const mongoose = require("mongoose");
const Expense = require("../models/Expense");
const Campaign = require("../models/Campaign");
const { utilization, totalsByCampaign } = require("../services/budget");
const { saveProofFiles, FileError } = require("../services/saveFiles");
const { logAction } = require("../services/audit");

// Expenses can be added/changed while the campaign is running
const OPEN_FOR_EXPENSES = ["approved", "active"];
// Campaigns that have a budget worth tracking
const TRACKED = ["approved", "active", "completion_review", "completed"];

function serverError(res, err) {
  console.error(err);
  res.status(500).json({ message: "Server error" });
}
const endOfDay = (x) => { const d = new Date(x); d.setHours(23, 59, 59, 999); return d; };

// Summary object for one campaign
function campaignSummary(c, totals) {
  const t = totals[String(c._id)] || { spent: 0, count: 0, byCategory: {} };
  return {
    _id: c._id,
    title: c.title,
    campaignStatus: c.status, // draft/approved/active/completed (the budget status is "status" below)
    startDate: c.startDate,
    endDate: c.endDate,
    manager: c.manager && c.manager.name ? { _id: c.manager._id, name: c.manager.name, organization: c.manager.organization } : undefined,
    expenseCount: t.count,
    byCategory: t.byCategory,
    ...utilization(c.budget, t.spent),
  };
}

// Reads and checks the expense fields. Returns { data } or { error }.
function readExpense(body, campaign, partial = false) {
  const data = {};
  if (body.title !== undefined) data.title = String(body.title).trim().slice(0, 120);
  if (body.category !== undefined) data.category = String(body.category);
  if (body.amount !== undefined) data.amount = Number(body.amount);
  if (body.date !== undefined) data.date = new Date(body.date);
  if (body.vendor !== undefined) data.vendor = String(body.vendor).trim().slice(0, 120);
  if (body.note !== undefined) data.note = String(body.note).trim().slice(0, 600);

  if (!partial || data.title !== undefined) if (!data.title) return { error: "What was the money spent on? (title is required)" };
  if (!partial || data.amount !== undefined) {
    if (!Number.isFinite(data.amount) || data.amount <= 0) return { error: "Amount must be greater than 0" };
    if (data.amount > 10000000) return { error: "Amount looks too large" };
    data.amount = Math.round(data.amount * 100) / 100;
  }
  if (data.category !== undefined && !Expense.CATEGORIES.includes(data.category)) return { error: "Choose a valid category" };
  if (!partial || data.date !== undefined) {
    if (!data.date || isNaN(data.date)) return { error: "A valid date is required" };
    if (data.date > endOfDay(new Date())) return { error: "The expense date cannot be in the future" };
    const earliest = new Date(campaign.createdAt || campaign.startDate);
    earliest.setDate(earliest.getDate() - 30);
    if (data.date < earliest) return { error: "The date is too early for this campaign" };
  }
  return { data };
}

// The manager's own campaign
async function ownCampaign(req, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Campaign.findOne({ _id: id, manager: req.user._id });
}

// Saves one optional receipt image/PDF; returns the receipt object or null
function saveReceipt(file) {
  if (!file) return null;
  return saveProofFiles([file], { folder: "receipts", maxFiles: 1 })[0];
}

// =========================================================
// MANAGER
// =========================================================

// GET /api/expenses/manager  — budget summary + expenses for the manager's campaigns
async function managerExpenses(req, res) {
  try {
    const campaigns = await Campaign.find({ manager: req.user._id, status: { $in: TRACKED } }).sort({ startDate: 1 });
    const expenses = await Expense.find({ campaign: { $in: campaigns.map((c) => c._id) } }).sort({ date: -1, createdAt: -1 });
    const totals = totalsByCampaign(expenses);
    res.json({
      categories: Expense.CATEGORIES,
      campaigns: campaigns.map((c) => ({ ...campaignSummary(c, totals), canEdit: OPEN_FOR_EXPENSES.includes(c.status) })),
      expenses,
    });
  } catch (err) {
    serverError(res, err);
  }
}

// POST /api/expenses   body: { campaign, title, category, amount, date, vendor, note, receipt: { name, data } }
async function createExpense(req, res) {
  try {
    const campaign = await ownCampaign(req, req.body.campaign);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    if (!OPEN_FOR_EXPENSES.includes(campaign.status)) {
      return res.status(400).json({ message: "Expenses can only be added to approved or active campaigns" });
    }

    const { data, error } = readExpense(req.body, campaign);
    if (error) return res.status(400).json({ message: error });

    let receipt = null;
    try {
      receipt = saveReceipt(req.body.receipt);
    } catch (e) {
      if (e instanceof FileError) return res.status(400).json({ message: e.message });
      throw e;
    }

    const before = utilization(campaign.budget, await spentOn(campaign._id));
    const expense = await Expense.create({ ...data, campaign: campaign._id, createdBy: req.user._id, ...(receipt ? { receipt } : {}) });
    const after = utilization(campaign.budget, before.spent + expense.amount);

    await logAction(req, "expense.create", { type: "Expense", id: expense._id, label: expense.title }, `${campaign.title} · ৳${expense.amount} · ${expense.category}${receipt ? " · with receipt" : ""}`);
    res.status(201).json({ message: budgetMessage("Expense added", before, after), expense, budget: after });
  } catch (err) {
    serverError(res, err);
  }
}

