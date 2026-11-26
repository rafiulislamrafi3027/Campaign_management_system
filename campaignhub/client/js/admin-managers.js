const admin = requireRole("admin");
if (admin) {
  fillUserChip(admin);
  renderSidebar("admin", "managers");
}

const grid = document.getElementById("grid");
const tabsEl = document.getElementById("tabs");
const searchEl = document.getElementById("search");

const TABS = [
  { key: "approved", label: "Active" },
  { key: "removed", label: "Removed" },
  { key: "all", label: "All" },
];
let managers = [];
let currentTab = "approved";

async function load() {
  try {
    const data = await api("/admin/managers");
    managers = data.managers;
    updateStats();
    renderTabs();
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

function updateStats() {
  const active = managers.filter((m) => m.status !== "removed");
  document.getElementById("sTotal").textContent = managers.length;
  document.getElementById("sActive").textContent = active.length;
  document.getElementById("sRemoved").textContent = managers.length - active.length;
  document.getElementById("sLive").textContent = managers.reduce((n, m) => n + m.stats.active, 0);
}

function renderTabs() {
  const count = (k) => (k === "all" ? managers.length : managers.filter((m) => (k === "removed" ? m.status === "removed" : m.status !== "removed")).length);
  tabsEl.innerHTML = TABS.map(
    (t) => `<button class="tab ${t.key === currentTab ? "active" : ""}" data-tab="${t.key}">${t.label} <span class="count">${count(t.key)}</span></button>`
  ).join("");
}
tabsEl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  currentTab = b.dataset.tab;
  renderTabs();
  render();
});
searchEl.addEventListener("input", render);

