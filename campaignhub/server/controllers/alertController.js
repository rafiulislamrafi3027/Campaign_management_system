// In-app notifications (Req 3.5, 4.3)
//
// Instead of a separate "notifications" collection, alerts are worked out from the
// data that already exists (tasks, applications, campaigns, users). So they are always
// correct: an alert disappears as soon as the work is done.
//
// GET /api/alerts  ->  { badges: { navKey: count }, items: [ { type, level, title, text, link, at } ] }

const Task = require("../models/Task");
const Application = require("../models/Application");
const Campaign = require("../models/Campaign");
const User = require("../models/User");
const Expense = require("../models/Expense");
const Certificate = require("../models/Certificate");
const { utilization, totalsByCampaign } = require("../services/budget");

// Budget status of campaigns (Req 11)
async function budgetStatus(campaigns) {
  const tracked = campaigns.filter((c) => ["approved", "active"].includes(c.status));
  const expenses = await Expense.find({ campaign: { $in: tracked.map((c) => c._id) } });
  const totals = totalsByCampaign(expenses);
  return tracked.map((c) => ({ c, u: utilization(c.budget, (totals[String(c._id)] || {}).spent || 0) }));
}
const money = (n) => "৳" + Math.round(n).toLocaleString("en-IN");

const DAY = 24 * 60 * 60 * 1000;
const RECENT = 3 * DAY; // "recently" = last 3 days

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const endOfDay = (x) => { const d = new Date(x); d.setHours(23, 59, 59, 999); return d; };
const fmt = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const recent = (d) => d && Date.now() - new Date(d).getTime() < RECENT;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Info-only updates (verified, joined, removed...) disappear once the user has seen them.
// "Action" alerts (new task, revision, due soon, review...) stay until the work is done.
function seenTime(user, page) {
  const s = (user.alertsSeen && typeof user.alertsSeen.toObject === "function" ? user.alertsSeen.toObject() : user.alertsSeen) || {};
  return Math.max(s[page] ? new Date(s[page]).getTime() : 0, s.all ? new Date(s.all).getTime() : 0);
}
const unseen = (at, user, page) => at && recent(at) && new Date(at).getTime() > seenTime(user, page);

