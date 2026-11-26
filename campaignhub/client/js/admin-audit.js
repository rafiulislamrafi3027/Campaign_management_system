// Audit Log (Req 15, 22) — read-only
const admin = requireRole("admin");
if (admin) {
  fillUserChip(admin);
  renderSidebar("admin", "audit");
}

const $ = (id) => document.getElementById(id);
$("csvBtn").innerHTML = `${META_ICONS.download}Export CSV`;

const CATS = [
  { key: "", label: "All" },
  { key: "account", label: "Accounts" },
  { key: "campaign", label: "Campaigns" },
  { key: "application", label: "Applications" },
  { key: "task", label: "Tasks" },
  { key: "expense", label: "Expenses" },
  { key: "certificate", label: "Certificates" },
  { key: "ai", label: "AI" },
];

// Plain-English names for every action
const ACTIONS = {
  "account.register": "Registered",
  "account.approve": "Approved volunteer",
  "account.reject": "Rejected volunteer",
  "account.remove_manager": "Removed manager",
  "account.restore_manager": "Restored manager",
  "account.password_change": "Changed password",
  "account.reset_request": "Asked for password reset code",
  "account.reset_done": "Reset password with code",
  "account.login_failed": "Failed login (wrong password)",
  "account.login_locked": "Login locked (too many wrong passwords)",
  "campaign.create": "Created campaign draft",
  "campaign.delete_draft": "Deleted campaign draft",
  "campaign.submit": "Submitted campaign for approval",
  "campaign.approve": "Approved campaign",
  "campaign.reject": "Rejected campaign",
  "campaign.activate": "Activated campaign",
  "campaign.remove": "Removed campaign",
  "campaign.restore": "Restored campaign",
  "campaign.delete_permanent": "Deleted campaign permanently",
  "campaign.report_submit": "Sent completion report",
  "campaign.report_verify": "Verified completion report",
  "campaign.report_return": "Sent completion report back",
  "application.apply": "Applied to campaign",
  "application.withdraw": "Withdrew application",
  "application.accept": "Accepted application",
  "application.reject": "Rejected application",
  "task.create": "Created & assigned task",
  "task.update": "Edited task",
  "task.delete": "Deleted task",
  "task.submit": "Submitted proof",
  "task.verify": "Verified task",
  "task.revision": "Asked for revision",
  "expense.create": "Added expense",
  "expense.update": "Edited expense",
  "expense.delete": "Deleted expense",
  "certificate.issue": "Issued certificates",
  "ai.task_planner": "Used AI Task Planner",
  "ai.receipt_scanner": "Used AI Receipt Scanner",
  "ai.campaign_recommendation": "Got AI recommendations",
};
// Colour of the dot: red for removals/rejections, green for approvals, etc.
const tone = (a) =>
  /reject|remove|delete|failed|revision|return|withdraw/.test(a) ? "bad" : /approve|verify|accept|activate|restore|issue/.test(a) ? "good" : a.startsWith("ai.") ? "ai" : "plain";

let cat = new URLSearchParams(location.search).get("category") || "";
let page = 1;
let entries = [];

function params() {
  const p = new URLSearchParams();
  if (cat) p.set("category", cat);
  if ($("q").value.trim()) p.set("q", $("q").value.trim());
  if ($("from").value) p.set("from", $("from").value);
  if ($("to").value) p.set("to", $("to").value);
  return p;
}

async function load(reset = true) {
  if (reset) {
    page = 1;
    entries = [];
    $("list").innerHTML = `<p class="muted" style="padding:20px;text-align:center">Loading...</p>`;
  }
  try {
    const p = params();
    p.set("page", page);
    const data = await api(`/admin/audit?${p}`);
    entries = entries.concat(data.entries);
    render();
    $("more").classList.toggle("hidden", !data.hasMore);
  } catch (err) {
    toast(err.message, "error");
  }
}

function dayLabel(d) {
  const x = new Date(d), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (x.toDateString() === today.toDateString()) return "Today";
  if (x.toDateString() === y.toDateString()) return "Yesterday";
  return x.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function render() {
  $("cats").innerHTML = CATS.map((c) => `<button class="tab ${c.key === cat ? "active" : ""}" data-cat="${c.key}">${c.label}</button>`).join("");
  if (!entries.length) {
    $("list").innerHTML = `<div class="empty-box">${ICONS.inbox}<h3>Nothing recorded</h3><p>No actions match these filters.</p></div>`;
    return;
  }
  let lastDay = "";
  $("list").innerHTML = entries
    .map((e, i) => {
      const day = dayLabel(e.createdAt);
      const head = day !== lastDay ? `<div class="audit-day">${day}</div>` : "";
      lastDay = day;
      return `${head}
      <div class="audit-row ${tone(e.action)}" style="animation-delay:${Math.min(i, 20) * 25}ms">
        <span class="audit-time">${new Date(e.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
        <span class="audit-dot"></span>
        <div class="audit-body">
          <p><strong>${esc(e.actorName)}</strong> ${e.actorRole ? `<span class="role-tag ${esc(e.actorRole)}">${esc(e.actorRole)}</span>` : ""}
            ${esc(ACTIONS[e.action] || e.action)}${e.targetLabel ? ` · <b>${esc(e.targetLabel)}</b>` : ""}</p>
          ${e.details ? `<small>${esc(e.details)}</small>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

$("cats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  cat = b.dataset.cat;
  load();
});
let timer;
$("q").addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(load, 350);
});
$("from").addEventListener("change", () => load());
$("to").addEventListener("change", () => load());
$("more").addEventListener("click", () => {
  page++;
  load(false);
});
$("csvBtn").addEventListener("click", async () => {
  try {
    await downloadFile(`/admin/audit/export?${params()}`, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
    toast("Audit log downloaded");
  } catch (err) {
    toast(err.message, "error");
  }
});

if (admin) load();
