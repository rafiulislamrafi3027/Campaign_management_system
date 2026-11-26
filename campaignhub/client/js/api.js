// Shared helpers used by every page

const API_BASE = "/api"; // same server serves the frontend and the API

function getToken() {
  return localStorage.getItem("token");
}

function getUser() {
  const raw = localStorage.getItem("user");
  return raw ? JSON.parse(raw) : null;
}

function saveSession(token, user) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

function logout() {
  // Also forget the private-files cookie on the server side (NFR 25)
  try {
    fetch("/api/auth/logout", { method: "POST", keepalive: true });
  } catch (e) {}
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/index.html";
}

// Calls the backend and returns the JSON. Throws an Error with the server's message on failure.
async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && token) {
    // Token expired or invalid
    logout();
    return;
  }
  if (!res.ok) throw new Error(data.message || "Something went wrong");
  return data;
}

// Downloads a protected file (e.g. a certificate PDF) — the token goes in the header, not the URL
async function downloadFile(path, filename) {
  const res = await fetch(API_BASE + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Download failed");
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// List of certificates of one campaign (Manager / Admin view)
async function certificateListHTML(campaignId) {
  try {
    const { certificates } = await api(`/certificates/campaign/${campaignId}`);
    if (!certificates.length) return `<p class="muted" style="font-size:13px">No certificates — no volunteer had a verified task in this campaign.</p>`;
    return `<ul class="cert-list">${certificates
      .map((c) => `<li><span><strong>${esc(c.volunteerName)}</strong> <span class="muted">· ${c.tasksCompleted} task${c.tasksCompleted === 1 ? "" : "s"} · ${esc(c.code)}</span></span>
        <button class="btn btn-light btn-sm" data-cert="${c._id}" data-code="${esc(c.code)}">${META_ICONS.download}PDF</button></li>`)
      .join("")}</ul>`;
  } catch (err) {
    return `<p class="muted" style="font-size:13px">${esc(err.message)}</p>`;
  }
}
// One click handler for every "PDF" button inside a container
function bindCertificateDownloads(container) {
  container.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cert]");
    if (!b) return;
    b.disabled = true;
    try {
      await downloadFile(`/certificates/${b.dataset.cert}/pdf`, `Certificate-${b.dataset.code}.pdf`);
    } catch (err) {
      toast(err.message, "error");
    }
    b.disabled = false;
  });
}

// Where each role goes after login
function dashboardFor(role) {
  return { admin: "/admin/dashboard.html", manager: "/manager/dashboard.html", volunteer: "/volunteer/dashboard.html" }[role];
}

// Put this at the top of every protected page: requireRole("admin")
function requireRole(role) {
  const user = getUser();
  if (!getToken() || !user) {
    window.location.href = "/index.html";
    return null;
  }
  if (user.role !== role) {
    window.location.href = dashboardFor(user.role);
    return null;
  }
  return user;
}

function showMessage(el, text, type = "error") {
  el.textContent = text;
  el.className = `msg ${type}`;
}

// ---------- UI helpers ----------

// Small inline icons (Lucide-style, stroke = currentColor)
const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
};

// "Rahat Hasan" -> "RH"
function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}

// Fills the name / role / avatar in the top bar
function fillUserChip(user) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const chip = document.querySelector(".user-chip");
  if (chip && !chip.dataset.linked) {
    chip.dataset.linked = "1";
    chip.style.cursor = "pointer";
    chip.title = "My profile";
    chip.addEventListener("click", () => (window.location.href = "/profile.html"));
  }
  set("who", user.name);
  set("whoRole", user.role);
  set("avatar", initials(user.name));
}

