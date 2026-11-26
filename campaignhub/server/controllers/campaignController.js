const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");
const Task = require("../models/Task");
const Expense = require("../models/Expense");
const Application = require("../models/Application");
const { completionStats } = require("../services/completion");
const { saveProofFiles, FileError } = require("../services/saveFiles");
const { issueForCampaign } = require("../services/certificates");
const { logAction } = require("../services/audit");

const EDITABLE = ["draft", "rejected"]; // Req 2.1: no editing after submit unless rejected

// ---------- helpers ----------
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Reads and cleans the campaign fields from the request body
function pickFields(body) {
  const data = {};
  ["title", "description", "category", "location"].forEach((f) => {
    if (body[f] !== undefined) data[f] = String(body[f]).trim();
  });
  ["budget", "beneficiaries", "volunteersNeeded"].forEach((f) => {
    if (body[f] !== undefined && body[f] !== "") data[f] = Number(body[f]);
  });
  ["startDate", "endDate"].forEach((f) => {
    if (body[f]) data[f] = new Date(body[f]);
  });
  if (body.requiredSkills !== undefined) {
    const list = Array.isArray(body.requiredSkills) ? body.requiredSkills : String(body.requiredSkills).split(",");
    data.requiredSkills = list.map((s) => String(s).trim()).filter(Boolean);
  }
  return data;
}

// Returns an error message, or null if the campaign data is valid
function validate(c, { forSubmit = false } = {}) {
  if (!c.title) return "Title is required";
  if (!c.description) return "Description is required";
  if (!c.location) return "Location is required";
  if (!c.startDate || isNaN(new Date(c.startDate))) return "A valid start date is required";
  if (!c.endDate || isNaN(new Date(c.endDate))) return "A valid end date is required";
  if (new Date(c.endDate) < new Date(c.startDate)) return "End date cannot be before the start date";
  if (c.budget === undefined || isNaN(c.budget) || c.budget <= 0) return "Budget must be greater than 0";
  for (const f of ["beneficiaries", "volunteersNeeded"]) {
    if (c[f] !== undefined && (isNaN(c[f]) || c[f] < 0)) return `${f} cannot be negative`;
  }
  if (forSubmit && new Date(c.startDate) < startOfToday()) {
    return "Start date is in the past. Please update the dates before submitting";
  }
  return null;
}

// Finds a campaign that belongs to the logged-in manager
async function findOwn(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ message: "Campaign not found" });
    return null;
  }
  const campaign = await Campaign.findOne({ _id: req.params.id, manager: req.user._id });
  if (!campaign) res.status(404).json({ message: "Campaign not found" });
  return campaign;
}

function serverError(res, err) {
  console.error(err);
  res.status(500).json({ message: "Server error" });
}

// =========================================================
// MANAGER
// =========================================================

// POST /api/campaigns  — create a draft
async function createCampaign(req, res) {
  try {
    const data = pickFields(req.body);
    const error = validate(data);
    if (error) return res.status(400).json({ message: error });

    const campaign = await Campaign.create({ ...data, manager: req.user._id, status: "draft" });
    await logAction(req, "campaign.create", { type: "Campaign", id: campaign._id, label: campaign.title }, `Budget ৳${campaign.budget}`);
    res.status(201).json({ message: "Campaign saved as draft", campaign });
  } catch (err) {
    serverError(res, err);
  }
}

// GET /api/campaigns/mine  — the manager's own campaigns
async function getMyCampaigns(req, res) {
  try {
    const campaigns = await Campaign.find({ manager: req.user._id }).sort({ updatedAt: -1 });
    res.json({ campaigns });
  } catch (err) {
    serverError(res, err);
  }
}

// PUT /api/campaigns/:id  — edit (only draft or rejected)
async function updateCampaign(req, res) {
  try {
    const campaign = await findOwn(req, res);
    if (!campaign) return;
    if (!EDITABLE.includes(campaign.status)) {
      return res.status(400).json({ message: `A ${campaign.status} campaign cannot be edited` });
    }

    const data = pickFields(req.body);
    const merged = { ...campaign.toObject(), ...data };
    const error = validate(merged);
    if (error) return res.status(400).json({ message: error });

    Object.assign(campaign, data);
    // Editing a rejected campaign moves it back to draft so it can be resubmitted
    if (campaign.status === "rejected") campaign.status = "draft";
    await campaign.save();

    res.json({ message: "Campaign updated", campaign });
  } catch (err) {
    serverError(res, err);
  }
}

