const grid = document.getElementById("grid");
const tabsEl = document.getElementById("tabs");
document.getElementById("browseBtn").innerHTML = `${NAV_ICONS.search}Browse campaigns`;

const TABS = ["all", "applied", "accepted", "rejected"];
let apps = [];
let currentTab = "all";

async function init() {
  if (!requireRole("volunteer")) return;
  renderSidebar("volunteer", "applications");
  const { user } = await api("/auth/me");
  localStorage.setItem("user", JSON.stringify(user));
  fillUserChip(user);

  if (user.status !== "approved") {
    const box = document.getElementById("blocked");
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="status-icon amber">${ICONS.clock}</div>
      <h2>Not available yet</h2>
      <p>You can apply to campaigns after the Admin verifies your account.</p>
      <a class="btn btn-primary-grad" style="margin-top:22px" href="/volunteer/dashboard.html">Check my status</a>`;
    return;
  }
  document.getElementById("area").classList.remove("hidden");
  load();
  markSeen("applications");
}

async function load() {
  try {
    const data = await api("/applications/mine");
    apps = data.applications.filter((a) => a.campaign); // skip if the campaign was removed
    renderTabs();
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderTabs() {
  const n = countBy(apps);
  tabsEl.innerHTML = TABS.map(
    (t) => `<button class="tab ${t === currentTab ? "active" : ""}" data-tab="${t}">
              ${t === "all" ? "All" : APP_LABEL[t]} <span class="count">${n[t] || 0}</span></button>`
  ).join("");
}
tabsEl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  currentTab = b.dataset.tab;
  renderTabs();
  render();
});

function render() {
  const list = currentTab === "all" ? apps : apps.filter((a) => a.status === currentTab);
  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-box">${ICONS.inbox}
        <h3>${currentTab === "all" ? "You haven't applied yet" : "Nothing here"}</h3>
        <p>${currentTab === "all" ? "Find a campaign that matches your skills and apply." : "Applications with this status will appear here."}</p>
        ${currentTab === "all" ? `<a class="btn btn-primary-grad" href="/volunteer/campaigns.html">${NAV_ICONS.search}Browse campaigns</a>` : ""}
      </div>`;
    return;
  }

  grid.innerHTML = list
    .map((a, i) => {
      const c = a.campaign;
      const m = c.manager || {};
      let extra = "";
      const removed = c.status === "removed";
      if (a.status === "applied")
        extra = `<div class="camp-actions"><button class="btn btn-outline-danger btn-sm" data-withdraw="${a._id}">${ICONS.x}Withdraw</button></div>`;
      if (a.status === "accepted")
        extra = `<div class="camp-note ok">You're part of this campaign. ${a.decisionNote ? `“${esc(a.decisionNote)}”` : ""}</div>`;
      if (a.status === "rejected")
        extra = `<div class="camp-note warn">${a.decisionNote ? esc(a.decisionNote) : "The manager did not accept this application."}</div>`;
      if (removed)
        extra = `<div class="camp-note warn"><strong>This campaign was removed by the Admin.</strong> ${esc(c.removalReason || "")}</div>` +
          (a.status === "applied" ? `<div class="camp-actions"><button class="btn btn-outline-danger btn-sm" data-withdraw="${a._id}">${ICONS.x}Withdraw</button></div>` : "");

      return `
        <article class="camp-card spot" style="--i:${i}">
          <div class="camp-top">
            <span class="cat-tag">${esc(c.category)}</span>
            <span class="badge ${removed ? "removed" : a.status}">${removed ? "Campaign removed" : APP_LABEL[a.status]}</span>
          </div>
          <h3>${esc(c.title)}</h3>
          <div class="camp-by"><div class="avatar sm">${esc(initials(m.name))}</div>${esc(m.organization || m.name || "")}</div>
          ${campaignMeta(c)}
          ${a.message ? `<div class="quote">“${esc(a.message)}”</div>` : ""}
          <p class="app-for">Applied ${timeAgo(a.createdAt)}${a.decidedAt ? ` · Reviewed ${timeAgo(a.decidedAt)}` : ""}</p>
          ${extra}
        </article>`;
    })
    .join("");
}

grid.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-withdraw]");
  if (!b) return;
  const ok = await confirmDialog({ title: "Withdraw application?", text: "You can apply again later.", okText: "Withdraw", danger: true });
  if (!ok) return;
  b.disabled = true;
  try {
    const data = await api(`/applications/${b.dataset.withdraw}`, { method: "DELETE" });
    toast(data.message);
    loadAlerts();
    load();
  } catch (err) {
    toast(err.message, "error");
    b.disabled = false;
  }
});

init();