// Small popup message at the bottom-right corner
function toast(text, type = "success") {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = (type === "error" ? ICONS.alert : ICONS.check) + `<span>${esc(text)}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---------- Background glow + mouse spotlight on glass cards ----------
document.addEventListener("DOMContentLoaded", () => {
  // Extra pink light in the animated background
  const aurora = document.createElement("div");
  aurora.className = "aurora-pink";
  document.body.prepend(aurora);

  document.querySelectorAll(".auth-card, .card, .stat, .feature").forEach((el) => el.classList.add("spot"));
});

document.addEventListener("mousemove", (e) => {
  const el = e.target.closest && e.target.closest(".spot");
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
});

// Escape text before putting it into innerHTML
function esc(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

// ---------- Formatting ----------
function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function formatMoney(n) {
  return "৳ " + Number(n || 0).toLocaleString("en-IN");
}
// Date -> "YYYY-MM-DD" for <input type="date">
function toInputDate(d) {
  if (!d) return "";
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// ---------- Sidebar (same on every dashboard page) ----------
const NAV_ICONS = {
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
  userCheck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  award: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
};

const NAV = {
  admin: {
    label: "Admin",
    items: [
      { key: "volunteers", text: "Volunteer Verification", icon: "userCheck", href: "/admin/dashboard.html" },
      { key: "campaigns", text: "Campaign Approval", icon: "megaphone", href: "/admin/campaigns.html" },
      { key: "managers", text: "Managers", icon: "users", href: "/admin/managers.html" },
      { key: "budgets", text: "Budget Monitor", icon: "wallet", href: "/admin/budgets.html" },
      { key: "reports", text: "Reports", icon: "chart", href: "/admin/reports.html" },
      { key: "audit", text: "Audit Log", icon: "file", href: "/admin/audit.html" },
      { key: "profile", text: "My Profile", icon: "user", href: "/profile.html" },
    ],
  },
  manager: {
    label: "Campaign Manager",
    items: [
      { key: "dashboard", text: "Dashboard", icon: "grid", href: "/manager/dashboard.html" },
      { key: "campaigns", text: "My Campaigns", icon: "megaphone", href: "/manager/campaigns.html" },
      { key: "applications", text: "Applications", icon: "users", href: "/manager/applications.html" },
      { key: "tasks", text: "Tasks", icon: "tasks", href: "/manager/tasks.html" },
      { key: "expenses", text: "Expenses", icon: "wallet", href: "/manager/expenses.html" },
      { key: "profile", text: "My Profile", icon: "user", href: "/profile.html" },
    ],
  },
  volunteer: {
    label: "Volunteer",
    items: [
      { key: "dashboard", text: "Dashboard", icon: "grid", href: "/volunteer/dashboard.html" },
      { key: "campaigns", text: "Browse Campaigns", icon: "search", href: "/volunteer/campaigns.html" },
      { key: "applications", text: "My Applications", icon: "file", href: "/volunteer/applications.html" },
      { key: "tasks", text: "My Tasks", icon: "tasks", href: "/volunteer/tasks.html" },
      { key: "certificates", text: "Certificates", icon: "award", href: "/volunteer/certificates.html" },
      { key: "profile", text: "My Profile", icon: "user", href: "/profile.html" },
    ],
  },
};

// Fills <aside class="sidebar" id="sidebar"> — items without href show "Soon"
function renderSidebar(role, activeKey) {
  const el = document.getElementById("sidebar");
  if (!el) return;
  const nav = NAV[role];
  el.innerHTML = `
    <div class="logo"><span class="logo-mark">${NAV_ICONS.megaphone}</span>CampaignHub</div>
    <p class="nav-label">${nav.label}</p>
    <ul class="nav">
      ${nav.items
        .map((i) =>
          i.href
            ? `<li><a href="${i.href}" class="${i.key === activeKey ? "active" : ""}">${NAV_ICONS[i.icon]}<span class="nav-text">${i.text}</span><b class="nav-badge hidden" data-badge="${i.key}"></b></a></li>`
            : `<li><span class="soon">${NAV_ICONS[i.icon]}${i.text}<em>Soon</em></span></li>`
        )
        .join("")}
    </ul>
    <div class="sidebar-foot"><button onclick="logout()">${NAV_ICONS.logout}<span>Log out</span></button></div>`;
  startAlerts();
}

// =========================================================
// In-app notifications (Req 3.5): sidebar badges + "Action needed" panel
// =========================================================
let alertsData = { badges: {}, items: [] };
const alertListeners = [];
let alertsTimer = null;

async function loadAlerts() {
  if (!getToken()) return;
  try {
    alertsData = await api("/alerts");
    if (!alertsData) return;
    document.querySelectorAll("[data-badge]").forEach((el) => {
      const n = alertsData.badges[el.dataset.badge] || 0;
      const changed = el.textContent !== String(n);
      el.textContent = n > 99 ? "99+" : n;
      el.classList.toggle("hidden", !n);
      if (changed && n) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
    });
    const total = alertsData.items.filter((i) => ["danger", "warn", "new"].includes(i.level)).length;
    document.title = document.title.replace(/^\(\d+\) /, "");
    if (total) document.title = `(${total}) ${document.title}`;
    alertListeners.forEach((fn) => fn(alertsData));
  } catch (e) {
    /* alerts are optional — never break the page */
  }
}

// Checks again every 30 seconds while the tab is open, and when the user comes back to the tab
function startAlerts() {
  loadAlerts();
  if (alertsTimer) return;
  alertsTimer = setInterval(() => document.visibilityState === "visible" && loadAlerts(), 30000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && loadAlerts());
}

const ALERT_ICONS = {
  new: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/></svg>',
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>',
};

// Tells the server the user has seen the updates of a page, then refreshes the badges
async function markSeen(page) {
  try {
    await api("/alerts/seen", { method: "POST", body: { page } });
    loadAlerts();
  } catch (e) {
    /* optional */
  }
}

// Info-only levels (no action needed) can be marked as read
const INFO_LEVELS = ["success", "muted", "info"];

// Shows the alerts inside the element with this id (on dashboards)
function renderActionPanel(elId, { max = 6 } = {}) {
  const el = document.getElementById(elId);
  if (!el) return;
  let expanded = false;
  const draw = (data) => {
    const items = data.items || [];
    const shown = expanded ? items : items.slice(0, max);
    el.classList.remove("hidden");
    el.innerHTML = `
      <div class="card-head">
        <div><h2>${ALERT_ICONS.new} Action needed ${items.length ? `<span class="count-pill">${items.length}</span>` : ""}</h2>
        <p>Updates and things that need your attention. This list refreshes by itself.</p></div>
        ${items.some((i) => INFO_LEVELS.includes(i.level)) ? `<button class="btn btn-light btn-sm" data-read>${ICONS.check}Mark updates as read</button>` : ""}
      </div>
      ${
        items.length
          ? `<div class="alert-list">${shown
              .map(
                (i, n) => `
            <a class="alert-item ${i.level}" href="${esc(i.link)}" style="animation-delay:${n * 50}ms">
              <span class="a-ico">${ALERT_ICONS[i.level] || ALERT_ICONS.info}</span>
              <span class="a-body"><strong>${esc(i.title)}</strong>${i.text ? `<small>${esc(i.text)}</small>` : ""}</span>
              ${i.at ? `<span class="a-time">${timeAgo(i.at)}</span>` : ""}
              <span class="a-go">→</span>
            </a>`
              )
              .join("")}</div>
             ${items.length > max ? `<button class="link-like" style="margin-top:12px" data-more>${expanded ? "Show less" : `Show all ${items.length}`}</button>` : ""}`
          : `<div class="all-clear">${ALERT_ICONS.success}<span>You're all caught up — nothing needs your attention right now.</span></div>`
      }`;
    el.querySelector("[data-more]")?.addEventListener("click", () => { expanded = !expanded; draw(data); });
    el.querySelector("[data-read]")?.addEventListener("click", (e) => { e.currentTarget.disabled = true; markSeen("all"); });
  };
  alertListeners.push(draw);
  if (alertsData.items.length || alertsData.badges) draw(alertsData);
}

// ---------- Confirm dialog (returns a Promise<boolean>) ----------
function confirmDialog({ title, text, okText = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal">
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
        <div class="modal-actions">
          <button class="btn btn-light" data-act="no">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary-grad"}" data-act="yes">${esc(okText)}</button>
        </div>
      </div>`;
    const close = (val) => { wrap.remove(); document.removeEventListener("keydown", onKey); resolve(val); };
    const onKey = (e) => { if (e.key === "Escape") close(false); };
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) return close(false);
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act) close(act === "yes");
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-act="yes"]').focus();
  });
}

