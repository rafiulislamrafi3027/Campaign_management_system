const mongoose = require("mongoose");

// One money entry for a campaign (Req 2.5)
const CATEGORIES = ["Purchase", "Transport", "Food", "Printing & Publicity", "Venue", "Volunteer Support", "Other"];

const expenseSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // manager

    title: { type: String, required: true, trim: true, maxlength: 120 }, // e.g. "200 blankets from Bongo Bazar"
    category: { type: String, enum: CATEGORIES, default: "Other" },
    amount: { type: Number, required: true, min: 1 }, // BDT
    date: { type: Date, required: true },
    vendor: { type: String, trim: true, maxlength: 120, default: "" },
    note: { type: String, trim: true, maxlength: 600, default: "" },

    // Note: "type" must be written as { type: String } here. A plain "type: String" inside a
    // nested object makes Mongoose think the whole "receipt" field is a String.
    receipt: {
      url: { type: String },
      name: { type: String },
      type: { type: String },
      size: { type: Number },
    },
  },
  { timestamps: true }
);

expenseSchema.statics.CATEGORIES = CATEGORIES;

module.exports = mongoose.model("Expense", expenseSchema);
