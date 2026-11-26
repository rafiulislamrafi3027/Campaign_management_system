// =========================================================
// Admin Reports (Req 4.4, 16) and Audit Log (Req 15, 22)
// =========================================================

const Campaign = require("../models/Campaign");
const User = require("../models/User");
const Task = require("../models/Task");
const Application = require("../models/Application");
const Expense = require("../models/Expense");
const Certificate = require("../models/Certificate");
const AuditLog = require("../models/AuditLog");
const AiLog = require("../models/AiLog");
const { utilization, totalsByCampaign } = require("../services/budget");

const serverError = (res, err) => {
  console.error(err);
  res.status(500).json({ message: "Server error" });
};
const idOf = (x) => String(x && x._id ? x._id : x);

// GET /api/admin/reports — everything the Reports page shows
async function getReports(req, res) {
  try {
    const [campaigns, users, tasks, apps, expenses, certs] = await Promise.all([
      Campaign.find({}).populate("manager", "name organization"),
      User.find({}),
      Task.find({}),
      Application.find({}),
      Expense.find({}),
      Certificate.find({}),
    ]);
    const live = campaigns.filter((c) => c.status !== "draft"); // drafts are private to managers

    // ---- Overview (Req 4.4)
    const byStatus = {};
    live.forEach((c) => (byStatus[c.status] = (byStatus[c.status] || 0) + 1));
    const vols = users.filter((u) => u.role === "volunteer");
    const verifiedTasks = tasks.filter((t) => t.status === "completed");
    const late = verifiedTasks.filter((t) => (t.submissions || []).some((s) => s.isLate)).length;
    const completed = live.filter((c) => c.status === "completed");
    const reached = completed.reduce((s, c) => s + ((c.completionReport && c.completionReport.beneficiariesReached) || 0), 0);
    const expected = completed.reduce((s, c) => s + (c.beneficiaries || 0), 0);

    const overview = {
      campaigns: live.length,
      byStatus,
      volunteers: { approved: vols.filter((u) => u.status === "approved").length, pending: vols.filter((u) => u.status === "pending").length, rejected: vols.filter((u) => u.status === "rejected").length },
      managers: users.filter((u) => u.role === "manager" && u.status !== "removed").length,
      applications: { total: apps.length, accepted: apps.filter((a) => a.status === "accepted").length },
      tasks: { total: tasks.length, verified: verifiedTasks.length, onTimeRate: verifiedTasks.length ? Math.round(((verifiedTasks.length - late) / verifiedTasks.length) * 100) : 0 },
      beneficiaries: { expected, reached },
      certificates: certs.length,
    };

    // ---- Finance (Req 16): requested vs approved vs actual
    const totals = totalsByCampaign(expenses);
    const REQUESTED = ["submitted", "approved", "active", "completion_review", "completed"];
    const APPROVED = ["approved", "active", "completion_review", "completed"];
    const finance = {
      requested: live.filter((c) => REQUESTED.includes(c.status)).reduce((s, c) => s + (c.budget || 0), 0),
      approved: live.filter((c) => APPROVED.includes(c.status)).reduce((s, c) => s + (c.budget || 0), 0),
      spent: expenses.reduce((s, e) => s + e.amount, 0),
      byCategory: {},
      campaigns: live
        .filter((c) => APPROVED.includes(c.status))
        .map((c) => {
          const u = utilization(c.budget, (totals[String(c._id)] || {}).spent || 0);
          return { title: c.title, manager: c.manager ? c.manager.name : "—", status: c.status, budget: u.budget, spent: u.spent, rate: u.rate, budgetStatus: u.status };
        })
        .sort((a, b) => b.rate - a.rate),
    };
    expenses.forEach((e) => (finance.byCategory[e.category] = (finance.byCategory[e.category] || 0) + e.amount));

    // ---- Campaign results (completed campaigns)
    const results = completed.map((c) => {
      const r = c.completionReport || {};
      const st = r.stats || {};
      return {
        title: c.title, category: c.category, manager: c.manager ? c.manager.name : "—", completedAt: c.completedAt,
        expected: c.beneficiaries || 0, reached: r.beneficiariesReached ?? null,
        tasksVerified: st.tasksVerified ?? tasks.filter((t) => idOf(t.campaign) === String(c._id) && t.status === "completed").length,
        volunteers: st.volunteersContributed ?? null, avgRating: st.avgRating ?? null,
        certificates: certs.filter((x) => idOf(x.campaign) === String(c._id)).length,
        hasReport: Boolean(c.completionReport),
      };
    });

    // ---- Campaigns by category
    const byCategory = {};
    live.forEach((c) => (byCategory[c.category] = (byCategory[c.category] || 0) + 1));

    // ---- Top volunteers by verified work
    const volStats = vols
      .filter((v) => v.status === "approved")
      .map((v) => {
        const mine = verifiedTasks.filter((t) => idOf(t.assignedTo) === String(v._id));
        return {
          name: v.name,
          tasksVerified: mine.length,
          campaigns: new Set(mine.map((t) => idOf(t.campaign))).size,
          avgRating: v.avgRating || 0,
          certificates: certs.filter((x) => idOf(x.volunteer) === String(v._id)).length,
        };
      })
      .filter((v) => v.tasksVerified > 0)
      .sort((a, b) => b.tasksVerified - a.tasksVerified || b.avgRating - a.avgRating)
      .slice(0, 10);

    // ---- AI usage (Req 22)
    const ai = await AiLog.find({});
    const aiUsage = {};
    for (const l of ai) {
      const f = (aiUsage[l.feature] = aiUsage[l.feature] || { total: 0, ok: 0, accepted: 0, edited: 0, rejected: 0, ms: 0 });
      f.total++;
      if (l.ok) { f.ok++; f.ms += l.ms || 0; }
      if (l.outcome) f[l.outcome]++;
    }
    Object.values(aiUsage).forEach((f) => { f.avgMs = f.ok ? Math.round(f.ms / f.ok) : 0; delete f.ms; });

    res.json({ generatedAt: new Date(), overview, finance, results, byCategory, topVolunteers: volStats, aiUsage });
  } catch (err) {
    serverError(res, err);
  }
}

