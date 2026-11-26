// Admin Reports (Req 4.4, 16, 22) — view, export to CSV, print / save as PDF
const admin = requireRole("admin");
if (admin) {
  fillUserChip(admin);
  renderSidebar("admin", "reports");
}

const $ = (id) => document.getElementById(id);
$("csvBtn").innerHTML = `${META_ICONS.download}Export CSV`;
$("pdfBtn").innerHTML = `${NAV_ICONS.file}Print / Save as PDF`;

const AI_NAMES = { task_planner: "Task Planner", receipt_scanner: "Receipt Scanner", campaign_recommendation: "Recommendation" };
let R = null;

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const fmtWhen = (d) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

async function load() {
  try {
    R = await api("/admin/reports");
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

function tile(color, icon, num, label) {
  return `<div class="stat"><div class="ico ${color}">${icon}</div><div><div class="num">${num}</div><div class="lbl">${label}</div></div></div>`;
}

function countBars(obj, labels = {}) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<p class="muted" style="font-size:13px">Nothing yet.</p>`;
  const max = entries[0][1];
  return `<div class="cat-bars">${entries
    .map(([k, v], i) => `<div class="cat-row" style="animation-delay:${i * 60}ms">
        <span class="cat-name"><i style="background:${CATEGORY_COLORS[k] || "#8b5cf6"}"></i>${esc(labels[k] || k)}</span>
        <span class="cat-track"><b style="width:${(v / max) * 100}%;background:${CATEGORY_COLORS[k] || "#8b5cf6"}"></b></span>
        <span class="cat-val">${v}</span></div>`)
    .join("")}</div>`;
}

function table(el, head, rows, empty) {
  $(el).innerHTML = `<thead><tr>${head.map((h) => `<th class="${h.r ? "right" : ""}">${h.t}</th>`).join("")}</tr></thead>
    <tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c, i) => `<td class="${head[i].r ? "right" : ""}">${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="empty">${ICONS.inbox}<div>${empty}</div></td></tr>`}</tbody>`;
}

function render() {
  const o = R.overview, f = R.finance;
  $("genAt").textContent = `Generated ${fmtWhen(R.generatedAt)} · ${o.campaigns} campaigns · ${o.managers} managers · ${o.volunteers.approved} verified volunteers`;

  $("tiles").innerHTML =
    tile("indigo", NAV_ICONS.megaphone || NAV_ICONS.grid, o.campaigns, "Campaigns (not drafts)") +
    tile("cyan", NAV_ICONS.users || NAV_ICONS.user, o.volunteers.approved, `Verified volunteers${o.volunteers.pending ? ` · ${o.volunteers.pending} waiting` : ""}`) +
    tile("green", NAV_ICONS.tasks, `${o.tasks.verified}<small> / ${o.tasks.total}</small>`, `Tasks verified · ${o.tasks.onTimeRate}% on time`) +
    tile("amber", NAV_ICONS.award, o.beneficiaries.reached.toLocaleString("en-IN"), `People helped${o.beneficiaries.expected ? ` · ${pct(o.beneficiaries.reached, o.beneficiaries.expected)}% of target` : ""} · ${o.certificates} certificates`);

  // Requested vs approved vs spent (Req 16)
  const max = Math.max(f.requested, f.approved, f.spent, 1);
  const bar = (label, v, color, note) => `
    <div class="fin-row"><span>${label}</span><div class="fin-track"><b style="width:${(v / max) * 100}%;background:${color}"></b></div><strong>${formatMoney(v)}</strong></div>
    ${note ? `<p class="fin-note">${note}</p>` : ""}`;
  $("finance").innerHTML =
    bar("Requested", f.requested, "#8b5cf6") +
    bar("Approved", f.approved, "#22d3ee", f.requested ? `${pct(f.approved, f.requested)}% of the requested budget was approved` : "") +
    bar("Spent", f.spent, f.spent > f.approved ? "#f87171" : "#34d399", f.approved ? `${pct(f.spent, f.approved)}% of the approved budget is spent · ${formatMoney(Math.max(f.approved - f.spent, 0))} left` : "");
  $("cats").innerHTML = categoryBars(f.byCategory);
  $("statusBox").innerHTML = countBars(o.byStatus, STATUS_LABEL);
  $("catCount").innerHTML = countBars(R.byCategory);

  table(
    "tFinance",
    [{ t: "Campaign" }, { t: "Manager" }, { t: "Status" }, { t: "Budget", r: 1 }, { t: "Spent", r: 1 }, { t: "Used", r: 1 }],
    f.campaigns.map((c) => [esc(c.title), esc(c.manager), `<span class="badge ${c.status}">${STATUS_LABEL[c.status] || c.status}</span>`, formatMoney(c.budget), formatMoney(c.spent), `<span class="rate ${c.budgetStatus}">${c.rate}%</span>`]),
    "No approved campaigns yet"
  );
  table(
    "tResults",
    [{ t: "Campaign" }, { t: "Manager" }, { t: "Completed" }, { t: "People helped", r: 1 }, { t: "Tasks", r: 1 }, { t: "Volunteers", r: 1 }, { t: "Rating", r: 1 }, { t: "Certificates", r: 1 }],
    R.results.map((c) => [
      `${esc(c.title)}${c.hasReport ? "" : ` <span class="muted" title="Completed before completion reports existed">(no report)</span>`}`,
      esc(c.manager),
      c.completedAt ? formatDate(c.completedAt) : "—",
      c.reached === null ? "—" : `${c.reached.toLocaleString("en-IN")} <small class="muted">/ ${c.expected}</small>`,
      c.tasksVerified,
      c.volunteers ?? "—",
      c.avgRating ? `${c.avgRating} ★` : "—",
      c.certificates,
    ]),
    "No completed campaigns yet"
  );
  table(
    "tVols",
    [{ t: "#" }, { t: "Volunteer" }, { t: "Tasks", r: 1 }, { t: "Campaigns", r: 1 }, { t: "Rating", r: 1 }, { t: "Certificates", r: 1 }],
    R.topVolunteers.map((v, i) => [i + 1, esc(v.name), v.tasksVerified, v.campaigns, v.avgRating ? `${v.avgRating} ★` : "—", v.certificates]),
    "No verified work yet"
  );
  table(
    "tAi",
    [{ t: "Feature" }, { t: "Uses", r: 1 }, { t: "OK", r: 1 }, { t: "Taken", r: 1 }, { t: "Edited", r: 1 }, { t: "Ignored", r: 1 }, { t: "Avg", r: 1 }],
    Object.entries(R.aiUsage).map(([k, a]) => [AI_NAMES[k] || k, a.total, `${pct(a.ok, a.total)}%`, a.accepted, a.edited, a.rejected, a.avgMs ? `${(a.avgMs / 1000).toFixed(1)}s` : "—"]),
    "AI has not been used yet"
  );
}

// ---------- CSV: every table in one file, Excel-friendly ----------
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formulas
  return `"${s.replace(/"/g, '""')}"`;
}
function exportCsv() {
  if (!R) return;
  const o = R.overview, f = R.finance;
  const rows = [];
  const add = (...r) => rows.push(r.map(csvCell).join(","));
  add("CampaignHub platform report", fmtWhen(R.generatedAt));
  add();
  add("SUMMARY");
  add("Campaigns (not drafts)", o.campaigns);
  add("Verified volunteers", o.volunteers.approved);
  add("Volunteers waiting for approval", o.volunteers.pending);
  add("Managers", o.managers);
  add("Tasks verified", o.tasks.verified, "of", o.tasks.total);
  add("On-time rate (%)", o.tasks.onTimeRate);
  add("People helped (completed campaigns)", o.beneficiaries.reached, "target", o.beneficiaries.expected);
  add("Certificates issued", o.certificates);
  add("Requested budget (BDT)", f.requested);
  add("Approved budget (BDT)", f.approved);
  add("Spent (BDT)", f.spent);
  add();
  add("SPENDING BY CATEGORY");
  add("Category", "Amount (BDT)");
  Object.entries(f.byCategory).forEach(([k, v]) => add(k, v));
  add();
  add("BUDGET BY CAMPAIGN");
  add("Campaign", "Manager", "Status", "Budget (BDT)", "Spent (BDT)", "Used (%)", "Budget status");
  f.campaigns.forEach((c) => add(c.title, c.manager, STATUS_LABEL[c.status] || c.status, c.budget, c.spent, c.rate, c.budgetStatus));
  add();
  add("COMPLETED CAMPAIGN RESULTS");
  add("Campaign", "Manager", "Completed on", "People helped", "Target", "Tasks verified", "Volunteers", "Avg rating", "Certificates");
  R.results.forEach((c) => add(c.title, c.manager, c.completedAt ? new Date(c.completedAt).toISOString().slice(0, 10) : "", c.reached ?? "", c.expected, c.tasksVerified, c.volunteers ?? "", c.avgRating ?? "", c.certificates));
  add();
  add("TOP VOLUNTEERS");
  add("Volunteer", "Tasks verified", "Campaigns", "Avg rating", "Certificates");
  R.topVolunteers.forEach((v) => add(v.name, v.tasksVerified, v.campaigns, v.avgRating, v.certificates));
  add();
  add("AI USAGE");
  add("Feature", "Uses", "Successful", "Accepted", "Edited", "Rejected", "Avg time (s)");
  Object.entries(R.aiUsage).forEach(([k, a]) => add(AI_NAMES[k] || k, a.total, a.ok, a.accepted, a.edited, a.rejected, (a.avgMs / 1000).toFixed(1)));

  const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `campaignhub-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast("Report downloaded as CSV");
}

$("csvBtn").addEventListener("click", exportCsv);
$("pdfBtn").addEventListener("click", () => window.print());

if (admin) load();
