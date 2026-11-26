// =========================================================
// Audit log helper (Req 15)
//
// logAction(req, "campaign.approve", { type: "Campaign", id, label: title }, "optional details")
// Writing the log never breaks the real action: if saving fails we only print the error.
// =========================================================

const AuditLog = require("../models/AuditLog");

async function logAction(req, action, target = {}, details = "", actor = null) {
  try {
    const who = actor || (req && req.user) || {};
    await AuditLog.create({
      actor: who._id,
      actorName: who.name || "Unknown",
      actorRole: who.role || "",
      action,
      category: action.split(".")[0],
      targetType: target.type,
      targetId: target.id,
      targetLabel: target.label ? String(target.label).slice(0, 200) : "",
      details: String(details || "").slice(0, 500),
      ip: req && (req.ip || (req.headers && req.headers["x-forwarded-for"])) ? String(req.ip || req.headers["x-forwarded-for"]) : "",
    });
  } catch (err) {
    console.error("Audit log failed:", err.message);
  }
}

module.exports = { logAction };