function render() {
  const q = searchEl.value.trim().toLowerCase();
  const list = managers.filter((m) => {
    if (currentTab === "removed" && m.status !== "removed") return false;
    if (currentTab === "approved" && m.status === "removed") return false;
    if (!q) return true;
    return [m.name, m.email, m.organization, m.location].join(" ").toLowerCase().includes(q);
  });

  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-box">${ICONS.inbox}
        <h3>${q ? "No managers match your search" : currentTab === "removed" ? "No removed managers" : "No managers yet"}</h3>
        <p>${q ? "Try a different name or email." : "Managers appear here after they register."}</p>
      </div>`;
    return;
  }

  grid.innerHTML = list
    .map((m, i) => {
      const removed = m.status === "removed";
      return `
        <article class="camp-card spot ${removed ? "is-removed" : ""}" style="--i:${i}">
          <div class="camp-top">
            <div class="app-person">
              <div class="avatar">${esc(initials(m.name))}</div>
              <div><strong>${esc(m.name)}</strong><small>${esc(m.organization || "No organization")}</small></div>
            </div>
            <span class="badge ${removed ? "removed" : "approved"}">${removed ? "Removed" : "Active"}</span>
          </div>
          <p class="app-for">${esc(m.email)}${m.phone ? " · " + esc(m.phone) : ""}${m.location ? " · " + esc(m.location) : ""}</p>
          <div class="mgr-stats">
            <div><strong>${m.stats.total}</strong><small>Campaigns</small></div>
            <div><strong>${m.stats.active}</strong><small>Active</small></div>
            <div><strong>${m.stats.waiting}</strong><small>Waiting</small></div>
            <div><strong>${m.stats.completed}</strong><small>Completed</small></div>
          </div>
          <p class="app-for">Approved budget <b>${formatMoney(m.stats.budget)}</b> · Joined ${formatDate(m.createdAt)}</p>
          ${removed ? `<div class="camp-note warn"><strong>Removed${m.removedAt ? " on " + formatDate(m.removedAt) : ""}:</strong> ${esc(m.removalReason)}</div>` : ""}
          <div class="camp-actions">
            <button class="btn btn-light btn-sm" data-act="view" data-id="${m.id}">${META_ICONS.eye}Campaigns</button>
            ${
              removed
                ? `<button class="btn btn-light btn-sm" data-act="restore" data-id="${m.id}">${META_ICONS.restore}Restore</button>`
                : `<button class="btn btn-outline-danger btn-sm" data-act="remove" data-id="${m.id}">${META_ICONS.ban}Remove manager</button>`
            }
          </div>
        </article>`;
    })
    .join("");
}

grid.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const m = managers.find((x) => x.id === b.dataset.id);
  if (!m) return;
  if (b.dataset.act === "view") viewCampaigns(m);
  if (b.dataset.act === "remove") removeManager(m);
  if (b.dataset.act === "restore") restoreManager(m);
});

// List of this manager's campaigns (drafts are private, so they are not shown)
async function viewCampaigns(m) {
  try {
    const { campaigns } = await api("/campaigns/admin");
    const own = campaigns.filter((c) => c.manager && String(c.manager._id) === String(m.id));
    openModal(
      `<h3>${esc(m.name)}'s campaigns</h3>
       <p>${esc(m.organization || "")}${m.stats.drafts ? ` · ${m.stats.drafts} private draft(s) not shown` : ""}</p>
       ${
         own.length
           ? `<div class="mini-list">${own
               .map(
                 (c) => `<div class="row"><span>${esc(c.title)}<br><small class="muted">${formatDate(c.startDate)} · ${formatMoney(c.budget)}</small></span>
                         <span class="badge ${c.status}">${STATUS_LABEL[c.status] || c.status}</span></div>`
               )
               .join("")}</div>
              <a class="link-btn" href="/admin/campaigns.html">Manage campaigns →</a>`
           : `<div class="empty-box" style="padding:30px 10px">${ICONS.inbox}<p>No submitted campaigns yet.</p></div>`
       }`,
      { wide: true }
    );
  } catch (err) {
    toast(err.message, "error");
  }
}

function removeManager(m) {
  const live = m.stats.total - m.stats.removed;
  const modal = openModal(`
    <h3>Remove ${esc(m.name)}?</h3>
    <p>${esc(m.name)} will not be able to log in and will see your reason. You can restore the account later.</p>
    ${live ? `<div class="danger-zone">${live} campaign(s) of this manager${m.stats.active ? `, including <strong>${m.stats.active} active</strong>,` : ""} will be removed too. Volunteers will no longer see them.</div>` : ""}
    <div class="field">
      <label for="rReason">Reason for removal</label>
      <textarea id="rReason" maxlength="600" placeholder="e.g. Created duplicate campaigns and did not respond to warnings."></textarea>
    </div>
    <div class="field confirm-name">
      <label for="rName">Type <code>${esc(m.name)}</code> to confirm</label>
      <input id="rName" autocomplete="off" />
    </div>
    <div class="modal-actions">
      <button class="btn btn-light" data-c>Cancel</button>
      <button class="btn btn-danger" data-ok>${META_ICONS.ban}Remove manager</button>
    </div>`);
  const reasonEl = modal.querySelector("#rReason");
  reasonEl.focus();
  modal.querySelector("[data-c]").addEventListener("click", () => modal.close());
  modal.querySelector("[data-ok]").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const reason = reasonEl.value.trim();
    if (!reason) {
      reasonEl.focus();
      return toast("A reason is required to remove a manager", "error");
    }
    if (modal.querySelector("#rName").value.trim() !== m.name.trim()) {
      return toast("The name you typed does not match", "error");
    }
    btn.disabled = true;
    try {
      const data = await api(`/admin/managers/${m.id}/remove`, { method: "PATCH", body: { reason } });
      toast(data.message);
      modal.close();
      currentTab = "removed";
      load();
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
    }
  });
}

async function restoreManager(m) {
  const ok = await confirmDialog({
    title: `Restore ${m.name}?`,
    text: "The manager can log in again, and campaigns that were removed together with the account will come back.",
    okText: "Restore",
  });
  if (!ok) return;
  try {
    const data = await api(`/admin/managers/${m.id}/restore`, { method: "PATCH" });
    toast(data.message);
    currentTab = "approved";
    load();
  } catch (err) {
    toast(err.message, "error");
  }
}

load();