// ---------- Audit log ----------
const AI_LABEL = { task_planner: "AI Task Planner", receipt_scanner: "AI Receipt Scanner", campaign_recommendation: "AI Recommendation" };
const CATEGORIES = ["account", "campaign", "application", "task", "expense", "certificate", "ai"];

function aiToEntry(l) {
  const u = l.user && l.user.name ? l.user : null;
  const meta = l.meta || {};
  const parts = [];
  if (!l.ok) parts.push(`Failed: ${l.error || "error"}`);
  else parts.push(`${l.source === "fallback" ? "Skill-match fallback" : "AI answered"} in ${((l.ms || 0) / 1000).toFixed(1)}s`);
  if (meta.suggestions !== undefined) parts.push(`${meta.suggestions} suggestion(s)`);
  if (l.outcome) parts.push(`User ${l.outcome}`);
  return {
    _id: l._id, createdAt: l.createdAt, category: "ai", action: `ai.${l.feature}`,
    actorName: u ? u.name : "Unknown", actorRole: l.role || (u ? u.role : ""),
    targetLabel: AI_LABEL[l.feature] || l.feature, details: parts.join(" · "),
  };
}

function buildFilters(q) {
  const f = {};
  const from = q.from ? new Date(q.from) : null;
  const to = q.to ? new Date(new Date(q.to).setHours(23, 59, 59, 999)) : null;
  if ((from && !isNaN(from)) || (to && !isNaN(to))) {
    f.createdAt = {};
    if (from && !isNaN(from)) f.createdAt.$gte = from;
    if (to && !isNaN(to)) f.createdAt.$lte = to;
  }
  return f;
}
const textMatch = (e, s) => !s || [e.actorName, e.targetLabel, e.details, e.action].some((x) => String(x || "").toLowerCase().includes(s));

async function collect(q, max) {
  const category = CATEGORIES.includes(q.category) ? q.category : "";
  const search = String(q.q || "").trim().toLowerCase().slice(0, 100);
  const base = buildFilters(q);
  let entries = [];
  if (category !== "ai") {
    const list = await AuditLog.find(category ? { ...base, category } : base).sort({ createdAt: -1 }).limit(max);
    entries = list.map((x) => (typeof x.toObject === "function" ? x.toObject() : x));
  }
  if (!category || category === "ai") {
    const ai = await AiLog.find(base).populate("user", "name role").sort({ createdAt: -1 }).limit(max);
    entries = entries.concat(ai.map(aiToEntry));
  }
  return entries
    .filter((e) => textMatch(e, search))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// GET /api/admin/audit?category=&q=&from=&to=&page=
async function getAudit(req, res) {
  try {
    const PAGE = 40;
    const page = Math.max(1, Math.min(200, parseInt(req.query.page, 10) || 1));
    const all = await collect(req.query, page * PAGE + 1);
    res.json({ entries: all.slice((page - 1) * PAGE, page * PAGE), hasMore: all.length > page * PAGE, page });
  } catch (err) {
    serverError(res, err);
  }
}

// GET /api/admin/audit/export — the same list as CSV (max 5000 rows)
async function exportAudit(req, res) {
  try {
    const rows = (await collect(req.query, 5000)).slice(0, 5000);
    const cell = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@]/.test(s)) s = "'" + s; // stop Excel from running formulas
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [["Time", "User", "Role", "Category", "Action", "Target", "Details"].map(cell).join(",")];
    rows.forEach((e) => lines.push([new Date(e.createdAt).toISOString(), e.actorName, e.actorRole, e.category, e.action, e.targetLabel, e.details].map(cell).join(",")));
    const csv = "﻿" + lines.join("\r\n"); // BOM so Excel shows ৳ and Bangla correctly
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"` });
    res.send(csv);
  } catch (err) {
    serverError(res, err);
  }
}

module.exports = { getReports, getAudit, exportAudit };