// ---------- Campaign helpers shared by manager / admin / volunteer pages ----------
const STATUS_LABEL = {
  draft: "Draft",
  submitted: "Waiting approval",
  approved: "Approved",
  rejected: "Rejected",
  active: "Active",
  completion_review: "Completion review",
  completed: "Completed",
  removed: "Removed by Admin",
};

const META_ICONS = {
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
};

// The info rows used on every campaign card
function campaignMeta(c) {
  return `
    <div class="camp-meta">
      <span>${META_ICONS.pin}${esc(c.location)}</span>
      <span>${META_ICONS.cal}${formatDate(c.startDate)} – ${formatDate(c.endDate)}</span>
      <span>${META_ICONS.money}${formatMoney(c.budget)}</span>
      <span>${META_ICONS.people}${c.volunteersNeeded || 0} volunteers needed</span>
    </div>`;
}

function skillChips(list) {
  return (list || []).length
    ? `<div class="chips">${list.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>`
    : "";
}

// Full details shown inside a modal
function campaignDetailsHTML(c) {
  return `
    <div class="detail-head">
      <span class="cat-tag">${esc(c.category)}</span>
      <span class="badge ${c.status}">${STATUS_LABEL[c.status] || c.status}</span>
    </div>
    <h3 class="detail-title">${esc(c.title)}</h3>
    ${c.manager && c.manager.name ? `<p class="detail-by">by ${esc(c.manager.name)}${c.manager.organization ? " · " + esc(c.manager.organization) : ""}</p>` : ""}
    <p class="detail-desc">${esc(c.description)}</p>
    <div class="detail-grid">
      <div><small>Location</small><strong>${esc(c.location)}</strong></div>
      <div><small>Dates</small><strong>${formatDate(c.startDate)} – ${formatDate(c.endDate)}</strong></div>
      <div><small>Budget</small><strong>${formatMoney(c.budget)}</strong></div>
      <div><small>Beneficiaries</small><strong>${c.beneficiaries || 0} people</strong></div>
      <div><small>Volunteers needed</small><strong>${c.volunteersNeeded || 0}</strong></div>
      <div><small>Submitted</small><strong>${formatDate(c.submittedAt)}</strong></div>
    </div>
    ${(c.requiredSkills || []).length ? `<small class="detail-label">Required skills</small>${skillChips(c.requiredSkills)}` : ""}
    ${c.rejectionReason ? `<div class="reason-box"><strong>Rejection reason:</strong> ${esc(c.rejectionReason)}</div>` : ""}
    ${c.status === "removed" ? `<div class="reason-box"><strong>Removed by Admin${c.removedAt ? " on " + formatDate(c.removedAt) : ""}:</strong> ${esc(c.removalReason)}</div>` : ""}`;
}

