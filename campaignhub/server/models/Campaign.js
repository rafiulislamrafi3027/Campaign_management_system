const mongoose = require("mongoose");

// Campaign workflow (Req 7):
// draft -> submitted -> approved / rejected -> active -> completion_review -> completed
//                                                       (Admin sends it back) -> active
// The Admin can "remove" any non-draft campaign at any time (Req 17), and restore it later.
const STATUSES = ["draft", "submitted", "approved", "rejected", "active", "completion_review", "completed", "removed"];

const photoSchema = new mongoose.Schema(
  { url: { type: String }, name: { type: String }, type: { type: String }, size: { type: Number } },
  { _id: false }
);

// Completion Report (Req 7, 2.7, 4.5): written by the Manager when the campaign ends, verified by the Admin.
// "stats" is calculated by the system from tasks, applications and expenses — the Manager cannot type it.
const completionSchema = new mongoose.Schema(
  {
    summary: { type: String, trim: true, maxlength: 3000 },
    beneficiariesReached: { type: Number, min: 0 },
    challenges: { type: String, trim: true, maxlength: 1500, default: "" },
    photos: [photoSchema],
    stats: {
      tasksTotal: Number,
      tasksVerified: Number,
      lateSubmissions: Number,
      volunteersJoined: Number,
      volunteersContributed: Number,
      avgRating: Number,
      budget: Number,
      spent: Number,
      utilization: Number,
      budgetStatus: { type: String },
      expenseCount: Number,
    },
    status: { type: String, enum: ["submitted", "approved", "returned"], default: "submitted" },
    submittedAt: Date,
    round: { type: Number, default: 1 }, // 2, 3 ... when resubmitted after the Admin sent it back
    reviewComment: { type: String, default: "" },
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false }
);

const campaignSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 3000 }, // goal / details
    category: {
      type: String,
      enum: ["Relief", "Education", "Health", "Environment", "Awareness", "Fundraising", "Other"],
      default: "Other",
    },
    location: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    budget: { type: Number, required: true, min: 0 },          // estimated / approved budget (BDT)
    beneficiaries: { type: Number, default: 0, min: 0 },       // expected number of people helped
    volunteersNeeded: { type: Number, default: 0, min: 0 },
    requiredSkills: [{ type: String, trim: true }],

    manager: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: STATUSES, default: "draft" },
    rejectionReason: { type: String, default: "" },

    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    activatedAt: Date,
    completedAt: Date,

    completionReport: { type: completionSchema, default: undefined },

    // Set when the Admin removes the campaign
    removalReason: { type: String, default: "" },
    statusBeforeRemoval: { type: String, default: "" },
    removedWithManager: { type: Boolean, default: false }, // true if removed because its manager was removed
    removedAt: Date,
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

campaignSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("Campaign", campaignSchema);
