const me = requireRole("manager");
if (me) {
  fillUserChip(me);
  renderSidebar("manager", "tasks");
}

const grid = document.getElementById("grid");
const tabsEl = document.getElementById("tabs");
const summaryEl = document.getElementById("summary");
const newBtn = document.getElementById("newBtn");
newBtn.innerHTML = `${META_ICONS.plus}New task`;

const TABS = ["all", "submitted", "pending", "in_progress", "revision_required", "completed"];
let campaigns = [];
let tasks = [];
let currentCampaign = "";
let currentTab = "all";

const isOverdue = (t) => t.status !== "completed" && new Date(t.deadline).setHours(23, 59, 59, 999) < Date.now();

async function load() {
  try {
    const data = await api("/tasks/manager");
    campaigns = data.campaigns;
    tasks = data.tasks.filter((t) => t.assignedTo && t.campaign);
    if (!currentCampaign || !campaigns.find((c) => c._id === currentCampaign)) {
      currentCampaign = (campaigns.find((c) => c.status === "active") || campaigns[0] || {})._id || "";
    }
    // Open the review tab first if something is waiting
    if (currentTab === "all" && visible().some((t) => t.status === "submitted")) currentTab = "submitted";
    renderAll();
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderAll() {
  updateStats();
  renderSummary();
  renderTabs();
  render();
  const c = campaigns.find((x) => x._id === currentCampaign);
  newBtn.disabled = !c || c.status !== "active" || !c.acceptedVolunteers;
  newBtn.title = !c ? "No active campaign" : c.status !== "active" ? (c.status === "completion_review" ? "The completion report is under review" : "This campaign is completed") : !c.acceptedVolunteers ? "Accept volunteers first (Applications page)" : "";
  const ab = document.getElementById("aiBtn");
  if (ab) { ab.disabled = newBtn.disabled; ab.title = newBtn.title || "Let AI suggest tasks for this campaign"; }
}

function updateStats() {
  const done = tasks.filter((t) => t.status === "completed").length;
  document.getElementById("sTotal").textContent = tasks.length;
  document.getElementById("sReview").textContent = tasks.filter((t) => t.status === "submitted").length;
  document.getElementById("sDone").textContent = tasks.length ? Math.round((done / tasks.length) * 100) + "%" : "0%";
  document.getElementById("sLate").textContent = tasks.filter(isOverdue).length;
}

function visible() {
  return currentCampaign ? tasks.filter((t) => t.campaign._id === currentCampaign) : tasks;
}

function renderSummary() {
  if (!campaigns.length) {
    summaryEl.innerHTML = `
      <div class="empty-box">${ICONS.inbox}
        <h3>No active campaigns</h3>
        <p>Make a campaign active and accept volunteers before creating tasks.</p>
        <a class="btn btn-primary-grad" href="/manager/campaigns.html">Go to My Campaigns</a>
      </div>`;
    return;
  }
  summaryEl.innerHTML = campaigns
    .map((c, i) => {
      const own = tasks.filter((t) => t.campaign._id === c._id);
      const done = own.filter((t) => t.status === "completed").length;
      const pct = own.length ? Math.round((done / own.length) * 100) : 0;
      const waiting = own.filter((t) => t.status === "submitted").length;
      return `
        <div class="item ${currentCampaign === c._id ? "active" : ""}" data-camp="${c._id}" style="animation-delay:${i * 60}ms">
          <h4 title="${esc(c.title)}">${esc(c.title)} ${["completed", "completion_review"].includes(c.status) ? `<span class="badge ${c.status}" style="margin-left:6px">${STATUS_LABEL[c.status]}</span>` : ""}</h4>
          <div class="capacity ${own.length && done === own.length ? "full" : ""}">
            <div class="bar"><i style="width:${pct}%"></i></div>
            <span><b>${done}</b> / ${own.length} verified</span>
          </div>
          <span class="muted" style="font-size:12px">${c.acceptedVolunteers} volunteer${c.acceptedVolunteers === 1 ? "" : "s"} · ${waiting} waiting for review</span>
        </div>`;
    })
    .join("");
}

summaryEl.addEventListener("click", (e) => {
  const item = e.target.closest("[data-camp]");
  if (!item) return;
  currentCampaign = item.dataset.camp;
  currentTab = "all";
  renderAll();
});

function renderTabs() {
  const n = countBy(visible());
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

function render() {
  if (!campaigns.length) {
    grid.innerHTML = "";
    return;
  }
  const list = visible().filter((t) => currentTab === "all" || t.status === currentTab);
  if (!list.length) {
    const c = campaigns.find((x) => x._id === currentCampaign);
    grid.innerHTML = `
      <div class="empty-box">${ICONS.inbox}
        <h3>${currentTab === "all" ? "No tasks yet" : "Nothing here"}</h3>
        <p>${currentTab !== "all" ? "Tasks with this status will appear here." : c && !c.acceptedVolunteers ? "Accept some volunteers on the Applications page first." : "Create the first task — the system will suggest the best volunteer."}</p>
        ${currentTab === "all" && c && c.acceptedVolunteers && c.status === "active" ? `<button class="btn btn-primary-grad" onclick="openCreate()">${META_ICONS.plus}Create task</button>` : ""}
      </div>`;
    return;
  }

  grid.innerHTML = list
    .map((t, i) => {
      const v = t.assignedTo;
      const last = t.submissions[t.submissions.length - 1];
      let actions = `<button class="btn btn-light btn-sm" data-act="view" data-id="${t._id}">${META_ICONS.eye}Details</button>`;
      if (t.status === "submitted") actions = `<button class="btn btn-primary-grad btn-sm" data-act="review" data-id="${t._id}">${META_ICONS.eye}Review proof</button>`;
      if (t.status === "pending")
        actions += `<button class="btn btn-light btn-sm" data-act="edit" data-id="${t._id}">${META_ICONS.edit}Edit</button>
                    <button class="btn btn-outline-danger btn-sm" data-act="delete" data-id="${t._id}">${META_ICONS.trash}Delete</button>`;
      return `
        <article class="camp-card spot" style="--i:${i}">
          <div class="camp-top">
            ${priorityChip(t.priority)}
            <span class="badge t-${t.status}">${TASK_LABEL[t.status]}</span>
          </div>
          <h3>${esc(t.title)}</h3>
          ${t.description ? `<p class="camp-desc">${esc(t.description)}</p>` : ""}
          <div class="assignee"><div class="avatar sm">${esc(initials(v.name))}</div>
            <div>${esc(v.name)}<small>${esc(v.availability || "")}${v.avgRating ? ` · ${v.avgRating.toFixed(1)}★` : ""}</small></div></div>
          <div class="task-meta">
            ${deadlineLabel(t.deadline, t.status)}
            ${t.requiredSkill ? `<span class="chip">${esc(t.requiredSkill)}</span>` : ""}
            ${!currentCampaign ? `<span class="app-for">${esc(t.campaign.title)}</span>` : ""}
          </div>
          ${t.status === "submitted" && last ? `<div class="camp-note info">Proof submitted ${timeAgo(last.submittedAt)}${last.isLate ? " (late)" : ""} — ${(last.files || []).length} file(s), ${(last.links || []).length} link(s)</div>` : ""}
          ${t.status === "revision_required" && last ? `<div class="camp-note warn"><strong>You asked for changes:</strong> ${esc(last.feedback)}</div>` : ""}
          ${t.status === "completed" ? `<div class="camp-note ok">Verified ${timeAgo(t.completedAt)} ${t.rating ? stars(t.rating) : ""}</div>` : ""}
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
  if (b.dataset.act === "review") openReview(t, true);
  if (b.dataset.act === "view") openReview(t, false);
  if (b.dataset.act === "edit") openCreate(t);
  if (b.dataset.act === "delete") {
    const ok = await confirmDialog({ title: "Delete task?", text: `"${t.title}" will be deleted.`, okText: "Delete", danger: true });
    if (!ok) return;
    try {
      const data = await api(`/tasks/${t._id}`, { method: "DELETE" });
      toast(data.message);
      loadAlerts();
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  }
});

newBtn.addEventListener("click", () => openCreate());

// =========================================================
// (18) AI Task Planner
// =========================================================
const aiBtn = document.getElementById("aiBtn");
aiBtn.innerHTML = `${AI_ICON}Plan with AI`;
aiBtn.addEventListener("click", openPlanner);

function openPlanner() {
  const c = campaigns.find((x) => x._id === currentCampaign);
  if (!c || c.status !== "active") return toast("Choose an active campaign first", "error");
  if (!c.acceptedVolunteers) return toast("Accept some volunteers first (Applications page)", "error");

  let plan = [];
  let logId = null;
  const used = new Set(); // indexes already turned into tasks
  let editedAny = false;

  const modal = openModal(
    `<h3>${AI_ICON} AI Task Planner · <span class="muted" style="font-weight:600">${esc(c.title)}</span></h3>
     <p>AI reads the campaign goal, dates and skills and suggests tasks. Nothing is created until you choose.</p>
     <div id="aiBody">${aiLoading("Reading the campaign and planning tasks...")}</div>`,
    { wide: true }
  );
  modal.querySelector(".modal").classList.add("modal-xl");

  // When the planner is closed without using anything, the suggestion counts as rejected
  const obs = new MutationObserver(() => {
    if (!document.body.contains(modal)) {
      obs.disconnect();
      if (logId) aiOutcome(logId, used.size ? (editedAny ? "edited" : "accepted") : "rejected");
      load();
    }
  });
  obs.observe(document.body, { childList: true });

  async function run() {
    modal.querySelector("#aiBody").innerHTML = aiLoading("Reading the campaign and planning tasks...");
    try {
      const data = await api("/ai/task-plan", { method: "POST", body: { campaign: c._id } });
      plan = data.tasks;
      logId = data.logId;
      draw(data.tookMs);
    } catch (err) {
      modal.querySelector("#aiBody").innerHTML = aiErrorBox(err.message, "You can still create tasks yourself with the New task button.");
      modal.querySelector("[data-retry]")?.addEventListener("click", run);
    }
  }

  function draw(ms) {
    modal.querySelector("#aiBody").innerHTML = `
      <div class="ai-toolbar">
        <label class="check-all"><input type="checkbox" id="chkAll" checked /> Select all</label>
        <span class="muted" style="font-size:13px">${plan.length} suggestions${ms ? ` · ${(ms / 1000).toFixed(1)}s` : ""}</span>
        <button class="link-like" data-retry>${META_ICONS.restore}Suggest again</button>
      </div>
      <div class="ai-list">${plan
        .map(
          (t, i) => `
        <div class="ai-item ${used.has(i) ? "done" : ""}" style="animation-delay:${i * 60}ms">
          <input type="checkbox" class="ai-chk" data-i="${i}" ${used.has(i) ? "disabled" : "checked"} />
          <div class="ai-main">
            <div class="ai-head"><strong>${esc(t.title)}</strong>${priorityChip(t.priority)}</div>
            <p>${esc(t.description)}</p>
            <div class="task-meta">${t.requiredSkill ? `<span class="chip">${esc(t.requiredSkill)}</span>` : ""}<span class="due">${META_ICONS.cal}Due ${formatDate(t.deadline)}</span></div>
          </div>
          ${used.has(i) ? `<span class="badge t-completed">Created</span>` : `<button class="btn btn-light btn-sm" data-use="${i}">${META_ICONS.edit}Review &amp; assign</button>`}
        </div>`
        )
        .join("")}</div>
      <div class="modal-actions">
        <span class="muted" style="font-size:12.5px;margin-right:auto">"Assign selected" gives each task to its BEST MATCH volunteer.</span>
        <button class="btn btn-light" data-close>Close</button>
        <button class="btn btn-primary-grad" id="bulkBtn">${META_ICONS.send}Assign selected</button>
      </div>`;
    const body = modal.querySelector("#aiBody");
    body.querySelector("[data-close]").addEventListener("click", () => modal.close());
    body.querySelector("[data-retry]").addEventListener("click", () => {
      if (logId) aiOutcome(logId, used.size ? "edited" : "rejected");
      logId = null;
      run();
    });
    body.querySelector("#chkAll").addEventListener("change", (e) => body.querySelectorAll(".ai-chk:not(:disabled)").forEach((x) => (x.checked = e.target.checked)));
    body.querySelectorAll("[data-use]").forEach((b) =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.use);
        const s = plan[i];
        openCreate(null, s, (saved) => {
          used.add(i);
          if (saved.title !== s.title || saved.requiredSkill !== s.requiredSkill || saved.priority !== s.priority || saved.deadline !== s.deadline || saved.description !== s.description) editedAny = true;
          draw();
        });
      })
    );
    body.querySelector("#bulkBtn").addEventListener("click", bulkAssign);
  }

  async function bulkAssign(e) {
    const btn = e.currentTarget;
    const picks = [...modal.querySelectorAll(".ai-chk:checked:not(:disabled)")].map((x) => Number(x.dataset.i));
    if (!picks.length) return toast("Select at least one task", "error");
    btn.disabled = true;
    let ok = 0;
    for (const i of picks) {
      const t = plan[i];
      btn.innerHTML = `Assigning ${ok + 1} of ${picks.length}...`;
      try {
        const q = new URLSearchParams({ campaign: c._id, skill: t.requiredSkill, deadline: t.deadline });
        const rec = await api(`/tasks/recommend?${q}`);
        if (!rec.candidates.length) throw new Error("No accepted volunteers");
        await api("/tasks", { method: "POST", body: { campaign: c._id, ...t, assignedTo: rec.candidates[0].volunteer._id } });
        used.add(i);
        ok++;
      } catch (err) {
        toast(`"${t.title}": ${err.message}`, "error");
      }
    }
    if (ok) toast(`${ok} task${ok > 1 ? "s" : ""} assigned to the best-matching volunteers`);
    loadAlerts();
    draw();
  }

  run();
}

// =========================================================
// Create / edit task + smart suggestions (Req 9)
// =========================================================
// prefill: values suggested by the AI Task Planner; onSaved(body) is called after saving
function openCreate(existing = null, prefill = null, onSaved = null) {
  const c = campaigns.find((x) => x._id === (existing ? existing.campaign._id : currentCampaign));
  if (!c) return toast("Choose a campaign first", "error");
  const today = toInputDate(new Date());
  const maxDate = toInputDate(c.endDate);
  const pre = existing || prefill;
  const defDeadline = pre && pre.deadline ? toInputDate(pre.deadline) : toInputDate(new Date(Math.max(Date.now(), new Date(c.startDate).getTime())));
  let selected = existing ? existing.assignedTo._id : "";
  let saved = false;

  const modal = openModal(
    `
    <h3>${existing ? "Edit task" : "New task"} · <span class="muted" style="font-weight:600">${esc(c.title)}</span>${prefill ? ' <span class="ai-tag">✨ AI suggestion</span>' : ""}</h3>
    <p>Fill in the task. The list on the right ranks your accepted volunteers for it.</p>
    <div class="task-create">
      <form id="taskForm">
        <div class="field">
          <label for="t_title">Task title *</label>
          <input id="t_title" required maxlength="120" placeholder="e.g. Pack 200 winter clothes kits" value="${esc(pre ? pre.title : "")}" />
        </div>
        <div class="field">
          <label for="t_desc">What needs to be done</label>
          <textarea id="t_desc" maxlength="2000" placeholder="Details, place, what proof you expect (e.g. photos of packed kits)">${esc(pre ? pre.description : "")}</textarea>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="t_skill">Required skill</label>
            <input id="t_skill" list="skillList" placeholder="e.g. Logistics" value="${esc(pre ? pre.requiredSkill : "")}" />
            <datalist id="skillList">${(c.requiredSkills || []).map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
          </div>
          <div class="field">
            <label for="t_prio">Priority</label>
            <select id="t_prio">${["low", "medium", "high"].map((p) => `<option value="${p}" ${(pre ? pre.priority : "medium") === p ? "selected" : ""}>${PRIORITY_LABEL[p]}</option>`).join("")}</select>
          </div>
          <div class="field full">
            <label for="t_deadline">Deadline * <span class="muted">(by ${formatDate(c.endDate)})</span></label>
            <input type="date" id="t_deadline" required min="${today}" max="${maxDate}" value="${defDeadline > maxDate ? maxDate : defDeadline}" />
          </div>
        </div>
        <div id="formMsg" class="msg"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-light" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary-grad" id="saveBtn">${existing ? "Save changes" : META_ICONS.send + "Assign task"}</button>
        </div>
      </form>
      <div class="suggest">
        <h4>${NAV_ICONS.chart} Smart suggestions</h4>
        <p class="hint">Click a volunteer to assign. Score = 50% skill + 20% availability + 15% verified completion + 15% rating.</p>
        <div class="cand-list" id="cands"><div class="skel" style="height:80px"></div><div class="skel" style="height:80px"></div></div>
        <p class="formula" id="tookMs"></p>
      </div>
    </div>`,
    { wide: true }
  );
  modal.querySelector(".modal").classList.add("modal-xl");
  modal.querySelector("[data-close]").addEventListener("click", () => modal.close());

  const candsEl = modal.querySelector("#cands");
  const skillEl = modal.querySelector("#t_skill");
  const deadlineEl = modal.querySelector("#t_deadline");
  let ranked = [];

  const pct = (x) => Math.round(x * 100);
  function drawCandidates() {
    if (!ranked.length) {
      candsEl.innerHTML = `<div class="empty-box" style="padding:30px 10px">${ICONS.inbox}<p>No accepted volunteers in this campaign.</p></div>`;
      return;
    }
    if (!selected || !ranked.find((r) => r.volunteer._id === selected)) selected = ranked[0].volunteer._id;
    candsEl.innerHTML = ranked
      .map(
        (r, i) => `
        <div class="cand ${r.volunteer._id === selected ? "selected" : ""}" data-v="${r.volunteer._id}" style="animation-delay:${i * 50}ms">
          ${i === 0 ? '<span class="best">BEST MATCH</span>' : ""}
          <div class="rank">${i + 1}</div>
          <div>
            <strong>${esc(r.volunteer.name)}</strong>
            <div class="why">${esc(r.reasons.join(" · "))}</div>
          </div>
          <div class="score"><b>${r.score}</b><small>score</small></div>
          <div class="parts">
            ${[["skill", "Skill"], ["availability", "Availability"], ["completion", "Completion"], ["rating", "Rating"]]
              .map(([k, label]) => `<div class="part ${k}"><small><span>${label}</span><span>${pct(r.parts[k])}%</span></small><div class="bar"><i style="width:${pct(r.parts[k])}%"></i></div></div>`)
              .join("")}
          </div>
        </div>`
      )
      .join("");
  }

  let timer;
  async function refresh() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ campaign: c._id, skill: skillEl.value.trim(), deadline: deadlineEl.value || "" });
        const data = await api(`/tasks/recommend?${q}`);
        ranked = data.candidates;
        drawCandidates();
        modal.querySelector("#tookMs").textContent = `Ranked ${ranked.length} volunteer${ranked.length === 1 ? "" : "s"} in ${data.tookMs} ms`;
      } catch (err) {
        candsEl.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
      }
    }, 250);
  }
  skillEl.addEventListener("input", refresh);
  deadlineEl.addEventListener("change", refresh);
  candsEl.addEventListener("click", (e) => {
    const el = e.target.closest("[data-v]");
    if (!el) return;
    selected = el.dataset.v;
    drawCandidates();
  });
  refresh();
  modal.querySelector("#t_title").focus();

  modal.querySelector("#taskForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = modal.querySelector("#formMsg");
    const btn = modal.querySelector("#saveBtn");
    if (!selected) return showMessage(msg, "Choose a volunteer from the list");
    const body = {
      campaign: c._id,
      title: modal.querySelector("#t_title").value.trim(),
      description: modal.querySelector("#t_desc").value.trim(),
      requiredSkill: skillEl.value.trim(),
      priority: modal.querySelector("#t_prio").value,
      deadline: deadlineEl.value,
      assignedTo: selected,
    };
    btn.disabled = true;
    showMessage(msg, "");
    try {
      const data = existing ? await api(`/tasks/${existing._id}`, { method: "PUT", body }) : await api("/tasks", { method: "POST", body });
      toast(data.message);
      loadAlerts();
      saved = true;
      if (onSaved) onSaved(body);
      modal.close();
      currentTab = "all";
      load();
    } catch (err) {
      showMessage(msg, err.message);
      btn.disabled = false;
    }
  });
}

// =========================================================
// Review proof (Req 10, 13)
// =========================================================
function openReview(t, canReview) {
  const v = t.assignedTo;
  const subs = t.submissions || [];
  const last = subs[subs.length - 1];
  const older = subs.slice(0, -1).reverse();

  const modal = openModal(
    `
    <div class="detail-head">${priorityChip(t.priority)}<span class="badge t-${t.status}">${TASK_LABEL[t.status]}</span></div>
    <h3 class="detail-title">${esc(t.title)}</h3>
    <p class="detail-by">${esc(t.campaign.title)} · assigned to <b>${esc(v.name)}</b> · ${deadlineLabel(t.deadline, t.status)}</p>
    ${t.description ? `<p class="detail-desc">${esc(t.description)}</p>` : ""}

    <p class="section-title">${last ? (canReview ? "Proof to review" : "Latest proof") : "Proof"}</p>
    ${last ? proofHTML(last) : `<p class="muted">The volunteer has not submitted proof yet.</p>`}
    ${last && last.feedback && !canReview ? `<div class="camp-note ${last.decision === "completed" ? "ok" : "warn"}" style="margin-top:10px">Your feedback: ${esc(last.feedback)}</div>` : ""}
    ${t.status === "completed" && t.rating ? `<p class="section-title">Your rating</p>${stars(t.rating)} <span class="muted">${esc(t.ratingComment || "")}</span>` : ""}

    ${
      older.length
        ? `<p class="section-title">Earlier submissions</p><div class="history">${older
            .map((s) => `<div class="h-item"><b>${formatDate(s.submittedAt)}</b>${s.isLate ? ' <span class="late-tag">Late</span>' : ""} — ${esc(s.summary)}<br>Your feedback: ${esc(s.feedback || "—")}</div>`)
            .join("")}</div>`
        : ""
    }

    ${
      canReview
        ? `<div class="apply-box">
            <div class="form-grid">
              <div class="field full">
                <label>Rate the work <span class="muted">(used in future task suggestions)</span></label>
                <div id="rateStars">${stars(0, "lg")}</div>
              </div>
              <div class="field full">
                <label for="fb">Feedback / comment for ${esc(v.name)}</label>
                <textarea id="fb" maxlength="600" placeholder="Required if you ask for changes, e.g. 'Please add a photo of the packed boxes.'"></textarea>
              </div>
            </div>
            <div class="modal-actions">
              <button class="btn btn-outline-danger" id="revBtn">${META_ICONS.restore}Ask for revision</button>
              <button class="btn btn-success" id="okBtn">${ICONS.check}Mark as completed</button>
            </div>
          </div>`
        : ""
    }`,
    { wide: true }
  );

  if (!canReview) return;
  let rating = 0;
  const starsEl = modal.querySelector("#rateStars");
  starsEl.addEventListener("click", (e) => {
    const i = [...starsEl.querySelectorAll("i")].indexOf(e.target);
    if (i < 0) return;
    rating = i + 1;
    starsEl.innerHTML = stars(rating, "lg");
  });

  async function send(decision, btn) {
    const feedback = modal.querySelector("#fb").value.trim();
    if (decision === "revision_required" && !feedback) {
      modal.querySelector("#fb").focus();
      return toast("Tell the volunteer what to fix", "error");
    }
    btn.disabled = true;
    try {
      const data = await api(`/tasks/${t._id}/review`, {
        method: "PATCH",
        body: { decision, feedback, rating: decision === "completed" && rating ? rating : undefined, ratingComment: feedback },
      });
      toast(data.message);
      loadAlerts();
      modal.close();
      load();
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
    }
  }
  modal.querySelector("#okBtn").addEventListener("click", (e) => send("completed", e.currentTarget));
  modal.querySelector("#revBtn").addEventListener("click", (e) => send("revision_required", e.currentTarget));
}

load();
