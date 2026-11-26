const grid = document.getElementById("grid");
const tabsEl = document.getElementById("tabs");
const TABS = ["all", "pending", "in_progress", "revision_required", "submitted", "completed"];
let tasks = [];
let currentTab = "all";
let me = null;
let lastSeen = 0; // tasks created after this time get a "NEW" tag

const MAX_FILES = 5;
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "application/pdf"];

async function init() {
  if (!requireRole("volunteer")) return;
  renderSidebar("volunteer", "tasks");
  const { user } = await api("/auth/me");
  me = user;
  localStorage.setItem("user", JSON.stringify(user));
  fillUserChip(user);

  if (user.status !== "approved") {
    const box = document.getElementById("blocked");
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="status-icon amber">${ICONS.clock}</div>
      <h2>Not available yet</h2>
      <p>You will get tasks after the Admin verifies your account and a manager accepts you into a campaign.</p>
      <a class="btn btn-primary-grad" style="margin-top:22px" href="/volunteer/dashboard.html">Check my status</a>`;
    return;
  }
  document.getElementById("area").classList.remove("hidden");
  const key = `seenTasks_${user.id}`;
  lastSeen = Number(localStorage.getItem(key) || 0);
  try { localStorage.setItem(key, String(Date.now())); } catch (e) {}
  load();
  markSeen("tasks");
}

async function load() {
  try {
    const data = await api("/tasks/mine");
    tasks = data.tasks.filter((t) => t.campaign);
    // Show what needs action first
    if (currentTab === "all" && tasks.some((t) => t.status === "revision_required")) currentTab = "revision_required";
    updateStats();
    renderTabs();
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

function updateStats() {
  const n = countBy(tasks);
  document.getElementById("sOpen").textContent = (n.pending || 0) + (n.in_progress || 0) + (n.revision_required || 0);
  document.getElementById("sWaiting").textContent = n.submitted || 0;
  document.getElementById("sDone").textContent = n.completed || 0;
  const rated = tasks.filter((t) => t.rating);
  document.getElementById("sRating").textContent = rated.length ? (rated.reduce((s, t) => s + t.rating, 0) / rated.length).toFixed(1) + "★" : "—";
}

function renderTabs() {
  const n = countBy(tasks);
  tabsEl.innerHTML = TABS.map(
    (t) => `<button class="tab ${t === currentTab ? "active" : ""}" data-tab="${t}">${t === "all" ? "All" : TASK_LABEL[t]} <span class="count">${n[t] || 0}</span></button>`
  ).join("");
}
tabsEl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  currentTab = b.dataset.tab;
  renderTabs();
  render();
});

const isNew = (t) => t.status === "pending" && new Date(t.createdAt).getTime() > lastSeen;

function render() {
  const list = tasks.filter((t) => currentTab === "all" || t.status === currentTab);
  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-box">${ICONS.inbox}
        <h3>${currentTab === "all" ? "No tasks yet" : "Nothing here"}</h3>
        <p>${currentTab === "all" ? "When a manager accepts you into a campaign and assigns you a task, it will show up here." : "Tasks with this status will appear here."}</p>
        ${currentTab === "all" ? `<a class="btn btn-primary-grad" href="/volunteer/campaigns.html">${NAV_ICONS.search}Browse campaigns</a>` : ""}
      </div>`;
    return;
  }

  grid.innerHTML = list
    .map((t, i) => {
      const c = t.campaign;
      const live = c.status === "active";
      const last = t.submissions[t.submissions.length - 1];
      let note = "";
      let actions = `<button class="btn btn-light btn-sm" data-act="view" data-id="${t._id}">${META_ICONS.eye}Details</button>`;

      if (!live && t.status !== "completed") note = `<div class="camp-note warn">This campaign is ${c.status === "removed" ? "removed by the Admin" : "no longer active"}. You cannot submit proof.</div>`;
      else if (t.status === "pending") actions += `<button class="btn btn-primary-grad btn-sm" data-act="start" data-id="${t._id}">${META_ICONS.rocket}Start task</button>`;
      else if (t.status === "in_progress") actions += `<button class="btn btn-primary-grad btn-sm" data-act="submit" data-id="${t._id}">${META_ICONS.send}Submit proof</button>`;
      else if (t.status === "revision_required") {
        note = `<div class="camp-note warn"><strong>Manager asked for changes:</strong> ${esc(last ? last.feedback : "")}</div>`;
        actions += `<button class="btn btn-primary-grad btn-sm" data-act="submit" data-id="${t._id}">${META_ICONS.send}Resubmit proof</button>`;
      } else if (t.status === "submitted") note = `<div class="camp-note info">Proof sent ${timeAgo(last.submittedAt)}${last.isLate ? " (late)" : ""}. Waiting for the manager to verify.</div>`;
      else if (t.status === "completed")
        note = `<div class="camp-note ok">Verified by the manager ${timeAgo(t.completedAt)} ${t.rating ? stars(t.rating) : ""}${last && last.feedback ? `<br>“${esc(last.feedback)}”` : ""}</div>`;

      return `
        <article class="camp-card spot ${isNew(t) ? "is-new" : ""}" style="--i:${i}">
          <div class="camp-top"><span style="display:flex;gap:8px;align-items:center">${priorityChip(t.priority)}${isNew(t) ? '<span class="new-tag">NEW</span>' : ""}</span><span class="badge t-${t.status}">${TASK_LABEL[t.status]}</span></div>
          <h3>${esc(t.title)}</h3>
          <p class="app-for">For <b>${esc(c.title)}</b>${c.manager ? ` · ${esc(c.manager.organization || c.manager.name)}` : ""}</p>
          ${t.description ? `<p class="camp-desc">${esc(t.description)}</p>` : ""}
          <div class="task-meta">${deadlineLabel(t.deadline, t.status)}${t.requiredSkill ? `<span class="chip">${esc(t.requiredSkill)}</span>` : ""}</div>
          ${note}
          <div class="camp-actions">${actions}</div>
        </article>`;
    })
    .join("");
}

