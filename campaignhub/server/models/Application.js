const mongoose = require("mongoose");

// A volunteer's request to join a campaign (Req 3.2, 2.2)
// applied -> accepted / rejected   (the volunteer can withdraw while it is "applied")
const applicationSchema = new mongoose.Schema(
  {
    volunteer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    message: { type: String, trim: true, maxlength: 600, default: "" }, // why they want to join
    status: { type: String, enum: ["applied", "accepted", "rejected"], default: "applied" },
    decisionNote: { type: String, trim: true, maxlength: 600, default: "" },
    decidedAt: Date,
  },
  { timestamps: true }
);

// One application per volunteer per campaign
applicationSchema.index({ volunteer: 1, campaign: 1 }, { unique: true });

module.exports = mongoose.model("Application", applicationSchema);