// Opens a modal with any HTML inside. Returns the modal element.
function openModal(innerHTML, { wide = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `<div class="modal ${wide ? "modal-lg" : ""}"><button class="modal-x" aria-label="Close">${ICONS.x}</button>${innerHTML}</div>`;
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest(".modal-x")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(wrap);
  wrap.close = close;
  return wrap;
}

// Counts how many items have each status: { all: 5, draft: 2, ... }
function countBy(list, key = "status") {
  const out = { all: list.length };
  list.forEach((x) => (out[x[key]] = (out[x[key]] || 0) + 1));
  return out;
}

// ---------- Applications ----------
const APP_LABEL = { applied: "Pending review", accepted: "Accepted", rejected: "Rejected" };

// "3 days ago", "just now"
function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  const days = Math.floor(h / 24); if (days < 30) return `${days} day${days > 1 ? "s" : ""} ago`;
  return formatDate(d);
}

// Skill chips where the ones in "wanted" are highlighted green
function skillChipsMatch(list, wanted = []) {
  const w = wanted.map((x) => x.toLowerCase());
  return (list || []).length
    ? `<div class="chips">${list.map((s) => `<span class="chip ${w.includes(s.toLowerCase()) ? "match" : ""}">${esc(s)}</span>`).join("")}</div>`
    : `<span class="muted" style="font-size:13px">No skills listed</span>`;
}

// ---------- Tasks ----------
const TASK_LABEL = {
  pending: "To do",
  in_progress: "In progress",
  submitted: "Needs review",
  revision_required: "Revision needed",
  completed: "Verified",
};
const PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High" };

