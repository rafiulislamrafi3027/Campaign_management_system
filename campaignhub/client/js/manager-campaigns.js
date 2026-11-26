const me = requireRole("manager");
if (me) {
  fillUserChip(me);
  renderSidebar("manager", "campaigns");
}

const grid = document.getElementById("grid");
const tabsEl = document.getElementById("tabs");
const newBtn = document.getElementById("newBtn");
newBtn.innerHTML = `${META_ICONS.plus}New campaign`;

const TABS = ["all", "draft", "submitted", "approved", "active", "completion_review", "rejected", "completed", "removed"];
let campaigns = [];
let currentTab = "all";

const CATEGORIES = ["Relief", "Education", "Health", "Environment", "Awareness", "Fundraising", "Other"];

// ---------- Load & render ----------
async function load() {
  try {
    const data = await api("/campaigns/mine");
    campaigns = data.campaigns;
    renderTabs();
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderTabs() {
  const counts = countBy(campaigns);
  tabsEl.innerHTML = TABS.map(
    (t) => `<button class="tab ${t === currentTab ? "active" : ""}" data-tab="${t}">
              ${t === "all" ? "All" : STATUS_LABEL[t]} <span class="count">${counts[t] || 0}</span>
            </button>`
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
  const list = currentTab === "all" ? campaigns : campaigns.filter((c) => c.status === currentTab);

  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-box">
        ${ICONS.inbox}
        <h3>${currentTab === "all" ? "No campaigns yet" : `No ${STATUS_LABEL[currentTab].toLowerCase()} campaigns`}</h3>
        <p>${currentTab === "all" ? "Create your first campaign to get started." : "Campaigns with this status will appear here."}</p>
        ${currentTab === "all" ? `<button class="btn btn-primary-grad" onclick="openForm()">${META_ICONS.plus}Create campaign</button>` : ""}
      </div>`;
    return;
  }

  grid.innerHTML = list.map((c, i) => cardHTML(c, i)).join("");
}

function cardHTML(c, i) {
  let note = "";
  let actions = "";

  switch (c.status) {
    case "draft":
      actions = `
        <button class="btn btn-light btn-sm" data-act="edit" data-id="${c._id}">${META_ICONS.edit}Edit</button>
        <button class="btn btn-outline-danger btn-sm" data-act="delete" data-id="${c._id}">${META_ICONS.trash}Delete</button>
        <button class="btn btn-primary-grad btn-sm" data-act="submit" data-id="${c._id}">${META_ICONS.send}Submit</button>`;
      break;
    case "rejected":
      note = `<div class="camp-note warn"><strong>Rejected:</strong> ${esc(c.rejectionReason)}</div>`;
      actions = `
        <button class="btn btn-light btn-sm" data-act="edit" data-id="${c._id}">${META_ICONS.edit}Edit</button>
        <button class="btn btn-outline-danger btn-sm" data-act="delete" data-id="${c._id}">${META_ICONS.trash}Delete</button>
        <button class="btn btn-primary-grad btn-sm" data-act="submit" data-id="${c._id}">${META_ICONS.send}Resubmit</button>`;
      break;
    case "submitted":
      note = `<div class="camp-note info">Waiting for the Admin to review this campaign.</div>`;
      break;
    case "approved":
      note = `<div class="camp-note ok">Approved! Make it active so volunteers can see it.</div>`;
      actions = `<button class="btn btn-primary-grad btn-sm" data-act="activate" data-id="${c._id}">${META_ICONS.rocket}Make active</button>`;
      break;
    case "active": {
      const r = c.completionReport;
      const ended = new Date(c.endDate) < new Date(new Date().toDateString());
      if (r && r.status === "returned") {
        note = `<div class="camp-note warn"><strong>Admin sent the report back:</strong> ${esc(r.reviewComment)}</div>`;
        actions = `<button class="btn btn-primary-grad btn-sm" data-act="report" data-id="${c._id}">${META_ICONS.flag}Fix &amp; resend report</button>`;
      } else {
        if (ended) note = `<div class="camp-note info">This campaign ended on ${formatDate(c.endDate)}. Send the completion report to the Admin.</div>`;
        actions = `<button class="btn ${ended ? "btn-primary-grad" : "btn-light"} btn-sm" data-act="report" data-id="${c._id}">${META_ICONS.flag}Completion report</button>`;
      }
      break;
    }
    case "completion_review":
      note = `<div class="camp-note ok">Completion report sent. Waiting for the Admin to verify it.</div>`;
      actions = `<button class="btn btn-light btn-sm" data-act="viewReport" data-id="${c._id}">${NAV_ICONS.file}View report</button>`;
      break;
    case "completed":
      if (c.completionReport) actions = `<button class="btn btn-light btn-sm" data-act="viewReport" data-id="${c._id}">${NAV_ICONS.file}Report &amp; certificates</button>`;
      break;
    case "removed":
      note = `<div class="camp-note warn"><strong>Removed by Admin:</strong> ${esc(c.removalReason)}<br>Volunteers can no longer see this campaign.</div>`;
      break;
  }

  return `
    <article class="camp-card spot ${c.status === "removed" ? "is-removed" : ""}" style="--i:${i}">
      <div class="camp-top">
        <span class="cat-tag">${esc(c.category)}</span>
        <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span>
      </div>
      <h3>${esc(c.title)}</h3>
      <p class="camp-desc">${esc(c.description)}</p>
      ${campaignMeta(c)}
      ${skillChips(c.requiredSkills)}
      ${note}
      <div class="camp-actions">
        <button class="btn btn-light btn-sm" data-act="view" data-id="${c._id}">${META_ICONS.eye}Details</button>
        ${actions}
      </div>
    </article>`;
}

// ---------- Card buttons ----------
grid.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const c = campaigns.find((x) => x._id === b.dataset.id);
  if (!c) return;

  switch (b.dataset.act) {
    case "view":
      openModal(campaignDetailsHTML(c), { wide: true });
      break;
    case "edit":
      openForm(c);
      break;
    case "delete":
      if (await confirmDialog({ title: "Delete campaign?", text: `"${c.title}" will be deleted permanently.`, okText: "Delete", danger: true }))
        act(b, () => api(`/campaigns/${c._id}`, { method: "DELETE" }));
      break;
    case "submit":
      if (await confirmDialog({ title: "Submit for approval?", text: "After submitting you cannot edit the campaign unless the Admin rejects it.", okText: "Submit" }))
        act(b, () => api(`/campaigns/${c._id}/submit`, { method: "PATCH" }));
      break;
    case "activate":
      if (await confirmDialog({ title: "Make campaign active?", text: "Verified volunteers will be able to see this campaign.", okText: "Make active" }))
        act(b, () => api(`/campaigns/${c._id}/activate`, { method: "PATCH" }));
      break;
    case "report":
      openReportForm(c);
      break;
    case "viewReport": {
      const m = openModal(`<h3>Completion report</h3><p>${esc(c.title)}</p>${completionReportHTML(c)}${c.status === "completed" ? `<small class="detail-label" style="margin-top:16px">Certificates issued</small><div id="certBox"><p class="muted" style="font-size:13px">Loading...</p></div>` : ""}`, { wide: true });
      if (c.status === "completed") {
        const box = m.querySelector("#certBox");
        box.innerHTML = await certificateListHTML(c._id);
        bindCertificateDownloads(box);
      }
      break;
    }
  }
});

// Runs an API action, shows a toast and reloads the list
async function act(button, fn) {
  button.disabled = true;
  try {
    const data = await fn();
    toast(data.message);
    loadAlerts();
    await load();
  } catch (err) {
    toast(err.message, "error");
    button.disabled = false;
  }
}

// ---------- Create / edit form ----------
newBtn.addEventListener("click", () => openForm());

function openForm(c = null) {
  const v = (f, d = "") => (c && c[f] !== undefined && c[f] !== null ? c[f] : d);

  const modal = openModal(
    `
    <h3>${c ? "Edit campaign" : "New campaign"}</h3>
    <p>${c ? "Update the details and save." : "Fill in the details. It will be saved as a draft first."}</p>
    <form id="campForm">
      <div class="form-grid">
        <div class="field full">
          <label for="f_title">Campaign title *</label>
          <input id="f_title" required maxlength="120" placeholder="e.g. Winter clothes distribution in Mirpur" value="${esc(v("title"))}" />
        </div>
        <div class="field">
          <label for="f_category">Category</label>
          <select id="f_category">${CATEGORIES.map((x) => `<option ${v("category", "Relief") === x ? "selected" : ""}>${x}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="f_location">Location *</label>
          <input id="f_location" required placeholder="e.g. Mirpur 10, Dhaka" value="${esc(v("location"))}" />
        </div>
        <div class="field full">
          <label for="f_description">Goal / description *</label>
          <textarea id="f_description" class="tall" required maxlength="3000" placeholder="What is this campaign about and what do you want to achieve?">${esc(v("description"))}</textarea>
        </div>
        <div class="field">
          <label for="f_start">Start date *</label>
          <input type="date" id="f_start" required value="${toInputDate(v("startDate"))}" />
        </div>
        <div class="field">
          <label for="f_end">End date *</label>
          <input type="date" id="f_end" required value="${toInputDate(v("endDate"))}" />
        </div>
        <div class="field">
          <label for="f_budget">Estimated budget (৳) *</label>
          <input type="number" id="f_budget" min="1" required placeholder="50000" value="${esc(v("budget"))}" />
        </div>
        <div class="field">
          <label for="f_benef">Expected beneficiaries</label>
          <input type="number" id="f_benef" min="0" placeholder="200" value="${esc(v("beneficiaries"))}" />
        </div>
        <div class="field">
          <label for="f_vol">Volunteers needed</label>
          <input type="number" id="f_vol" min="0" placeholder="15" value="${esc(v("volunteersNeeded"))}" />
        </div>
        <div class="field">
          <label for="f_skills">Required skills</label>
          <input id="f_skills" placeholder="Logistics, Social Media" value="${esc((v("requiredSkills", []) || []).join(", "))}" />
          <p class="hint">Separate with commas</p>
        </div>
      </div>
      <div id="formMsg" class="msg"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-light" data-close>Cancel</button>
        <button type="submit" class="btn btn-light" data-mode="draft">Save as draft</button>
        <button type="submit" class="btn btn-primary-grad" data-mode="submit">${META_ICONS.send}Save &amp; submit</button>
      </div>
    </form>`,
    { wide: true }
  );

  const form = modal.querySelector("#campForm");
  const msg = modal.querySelector("#formMsg");
  modal.querySelector("[data-close]").addEventListener("click", () => modal.close());
  modal.querySelector("#f_title").focus();

  let mode = "draft";
  form.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => (mode = b.dataset.mode)));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const val = (id) => modal.querySelector(id).value.trim();
    const body = {
      title: val("#f_title"),
      category: val("#f_category"),
      location: val("#f_location"),
      description: val("#f_description"),
      startDate: val("#f_start"),
      endDate: val("#f_end"),
      budget: val("#f_budget"),
      beneficiaries: val("#f_benef"),
      volunteersNeeded: val("#f_vol"),
      requiredSkills: val("#f_skills"),
    };

    if (body.endDate && body.startDate && body.endDate < body.startDate) {
      return showMessage(msg, "End date cannot be before the start date");
    }

    const buttons = form.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    showMessage(msg, "");

    try {
      const saved = c
        ? await api(`/campaigns/${c._id}`, { method: "PUT", body })
        : await api("/campaigns", { method: "POST", body });
      c = saved.campaign; // if submitting fails, a retry updates this draft instead of creating a new one

      if (mode === "submit") {
        await api(`/campaigns/${saved.campaign._id}/submit`, { method: "PATCH" });
        toast("Campaign submitted for Admin approval");
      } else {
        toast(saved.message);
      }
      modal.close();
      currentTab = mode === "submit" ? "submitted" : "draft";
      await load();
    } catch (err) {
      showMessage(msg, err.message);
      buttons.forEach((b) => (b.disabled = false));
      // If saving worked but submitting failed, refresh the list so the draft shows
      load();
    }
  });
}

