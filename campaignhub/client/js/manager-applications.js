const me = requireRole("manager");
if (me) {
  fillUserChip(me);
  renderSidebar("manager", "applications");
}

const grid = document.getElementById("grid");
const tabsEl = document.getElementById("tabs");
const summaryEl = document.getElementById("summary");

const TABS = ["applied", "accepted", "rejected", "all"];
let campaigns = [];
let apps = [];
let currentTab = "applied";
let currentCampaign = ""; // "" = all campaigns

async function load() {
  try {
    const data = await api("/applications/manager");
    campaigns = data.campaigns;
    apps = data.applications.filter((a) => a.volunteer && a.campaign);
    renderSummary();
    renderTabs();
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

function capacityHTML(c) {
  const need = c.volunteersNeeded || 0;
  const pct = need ? Math.min(100, Math.round((c.accepted / need) * 100)) : 0;
  return `
    <div class="capacity ${need && c.accepted >= need ? "full" : ""}">
      <div class="bar"><i style="width:${need ? pct : 0}%"></i></div>
      <span><b>${c.accepted}</b>${need ? ` / ${need}` : ""} accepted</span>
    </div>`;
}

function renderSummary() {
  if (!campaigns.length) {
    summaryEl.innerHTML = `
      <div class="empty-box">${ICONS.inbox}
        <h3>No active campaigns</h3>
        <p>Volunteers can apply only after a campaign is approved and made active.</p>
        <a class="btn btn-primary-grad" href="/manager/campaigns.html">Go to My Campaigns</a>
      </div>`;
    return;
  }
  const pendingFor = (id) => apps.filter((a) => a.campaign._id === id && a.status === "applied").length;
  summaryEl.innerHTML =
    `<div class="item ${currentCampaign === "" ? "active" : ""}" data-camp="">
       <h4>All campaigns</h4>
       <span class="muted" style="font-size:13px">${apps.filter((a) => a.status === "applied").length} waiting for review</span>
     </div>` +
    campaigns
      .map(
        (c, i) => `
      <div class="item ${currentCampaign === c._id ? "active" : ""}" data-camp="${c._id}" style="animation-delay:${i * 60}ms">
        <h4 title="${esc(c.title)}">${esc(c.title)} ${["completed", "completion_review"].includes(c.status) ? `<span class="badge ${c.status}" style="margin-left:6px">${STATUS_LABEL[c.status]}</span>` : ""}</h4>
        ${capacityHTML(c)}
        <span class="muted" style="font-size:12px">${pendingFor(c._id)} waiting for review</span>
      </div>`
      )
      .join("");
}

summaryEl.addEventListener("click", (e) => {
  const item = e.target.closest("[data-camp]");
  if (!item) return;
  currentCampaign = item.dataset.camp;
  renderSummary();
  renderTabs();
  render();
});

function visibleApps() {
  return currentCampaign ? apps.filter((a) => a.campaign._id === currentCampaign) : apps;
}

function renderTabs() {
  const n = countBy(visibleApps());
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
  const list = visibleApps().filter((a) => currentTab === "all" || a.status === currentTab);
  if (!campaigns.length) {
    grid.innerHTML = "";
    return;
  }
  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-box">${ICONS.inbox}
        <h3>${currentTab === "applied" ? "No applications waiting" : "Nothing here"}</h3>
        <p>${currentTab === "applied" ? "New applications from volunteers will show up here." : "Applications with this status will appear here."}</p>
      </div>`;
    return;
  }

  grid.innerHTML = list
    .map((a, i) => {
      const v = a.volunteer;
      const c = a.campaign;
      const matches = (v.skills || []).filter((s) => (c.requiredSkills || []).map((x) => x.toLowerCase()).includes(s.toLowerCase())).length;
      const canDecide = a.status === "applied" && c.status === "active";
      return `
        <article class="camp-card spot" style="--i:${i}">
          <div class="camp-top">
            <div class="app-person">
              <div class="avatar">${esc(initials(v.name))}</div>
              <div><strong>${esc(v.name)}</strong><small>${esc(v.location || "No location")} · ${esc(v.availability || "—")}</small></div>
            </div>
            <span class="badge ${a.status}">${APP_LABEL[a.status]}</span>
          </div>
          <p class="app-for">For <b>${esc(c.title)}</b> · ${timeAgo(a.createdAt)}</p>
          <div>
            <small class="detail-label">Skills ${matches ? `· <span style="color:var(--success)">${matches} skill${matches > 1 ? "s match" : " matches"} this campaign</span>` : ""}</small>
            ${skillChipsMatch(v.skills, c.requiredSkills)}
          </div>
          ${a.message ? `<div class="quote">“${esc(a.message)}”</div>` : `<p class="muted" style="font-size:13px">No message from the volunteer.</p>`}
          <p class="app-for">${esc(v.email)}${v.phone ? " · " + esc(v.phone) : ""}</p>
          ${a.decisionNote ? `<div class="camp-note ${a.status === "accepted" ? "ok" : "warn"}">Your note: ${esc(a.decisionNote)}</div>` : ""}
          ${
            canDecide
              ? `<div class="camp-actions">
                   <button class="btn btn-outline-danger btn-sm" data-act="rejected" data-id="${a._id}">${ICONS.x}Reject</button>
                   <button class="btn btn-success btn-sm" data-act="accepted" data-id="${a._id}">${ICONS.check}Accept</button>
                 </div>`
              : ""
          }
        </article>`;
    })
    .join("");
}

grid.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = apps.find((x) => x._id === b.dataset.id);
  if (a) openDecision(a, b.dataset.act);
});

// Accept / reject with an optional note for the volunteer
function openDecision(a, decision) {
  const accept = decision === "accepted";
  const modal = openModal(`
    <h3>${accept ? "Accept" : "Reject"} ${esc(a.volunteer.name)}?</h3>
    <p>${accept ? `${esc(a.volunteer.name)} will join "${esc(a.campaign.title)}".` : "The volunteer will see that the application was not accepted."}</p>
    <label for="dNote">Note for the volunteer <span class="muted">(optional)</span></label>
    <textarea id="dNote" maxlength="600" placeholder="${accept ? "e.g. Welcome! Please join the briefing on Friday at 5 PM." : "e.g. We already have enough volunteers for logistics."}"></textarea>
    <div class="modal-actions">
      <button class="btn btn-light" data-c>Cancel</button>
      <button class="btn ${accept ? "btn-success" : "btn-danger"}" data-ok>${accept ? ICONS.check + "Accept" : ICONS.x + "Reject"}</button>
    </div>`);
  modal.querySelector("#dNote").focus();
  modal.querySelector("[data-c]").addEventListener("click", () => modal.close());
  modal.querySelector("[data-ok]").addEventListener("click", async (e) => {
    const btn = e.currentTarget; // save it: currentTarget is null after "await"
    btn.disabled = true;
    try {
      const data = await api(`/applications/${a._id}/decision`, {
        method: "PATCH",
        body: { decision, note: modal.querySelector("#dNote").value },
      });
      toast(data.message);
      loadAlerts();
      modal.close();
      load();
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
    }
  });
}

load();