// DELETE /api/campaigns/:id  — only draft or rejected
async function deleteCampaign(req, res) {
  try {
    const campaign = await findOwn(req, res);
    if (!campaign) return;
    if (!EDITABLE.includes(campaign.status)) {
      return res.status(400).json({ message: `A ${campaign.status} campaign cannot be deleted` });
    }
    await campaign.deleteOne();
    await logAction(req, "campaign.delete_draft", { type: "Campaign", id: campaign._id, label: campaign.title });
    res.json({ message: "Campaign deleted" });
  } catch (err) {
    serverError(res, err);
  }
}

// PATCH /api/campaigns/:id/submit  — draft/rejected -> submitted
async function submitCampaign(req, res) {
  try {
    const campaign = await findOwn(req, res);
    if (!campaign) return;
    if (!EDITABLE.includes(campaign.status)) {
      return res.status(400).json({ message: "Only draft or rejected campaigns can be submitted" });
    }
    const error = validate(campaign, { forSubmit: true });
    if (error) return res.status(400).json({ message: error });

    campaign.status = "submitted";
    campaign.rejectionReason = "";
    campaign.submittedAt = new Date();
    await campaign.save();

    await logAction(req, "campaign.submit", { type: "Campaign", id: campaign._id, label: campaign.title }, `Budget ৳${campaign.budget}`);
    res.json({ message: "Campaign submitted for Admin approval", campaign });
  } catch (err) {
    serverError(res, err);
  }
}

// PATCH /api/campaigns/:id/activate  — approved -> active (visible to volunteers)
async function activateCampaign(req, res) {
  try {
    const campaign = await findOwn(req, res);
    if (!campaign) return;
    if (campaign.status !== "approved") {
      return res.status(400).json({ message: "Only approved campaigns can be made active" });
    }
    campaign.status = "active";
    campaign.activatedAt = new Date();
    await campaign.save();
    await logAction(req, "campaign.activate", { type: "Campaign", id: campaign._id, label: campaign.title });
    res.json({ message: "Campaign is now active and visible to volunteers", campaign });
  } catch (err) {
    serverError(res, err);
  }
}

// =========================================================
// COMPLETION REPORT (Req 7, 2.7, 4.5)
// active --(Manager submits report)--> completion_review --(Admin approves)--> completed
//                                                        --(Admin sends back)--> active
// =========================================================

// GET /api/campaigns/:id/completion  — Manager: live statistics + open tasks before writing the report
async function getCompletion(req, res) {
  try {
    const campaign = await findOwn(req, res);
    if (!campaign) return;
    const { stats, openTasks } = await completionStats(campaign);
    res.json({ campaign, stats, openTasks });
  } catch (err) {
    serverError(res, err);
  }
}

// POST /api/campaigns/:id/completion
// body: { summary, beneficiariesReached, challenges, photos: [{ name, data }], keepPhotos }
async function submitCompletion(req, res) {
  try {
    const campaign = await findOwn(req, res);
    if (!campaign) return;
    if (campaign.status !== "active") {
      return res.status(400).json({ message: "A completion report can only be sent for an active campaign" });
    }

    const summary = String(req.body.summary || "").trim();
    const challenges = String(req.body.challenges || "").trim();
    const reached = req.body.beneficiariesReached;
    if (summary.length < 30) return res.status(400).json({ message: "Please describe what the campaign achieved (at least 30 characters)" });
    if (summary.length > 3000) return res.status(400).json({ message: "The summary is too long (max 3000 characters)" });
    if (challenges.length > 1500) return res.status(400).json({ message: "Challenges text is too long (max 1500 characters)" });
    if (reached === undefined || reached === null || reached === "" || !Number.isInteger(Number(reached)) || Number(reached) < 0) {
      return res.status(400).json({ message: "Enter how many people were actually helped (a whole number, 0 or more)" });
    }

    // Every task must be finished (verified) first — no open work left behind
    const { stats, openTasks } = await completionStats(campaign);
    if (openTasks.length) {
      return res.status(400).json({
        message: `${openTasks.length} task${openTasks.length === 1 ? " is" : "s are"} not finished yet. Verify them or delete pending ones first.`,
        openTasks,
      });
    }

    // Photos: new ones, or keep the photos of the report the Admin sent back
    const old = campaign.completionReport;
    let photos = [];
    const incoming = Array.isArray(req.body.photos) ? req.body.photos : [];
    if (incoming.length) {
      try {
        photos = saveProofFiles(incoming, { folder: "reports", maxFiles: 5 });
      } catch (e) {
        if (e instanceof FileError) return res.status(400).json({ message: e.message });
        throw e;
      }
    } else if (req.body.keepPhotos && old && old.photos && old.photos.length) {
      photos = old.photos;
    }
    if (!photos.length) return res.status(400).json({ message: "Add at least one photo or PDF as proof of the campaign" });

    campaign.completionReport = {
      summary,
      beneficiariesReached: Number(reached),
      challenges,
      photos,
      stats,
      status: "submitted",
      submittedAt: new Date(),
      round: old && old.round ? old.round + 1 : 1,
      reviewComment: "",
    };
    campaign.status = "completion_review";
    await campaign.save();

    await logAction(req, "campaign.report_submit", { type: "Campaign", id: campaign._id, label: campaign.title }, `Attempt ${campaign.completionReport.round} · ${campaign.completionReport.beneficiariesReached} people helped`);
    res.json({ message: "Completion report sent. The Admin will verify it.", campaign });
  } catch (err) {
    serverError(res, err);
  }
}

