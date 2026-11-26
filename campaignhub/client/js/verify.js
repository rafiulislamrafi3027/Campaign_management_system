// Public certificate check (Req 14) — works without login
const form = document.getElementById("vForm");
const input = document.getElementById("v_code");
const out = document.getElementById("vResult");
const btn = document.getElementById("vBtn");

async function check(code) {
  code = code.trim().toUpperCase();
  if (!code) return;
  btn.disabled = true;
  btn.textContent = "Checking...";
  out.innerHTML = "";
  try {
    const res = await fetch(`${API_BASE}/certificates/verify/${encodeURIComponent(code)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.valid) {
      const c = data.certificate;
      out.innerHTML = `
        <div class="verify-box ok">
          <div class="verify-head">${META_ICONS.shield}<div><strong>Valid certificate</strong><small>${esc(c.code)}</small></div></div>
          <dl>
            <dt>Awarded to</dt><dd class="big">${esc(c.volunteerName)}</dd>
            <dt>Campaign</dt><dd>${esc(c.campaignTitle)}${c.category ? ` <span class="muted">· ${esc(c.category)}</span>` : ""}</dd>
            ${c.organization ? `<dt>Organized by</dt><dd>${esc(c.organization)}</dd>` : ""}
            ${c.location ? `<dt>Place</dt><dd>${esc(c.location)}</dd>` : ""}
            <dt>Dates</dt><dd>${formatDate(c.startDate)} – ${formatDate(c.endDate)}</dd>
            <dt>Verified tasks</dt><dd>${c.tasksCompleted}</dd>
            <dt>Issued</dt><dd>${formatDate(c.issuedAt)}</dd>
          </dl>
        </div>`;
    } else {
      out.innerHTML = `
        <div class="verify-box bad">
          <div class="verify-head">${ICONS.x}<div><strong>Not verified</strong><small>${esc(data.message || "No certificate with this ID was found")}</small></div></div>
          <p>Check the ID for typing mistakes. A real CampaignHub certificate ID looks like <b>CH-2026-7KQ4XM</b>.</p>
        </div>`;
    }
  } catch {
    out.innerHTML = `<div class="verify-box bad"><div class="verify-head">${ICONS.x}<div><strong>Could not check right now</strong><small>Please try again.</small></div></div></div>`;
  }
  btn.disabled = false;
  btn.textContent = "Check certificate";
  history.replaceState(null, "", `?code=${encodeURIComponent(code)}`);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  check(input.value);
});

// Opened from the link printed on the certificate: /verify.html?code=CH-2026-XXXXXX
const fromLink = new URLSearchParams(location.search).get("code");
if (fromLink) {
  input.value = fromLink.toUpperCase();
  check(fromLink);
}