function priorityChip(p) {
  return `<span class="prio ${p}">${PRIORITY_LABEL[p] || p}</span>`;
}

// "Due in 3 days" / "Due today" / "2 days overdue"
function deadlineLabel(d, status) {
  const end = new Date(d); end.setHours(23, 59, 59, 999);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(end).setHours(0, 0, 0, 0) - today) / 86400000);
  if (status === "completed") return `<span class="due">${META_ICONS.cal}Due ${formatDate(d)}</span>`;
  if (days < 0) return `<span class="due late">${META_ICONS.cal}${-days} day${days < -1 ? "s" : ""} overdue</span>`;
  if (days === 0) return `<span class="due soon">${META_ICONS.cal}Due today</span>`;
  if (days <= 2) return `<span class="due soon">${META_ICONS.cal}Due in ${days} day${days > 1 ? "s" : ""}</span>`;
  return `<span class="due">${META_ICONS.cal}Due ${formatDate(d)}</span>`;
}

function stars(n = 0, size = "") {
  return `<span class="stars ${size}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "on" : ""}">★</i>`).join("")}</span>`;
}

// Shows the files and links of one proof submission
function proofHTML(sub) {
  if (!sub) return "";
  const imgs = (sub.files || []).filter((f) => f.type.startsWith("image/"));
  const docs = (sub.files || []).filter((f) => !f.type.startsWith("image/"));
  return `
    <div class="proof">
      <p class="proof-summary">${esc(sub.summary)}</p>
      ${imgs.length ? `<div class="proof-imgs">${imgs.map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy" /></a>`).join("")}</div>` : ""}
      ${docs.length || (sub.links || []).length ? `<div class="proof-files">
        ${docs.map((f) => `<a class="file-chip" href="${esc(f.url)}" target="_blank" rel="noopener">${NAV_ICONS.file}${esc(f.name)}</a>`).join("")}
        ${(sub.links || []).map((l) => `<a class="file-chip" href="${esc(l)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(l.replace(/^https?:\/\//, "").slice(0, 40))}</a>`).join("")}
      </div>` : ""}
      <p class="app-for">Submitted ${timeAgo(sub.submittedAt)} ${sub.isLate ? '<span class="late-tag">Late</span>' : ""}</p>
    </div>`;
}

// Reads a File into a "data:...;base64,..." string
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    r.readAsDataURL(file);
  });
}

// ---------- Any logged-in user (used by the profile page) ----------
function requireLogin() {
  const user = getUser();
  if (!getToken() || !user) {
    window.location.href = "/index.html";
    return null;
  }
  return user;
}

// ---------- Skill picker (chips + "add your own") ----------
const SKILLS = [
  "Logistics", "Event Management", "Social Media", "Content Writing", "Graphic Design", "Photography",
  "Video Editing", "Fundraising", "Public Speaking", "First Aid", "Teaching", "Data Entry",
  "Driving", "Cooking", "Translation",
];

// Renders a picker inside `el`. onChange(list) is called on every change. Returns { get, set }.
function skillPicker(el, initial = [], onChange = () => {}) {
  let selected = [...initial];
  const has = (s) => selected.some((x) => x.toLowerCase() === s.toLowerCase());

  function draw() {
    const custom = selected.filter((s) => !SKILLS.some((k) => k.toLowerCase() === s.toLowerCase()));
    el.innerHTML = `
      <div class="skill-picker">
        ${[...SKILLS, ...custom].map((s) => `<button type="button" class="skill-opt ${has(s) ? "on" : ""}" data-s="${esc(s)}">${has(s) ? "✓ " : "+ "}${esc(s)}</button>`).join("")}
      </div>
      <div class="skill-add">
        <input type="text" maxlength="40" placeholder="Another skill? Type it and press Enter" />
        <button type="button" class="btn btn-light btn-sm">Add</button>
      </div>
      <p class="hint">${selected.length ? `${selected.length} selected` : "Choose at least one skill — it helps managers find you"}</p>`;
  }
  function toggle(s) {
    selected = has(s) ? selected.filter((x) => x.toLowerCase() !== s.toLowerCase()) : [...selected, s];
    draw();
    onChange(selected);
  }
  function addTyped() {
    const input = el.querySelector(".skill-add input");
    const v = input.value.trim().replace(/\s+/g, " ");
    if (!v) return;
    if (selected.length >= 15) return toast("You can add at most 15 skills", "error");
    if (!has(v)) toggle(v);
    else draw();
    el.querySelector(".skill-add input").focus();
  }
  el.addEventListener("click", (e) => {
    const opt = e.target.closest(".skill-opt");
    if (opt) return toggle(opt.dataset.s);
    if (e.target.closest(".skill-add button")) addTyped();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches(".skill-add input")) {
      e.preventDefault();
      addTyped();
    }
  });
  draw();
  return {
    get: () => [...selected],
    set: (list) => { selected = [...list]; draw(); onChange(selected); },
  };
}

