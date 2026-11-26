const mongoose = require("mongoose");
const Task = require("../models/Task");
const Campaign = require("../models/Campaign");
const Application = require("../models/Application");
const User = require("../models/User");
const { rankVolunteers } = require("../services/allocation");
const { saveProofFiles, FileError } = require("../services/saveFiles");
const { logAction } = require("../services/audit");

const VOLUNTEER_FIELDS = "name email phone skills availability location avgRating status";

// ---------- helpers ----------
function serverError(res, err) {
  console.error(err);
  res.status(500).json({ message: "Server error" });
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const endOfDay = (x) => { const d = new Date(x); d.setHours(23, 59, 59, 999); return d; };
const validId = (id) => mongoose.isValidObjectId(id);

// The manager's own campaign, or null
async function ownCampaign(req, campaignId) {
  if (!validId(campaignId)) return null;
  return Campaign.findOne({ _id: campaignId, manager: req.user._id });
}

// Volunteers accepted in a campaign (Req 2.3: tasks only go to accepted volunteers)
async function acceptedVolunteers(campaignId) {
  const apps = await Application.find({ campaign: campaignId, status: "accepted" }).populate("volunteer", VOLUNTEER_FIELDS);
  return apps.map((a) => a.volunteer).filter((v) => v && v.status === "approved");
}

// Runs the allocation algorithm for a (possibly not yet saved) task
async function rankFor(campaign, task) {
  const volunteers = await acceptedVolunteers(campaign._id);
  const tasks = await Task.find({ assignedTo: { $in: volunteers.map((v) => v._id) } });
  return rankVolunteers(task, campaign, volunteers, tasks);
}

// Checks title / deadline / priority. Returns an error message or null.
function validateTask(data, campaign) {
  if (!data.title || !String(data.title).trim()) return "Task title is required";
  if (!data.deadline || isNaN(new Date(data.deadline))) return "A valid deadline is required";
  if (endOfDay(data.deadline) < startOfToday()) return "The deadline cannot be in the past";
  if (endOfDay(data.deadline) > endOfDay(campaign.endDate)) return "The deadline must be on or before the campaign end date";
  if (data.priority && !["low", "medium", "high"].includes(data.priority)) return "Priority must be low, medium or high";
  return null;
}

function pickTaskFields(body) {
  const out = {};
  ["title", "description", "requiredSkill", "priority"].forEach((f) => {
    if (body[f] !== undefined) out[f] = String(body[f]).trim();
  });
  if (body.deadline) out.deadline = new Date(body.deadline);
  if (body.assignedTo) out.assignedTo = body.assignedTo;
  return out;
}

// Recalculates a volunteer's average rating from all their rated tasks
async function updateAvgRating(volunteerId) {
  const done = await Task.find({ assignedTo: volunteerId, status: "completed" });
  const rated = done.filter((t) => t.rating);
  const avg = rated.length ? rated.reduce((s, t) => s + t.rating, 0) / rated.length : 0;
  const user = await User.findById(volunteerId);
  if (user) {
    user.avgRating = Math.round(avg * 10) / 10;
    await user.save();
  }
}

// =========================================================
// MANAGER
// =========================================================

// GET /api/tasks/recommend?campaign=ID&skill=Logistics&deadline=2026-12-10
// Ranked list of accepted volunteers for a new task (Req 9)
async function recommend(req, res) {
  try {
    const campaign = await ownCampaign(req, req.query.campaign);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });

    const t0 = Date.now();
    const ranked = await rankFor(campaign, {
      requiredSkill: req.query.skill || "",
      deadline: req.query.deadline ? new Date(req.query.deadline) : campaign.endDate,
    });

    res.json({
      tookMs: Date.now() - t0,
      candidates: ranked.map((r) => ({
        volunteer: {
          _id: r.volunteer._id,
          name: r.volunteer.name,
          skills: r.volunteer.skills,
          availability: r.volunteer.availability,
          location: r.volunteer.location,
          avgRating: r.volunteer.avgRating,
        },
        score: r.score,
        parts: r.parts,
        reasons: r.reasons,
        openTasks: r.stats.open,
      })),
    });
  } catch (err) {
    serverError(res, err);
  }
}

// GET /api/tasks/manager  — tasks of all this manager's active/completed campaigns
async function managerTasks(req, res) {
  try {
    const campaigns = await Campaign.find({ manager: req.user._id, status: { $in: ["active", "completion_review", "completed"] } }).sort({ startDate: 1 });
    const tasks = await Task.find({ campaign: { $in: campaigns.map((c) => c._id) } })
      .populate("assignedTo", VOLUNTEER_FIELDS)
      .populate("campaign", "title status startDate endDate requiredSkills")
      .sort({ deadline: 1 });

    const accepted = await Application.find({ campaign: { $in: campaigns.map((c) => c._id) }, status: "accepted" });

    res.json({
      campaigns: campaigns.map((c) => ({
        _id: c._id,
        title: c.title,
        status: c.status,
        startDate: c.startDate,
        endDate: c.endDate,
        requiredSkills: c.requiredSkills,
        acceptedVolunteers: accepted.filter((a) => String(a.campaign) === String(c._id)).length,
      })),
      tasks,
    });
  } catch (err) {
    serverError(res, err);
  }
}

