const grid = document.getElementById("grid");
const searchEl = document.getElementById("search");
const categoryEl = document.getElementById("category");
const sortEl = document.getElementById("sort");
let campaigns = [];
let mySkills = [];
let myApps = {}; // campaignId -> application

async function init() {
  if (!requireRole("volunteer")) return;
  renderSidebar("volunteer", "campaigns");

  // Latest status from the server
  const { user } = await api("/auth/me");
  localStorage.setItem("user", JSON.stringify(user));
  fillUserChip(user);
  mySkills = (user.skills || []).map((s) => s.toLowerCase());

  if (user.status !== "approved") {
    const box = document.getElementById("blocked");
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="status-icon amber">${ICONS.clock}</div>
      <h2>Campaigns are locked</h2>
      <p>You can browse campaigns after the Admin verifies your account.</p>
      <a class="btn btn-primary-grad" style="margin-top:22px" href="/volunteer/dashboard.html">Check my status</a>`;
    return;
  }

  document.getElementById("browse").classList.remove("hidden");
  await load();
}

async function load() {
  if (!campaigns.length) {
    grid.innerHTML = Array.from({ length: 3 }, () => `
      <div class="camp-card"><div class="skel" style="width:40%"></div><div class="skel" style="width:80%;height:18px"></div>
      <div class="skel"></div><div class="skel" style="width:60%"></div></div>`).join("");
  }
  try {
    const [c, a] = await Promise.all([api("/campaigns/active"), api("/applications/mine")]);
    campaigns = c.campaigns;
    myApps = {};
    a.applications.forEach((app) => app.campaign && (myApps[app.campaign._id] = app));
    render();
    // Opened from a recommendation: show that campaign straight away
    const openId = new URLSearchParams(location.search).get("open");
    if (openId && !window.__opened) {
      window.__opened = true;
      const target = campaigns.find((x) => x._id === openId);
      if (target) openCampaign(target);
      history.replaceState(null, "", location.pathname);
    }
  } catch (err) {
    toast(err.message, "error");
  }
}

// How many of the campaign's required skills the volunteer has
function matchCount(c) {
  return (c.requiredSkills || []).filter((s) => mySkills.includes(s.toLowerCase())).length;
}

function render() {
  const q = searchEl.value.trim().toLowerCase();
  const cat = categoryEl.value;

  let list = campaigns.filter((c) => {
    if (cat && c.category !== cat) return false;
    if (!q) return true;
    return [c.title, c.location, c.description, ...(c.requiredSkills || [])].join(" ").toLowerCase().includes(q);
  });

  if (sortEl.value === "match") list.sort((a, b) => matchCount(b) - matchCount(a) || new Date(a.startDate) - new Date(b.startDate));
  else list.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-box">${ICONS.inbox}
        <h3>${campaigns.length ? "No campaigns match your search" : "No active campaigns yet"}</h3>
        <p>${campaigns.length ? "Try a different word or category." : "New campaigns will appear here when managers make them active."}</p>
      </div>`;
    return;
  }

  grid.innerHTML = list
    .map((c, i) => {
      const m = c.manager || {};
      const matches = matchCount(c);
      const app = myApps[c._id];
      const topRight = app
        ? `<span class="badge ${app.status}">${APP_LABEL[app.status]}</span>`
        : matches
        ? `<span class="match-tag">${ICONS.check}Matches ${matches} of your skills</span>`
        : `<span class="badge active">Active</span>`;
      const btn = app
        ? `<button class="btn btn-light btn-sm" data-id="${c._id}">${META_ICONS.eye}View details</button>`
        : `<button class="btn btn-primary-grad btn-sm" data-id="${c._id}">${META_ICONS.heart}View &amp; apply</button>`;
      return `
        <article class="camp-card spot" style="--i:${i}">
          <div class="camp-top">
            <span class="cat-tag">${esc(c.category)}</span>
            ${topRight}
          </div>
          <h3>${esc(c.title)}</h3>
          <div class="camp-by"><div class="avatar sm">${esc(initials(m.name))}</div>${esc(m.organization || m.name || "")}</div>
          <p class="camp-desc">${esc(c.description)}</p>
          ${campaignMeta(c)}
          ${skillChipsMatch(c.requiredSkills, mySkills)}
          <div class="camp-actions">${btn}</div>
        </article>`;
    })
    .join("");
}

[searchEl, categoryEl, sortEl].forEach((el) => el.addEventListener("input", render));

grid.addEventListener("click", (e) => {
  const b = e.target.closest("[data-id]");
  if (!b) return;
  const c = campaigns.find((x) => x._id === b.dataset.id);
  if (c) openCampaign(c);
});

// Campaign details + apply form (or the current application state)
function openCampaign(c) {
  const app = myApps[c._id];
  let bottom;

  if (!app) {
    bottom = `
      <div class="apply-box">
        <label for="applyMsg">Why do you want to join? <span class="muted">(optional)</span></label>
        <textarea id="applyMsg" maxlength="600" placeholder="e.g. I have done logistics work in two relief campaigns and I am free every weekend."></textarea>
        <div class="modal-actions">
          <button class="btn btn-light" data-close>Cancel</button>
          <button class="btn btn-primary-grad" id="applyBtn">${META_ICONS.heart}Apply to join</button>
        </div>
      </div>`;
  } else if (app.status === "applied") {
    bottom = `
      <div class="state-box applied">${ICONS.clock}
        <div><strong>Application sent ${timeAgo(app.createdAt)}</strong>The manager will review it soon. You can withdraw it until then.</div>
      </div>
      <div class="modal-actions"><button class="btn btn-outline-danger" id="withdrawBtn">${ICONS.x}Withdraw application</button></div>`;
  } else if (app.status === "accepted") {
    bottom = `
      <div class="state-box accepted">${ICONS.check}
        <div><strong>You're in! 🎉</strong>The manager accepted your application. Tasks for this campaign will appear in "My Tasks".
        ${app.decisionNote ? `<br><em>“${esc(app.decisionNote)}”</em>` : ""}</div>
      </div>`;
  } else {
    bottom = `
      <div class="state-box rejected">${ICONS.alert}
        <div><strong>Application not accepted</strong>${app.decisionNote ? esc(app.decisionNote) : "The manager did not accept this application."}</div>
      </div>`;
  }

  const modal = openModal(campaignDetailsHTML(c) + bottom, { wide: true });
  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.close());

  modal.querySelector("#applyBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const data = await api("/applications", {
        method: "POST",
        body: { campaignId: c._id, message: modal.querySelector("#applyMsg").value },
      });
      toast(data.message);
      loadAlerts();
      modal.close();
      await load();
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
    }
  });

  modal.querySelector("#withdrawBtn")?.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "Withdraw application?", text: "You can apply again later.", okText: "Withdraw", danger: true });
    if (!ok) return;
    try {
      const data = await api(`/applications/${app._id}`, { method: "DELETE" });
      toast(data.message);
      loadAlerts();
      modal.close();
      await load();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

init();