// ---------- Show / hide password (eye icon) on every password field ----------
const EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/></svg>';

function addPasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]:not([data-eye])').forEach((input) => {
    input.dataset.eye = "1";
    let wrap = input.parentElement;
    if (!wrap.classList.contains("input-wrap")) {
      wrap = document.createElement("div");
      wrap.className = "input-wrap no-icon";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    }
    wrap.classList.add("has-eye");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-toggle";
    btn.setAttribute("aria-label", "Show password");
    btn.innerHTML = EYE_OPEN;
    btn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? EYE_CLOSED : EYE_OPEN;
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      btn.classList.toggle("on", show);
      input.focus();
    });
    wrap.appendChild(btn);
  });
}
document.addEventListener("DOMContentLoaded", () => addPasswordToggles());

// ---------- Budget (Req 11) ----------
const BUDGET_LABEL = { ok: "On track", warning: "Close to limit", exceeded: "Budget exceeded" };
const CATEGORY_COLORS = {
  Purchase: "#8b5cf6", Transport: "#22d3ee", Food: "#f59e0b", "Printing & Publicity": "#ec4899",
  Venue: "#10b981", "Volunteer Support": "#6366f1", Other: "#94a3b8",
};

// Big progress meter: spent vs budget
function budgetMeter(b, { compact = false } = {}) {
  const pct = Math.min(b.rate, 100);
  const over = b.rate > 100 ? Math.min(b.rate - 100, 100) : 0;
  return `
    <div class="budget-meter ${b.status} ${compact ? "compact" : ""}">
      <div class="bm-top">
        <div><span class="bm-spent">${formatMoney(b.spent)}</span> <span class="muted">of ${formatMoney(b.budget)}</span></div>
        <span class="bm-rate">${b.rate}%</span>
      </div>
      <div class="bm-bar"><i style="width:${pct}%"></i>${over ? `<b style="width:${over}%"></b>` : ""}<span class="bm-80" title="80% warning line"></span></div>
      <div class="bm-foot">
        <span class="budget-tag ${b.status}">${b.status === "exceeded" ? "⚠ " : ""}${BUDGET_LABEL[b.status]}</span>
        <span class="muted">${b.remaining >= 0 ? `${formatMoney(b.remaining)} left` : `${formatMoney(-b.remaining)} over budget`}</span>
      </div>
    </div>`;
}

