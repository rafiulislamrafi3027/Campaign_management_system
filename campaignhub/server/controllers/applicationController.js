const mongoose = require("mongoose");
const Application = require("../models/Application");
const Campaign = require("../models/Campaign");
const User = require("../models/User");
const { logAction } = require("../services/audit");

function serverError(res, err) {
  console.error(err);
  res.status(500).json({ message: "Server error" });
}

// =========================================================
// VOLUNTEER
// =========================================================

// POST /api/applications   body: { campaignId, message }
async function apply(req, res) {
  try {
    const { campaignId, message = "" } = req.body;
    if (!mongoose.isValidObjectId(campaignId)) return res.status(404).json({ message: "Campaign not found" });

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    if (campaign.status !== "active") {
      return res.status(400).json({ message: "You can only apply to active campaigns" });
    }

    const existing = await Application.findOne({ volunteer: req.user._id, campaign: campaign._id });
    if (existing) {
      return res.status(409).json({ message: `You have already applied to this campaign (status: ${existing.status})` });
    }

    const application = await Application.create({
      volunteer: req.user._id,
      campaign: campaign._id,
      message: String(message).trim().slice(0, 600),
    });

    await logAction(req, "application.apply", { type: "Campaign", id: campaign._id, label: campaign.title });
    res.status(201).json({ message: "Application sent! The manager will review it.", application });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "You have already applied to this campaign" });
    serverError(res, err);
  }
}

// GET /api/applications/mine
async function myApplications(req, res) {
  try {
    const applications = await Application.find({ volunteer: req.user._id })
      .populate({
        path: "campaign",
        select: "title category location startDate endDate status budget volunteersNeeded requiredSkills description beneficiaries manager removalReason",
        populate: { path: "manager", select: "name organization" },
      })
      .sort({ createdAt: -1 });
    res.json({ applications });
  } catch (err) {
    serverError(res, err);
  }
}

// DELETE /api/applications/:id  — withdraw (only while "applied")
async function withdraw(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Application not found" });
    const application = await Application.findOne({ _id: req.params.id, volunteer: req.user._id });
    if (!application) return res.status(404).json({ message: "Application not found" });
    if (application.status !== "applied") {
      return res.status(400).json({ message: `An ${application.status} application cannot be withdrawn` });
    }
    await application.deleteOne();
    await logAction(req, "application.withdraw", { type: "Campaign", id: application.campaign, label: "" });
    res.json({ message: "Application withdrawn" });
  } catch (err) {
    serverError(res, err);
  }
}

// =========================================================
// MANAGER
// =========================================================

// GET /api/applications/manager  — applications for all of this manager's campaigns
async function managerApplications(req, res) {
  try {
    const campaigns = await Campaign.find({ manager: req.user._id, status: { $in: ["active", "completion_review", "completed"] } }).sort({
      startDate: 1,
    });
    const ids = campaigns.map((c) => c._id);

    const applications = await Application.find({ campaign: { $in: ids } })
      .populate("volunteer", "name email phone skills availability location avgRating")
      .populate("campaign", "title requiredSkills volunteersNeeded status startDate endDate")
      .sort({ createdAt: -1 });

    // How many volunteers are already accepted in each campaign
    const accepted = {};
    applications.forEach((a) => {
      if (a.status === "accepted" && a.campaign) {
        const key = String(a.campaign._id);
        accepted[key] = (accepted[key] || 0) + 1;
      }
    });

    res.json({
      campaigns: campaigns.map((c) => ({
        _id: c._id,
        title: c.title,
        status: c.status,
        volunteersNeeded: c.volunteersNeeded,
        accepted: accepted[String(c._id)] || 0,
      })),
      applications,
    });
  } catch (err) {
    serverError(res, err);
  }
}

// PATCH /api/applications/:id/decision   body: { decision: "accepted" | "rejected", note }
async function decide(req, res) {
  try {
    const { decision, note = "" } = req.body;
    if (!["accepted", "rejected"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be accepted or rejected" });
    }
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Application not found" });

    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ message: "Application not found" });

    // The manager can only decide on applications for their own campaigns
    const campaign = await Campaign.findOne({ _id: application.campaign, manager: req.user._id });
    if (!campaign) return res.status(404).json({ message: "Application not found" });

    if (campaign.status !== "active") {
      return res.status(400).json({ message: "Applications can only be reviewed while the campaign is active" });
    }
    if (application.status !== "applied") {
      return res.status(400).json({ message: `This application is already ${application.status}` });
    }

    // Do not accept more volunteers than the campaign needs
    if (decision === "accepted" && campaign.volunteersNeeded > 0) {
      const acceptedCount = await Application.countDocuments({ campaign: campaign._id, status: "accepted" });
      if (acceptedCount >= campaign.volunteersNeeded) {
        return res.status(400).json({
          message: `This campaign already has all ${campaign.volunteersNeeded} volunteers it needs`,
        });
      }
    }

    application.status = decision;
    application.decisionNote = String(note).trim().slice(0, 600);
    application.decidedAt = new Date();
    await application.save();

    const vol = await User.findById(application.volunteer);
    await logAction(req, decision === "accepted" ? "application.accept" : "application.reject", { type: "Campaign", id: campaign._id, label: campaign.title }, `Volunteer: ${vol ? vol.name : "—"}${application.decisionNote ? ` · Note: ${application.decisionNote}` : ""}`);
    res.json({ message: `Application ${decision}`, application });
  } catch (err) {
    serverError(res, err);
  }
}

module.exports = { apply, myApplications, withdraw, managerApplications, decide };
