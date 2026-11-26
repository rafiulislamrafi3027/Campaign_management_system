const mongoose = require("mongoose");

// One record per AI request (Req 22): who used which feature, when, and whether
// the suggestion was accepted, edited or rejected.
const aiLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String },
    feature: { type: String, enum: ["task_planner", "receipt_scanner", "campaign_recommendation"], required: true },
    ok: { type: Boolean, default: true },        // did the AI answer successfully?
    source: { type: String, default: "ai" },     // "ai" or "fallback" (skill match when AI is unavailable)
    ms: { type: Number, default: 0 },            // how long the AI took
    error: { type: String, default: "" },
    outcome: { type: String, enum: ["", "accepted", "edited", "rejected"], default: "" },
    meta: { type: Object, default: {} },         // e.g. { campaign, suggestions: 6 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("AiLog", aiLogSchema);
