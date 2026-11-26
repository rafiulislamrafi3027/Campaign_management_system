const admin = requireRole("admin");
if (admin) {
  fillUserChip(admin);
  renderSidebar("admin", "campaigns");
}

const grid = document.getElementById("grid");
const tabsEl = document.getElementById("tabs");
const TABS = ["submitted", "completion_review", "approved", "active", "rejected", "completed", "removed", "all"];
let campaigns = [];
let currentTab = TABS.includes(new URLSearchParams(location.search).get("tab")) ? new URLSearchParams(location.search).get("tab") : "submitted";

async function load() {
  try {
    const data = await api("/campaigns/admin");
    campaigns = data.campaigns;
    updateStats();
    renderTabs();
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

function updateStats() {
  const counts = countBy(campaigns);
  document.getElementById("sSubmitted").textContent = counts.submitted || 0;
  document.getElementById("sActive").textContent = counts.active || 0;
  document.getElementById("sRejected").textContent = counts.rejected || 0;
  const approvedBudget = campaigns
    .filter((c) => ["approved", "active", "completion_review", "completed"].includes(c.status))
    .reduce((sum, c) => sum + (c.budget || 0), 0);
  document.getElementById("sBudget").textContent = formatMoney(approvedBudget);
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
      <div class="empty-box">${ICONS.inbox}
        <h3>Nothing here</h3>
        <p>${currentTab === "submitted" ? "No campaigns are waiting for review right now." : currentTab === "completion_review" ? "No completion reports are waiting right now." : "No campaigns with this status."}</p>
      </div>`;
    return;
  }

  grid.innerHTML = list
    .map((c, i) => {
      const m = c.manager || {};
      let actions = "";
      if (c.status === "submitted")
        actions = `<button class="btn btn-success btn-sm" data-act="approve" data-id="${c._id}">${ICONS.check}Approve</button>
                   <button class="btn btn-outline-danger btn-sm" data-act="reject" data-id="${c._id}">${ICONS.x}Reject</button>`;
      else if (c.status === "completion_review")
        actions = `<button class="btn btn-primary-grad btn-sm" data-act="report" data-id="${c._id}">${NAV_ICONS.file}Review report</button>`;
      else if (c.status === "removed")
        actions = `<button class="btn btn-light btn-sm" data-act="restore" data-id="${c._id}">${META_ICONS.restore}Restore</button>
                   <button class="btn btn-danger btn-sm" data-act="purge" data-id="${c._id}">${META_ICONS.trash}Delete permanently</button>`;
      else
        actions = `<button class="btn btn-outline-danger btn-sm" data-act="remove" data-id="${c._id}">${META_ICONS.ban}Remove</button>`;
      return `
        <article class="camp-card spot ${c.status === "removed" ? "is-removed" : ""}" style="--i:${i}">
          <div class="camp-top">
            <span class="cat-tag">${esc(c.category)}</span>
            <span class="badge ${c.status}">${STATUS_LABEL[c.status]}</span>
          </div>
          <h3>${esc(c.title)}</h3>
          <div class="camp-by"><div class="avatar sm">${esc(initials(m.name))}</div>${esc(m.name || "Unknown")}${m.organization ? " · " + esc(m.organization) : ""}</div>
          <p class="camp-desc">${esc(c.description)}</p>
          ${campaignMeta(c)}
          ${c.status === "rejected" ? `<div class="camp-note warn"><strong>Reason:</strong> ${esc(c.rejectionReason)}</div>` : ""}
          ${c.status === "removed" ? `<div class="camp-note warn"><strong>Removed:</strong> ${esc(c.removalReason)}<br><span style="opacity:.8">Was "${esc(STATUS_LABEL[c.statusBeforeRemoval] || c.statusBeforeRemoval)}" before removal</span></div>` : ""}
          ${c.status === "completion_review" && c.completionReport ? `<div class="camp-note ok">Completion report sent ${timeAgo(c.completionReport.submittedAt)}${c.completionReport.round > 1 ? ` (attempt ${c.completionReport.round})` : ""}. Please verify it.</div>` : ""}
          <div class="camp-actions">
            <button class="btn btn-light btn-sm" data-act="view" data-id="${c._id}">${META_ICONS.eye}Details</button>
            ${c.status === "completed" && c.completionReport ? `<button class="btn btn-light btn-sm" data-act="report" data-id="${c._id}">${NAV_ICONS.file}Report</button>` : ""}
            ${actions}
          </div>
        </article>`;
    })
    .join("");
}

grid.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const c = campaigns.find((x) => x._id === b.dataset.id);
  if (!c) return;

  if (b.dataset.act === "view") {
    const modal = openModal(
      campaignDetailsHTML(c) +
        (c.status === "submitted"
          ? `<div class="modal-actions">
               <button class="btn btn-outline-danger" data-m="reject">${ICONS.x}Reject</button>
               <button class="btn btn-success" data-m="approve">${ICONS.check}Approve</button>
             </div>`
          : c.status !== "removed"
          ? `<div class="modal-actions"><button class="btn btn-outline-danger" data-m="remove">${META_ICONS.ban}Remove campaign</button></div>`
          : ""),
      { wide: true }
    );
    modal.addEventListener("click", (ev) => {
      const m = ev.target.closest("[data-m]");
      if (!m) return;
      modal.close();
      if (m.dataset.m === "approve") approve(c);
      else if (m.dataset.m === "reject") reject(c);
      else removeCampaign(c);
    });
  }
  if (b.dataset.act === "report") openReport(c);
  if (b.dataset.act === "approve") approve(c);
  if (b.dataset.act === "reject") reject(c);
  if (b.dataset.act === "remove") removeCampaign(c);
  if (b.dataset.act === "restore") restoreCampaign(c);
  if (b.dataset.act === "purge") purgeCampaign(c);
});

// ---------- Remove / restore / delete permanently (Req 17) ----------
function removeCampaign(c) {
  const live = c.status === "active";
  const modal = openModal(`
    <h3>Remove this campaign?</h3>
    <p>"${esc(c.title)}" by ${esc((c.manager && c.manager.name) || "the manager")} will be hidden from volunteers.
       The manager and applicants will see your reason. You can restore it later.</p>
    ${live ? `<div class="danger-zone">This campaign is <strong>active</strong>. Volunteers who joined will see that it was removed.</div>` : ""}
    <label for="rmReason" style="margin-top:14px">Reason for removal</label>
    <textarea id="rmReason" placeholder="e.g. Duplicate campaign — the same campaign was already created by another manager"></textarea>
    <div class="modal-actions">
      <button class="btn btn-light" data-c>Cancel</button>
      <button class="btn btn-danger" data-ok>${META_ICONS.ban}Remove campaign</button>
    </div>`);
  const input = modal.querySelector("#rmReason");
  input.focus();
  modal.querySelector("[data-c]").addEventListener("click", () => modal.close());
  modal.querySelector("[data-ok]").addEventListener("click", async (e) => {
    const reason = input.value.trim();
    if (!reason) {
      input.focus();
      return toast("A reason is required to remove a campaign", "error");
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const data = await api(`/campaigns/${c._id}/remove`, { method: "PATCH", body: { reason } });
      toast(data.message);
      loadAlerts();
      modal.close();
      currentTab = "removed";
      load();
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
    }
  });
}

async function restoreCampaign(c) {
  const ok = await confirmDialog({
    title: "Restore campaign?",
    text: `"${c.title}" will go back to "${STATUS_LABEL[c.statusBeforeRemoval] || "Approved"}".`,
    okText: "Restore",
  });
  if (!ok) return;
  try {
    const data = await api(`/campaigns/${c._id}/restore`, { method: "PATCH" });
    toast(data.message);
    loadAlerts();
    currentTab = c.statusBeforeRemoval || "all";
    load();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function purgeCampaign(c) {
  const ok = await confirmDialog({
    title: "Delete permanently?",
    text: `"${c.title}" and ALL its volunteer applications will be deleted forever. This cannot be undone.`,
    okText: "Delete forever",
    danger: true,
  });
  if (!ok) return;
  try {
    const data = await api(`/campaigns/${c._id}/permanent`, { method: "DELETE" });
    toast(data.message);
    loadAlerts();
    load();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---------- Completion report review (Req 7, 2.7, 4.5) ----------
async function openReport(c) {
  const modal = openModal(`<h3>Completion report</h3><p>${esc(c.title)}</p><div class="ai-loading"><p>Loading the report...</p></div>`, { wide: true });
  const inner = modal.querySelector(".modal");
  let data;
  try {
    data = await api(`/campaigns/${c._id}/completion/admin`);
  } catch (err) {
    inner.querySelector(".ai-loading").outerHTML = `<div class="camp-note warn">${esc(err.message)}</div>`;
    return;
  }
  const camp = data.campaign;
  const r = camp.completionReport;
  const m = camp.manager || {};
  const waiting = camp.status === "completion_review";

  // If the numbers changed after the report was sent (e.g. an expense was edited), warn the Admin
  const a = r.stats || {}, b = data.liveStats || {};
  const changed = ["tasksVerified", "tasksTotal", "spent", "volunteersJoined"].filter((k) => a[k] !== b[k]);

  inner.innerHTML = `<button class="modal-x" aria-label="Close">${ICONS.x}</button>
    <h3>Completion report</h3>
    <p>${esc(camp.title)} · by ${esc(m.name || "the manager")}${m.organization ? " · " + esc(m.organization) : ""}</p>
    <div class="rep-steps"><b>1. Manager wrote the report</b><b class="${waiting ? "on" : ""}">2. Admin verifies</b><b class="${camp.status === "completed" ? "on" : ""}">3. Completed</b></div>
    ${changed.length ? `<div class="camp-note warn" style="margin-bottom:10px">Some numbers changed after the report was sent (${changed.join(", ")}). Current: ${b.tasksVerified}/${b.tasksTotal} tasks verified, ${formatMoney(b.spent)} spent.</div>` : ""}
    ${completionReportHTML(camp)}
    <small class="detail-label" style="margin-top:16px">Task proof (${data.tasks.length})</small>
    <div class="rep-tasks">
      ${data.tasks.length ? data.tasks.map((t) => `
        <details class="rep-task">
          <summary><span>${esc(t.title)} <small>· ${esc(t.assignedTo || "—")}</small></span>
            <span>${t.rating ? stars(t.rating, "sm") : ""} <span class="badge t-${t.status}">${TASK_LABEL[t.status] || t.status}</span></span></summary>
          ${t.proof ? proofHTML(t.proof) : `<p class="muted" style="margin-top:8px;font-size:13px">No proof submitted.</p>`}
        </details>`).join("") : `<p class="muted" style="font-size:13px">This campaign had no tasks.</p>`}
    </div>
    ${waiting ? `
    <label for="revComment" style="margin-top:16px">Comment for the manager <span class="muted">(required when sending back)</span></label>
    <textarea id="revComment" placeholder="e.g. Please add a group photo of the event and the attendance sheet"></textarea>
    <div class="modal-actions">
      <button class="btn btn-outline-danger" data-d="return">${ICONS.x}Send back</button>
      <button class="btn btn-success" data-d="approve">${ICONS.check}Verify &amp; complete</button>
    </div>` : ""}`;

  if (camp.status === "completed") {
    inner.insertAdjacentHTML("beforeend", `<small class="detail-label" style="margin-top:16px">Certificates issued</small><div id="certBox"><p class="muted" style="font-size:13px">Loading...</p></div>`);
    const box = inner.querySelector("#certBox");
    const fill = async () => {
      box.innerHTML =
        (await certificateListHTML(camp._id)) +
        `<button class="btn btn-light btn-sm" id="issueBtn" style="margin-top:10px" title="Gives certificates to volunteers who earned one but do not have it yet">${NAV_ICONS.award}Issue missing certificates</button>`;
      box.querySelector("#issueBtn").addEventListener("click", async (e) => {
        e.currentTarget.disabled = true;
        try {
          const res = await api(`/certificates/campaign/${camp._id}/issue`, { method: "POST" });
          toast(res.message);
          fill();
        } catch (err) {
          toast(err.message, "error");
          e.currentTarget.disabled = false;
        }
      });
    };
    await fill();
    bindCertificateDownloads(box);
  }
  if (!waiting) return;
  inner.querySelectorAll("[data-d]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const decision = btn.dataset.d;
      const comment = inner.querySelector("#revComment").value.trim();
      if (decision === "return" && comment.length < 5) {
        inner.querySelector("#revComment").focus();
        return toast("Tell the manager what to fix", "error");
      }
      if (decision === "approve") {
        const ok = await confirmDialog({ title: "Verify this report?", text: `"${camp.title}" will be marked as completed. Volunteers who did verified tasks will be able to get certificates.`, okText: "Verify & complete" });
        if (!ok) return;
      }
      inner.querySelectorAll("[data-d]").forEach((x) => (x.disabled = true));
      try {
        const res = await api(`/campaigns/${camp._id}/completion/review`, { method: "PATCH", body: { decision, comment } });
        toast(res.message);
        modal.close();
        currentTab = decision === "approve" ? "completed" : "active";
        loadAlerts();
        load();
      } catch (err) {
        toast(err.message, "error");
        inner.querySelectorAll("[data-d]").forEach((x) => (x.disabled = false));
      }
    })
  );
}

async function approve(c) {
  const ok = await confirmDialog({
    title: "Approve campaign?",
    text: `"${c.title}" with a budget of ${formatMoney(c.budget)} will be approved. The manager can then make it active.`,
    okText: "Approve",
  });
  if (!ok) return;
  decide(c, "approved");
}

function reject(c) {
  const modal = openModal(`
    <h3>Reject campaign</h3>
    <p>The manager will see this reason and can edit and resubmit the campaign.</p>
    <label for="rReason">Reason for rejection</label>
    <textarea id="rReason" placeholder="e.g. The budget is too high for the number of beneficiaries"></textarea>
    <div class="modal-actions">
      <button class="btn btn-light" data-c>Cancel</button>
      <button class="btn btn-danger" data-ok>Reject</button>
    </div>`);
  const input = modal.querySelector("#rReason");
  input.focus();
  modal.querySelector("[data-c]").addEventListener("click", () => modal.close());
  modal.querySelector("[data-ok]").addEventListener("click", () => {
    const reason = input.value.trim();
    if (!reason) {
      input.focus();
      return toast("A reason is required when rejecting", "error");
    }
    modal.close();
    decide(c, "rejected", reason);
  });
}

async function decide(c, decision, reason = "") {
  try {
    const data = await api(`/campaigns/${c._id}/review`, { method: "PATCH", body: { decision, reason } });
    toast(data.message);
    loadAlerts();
    await load();
  } catch (err) {
    toast(err.message, "error");
  }
}

load();
