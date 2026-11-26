const mongoose = require("mongoose");

// Audit log (Req 15): who did what, to what, and when.
// It is READ-ONLY: entries can be added but never edited or deleted (enforced below).
const auditSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorName: String, // copied so the log still reads correctly if the user changes later
    actorRole: String,
    action: { type: String, required: true }, // e.g. "campaign.approve"
    category: { type: String, required: true }, // account | campaign | application | task | expense | certificate
    targetType: String,
    targetId: mongoose.Schema.Types.ObjectId,
    targetLabel: String,
    details: { type: String, default: "" },
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ createdAt: -1 });
auditSchema.index({ category: 1, createdAt: -1 });

// Block every kind of change or delete — the log can only grow
const blocked = function (next) {
  next(new Error("The audit log is read-only"));
};
["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete", "findOneAndReplace"].forEach((op) =>
  auditSchema.pre(op, blocked)
);
auditSchema.pre("save", function (next) {
  if (!this.isNew) return next(new Error("The audit log is read-only"));
  next();
});

module.exports = mongoose.model("AuditLog", auditSchema);