// ---------------- Volunteer ----------------
async function volunteerAlerts(user) {
  const items = [];
  const badges = {};

  if (user.status !== "approved") {
    return {
      badges,
      items: [
        user.status === "pending"
          ? { type: "account", level: "info", title: "Waiting for verification", text: "The Admin is reviewing your account.", link: "/volunteer/dashboard.html" }
          : { type: "account", level: "danger", title: "Account not approved", text: user.rejectionReason || "", link: "/volunteer/dashboard.html" },
      ],
    };
  }

  const tasks = await Task.find({ assignedTo: user._id }).populate("campaign", "title status");
  const live = tasks.filter((t) => t.campaign && t.campaign.status === "active");
  const today = startOfToday();
  const tomorrowEnd = endOfDay(new Date(today.getTime() + DAY));

  for (const t of live) {
    const link = "/volunteer/tasks.html";
    const camp = t.campaign.title;
    const open = ["pending", "in_progress", "revision_required"].includes(t.status);
    const dueEnd = endOfDay(t.deadline);

    if (t.status === "pending") {
      items.push({ type: "new_task", level: "new", title: `New task: ${t.title}`, text: `${camp} · due ${fmt(t.deadline)}`, link, at: t.createdAt });
    }
    if (t.status === "revision_required") {
      const last = t.submissions[t.submissions.length - 1];
      items.push({ type: "revision", level: "warn", title: `Revision needed: ${t.title}`, text: last && last.feedback ? `“${last.feedback}”` : camp, link, at: last && last.reviewedAt });
    }
    // Deadline approaching (today or tomorrow) or already passed (Req 3.5)
    if (open && dueEnd < today) {
      items.push({ type: "overdue", level: "danger", title: `Overdue: ${t.title}`, text: `Was due ${fmt(t.deadline)} — submit your proof as soon as possible`, link, at: t.deadline });
    } else if (open && dueEnd <= tomorrowEnd) {
      const isToday = dueEnd <= endOfDay(today);
      items.push({ type: "due_soon", level: "warn", title: `Due ${isToday ? "today" : "tomorrow"}: ${t.title}`, text: camp, link, at: t.deadline });
    }
    if (t.status === "completed" && unseen(t.completedAt, user, "tasks")) {
      items.push({ type: "verified", level: "success", title: `Verified: ${t.title}`, text: t.rating ? `The manager rated your work ${t.rating}★` : "The manager verified your work", link, at: t.completedAt });
    }
  }
  badges.tasks = live.filter((t) => ["pending", "in_progress", "revision_required"].includes(t.status)).length;

  // Application decisions in the last 3 days
  const apps = await Application.find({ volunteer: user._id, status: { $in: ["accepted", "rejected"] } }).populate("campaign", "title");
  for (const a of apps) {
    if (!a.campaign || !unseen(a.decidedAt, user, "applications")) continue;
    items.push(
      a.status === "accepted"
        ? { type: "accepted", level: "success", title: `You joined: ${a.campaign.title}`, text: a.decisionNote || "The manager accepted your application.", link: "/volunteer/applications.html", at: a.decidedAt }
        : { type: "app_rejected", level: "muted", title: `Not accepted: ${a.campaign.title}`, text: a.decisionNote || "", link: "/volunteer/applications.html", at: a.decidedAt }
    );
  }
  // Campaigns the volunteer joined that the Admin has now verified as completed
  for (const a of apps) {
    if (a.status !== "accepted" || !a.campaign) continue;
    const camp = await Campaign.findById(a.campaign._id || a.campaign);
    if (camp && camp.status === "completed" && unseen(camp.completedAt, user, "applications")) {
      items.push({ type: "campaign_done", level: "success", title: `Campaign completed: ${camp.title}`, text: "Thank you for your work! The Admin verified the final report.", link: "/volunteer/applications.html", at: camp.completedAt });
    }
  }
  badges.applications = apps.filter((a) => a.campaign && unseen(a.decidedAt, user, "applications")).length;

  // New certificates (Req 14)
  const certs = (await Certificate.find({ volunteer: user._id })).filter((c) => unseen(c.issuedAt, user, "certificates"));
  for (const c of certs) {
    items.push({ type: "certificate", level: "success", title: `Certificate ready: ${c.campaignTitle}`, text: "Download your participation certificate (PDF).", link: "/volunteer/certificates.html", at: c.issuedAt });
  }
  badges.certificates = certs.length;

  return { badges, items };
}