// =========================================================
// ADMIN
// =========================================================

// GET /api/campaigns/admin?status=submitted  — all campaigns except drafts
async function adminListCampaigns(req, res) {
  try {
    const filter = { status: { $ne: "draft" } }; // drafts are private to the manager
    if (req.query.status && req.query.status !== "draft") filter.status = req.query.status;
    const campaigns = await Campaign.find(filter)
      .populate("manager", "name email organization")
      .sort({ submittedAt: -1, updatedAt: -1 });
    res.json({ campaigns });
  } catch (err) {
    serverError(res, err);
  }
}

// PATCH /api/campaigns/:id/review  body: { decision: "approved" | "rejected", reason }  (Req 4.2)
async function reviewCampaign(req, res) {
  try {
    const { decision, reason } = req.body;
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be approved or rejected" });
    }
    if (decision === "rejected" && (!reason || !reason.trim())) {
      return res.status(400).json({ message: "A reason is required when rejecting" });
    }
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Campaign not found" });

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    if (campaign.status !== "submitted") {
      return res.status(400).json({ message: "Only submitted campaigns can be reviewed" });
    }

    campaign.status = decision;
    campaign.rejectionReason = decision === "rejected" ? reason.trim() : "";
    campaign.reviewedAt = new Date();
    campaign.reviewedBy = req.user._id;
    await campaign.save();

    // TODO (later step): notify the manager (Req 4.3) and write to the audit log

    await logAction(req, decision === "approved" ? "campaign.approve" : "campaign.reject", { type: "Campaign", id: campaign._id, label: campaign.title }, decision === "rejected" ? `Reason: ${campaign.rejectionReason}` : `Budget ৳${campaign.budget}`);
    res.json({ message: `Campaign ${decision}`, campaign });
  } catch (err) {
    serverError(res, err);
  }
}

// PATCH /api/campaigns/:id/remove   body: { reason }  — Admin removes a campaign (Req 17)
async function removeCampaign(req, res) {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ message: "A reason is required to remove a campaign" });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Campaign not found" });

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    if (campaign.status === "draft") return res.status(400).json({ message: "Draft campaigns are private to the manager" });
    if (campaign.status === "removed") return res.status(400).json({ message: "This campaign is already removed" });

    campaign.statusBeforeRemoval = campaign.status;
    campaign.status = "removed";
    campaign.removalReason = reason.trim();
    campaign.removedAt = new Date();
    campaign.removedBy = req.user._id;
    await campaign.save();

    // TODO (later step): notify the manager and volunteers, write to the audit log
    await logAction(req, "campaign.remove", { type: "Campaign", id: campaign._id, label: campaign.title }, `Reason: ${campaign.removalReason}`);
    res.json({ message: "Campaign removed. Volunteers can no longer see it.", campaign });
  } catch (err) {
    serverError(res, err);
  }
}

// PATCH /api/campaigns/:id/restore  — undo a removal
async function restoreCampaign(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Campaign not found" });
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    if (campaign.status !== "removed") return res.status(400).json({ message: "Only removed campaigns can be restored" });

    campaign.status = campaign.statusBeforeRemoval || "approved";
    campaign.statusBeforeRemoval = "";
    campaign.removedWithManager = false;
    campaign.removalReason = "";
    campaign.removedAt = undefined;
    campaign.removedBy = undefined;
    await campaign.save();

    await logAction(req, "campaign.restore", { type: "Campaign", id: campaign._id, label: campaign.title }, `Back to ${campaign.status}`);
    res.json({ message: `Campaign restored (status: ${campaign.status})`, campaign });
  } catch (err) {
    serverError(res, err);
  }
}

