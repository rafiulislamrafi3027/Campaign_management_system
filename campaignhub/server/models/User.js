const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false }, // hashed, never returned by default
    role: { type: String, enum: ["admin", "manager", "volunteer"], required: true },

    // Volunteers start as "pending" until the Admin approves them (Req 1.5)
    // "removed" = account removed by the Admin (Req 17). The record is kept so the user sees the reason.
    status: { type: String, enum: ["pending", "approved", "rejected", "removed"], default: "approved" },
    rejectionReason: { type: String, default: "" },
    removalReason: { type: String, default: "" },
    removedAt: Date,

    // Profile fields
    phone: { type: String, default: "" },
    organization: { type: String, default: "" }, // managers
    skills: [{ type: String, trim: true }],      // volunteers
    availability: { type: String, default: "" }, // e.g. "Weekends", "Evenings"
    location: { type: String, default: "" },
    avgRating: { type: Number, default: 0 },

    // Forgot password: a 6-digit code (stored only as a hash) that expires after 10 minutes
    resetCodeHash: { type: String, select: false },
    resetCodeExpires: { type: Date, select: false },
    resetAttempts: { type: Number, default: 0, select: false },
    resetRequestedAt: { type: Date, select: false },
    // Tokens issued before this time stop working (after a password change/reset)
    passwordChangedAt: Date,

    // When the user last looked at each kind of update ("seen" = the update disappears)
    alertsSeen: {
      applications: Date, // My Applications page (volunteer)
      tasks: Date,        // My Tasks page (volunteer)
      campaigns: Date,    // My Campaigns page (manager)
      certificates: Date, // My Certificates page (volunteer)
      all: Date,          // "Mark all as read" on the dashboard
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