// ---------------- Manager ----------------
async function managerAlerts(user) {
  const items = [];
  const badges = {};
  const campaigns = await Campaign.find({ manager: user._id });
  const ids = campaigns.map((c) => c._id);
  const byId = Object.fromEntries(campaigns.map((c) => [String(c._id), c]));

  // Proof waiting for review
  const tasks = await Task.find({ campaign: { $in: ids } }).populate("assignedTo", "name");
  const toReview = tasks.filter((t) => t.status === "submitted");
  for (const t of toReview) {
    const last = t.submissions[t.submissions.length - 1];
    items.push({
      type: "review", level: "new",
      title: `Proof to review: ${t.title}`,
      text: `${t.assignedTo ? t.assignedTo.name : "A volunteer"} submitted${last && last.isLate ? " (late)" : ""} · ${(byId[String(t.campaign)] || {}).title || ""}`,
      link: "/manager/tasks.html", at: last && last.submittedAt,
    });
  }
  const today = startOfToday();
  const overdue = tasks.filter((t) => ["pending", "in_progress", "revision_required"].includes(t.status) && endOfDay(t.deadline) < today && (byId[String(t.campaign)] || {}).status === "active");
  if (overdue.length) {
    items.push({ type: "overdue", level: "danger", title: `${plural(overdue.length, "task")} overdue`, text: overdue.slice(0, 3).map((t) => t.title).join(", "), link: "/manager/tasks.html", at: overdue[0].deadline });
  }
  badges.tasks = toReview.length;

  // New applications
  const activeIds = campaigns.filter((c) => c.status === "active").map((c) => c._id);
  const pendingApps = await Application.find({ campaign: { $in: activeIds }, status: "applied" });
  if (pendingApps.length) {
    const perCamp = {};
    pendingApps.forEach((a) => (perCamp[String(a.campaign)] = (perCamp[String(a.campaign)] || 0) + 1));
    for (const [cid, n] of Object.entries(perCamp)) {
      items.push({ type: "applications", level: "new", title: `${plural(n, "new application")}`, text: (byId[cid] || {}).title || "", link: "/manager/applications.html", at: pendingApps.find((a) => String(a.campaign) === cid).createdAt });
    }
  }
  badges.applications = pendingApps.length;

  // Campaign decisions by the Admin (Req 4.3)
  let campaignBadge = 0;
  for (const c of campaigns) {
    if (c.status === "approved") {
      campaignBadge++;
      items.push({ type: "approved", level: "success", title: `Approved: ${c.title}`, text: "Make it active so volunteers can see it.", link: "/manager/campaigns.html", at: c.reviewedAt });
    }
    if (c.status === "rejected") {
      campaignBadge++;
      items.push({ type: "rejected", level: "warn", title: `Rejected: ${c.title}`, text: c.rejectionReason ? `“${c.rejectionReason}” — edit and resubmit` : "Edit and resubmit", link: "/manager/campaigns.html", at: c.reviewedAt });
    }
    // Completion report (Req 7, 2.7, 4.5)
    const rep = c.completionReport;
    if (c.status === "active" && rep && rep.status === "returned") {
      campaignBadge++;
      items.push({ type: "report_returned", level: "warn", title: `Completion report sent back: ${c.title}`, text: rep.reviewComment ? `“${rep.reviewComment}” — fix and send again` : "Fix and send again", link: "/manager/campaigns.html", at: rep.reviewedAt });
    } else if (c.status === "active" && endOfDay(c.endDate) < today) {
      campaignBadge++;
      items.push({ type: "report_due", level: "warn", title: `Campaign ended: ${c.title}`, text: `Ended ${fmt(c.endDate)} — send the completion report to the Admin`, link: "/manager/campaigns.html", at: c.endDate });
    }
    if (c.status === "completion_review") {
      items.push({ type: "report_waiting", level: "info", title: `Report under review: ${c.title}`, text: "The Admin is checking your completion report.", link: "/manager/campaigns.html", at: rep && rep.submittedAt });
    }
    if (c.status === "completed" && rep && unseen(c.completedAt, user, "campaigns")) {
      items.push({ type: "report_approved", level: "success", title: `Completed: ${c.title}`, text: rep.reviewComment ? `Admin verified the report — “${rep.reviewComment}”` : "The Admin verified your completion report.", link: "/manager/campaigns.html", at: c.completedAt });
    }
    if (c.status === "removed" && unseen(c.removedAt, user, "campaigns")) {
      items.push({ type: "removed", level: "danger", title: `Removed by Admin: ${c.title}`, text: c.removalReason || "", link: "/manager/campaigns.html", at: c.removedAt });
    }
  }
  badges.campaigns = campaignBadge;

  // Budget warnings
  const budgets = await budgetStatus(campaigns);
  for (const { c, u } of budgets) {
    if (u.status === "exceeded") {
      items.push({ type: "budget_exceeded", level: "danger", title: `Budget exceeded: ${c.title}`, text: `${money(u.spent)} spent of ${money(u.budget)} (${u.rate}%) — ${money(-u.remaining)} over`, link: "/manager/expenses.html" });
    } else if (u.status === "warning") {
      items.push({ type: "budget_warning", level: "warn", title: `${u.rate}% of the budget used: ${c.title}`, text: `${money(u.remaining)} left of ${money(u.budget)}`, link: "/manager/expenses.html" });
    }
  }
  badges.expenses = budgets.filter((b) => b.u.status === "exceeded").length;

  return { badges, items };
}