async function spentOn(campaignId) {
  const list = await Expense.find({ campaign: campaignId });
  return list.reduce((s, e) => s + e.amount, 0);
}

// Adds a warning to the success message when the budget line is crossed
function budgetMessage(base, before, after) {
  if (after.status === "exceeded" && before.status !== "exceeded") return `${base}. ⚠ Budget exceeded — now at ${after.rate}% of the budget.`;
  if (after.status === "warning" && before.status === "ok") return `${base}. Careful: ${after.rate}% of the budget is used.`;
  return base;
}

// Finds an expense of one of this manager's campaigns
async function ownExpense(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ message: "Expense not found" });
    return null;
  }
  const expense = await Expense.findById(req.params.id);
  const campaign = expense && (await ownCampaign(req, expense.campaign));
  if (!expense || !campaign) {
    res.status(404).json({ message: "Expense not found" });
    return null;
  }
  if (!OPEN_FOR_EXPENSES.includes(campaign.status)) {
    res.status(400).json({ message: `Expenses of a ${campaign.status} campaign cannot be changed` });
    return null;
  }
  return { expense, campaign };
}

// PUT /api/expenses/:id   (send receipt: null to remove the receipt)
async function updateExpense(req, res) {
  try {
    const found = await ownExpense(req, res);
    if (!found) return;
    const { expense, campaign } = found;

    const { data, error } = readExpense(req.body, campaign, true);
    if (error) return res.status(400).json({ message: error });

    if (req.body.receipt && req.body.receipt.data) {
      try {
        data.receipt = saveReceipt(req.body.receipt);
      } catch (e) {
        if (e instanceof FileError) return res.status(400).json({ message: e.message });
        throw e;
      }
    } else if (req.body.receipt === null) {
      data.receipt = undefined;
    }

    const before = utilization(campaign.budget, await spentOn(campaign._id));
    Object.assign(expense, data);
    await expense.save();
    const after = utilization(campaign.budget, await spentOn(campaign._id));
    await logAction(req, "expense.update", { type: "Expense", id: expense._id, label: expense.title }, `${campaign.title} · ৳${before.spent} → ৳${after.spent} spent in total`);
    res.json({ message: budgetMessage("Expense updated", before, after), expense, budget: after });
  } catch (err) {
    serverError(res, err);
  }
}

// DELETE /api/expenses/:id
async function deleteExpense(req, res) {
  try {
    const found = await ownExpense(req, res);
    if (!found) return;
    await found.expense.deleteOne();
    await logAction(req, "expense.delete", { type: "Expense", id: found.expense._id, label: found.expense.title }, `${found.campaign.title} · ৳${found.expense.amount}`);
    res.json({ message: "Expense deleted" });
  } catch (err) {
    serverError(res, err);
  }
}

// =========================================================
// ADMIN (Req 4.4, 11, 16)
// =========================================================

// GET /api/expenses/admin  — every tracked campaign with its budget utilization
async function adminSummary(req, res) {
  try {
    const campaigns = await Campaign.find({ status: { $in: TRACKED } }).populate("manager", "name organization").sort({ startDate: 1 });
    const expenses = await Expense.find({ campaign: { $in: campaigns.map((c) => c._id) } });
    const totals = totalsByCampaign(expenses);
    const list = campaigns.map((c) => campaignSummary(c, totals));

    const byCategory = {};
    expenses.forEach((e) => (byCategory[e.category] = (byCategory[e.category] || 0) + e.amount));

    // Requested budget includes campaigns waiting for approval too (Req 16)
    const requested = await Campaign.find({ status: { $in: ["submitted", ...TRACKED] } });

    res.json({
      totals: {
        requestedBudget: requested.reduce((s, c) => s + (c.budget || 0), 0),
        approvedBudget: list.reduce((s, c) => s + c.budget, 0),
        spent: list.reduce((s, c) => s + c.spent, 0),
        exceeded: list.filter((c) => c.status === "exceeded").length,
        warning: list.filter((c) => c.status === "warning").length,
      },
      byCategory,
      campaigns: list,
    });
  } catch (err) {
    serverError(res, err);
  }
}

// GET /api/expenses/admin/:campaignId  — expense list of one campaign (read-only)
async function adminCampaignExpenses(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.campaignId)) return res.status(404).json({ message: "Campaign not found" });
    const campaign = await Campaign.findById(req.params.campaignId).populate("manager", "name organization");
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    const expenses = await Expense.find({ campaign: campaign._id }).sort({ date: -1 });
    const totals = totalsByCampaign(expenses);
    res.json({ campaign: campaignSummary(campaign, totals), expenses });
  } catch (err) {
    serverError(res, err);
  }
}

module.exports = { managerExpenses, createExpense, updateExpense, deleteExpense, adminSummary, adminCampaignExpenses };
