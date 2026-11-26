const mongoose = require("mongoose");

// Task workflow (Req 10 — proof-based verification):
//   pending -> in_progress -> submitted -> completed
//                                       -> revision_required -> in_progress -> submitted ...
// Only the MANAGER can move a task to "completed".
const STATUSES = ["pending", "in_progress", "submitted", "revision_required", "completed"];

const fileSchema = new mongoose.Schema(
  {
    url: String,  // e.g. /uploads/proofs/ab12cd.jpg
    name: String, // original file name
    type: String, // image/jpeg, image/png, application/pdf
    size: Number, // bytes
  },
  { _id: false }
);

// One proof submission by the volunteer (a task can have several if revisions were asked)
const submissionSchema = new mongoose.Schema(
  {
    summary: { type: String, trim: true, maxlength: 2000 },
    files: [fileSchema],
    links: [{ type: String, trim: true }],
    submittedAt: { type: Date, default: Date.now },
    isLate: { type: Boolean, default: false },
    // filled by the manager when reviewing this submission
    decision: { type: String, enum: ["completed", "revision_required", ""], default: "" },
    feedback: { type: String, trim: true, default: "" },
    reviewedAt: Date,
  },
  { _id: true }
);

const taskSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // manager
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // volunteer

    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    requiredSkill: { type: String, trim: true, default: "" },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    deadline: { type: Date, required: true },

    status: { type: String, enum: STATUSES, default: "pending" },
    startedAt: Date,
    completedAt: Date,

    submissions: [submissionSchema],

    // Manager's rating after verifying the work (Req 13)
    rating: { type: Number, min: 1, max: 5 },
    ratingComment: { type: String, trim: true, default: "" },

    // Score from the allocation algorithm when the task was assigned (for the report)
    allocationScore: { type: Number, default: 0 },
  },
  { timestamps: true }
);

taskSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("Task", taskSchema);