// POST /api/tasks   body: { campaign, title, description, requiredSkill, priority, deadline, assignedTo }
async function createTask(req, res) {
  try {
    const campaign = await ownCampaign(req, req.body.campaign);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    if (campaign.status !== "active") return res.status(400).json({ message: "Tasks can only be added to active campaigns" });

    const data = pickTaskFields(req.body);
    const error = validateTask(data, campaign);
    if (error) return res.status(400).json({ message: error });

    if (!validId(data.assignedTo)) return res.status(400).json({ message: "Choose a volunteer for this task" });
    const ranked = await rankFor(campaign, data);
    const pick = ranked.find((r) => String(r.volunteer._id) === String(data.assignedTo));
    if (!pick) return res.status(400).json({ message: "You can only assign tasks to volunteers accepted in this campaign" });

    const task = await Task.create({
      ...data,
      campaign: campaign._id,
      createdBy: req.user._id,
      allocationScore: pick.score,
    });

    await logAction(req, "task.create", { type: "Task", id: task._id, label: task.title }, `${campaign.title} · assigned to ${pick.volunteer.name} (score ${pick.score})`);
    res.status(201).json({ message: `Task assigned to ${pick.volunteer.name}`, task });
  } catch (err) {
    serverError(res, err);
  }
}

// Finds a task that belongs to one of this manager's campaigns
async function ownTask(req, res) {
  if (!validId(req.params.id)) {
    res.status(404).json({ message: "Task not found" });
    return null;
  }
  const task = await Task.findById(req.params.id);
  const campaign = task && (await ownCampaign(req, task.campaign));
  if (!task || !campaign) {
    res.status(404).json({ message: "Task not found" });
    return null;
  }
  return { task, campaign };
}

// PUT /api/tasks/:id  — edit (only while nobody has started it)
async function updateTask(req, res) {
  try {
    const found = await ownTask(req, res);
    if (!found) return;
    const { task, campaign } = found;
    if (task.status !== "pending") return res.status(400).json({ message: "Only tasks that have not been started can be edited" });
    if (campaign.status !== "active") return res.status(400).json({ message: "The campaign is not active" });

    const data = pickTaskFields(req.body);
    const merged = { ...task.toObject(), ...data };
    const error = validateTask(merged, campaign);
    if (error) return res.status(400).json({ message: error });

    if (data.assignedTo && String(data.assignedTo) !== String(task.assignedTo)) {
      const ranked = await rankFor(campaign, merged);
      const pick = ranked.find((r) => String(r.volunteer._id) === String(data.assignedTo));
      if (!pick) return res.status(400).json({ message: "You can only assign tasks to volunteers accepted in this campaign" });
      data.allocationScore = pick.score;
    }

    Object.assign(task, data);
    await task.save();
    await logAction(req, "task.update", { type: "Task", id: task._id, label: task.title }, campaign.title);
    res.json({ message: "Task updated", task });
  } catch (err) {
    serverError(res, err);
  }
}

// DELETE /api/tasks/:id  — only while not started
async function deleteTask(req, res) {
  try {
    const found = await ownTask(req, res);
    if (!found) return;
    if (found.task.status !== "pending") return res.status(400).json({ message: "Only tasks that have not been started can be deleted" });
    await found.task.deleteOne();
    await logAction(req, "task.delete", { type: "Task", id: found.task._id, label: found.task.title }, found.campaign ? found.campaign.title : "");
    res.json({ message: "Task deleted" });
  } catch (err) {
    serverError(res, err);
  }
}