// ---------------- Admin ----------------
async function adminAlerts() {
  const items = [];
  const pendingVols = await User.find({ role: "volunteer", status: "pending" });
  const waiting = await Campaign.find({ status: "submitted" });

  if (pendingVols.length) {
    items.push({ type: "volunteers", level: "new", title: `${plural(pendingVols.length, "volunteer")} waiting for verification`, text: pendingVols.slice(0, 3).map((v) => v.name).join(", ") + (pendingVols.length > 3 ? "…" : ""), link: "/admin/dashboard.html", at: pendingVols[0].createdAt });
  }
  if (waiting.length) {
    items.push({ type: "campaigns", level: "new", title: `${plural(waiting.length, "campaign")} waiting for approval`, text: waiting.slice(0, 3).map((c) => c.title).join(", ") + (waiting.length > 3 ? "…" : ""), link: "/admin/campaigns.html", at: waiting[0].submittedAt });
  }
  // Completion reports waiting for verification (Req 7, 2.7, 4.5)
  const reports = await Campaign.find({ status: "completion_review" }).populate("manager", "name");
  if (reports.length) {
    items.push({ type: "reports", level: "new", title: `${plural(reports.length, "completion report")} to verify`, text: reports.slice(0, 3).map((c) => c.title).join(", ") + (reports.length > 3 ? "…" : ""), link: "/admin/campaigns.html?tab=completion_review", at: reports[0].completionReport && reports[0].completionReport.submittedAt });
  }
  // Campaigns over budget (Req 11: shown on the Admin dashboard too)
  const running = await Campaign.find({ status: { $in: ["approved", "active"] } }).populate("manager", "name");
  const budgets = await budgetStatus(running);
  const over = budgets.filter((b) => b.u.status === "exceeded");
  for (const { c, u } of over) {
    items.push({ type: "budget_exceeded", level: "danger", title: `Budget exceeded: ${c.title}`, text: `${c.manager ? c.manager.name + " · " : ""}${money(u.spent)} of ${money(u.budget)} (${u.rate}%)`, link: "/admin/budgets.html" });
  }

  return { badges: { volunteers: pendingVols.length, campaigns: waiting.length + reports.length, budgets: over.length }, items };
}

// Most urgent first: danger, warn, new, success, info, muted — then newest first
const ORDER = { danger: 0, warn: 1, new: 2, success: 3, info: 4, muted: 5 };

async function getAlerts(req, res) {
  try {
    const u = req.user;
    const data = u.role === "volunteer" ? await volunteerAlerts(u) : u.role === "manager" ? await managerAlerts(u) : await adminAlerts();
    data.items.sort((a, b) => ORDER[a.level] - ORDER[b.level] || new Date(b.at || 0) - new Date(a.at || 0));
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

// POST /api/alerts/seen   body: { page: "applications" | "tasks" | "campaigns" | "certificates" | "all" }
async function markSeen(req, res) {
  try {
    const page = req.body.page;
    if (!["applications", "tasks", "campaigns", "certificates", "all"].includes(page)) return res.status(400).json({ message: "Invalid page" });
    const user = req.user;
    const current = (user.alertsSeen && typeof user.alertsSeen.toObject === "function" ? user.alertsSeen.toObject() : user.alertsSeen) || {};
    user.alertsSeen = { ...current, [page]: new Date() };
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = { getAlerts, markSeen };
