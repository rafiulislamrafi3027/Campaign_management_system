const mongoose = require("mongoose");

// Participation certificate (Req 14)
// Issued automatically when the Admin verifies a campaign's completion report,
// to every accepted volunteer with at least one verified (completed) task.
// The details are copied ("snapshot") so the certificate never changes later.
const certificateSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true }, // e.g. CH-2026-7KQ4XM — used to verify
    volunteer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },

    volunteerName: String,
    campaignTitle: String,
    category: String,
    organization: String,
    location: String,
    startDate: Date,
    endDate: Date,
    managerName: String,
    tasksCompleted: Number,
    taskTitles: [String],
    avgRating: Number,

    issuedAt: { type: Date, default: Date.now },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // the Admin who verified the report
  },
  { timestamps: true }
);

// One certificate per volunteer per campaign
certificateSchema.index({ volunteer: 1, campaign: 1 }, { unique: true });

module.exports = mongoose.model("Certificate", certificateSchema);