// Horizontal bars, one per category
function categoryBars(byCategory = {}) {
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<p class="muted" style="font-size:13px">No expenses yet.</p>`;
  const max = entries[0][1];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return `<div class="cat-bars">${entries
    .map(
      ([cat, v], i) => `
      <div class="cat-row" style="animation-delay:${i * 60}ms">
        <span class="cat-name"><i style="background:${CATEGORY_COLORS[cat] || "#94a3b8"}"></i>${esc(cat)}</span>
        <span class="cat-track"><b style="width:${(v / max) * 100}%;background:${CATEGORY_COLORS[cat] || "#94a3b8"}"></b></span>
        <span class="cat-val">${formatMoney(v)} <small>${Math.round((v / total) * 100)}%</small></span>
      </div>`
    )
    .join("")}</div>`;
}

// ---------- Completion report (Req 7, 2.7, 4.5) ----------
const REPORT_LABEL = { submitted: "Waiting for Admin", approved: "Verified by Admin", returned: "Sent back" };

// Number tiles made by the system (tasks, volunteers, rating, budget)
function completionStatsHTML(st) {
  if (!st) return "";
  const pct = st.tasksTotal ? Math.round((st.tasksVerified / st.tasksTotal) * 100) : 0;
  return `
    <div class="rep-stats">
      <div><small>Tasks verified</small><strong>${st.tasksVerified} / ${st.tasksTotal}</strong><span>${st.tasksTotal ? pct + "% done" : "No tasks"}${st.lateSubmissions ? ` · ${st.lateSubmissions} late` : ""}</span></div>
      <div><small>Volunteers</small><strong>${st.volunteersContributed} / ${st.volunteersJoined}</strong><span>contributed / joined</span></div>
      <div><small>Average rating</small><strong>${st.avgRating ? st.avgRating + " ★" : "—"}</strong><span>from verified tasks</span></div>
      <div><small>Expenses</small><strong>${st.expenseCount}</strong><span>entries logged</span></div>
    </div>
    ${budgetMeter({ budget: st.budget, spent: st.spent, rate: st.utilization, status: st.budgetStatus, remaining: st.budget - st.spent }, { compact: true })}`;
}

// Full read-only view of a campaign's completion report
function completionReportHTML(c) {
  const r = c.completionReport;
  if (!r) return "";
  const imgs = (r.photos || []).filter((f) => (f.type || "").startsWith("image/"));
  const docs = (r.photos || []).filter((f) => !(f.type || "").startsWith("image/"));
  const expected = c.beneficiaries || 0;
  const reached = r.beneficiariesReached || 0;
  const benefNote = expected ? `${Math.round((reached / expected) * 100)}% of the ${expected} expected` : "No target was set";
  return `
    <div class="report">
      <div class="report-head">
        <span class="badge report-${r.status}">${REPORT_LABEL[r.status] || r.status}</span>
        <span class="muted">Sent ${formatDate(r.submittedAt)}${r.round > 1 ? ` · attempt ${r.round}` : ""}</span>
      </div>
      ${r.reviewComment ? `<div class="camp-note ${r.status === "returned" ? "warn" : "ok"}"><strong>Admin:</strong> ${esc(r.reviewComment)}</div>` : ""}
      <div class="rep-benef">
        <div><small>People helped</small><strong>${reached.toLocaleString("en-IN")}</strong></div>
        <span>${benefNote}</span>
      </div>
      <small class="detail-label">What the campaign achieved</small>
      <p class="report-text">${esc(r.summary)}</p>
      ${r.challenges ? `<small class="detail-label">Challenges &amp; lessons</small><p class="report-text">${esc(r.challenges)}</p>` : ""}
      <small class="detail-label">Calculated by the system</small>
      ${completionStatsHTML(r.stats)}
      ${imgs.length || docs.length ? `<small class="detail-label" style="margin-top:14px">Photos &amp; documents</small>` : ""}
      ${imgs.length ? `<div class="proof-imgs">${imgs.map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy" /></a>`).join("")}</div>` : ""}
      ${docs.length ? `<div class="proof-files">${docs.map((f) => `<a class="file-chip" href="${esc(f.url)}" target="_blank" rel="noopener">${NAV_ICONS.file}${esc(f.name)}</a>`).join("")}</div>` : ""}
    </div>`;
}

// ---------- AI helpers (Req 18–22) ----------
const AI_ICON = '<svg class="ai-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/></svg>';

function aiLoading(text) {
  return `<div class="ai-loading"><div class="ai-orb"><span></span><span></span><span></span></div><p>${esc(text)}</p><small>This can take up to 20 seconds</small></div>`;
}

// Req 21: clear message + the user can always continue manually
function aiErrorBox(message, manualHint) {
  return `<div class="ai-error">${ICONS.alert}<div><strong>AI is not available right now</strong><p>${esc(message)}</p><small>${esc(manualHint)}</small></div>
          <button class="btn btn-light btn-sm" data-retry>${META_ICONS.restore}Try again</button></div>`;
}

// Req 22: tell the server what the user did with the suggestion
function aiOutcome(logId, outcome) {
  if (!logId) return;
  api(`/ai/logs/${logId}`, { method: "PATCH", body: { outcome } }).catch(() => {});
}
