// =========================================================
// Completion Report statistics (Req 7, 2.7, 4.5)
//
// Calculated from real data so the Manager cannot change them:
//   tasks (verified / total, late), volunteers (joined / contributed),
//   average rating, and budget used (spent ÷ budget × 100).
// =========================================================

const Task = require("../models/Task");
const Application = require("../models/Application");
const Expense = require("../models/Expense");
const { utilization } = require("./budget");

const OPEN_TASK = ["pending", "in_progress", "submitted", "revision_required"];

async function completionStats(campaign) {
  const [tasks, joined, expenses] = await Promise.all([
    Task.find({ campaign: campaign._id }).populate("assignedTo", "name"),
    Application.countDocuments({ campaign: campaign._id, status: "accepted" }),
    Expense.find({ campaign: campaign._id }),
  ]);

  const verified = tasks.filter((t) => t.status === "completed");
  const rated = verified.filter((t) => t.rating);
  const contributors = new Set(verified.map((t) => String(t.assignedTo && t.assignedTo._id ? t.assignedTo._id : t.assignedTo)));
  const spent = expenses.reduce((sum, e) => sum + e.amount, 0);
  const u = utilization(campaign.budget, spent);

  const stats = {
    tasksTotal: tasks.length,
    tasksVerified: verified.length,
    lateSubmissions: tasks.filter((t) => (t.submissions || []).some((s) => s.isLate)).length,
    volunteersJoined: joined,
    volunteersContributed: contributors.size,
    avgRating: rated.length ? Math.round((rated.reduce((s, t) => s + t.rating, 0) / rated.length) * 10) / 10 : 0,
    budget: u.budget,
    spent: u.spent,
    utilization: u.rate,
    budgetStatus: u.status,
    expenseCount: expenses.length,
  };

  // Tasks that are not finished block the report
  const openTasks = tasks
    .filter((t) => OPEN_TASK.includes(t.status))
    .map((t) => ({ _id: t._id, title: t.title, status: t.status, assignedTo: t.assignedTo ? t.assignedTo.name : "" }));

  return { stats, openTasks, tasks };
}

module.exports = { completionStats, OPEN_TASK };