// PATCH /api/tasks/:id/review
// body: { decision: "completed", rating: 1-5, ratingComment }  or  { decision: "revision_required", feedback }
async function reviewTask(req, res) {
  try {
    const found = await ownTask(req, res);
    if (!found) return;
    const { task } = found;
    const { decision } = req.body;
    const feedback = String(req.body.feedback || "").trim();

    if (task.status !== "submitted") return res.status(400).json({ message: "Only submitted tasks can be reviewed" });
    if (!["completed", "revision_required"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be completed or revision_required" });
    }
    if (decision === "revision_required" && !feedback) {
      return res.status(400).json({ message: "Tell the volunteer what to fix (feedback is required)" });
    }

    let rating;
    if (decision === "completed" && req.body.rating !== undefined && req.body.rating !== "" && req.body.rating !== null) {
      rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ message: "Rating must be 1 to 5" });
    }

    const last = task.submissions[task.submissions.length - 1];
    last.decision = decision;
    last.feedback = feedback;
    last.reviewedAt = new Date();

    task.status = decision;
    if (decision === "completed") {
      task.completedAt = new Date();
      if (rating) {
        task.rating = rating;
        task.ratingComment = String(req.body.ratingComment || "").trim();
      }
    }
    if (task.markModified) task.markModified("submissions");
    await task.save();

    if (decision === "completed" && rating) await updateAvgRating(task.assignedTo);

    await logAction(req, decision === "completed" ? "task.verify" : "task.revision", { type: "Task", id: task._id, label: task.title }, decision === "completed" ? (rating ? `Rating: ${rating}/5` : "No rating") : `Feedback: ${feedback}`);
    res.json({
      message: decision === "completed" ? "Task verified as completed" : "Sent back to the volunteer for revision",
      task,
    });
  } catch (err) {
    serverError(res, err);
  }
}

// =========================================================
// VOLUNTEER
// =========================================================

// GET /api/tasks/mine
async function myTasks(req, res) {
  try {
    const tasks = await Task.find({ assignedTo: req.user._id })
      .populate({ path: "campaign", select: "title status location startDate endDate manager", populate: { path: "manager", select: "name organization" } })
      .sort({ deadline: 1 });
    res.json({ tasks });
  } catch (err) {
    serverError(res, err);
  }
}

// The volunteer's own task + its campaign must be active
async function ownVolunteerTask(req, res) {
  if (!validId(req.params.id)) {
    res.status(404).json({ message: "Task not found" });
    return null;
  }
  const task = await Task.findOne({ _id: req.params.id, assignedTo: req.user._id });
  if (!task) {
    res.status(404).json({ message: "Task not found" });
    return null;
  }
  const campaign = await Campaign.findById(task.campaign);
  if (!campaign || campaign.status !== "active") {
    res.status(400).json({ message: "This campaign is not active any more" });
    return null;
  }
  return task;
}

// PATCH /api/tasks/:id/start  — pending -> in_progress
async function startTask(req, res) {
  try {
    const task = await ownVolunteerTask(req, res);
    if (!task) return;
    if (task.status !== "pending") return res.status(400).json({ message: "This task has already been started" });
    task.status = "in_progress";
    task.startedAt = new Date();
    await task.save();
    res.json({ message: "Task started. Good luck!", task });
  } catch (err) {
    serverError(res, err);
  }
}

// POST /api/tasks/:id/submit   body: { summary, links: [], files: [{ name, data }] }
// in_progress / revision_required -> submitted.  The volunteer can NEVER set "completed" (Req 3.4).
async function submitProof(req, res) {
  try {
    const task = await ownVolunteerTask(req, res);
    if (!task) return;
    if (!["in_progress", "revision_required"].includes(task.status)) {
      return res.status(400).json({
        message: task.status === "pending" ? "Start the task before submitting proof" : `This task is already ${task.status.replace("_", " ")}`,
      });
    }

    const summary = String(req.body.summary || "").trim();
    if (summary.length < 10) return res.status(400).json({ message: "Please describe what you did (at least 10 characters)" });

    const links = (Array.isArray(req.body.links) ? req.body.links : [])
      .map((l) => String(l).trim())
      .filter(Boolean);
    if (links.length > 5) return res.status(400).json({ message: "You can add at most 5 links" });
    const badLink = links.find((l) => !/^https?:\/\/\S+\.\S+/.test(l));
    if (badLink) return res.status(400).json({ message: `"${badLink}" is not a valid link (start with http:// or https://)` });

    const incoming = Array.isArray(req.body.files) ? req.body.files : [];
    if (!incoming.length && !links.length) {
      return res.status(400).json({ message: "Add at least one photo, file or link as proof" });
    }

    let files = [];
    try {
      files = saveProofFiles(incoming);
    } catch (e) {
      if (e instanceof FileError) return res.status(400).json({ message: e.message });
      throw e;
    }

    const isLate = new Date() > endOfDay(task.deadline);
    task.submissions.push({ summary, files, links, submittedAt: new Date(), isLate, decision: "", feedback: "" });
    task.status = "submitted";
    if (task.markModified) task.markModified("submissions");
    await task.save();

    await logAction(req, "task.submit", { type: "Task", id: task._id, label: task.title }, `${files.length} file(s), ${links.length} link(s)${isLate ? " · LATE" : ""}`);
    res.json({
      message: isLate ? "Proof submitted (after the deadline). The manager will review it." : "Proof submitted! The manager will review it.",
      task,
    });
  } catch (err) {
    serverError(res, err);
  }
}

module.exports = { recommend, managerTasks, createTask, updateTask, deleteTask, reviewTask, myTasks, startTask, submitProof };