// ---------- Completion report (Req 7, 2.7, 4.5) ----------
// Step 1: the system shows the real numbers and any unfinished tasks.
// Step 2: the Manager writes the summary, people helped and adds photos, then sends it to the Admin.
const MAX_PHOTOS = 5;
const PHOTO_TYPES = ["image/jpeg", "image/png", "application/pdf"];

async function openReportForm(c) {
  const modal = openModal(`<h3>Completion report</h3><p>${esc(c.title)}</p><div class="ai-loading"><p>Collecting the campaign numbers...</p></div>`, { wide: true });
  let data;
  try {
    data = await api(`/campaigns/${c._id}/completion`);
  } catch (err) {
    modal.querySelector(".ai-loading").outerHTML = `<div class="camp-note warn">${esc(err.message)}</div>`;
    return;
  }
  const { stats, openTasks } = data;
  const old = c.completionReport && c.completionReport.status === "returned" ? c.completionReport : null;
  const inner = modal.querySelector(".modal");

  // Unfinished tasks block the report
  if (openTasks.length) {
    inner.innerHTML = `<button class="modal-x" aria-label="Close">${ICONS.x}</button>
      <h3>Finish the tasks first</h3>
      <p>${esc(c.title)}</p>
      <div class="camp-note warn">The report can be sent only when every task is verified. ${openTasks.length} task${openTasks.length === 1 ? " is" : "s are"} still open:</div>
      <ul class="open-list">${openTasks.map((t) => `<li><span>${esc(t.title)}${t.assignedTo ? ` <span class="muted">· ${esc(t.assignedTo)}</span>` : ""}</span><span class="badge t-${t.status}">${TASK_LABEL[t.status] || t.status}</span></li>`).join("")}</ul>
      <p class="muted" style="font-size:13px">Review submitted proof, or delete tasks that were never started (pending).</p>
      <div class="modal-actions">
        <button class="btn btn-light" data-close>Close</button>
        <a class="btn btn-primary-grad" href="/manager/tasks.html">${NAV_ICONS.tasks}Go to Tasks</a>
      </div>`;
    inner.querySelector("[data-close]").addEventListener("click", () => modal.close());
    return;
  }

  let files = [];
  inner.innerHTML = `<button class="modal-x" aria-label="Close">${ICONS.x}</button>
    <h3>Completion report</h3>
    <p>${esc(c.title)} · the Admin will verify it before the campaign is marked completed.</p>
    <div class="rep-steps"><b class="on">1. You write the report</b><b>2. Admin verifies</b><b>3. Completed</b></div>
    ${old ? `<div class="camp-note warn" style="margin-bottom:12px"><strong>What the Admin asked you to fix:</strong> ${esc(old.reviewComment)}</div>` : ""}
    <small class="detail-label">Calculated by the system (you cannot change these)</small>
    ${completionStatsHTML(stats)}
    <div class="form-grid" style="margin-top:16px">
      <div class="field full">
        <label for="r_summary">What did the campaign achieve? *</label>
        <textarea id="r_summary" class="tall" maxlength="3000" placeholder="e.g. We collected 85 bags of blood at the IUBAT hall with 12 volunteers. The donors were checked by the medical team and given snacks after donation.">${old ? esc(old.summary) : ""}</textarea>
      </div>
      <div class="field">
        <label for="r_reached">People actually helped *</label>
        <input type="number" id="r_reached" min="0" step="1" placeholder="${c.beneficiaries || 0}" value="${old ? old.beneficiariesReached : ""}" />
        <p class="hint">Expected: ${c.beneficiaries || 0} people</p>
      </div>
      <div class="field">
        <label for="r_challenges">Challenges &amp; lessons <span class="muted">(optional)</span></label>
        <textarea id="r_challenges" style="min-height:84px" maxlength="1500" placeholder="e.g. Fewer donors in the morning; next time start after 11 AM.">${old ? esc(old.challenges || "") : ""}</textarea>
      </div>
      <div class="field full">
        <label>Photos or PDF of the event * <span class="muted">(JPG, PNG, PDF · max 5 · 5 MB each)</span></label>
        <div class="dropzone" id="drop">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/></svg>
          <div>Click to choose files or drag them here</div>
          <small>${old && old.photos.length ? `Leave empty to keep the ${old.photos.length} file(s) you sent before` : "Group photo, banner, attendance sheet..."}</small>
        </div>
        <input type="file" id="r_files" accept=".jpg,.jpeg,.png,.pdf" multiple hidden />
        <div class="previews" id="previews"></div>
      </div>
    </div>
    <div id="rMsg" class="msg"></div>
    <div class="modal-actions">
      <button class="btn btn-light" data-close>Cancel</button>
      <button class="btn btn-primary-grad" id="rSend">${META_ICONS.send}Send to Admin</button>
    </div>`;

  const $ = (sel) => inner.querySelector(sel);
  $("[data-close]").addEventListener("click", () => modal.close());
  const drop = $("#drop"), input = $("#r_files"), previews = $("#previews"), msg = $("#rMsg");

  function addFiles(list) {
    for (const f of list) {
      if (files.length >= MAX_PHOTOS) { toast(`At most ${MAX_PHOTOS} files`, "error"); break; }
      if (!PHOTO_TYPES.includes(f.type)) { toast(`"${f.name}": only JPG, PNG or PDF`, "error"); continue; }
      if (f.size > 5 * 1024 * 1024) { toast(`"${f.name}" is larger than 5 MB`, "error"); continue; }
      files.push(f);
    }
    draw();
  }
  function draw() {
    previews.innerHTML = files
      .map((f, i) => `<div class="pv">${f.type.startsWith("image/") ? `<img src="${URL.createObjectURL(f)}" alt="" />` : `${NAV_ICONS.file}<br>${esc(f.name)}`}<button data-rm="${i}" title="Remove">${ICONS.x}</button></div>`)
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
    draw();
  });

  $("#rSend").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const summary = $("#r_summary").value.trim();
    const reached = $("#r_reached").value.trim();
    if (summary.length < 30) return showMessage(msg, "Please describe what the campaign achieved (at least 30 characters)");
    if (reached === "" || !/^\d+$/.test(reached)) return showMessage(msg, "Enter how many people were actually helped (a whole number)");
    if (!files.length && !(old && old.photos.length)) return showMessage(msg, "Add at least one photo or PDF of the event");

    btn.disabled = true;
    btn.innerHTML = "Sending...";
    showMessage(msg, "");
    try {
      const photos = await Promise.all(files.map(async (f) => ({ name: f.name, data: await readAsDataURL(f) })));
      const res = await api(`/campaigns/${c._id}/completion`, {
        method: "POST",
        body: { summary, beneficiariesReached: Number(reached), challenges: $("#r_challenges").value.trim(), photos, keepPhotos: !files.length },
      });
      toast(res.message);
      modal.close();
      currentTab = "completion_review";
      loadAlerts();
      load();
    } catch (err) {
      showMessage(msg, err.message);
      btn.disabled = false;
      btn.innerHTML = `${META_ICONS.send}Send to Admin`;
    }
  });
}

load();
markSeen("campaigns");
