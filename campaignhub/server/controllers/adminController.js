const mongoose = require("mongoose");
const User = require("../models/User");
const Campaign = require("../models/Campaign");
const { publicUser } = require("./authController");
const { logAction } = require("../services/audit");

// GET /api/admin/volunteers?status=pending
async function listVolunteers(req, res) {
  try {
    const filter = { role: "volunteer" };
    if (req.query.status) filter.status = req.query.status;
    const volunteers = await User.find(filter).sort({ createdAt: -1 });
    res.json({ volunteers: volunteers.map((v) => ({ ...publicUser(v), createdAt: v.createdAt })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

// PATCH /api/admin/volunteers/:id   body: { decision: "approved" | "rejected", reason }
async function reviewVolunteer(req, res) {
  try {
    const { decision, reason } = req.body;

    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be approved or rejected" });
    }
    // Rejection reason is mandatory (Req 4.1)
    if (decision === "rejected" && (!reason || !reason.trim())) {
      return res.status(400).json({ message: "A reason is required when rejecting" });
    }

    const volunteer = await User.findOne({ _id: req.params.id, role: "volunteer" });
    if (!volunteer) return res.status(404).json({ message: "Volunteer not found" });

    volunteer.status = decision;
    volunteer.rejectionReason = decision === "rejected" ? reason.trim() : "";
    await volunteer.save();

    await logAction(req, decision === "approved" ? "account.approve" : "account.reject", { type: "User", id: volunteer._id, label: volunteer.name }, decision === "rejected" ? `Reason: ${reason.trim()}` : volunteer.email);

    res.json({ message: `Volunteer ${decision}`, volunteer: publicUser(volunteer) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

// =========================================================
// MANAGERS (Req 17)
// =========================================================

// GET /api/admin/managers  — every manager with a summary of their campaigns
async function listManagers(req, res) {
  try {
    const managers = await User.find({ role: "manager" }).sort({ createdAt: -1 });
    const campaigns = await Campaign.find({ manager: { $in: managers.map((m) => m._id) } });

    const result = managers.map((m) => {
      const own = campaigns.filter((c) => String(c.manager) === String(m._id));
      const count = (s) => own.filter((c) => c.status === s).length;
      return {
        ...publicUser(m),
        createdAt: m.createdAt,
        removedAt: m.removedAt,
        stats: {
          total: own.filter((c) => c.status !== "draft").length, // drafts are private
          drafts: count("draft"),
          waiting: count("submitted"),
          active: count("active"),
          completed: count("completed"),
          removed: count("removed"),
          budget: own
            .filter((c) => ["approved", "active", "completion_review", "completed"].includes(c.status))
            .reduce((sum, c) => sum + (c.budget || 0), 0),
        },
      };
    });

    res.json({ managers: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

// PATCH /api/admin/managers/:id/remove   body: { reason }
// The manager can no longer log in (they see the reason), and all their campaigns are removed.
async function removeManager(req, res) {
  try {
    const reason = (req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ message: "A reason is required to remove a manager" });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Manager not found" });

    const manager = await User.findOne({ _id: req.params.id, role: "manager" });
    if (!manager) return res.status(404).json({ message: "Manager not found" });
    if (manager.status === "removed") return res.status(400).json({ message: "This manager is already removed" });

    manager.status = "removed";
    manager.removalReason = reason;
    manager.removedAt = new Date();
    await manager.save();

    // Take down every campaign of this manager that is not a draft and not already removed
    const campaigns = await Campaign.find({ manager: manager._id, status: { $nin: ["draft", "removed"] } });
    for (const c of campaigns) {
      c.statusBeforeRemoval = c.status;
      c.status = "removed";
      c.removalReason = `Manager account removed: ${reason}`;
      c.removedAt = new Date();
      c.removedBy = req.user._id;
      c.removedWithManager = true;
      await c.save();
    }

    await logAction(req, "account.remove_manager", { type: "User", id: manager._id, label: manager.name }, `Reason: ${reason}${campaigns.length ? ` · ${campaigns.length} campaign(s) removed` : ""}`);
    res.json({
      message: `${manager.name} was removed${campaigns.length ? ` along with ${campaigns.length} campaign(s)` : ""}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

// PATCH /api/admin/managers/:id/restore  — undo a removal (also brings back their campaigns)
async function restoreManager(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Manager not found" });
    const manager = await User.findOne({ _id: req.params.id, role: "manager" });
    if (!manager) return res.status(404).json({ message: "Manager not found" });
    if (manager.status !== "removed") return res.status(400).json({ message: "Only removed managers can be restored" });

    manager.status = "approved";
    manager.removalReason = "";
    manager.removedAt = undefined;
    await manager.save();

    // Only campaigns that were removed together with the manager come back
    const campaigns = await Campaign.find({ manager: manager._id, status: "removed", removedWithManager: true });
    for (const c of campaigns) {
      c.status = c.statusBeforeRemoval || "approved";
      c.statusBeforeRemoval = "";
      c.removalReason = "";
      c.removedAt = undefined;
      c.removedBy = undefined;
      c.removedWithManager = false;
      await c.save();
    }

    await logAction(req, "account.restore_manager", { type: "User", id: manager._id, label: manager.name }, campaigns.length ? `${campaigns.length} campaign(s) restored` : "");
    res.json({
      message: `${manager.name} was restored${campaigns.length ? ` along with ${campaigns.length} campaign(s)` : ""}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = { listVolunteers, reviewVolunteer, listManagers, removeManager, restoreManager };