// DELETE /api/campaigns/:id/permanent  — delete a REMOVED campaign and all its applications for good
async function deleteCampaignPermanently(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Campaign not found" });
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    if (campaign.status !== "removed") {
      return res.status(400).json({ message: "Remove the campaign first, then you can delete it permanently" });
    }

    const result = await Application.deleteMany({ campaign: campaign._id });
    await Task.deleteMany({ campaign: campaign._id });
    await Expense.deleteMany({ campaign: campaign._id });
    await campaign.deleteOne();

    await logAction(req, "campaign.delete_permanent", { type: "Campaign", id: campaign._id, label: campaign.title }, `${result.deletedCount || 0} application(s) deleted`);
    res.json({ message: `Campaign deleted permanently along with ${result.deletedCount || 0} application(s)` });
  } catch (err) {
    serverError(res, err);
  }
}

// GET /api/campaigns/:id/completion/admin  — Admin: the report + all tasks with their proof
async function adminGetCompletion(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Campaign not found" });
    const campaign = await Campaign.findById(req.params.id).populate("manager", "name email organization");
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    if (!campaign.completionReport) return res.status(404).json({ message: "This campaign has no completion report yet" });

    const { stats, tasks } = await completionStats(campaign);
    res.json({
      campaign,
      liveStats: stats, // numbers right now (should match the report)
      tasks: tasks.map((t) => ({
        _id: t._id,
        title: t.title,
        status: t.status,
        assignedTo: t.assignedTo ? t.assignedTo.name : "",
        rating: t.rating || 0,
        deadline: t.deadline,
        proof: t.submissions && t.submissions.length ? t.submissions[t.submissions.length - 1] : null,
      })),
    });
  } catch (err) {
    serverError(res, err);
  }
}

// PATCH /api/campaigns/:id/completion/review   body: { decision: "approve" | "return", comment }
async function reviewCompletion(req, res) {
  try {
    const { decision } = req.body;
    const comment = String(req.body.comment || "").trim();
    if (!["approve", "return"].includes(decision)) return res.status(400).json({ message: "Decision must be approve or return" });
    if (decision === "return" && comment.length < 5) {
      return res.status(400).json({ message: "Tell the manager what to fix (at least 5 characters)" });
    }
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Campaign not found" });

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    if (campaign.status !== "completion_review" || !campaign.completionReport) {
      return res.status(400).json({ message: "This campaign is not waiting for completion review" });
    }

    const report = campaign.completionReport;
    report.reviewComment = comment;
    report.reviewedAt = new Date();
    report.reviewedBy = req.user._id;

    if (decision === "approve") {
      report.status = "approved";
      campaign.status = "completed";
      campaign.completedAt = new Date();
    } else {
      report.status = "returned";
      campaign.status = "active"; // the manager can fix things and send it again
    }
    campaign.markModified("completionReport");
    await campaign.save();

    // Req 14: certificates for every volunteer with at least one verified task
    let certificates = 0;
    if (decision === "approve") {
      try {
        certificates = await issueForCampaign(campaign, req.user._id);
      } catch (e) {
        console.error("Certificate issue failed:", e.message); // the campaign is still completed
      }
    }

    await logAction(req, decision === "approve" ? "campaign.report_verify" : "campaign.report_return", { type: "Campaign", id: campaign._id, label: campaign.title }, decision === "approve" ? `${certificates} certificate(s) issued${comment ? ` · ${comment}` : ""}` : `Comment: ${comment}`);
    res.json({
      message:
        decision === "approve"
          ? `Report verified. The campaign is now completed${certificates ? ` and ${certificates} certificate${certificates === 1 ? " was" : "s were"} issued` : ""}.`
          : "Report sent back to the manager",
      campaign,
      certificates,
    });
  } catch (err) {
    serverError(res, err);
  }
}

// =========================================================
// VOLUNTEER (and everyone logged in)
// =========================================================

// GET /api/campaigns/active  — only active campaigns (Req 3.1)
async function listActiveCampaigns(req, res) {
  try {
    const campaigns = await Campaign.find({ status: "active" })
      .populate("manager", "name organization")
      .sort({ startDate: 1 });
    res.json({ campaigns });
  } catch (err) {
    serverError(res, err);
  }
}

module.exports = {
  createCampaign,
  getMyCampaigns,
  updateCampaign,
  deleteCampaign,
  submitCampaign,
  activateCampaign,
  getCompletion,
  submitCompletion,
  adminGetCompletion,
  reviewCompletion,
  adminListCampaigns,
  reviewCampaign,
  removeCampaign,
  restoreCampaign,
  deleteCampaignPermanently,
  listActiveCampaigns,
};