grid.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const t = tasks.find((x) => x._id === b.dataset.id);
  if (!t) return;

  if (b.dataset.act === "start") {
    b.disabled = true;
    try {
      const data = await api(`/tasks/${t._id}/start`, { method: "PATCH" });
      toast(data.message);
      currentTab = "in_progress";
      load();
      loadAlerts();
    } catch (err) {
      toast(err.message, "error");
      b.disabled = false;
    }
  }
  if (b.dataset.act === "submit") openSubmit(t);
  if (b.dataset.act === "view") openView(t);
});

function openView(t) {
  const subs = (t.submissions || []).slice().reverse();
  openModal(
    `<div class="detail-head">${priorityChip(t.priority)}<span class="badge t-${t.status}">${TASK_LABEL[t.status]}</span></div>
     <h3 class="detail-title">${esc(t.title)}</h3>
     <p class="detail-by">${esc(t.campaign.title)} · ${deadlineLabel(t.deadline, t.status)}</p>
     ${t.description ? `<p class="detail-desc">${esc(t.description)}</p>` : ""}
     ${subs.length ? `<p class="section-title">Your submissions</p>` : `<p class="muted">You have not submitted proof yet.</p>`}
     ${subs
       .map(
         (s) => `${proofHTML(s)}${s.feedback ? `<div class="camp-note ${s.decision === "completed" ? "ok" : "warn"}" style="margin:8px 0 16px">Manager: ${esc(s.feedback)}</div>` : '<div style="height:14px"></div>'}`
       )
       .join("")}`,
    { wide: true }
  );
}

