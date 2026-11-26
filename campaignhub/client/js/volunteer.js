const statusBox = document.getElementById("statusBox");
const mainArea = document.getElementById("mainArea");

async function init() {
  if (!requireRole("volunteer")) return;
  renderSidebar("volunteer", "dashboard");

  // Always ask the server for the latest status (the Admin may have approved since login)
  const { user } = await api("/auth/me");
  localStorage.setItem("user", JSON.stringify(user));
  fillUserChip(user);

  if (user.status === "approved") {
    document.getElementById("welcomeTitle").innerHTML = `Welcome, ${esc(user.name.split(" ")[0])}! <span class="wave">🎉</span>`;
    mainArea.classList.remove("hidden");
    loadStats(user);
    renderActionPanel("actionPanel");
    loadRecommendations();
    return;
  }

  statusBox.classList.remove("hidden");

  if (user.status === "pending") {
    statusBox.innerHTML = `
      <div class="status-icon amber">${ICONS.clock}</div>
      <h2>Waiting for verification</h2>
      <p>Thanks for registering! The Admin is reviewing your account. You can browse and join campaigns as soon as it is approved.</p>
      <div class="timeline">
        <div class="step done"><div class="dot">${ICONS.check}</div><span>Registered</span></div>
        <div class="step current"><div class="dot">2</div><span>Admin review</span></div>
        <div class="step"><div class="dot">3</div><span>Join campaigns</span></div>
      </div>`;
  } else {
    statusBox.innerHTML = `
      <div class="status-icon red">${ICONS.alert}</div>
      <h2>Registration not approved</h2>
      <p>Unfortunately, the Admin did not approve your account.</p>
      <div class="reason-box"><strong>Reason:</strong> ${esc(user.rejectionReason) || "Not given"}</div>
      <div class="timeline">
        <div class="step done"><div class="dot">${ICONS.check}</div><span>Registered</span></div>
        <div class="step failed"><div class="dot">${ICONS.x}</div><span>Admin review</span></div>
        <div class="step"><div class="dot">3</div><span>Join campaigns</span></div>
      </div>`;
  }
}

async function loadStats(user) {
  try {
    const [a, c] = await Promise.all([api("/applications/mine"), api("/campaigns/active")]);
    const n = countBy(a.applications);
    const mine = (user.skills || []).map((x) => x.toLowerCase());
    const set = (id, v) => (document.getElementById(id).textContent = v);
    set("sApplied", n.applied || 0);
    set("sAccepted", n.accepted || 0);
    set("sOpen", c.campaigns.length);
    set("sMatch", c.campaigns.filter((x) => (x.requiredSkills || []).some((s) => mine.includes(s.toLowerCase()))).length);
  } catch (err) {
    toast(err.message, "error");
  }
}

// (20) AI Campaign Recommendation
async function loadRecommendations() {
  const el = document.getElementById("recPanel");
  el.classList.remove("hidden");
  el.innerHTML = `<div class="card-head"><div><h2>${AI_ICON} Recommended for you</h2><p>Finding campaigns that fit your skills...</p></div></div>
    <div class="rec-grid">${'<div class="rec-card"><div class="skel" style="width:40%"></div><div class="skel" style="height:18px"></div><div class="skel"></div></div>'.repeat(3)}</div>`;
  try {
    const data = await api("/ai/recommendations");
    if (!data.items.length) {
      el.innerHTML = `<div class="card-head"><div><h2>${AI_ICON} Recommended for you</h2>
        <p>${data.source === "none" ? "You have applied to every active campaign — nice!" : "No campaign matches your skills right now. Add more skills in My Profile or browse all campaigns."}</p></div>
        <a class="btn btn-light btn-sm" href="/volunteer/campaigns.html">${NAV_ICONS.search}Browse all</a></div>`;
      return;
    }
    const isAi = data.source === "ai";
    el.innerHTML = `
      <div class="card-head">
        <div><h2>${AI_ICON} Recommended for you <span class="source-tag ${isAi ? "ai" : "skills"}">${isAi ? "✨ AI" : "Skill match"}</span></h2>
        <p>${esc(data.note || "Picked by AI from your skills, availability and area.")}</p></div>
        <a class="btn btn-light btn-sm" href="/volunteer/campaigns.html">${NAV_ICONS.search}Browse all</a>
      </div>
      <div class="rec-grid">${data.items
        .map(
          (r, i) => `
        <div class="rec-card" style="animation-delay:${i * 90}ms">
          <span class="cat-tag">${esc(r.campaign.category)}</span>
          <h4>${esc(r.campaign.title)}</h4>
          <span class="app-for">${esc(r.campaign.organization || "")} · ${esc(r.campaign.location)} · ${formatDate(r.campaign.startDate)}</span>
          <div class="rec-reason ${isAi ? "" : "plain"}">${isAi ? "✨ " : ""}${esc(r.reason)}</div>
          <a class="btn btn-primary-grad btn-sm" href="/volunteer/campaigns.html?open=${r.campaign._id}">${META_ICONS.heart}View &amp; apply</a>
        </div>`
        )
        .join("")}</div>`;
  } catch (err) {
    el.classList.add("hidden"); // recommendations are optional — never block the dashboard
  }
}

init();
