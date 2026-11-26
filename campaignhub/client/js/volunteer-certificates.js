// My Certificates (Req 14)
const grid = document.getElementById("grid");
document.getElementById("verifyBtn").innerHTML = `${META_ICONS.shield}Verify a certificate`;

async function init() {
  if (!requireRole("volunteer")) return;
  renderSidebar("volunteer", "certificates");
  const { user } = await api("/auth/me");
  localStorage.setItem("user", JSON.stringify(user));
  fillUserChip(user);

  if (user.status !== "approved") {
    const box = document.getElementById("blocked");
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="status-icon amber">${ICONS.clock}</div>
      <h2>Not available yet</h2>
      <p>You can earn certificates after the Admin verifies your account.</p>
      <a class="btn btn-primary-grad" style="margin-top:22px" href="/volunteer/dashboard.html">Check my status</a>`;
    return;
  }
  document.getElementById("area").classList.remove("hidden");
  await load();
  markSeen("certificates");
}

async function load() {
  try {
    const { certificates } = await api("/certificates/mine");
    render(certificates);
  } catch (err) {
    toast(err.message, "error");
  }
}

function render(list) {
  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-box" style="grid-column:1/-1">${NAV_ICONS.award}
        <h3>No certificates yet</h3>
        <p>Join a campaign, finish your tasks with proof, and when the Admin verifies the campaign as completed your certificate appears here.</p>
        <a class="btn btn-primary-grad" href="/volunteer/campaigns.html">${NAV_ICONS.search}Browse campaigns</a>
      </div>`;
    return;
  }
  const verifyBase = `${location.origin}/verify.html?code=`;
  grid.innerHTML = list
    .map(
      (c, i) => `
    <article class="cert-card" style="animation-delay:${i * 70}ms">
      <div class="cert-ribbon">${NAV_ICONS.award}</div>
      <p class="cert-kicker">Certificate of participation</p>
      <h3>${esc(c.campaignTitle)}</h3>
      <p class="cert-org">${esc(c.organization || "")}${c.location ? ` · ${esc(c.location)}` : ""}</p>
      <div class="cert-facts">
        <span>${META_ICONS.cal}${formatDate(c.startDate)} – ${formatDate(c.endDate)}</span>
        <span>${ICONS.check}${c.tasksCompleted} verified task${c.tasksCompleted === 1 ? "" : "s"}</span>
        ${c.avgRating ? `<span>★ ${c.avgRating} / 5 rating</span>` : ""}
      </div>
      <div class="cert-code"><small>Certificate ID</small><strong>${esc(c.code)}</strong>
        <button class="icon-btn" data-copy="${esc(verifyBase + c.code)}" title="Copy verification link">${META_ICONS.copy}</button></div>
      <p class="cert-issued">Issued ${formatDate(c.issuedAt)}</p>
      <div class="camp-actions">
        <a class="btn btn-light btn-sm" href="/verify.html?code=${encodeURIComponent(c.code)}" target="_blank">${META_ICONS.shield}Verify</a>
        <button class="btn btn-primary-grad btn-sm" data-cert="${c._id}" data-code="${esc(c.code)}">${META_ICONS.download}Download PDF</button>
      </div>
    </article>`
    )
    .join("");
}

bindCertificateDownloads(grid);
grid.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    toast("Verification link copied");
  } catch {
    toast(b.dataset.copy);
  }
});

init();