// =========================================================
// Submit proof (Req 3.4 / 10)
// =========================================================
function openSubmit(t) {
  const last = t.submissions[t.submissions.length - 1];
  let files = []; // File objects

  const modal = openModal(
    `<h3>Submit proof</h3>
     <p>${esc(t.title)} · ${deadlineLabel(t.deadline, t.status)}</p>
     ${t.status === "revision_required" && last ? `<div class="camp-note warn" style="margin-bottom:12px"><strong>What to fix:</strong> ${esc(last.feedback)}</div>` : ""}
     <div class="field">
       <label for="p_summary">What did you do? *</label>
       <textarea id="p_summary" maxlength="2000" placeholder="e.g. Packed 200 kits with 2 other volunteers at the IUBAT hall. Photos of the packed boxes attached."></textarea>
     </div>
     <div class="field">
       <label>Photos or PDF <span class="muted">(JPG, PNG, PDF · max 5 files · 5 MB each)</span></label>
       <div class="dropzone" id="drop">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/></svg>
         <div>Click to choose files or drag them here</div>
         <small>Clear photos of the finished work help the manager verify faster</small>
       </div>
       <input type="file" id="p_files" accept=".jpg,.jpeg,.png,.pdf" multiple hidden />
       <div class="previews" id="previews"></div>
     </div>
     <div class="field">
       <label for="p_links">Links <span class="muted">(optional, one per line — e.g. a Facebook post)</span></label>
       <textarea id="p_links" style="min-height:70px" placeholder="https://facebook.com/..."></textarea>
     </div>
     <div id="pMsg" class="msg"></div>
     <div class="modal-actions">
       <button class="btn btn-light" data-close>Cancel</button>
       <button class="btn btn-primary-grad" id="pSend">${META_ICONS.send}Submit for review</button>
     </div>`,
    { wide: true }
  );
  modal.querySelector("[data-close]").addEventListener("click", () => modal.close());

  const drop = modal.querySelector("#drop");
  const input = modal.querySelector("#p_files");
  const previews = modal.querySelector("#previews");
  const msg = modal.querySelector("#pMsg");

  function addFiles(list) {
    for (const f of list) {
      if (files.length >= MAX_FILES) { toast(`At most ${MAX_FILES} files`, "error"); break; }
      if (!ALLOWED.includes(f.type)) { toast(`"${f.name}": only JPG, PNG or PDF`, "error"); continue; }
      if (f.size > MAX_SIZE) { toast(`"${f.name}" is larger than 5 MB`, "error"); continue; }
      files.push(f);
    }
    drawPreviews();
  }
  function drawPreviews() {
    previews.innerHTML = files
      .map(
        (f, i) => `<div class="pv">${f.type.startsWith("image/") ? `<img src="${URL.createObjectURL(f)}" alt="" />` : `${NAV_ICONS.file}<br>${esc(f.name)}`}
                   <button data-rm="${i}" title="Remove">${ICONS.x}</button></div>`
      )
      .join("");
  }
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); addFiles(e.dataTransfer.files); });
  previews.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (!b) return;
    files.splice(Number(b.dataset.rm), 1);
    drawPreviews();
  });

  modal.querySelector("#pSend").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const summary = modal.querySelector("#p_summary").value.trim();
    const links = modal.querySelector("#p_links").value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (summary.length < 10) return showMessage(msg, "Please describe what you did (at least 10 characters)");
    if (!files.length && !links.length) return showMessage(msg, "Add at least one photo, file or link as proof");

    btn.disabled = true;
    btn.innerHTML = "Uploading...";
    showMessage(msg, "");
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, data: await readAsDataURL(f) })));
      const data = await api(`/tasks/${t._id}/submit`, { method: "POST", body: { summary, links, files: payload } });
      toast(data.message);
      modal.close();
      currentTab = "submitted";
      load();
      loadAlerts();
    } catch (err) {
      showMessage(msg, err.message);
      btn.disabled = false;
      btn.innerHTML = `${META_ICONS.send}Submit for review`;
    }
  });
}

init();
