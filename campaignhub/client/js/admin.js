const admin = requireRole("admin");
if (admin) {
  fillUserChip(admin);
  renderSidebar("admin", "volunteers");
  renderActionPanel("actionPanel");
}

const rows = document.getElementById("volunteerRows");
const msg = document.getElementById("msg");
let currentStatus = "pending";
let allVolunteers = [];

// Tabs: Pending / Approved / Rejected
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentStatus = tab.dataset.status;
    render();
  });
});

// Load every volunteer once, then count and filter in the browser
async function loadVolunteers() {
  // Shimmer placeholder rows while loading (only the first time)
  if (!allVolunteers.length) {
    rows.innerHTML = Array.from({ length: 3 }, () => `
      <tr class="skeleton">
        <td><div class="person"><div class="skel round"></div><div style="flex:1"><div class="skel" style="width:70%"></div></div></div></td>
        <td><div class="skel" style="width:80%"></div></td>
        <td><div class="skel" style="width:60%"></div></td>
        <td><div class="skel" style="width:50%"></div></td>
        <td><div class="skel" style="width:70%;margin-left:auto"></div></td>
      </tr>`).join("");
  }
  try {
    const { volunteers } = await api("/admin/volunteers");
    allVolunteers = volunteers;
    updateCounts();
    render();
  } catch (err) {
    showMessage(msg, err.message);
  }
}

function updateCounts() {
  const count = (s) => allVolunteers.filter((v) => v.status === s).length;
  const set = (id, n) => (document.getElementById(id).textContent = n);
  countUp("statTotal", allVolunteers.length);
  countUp("statPending", count("pending"));
  countUp("statApproved", count("approved"));
  countUp("statRejected", count("rejected"));
  set("countPending", count("pending"));
  set("countApproved", count("approved"));
  set("countRejected", count("rejected"));
}

// Animates a number from its current value to the new value
function countUp(id, target) {
  const el = document.getElementById(id);
  const start = parseInt(el.textContent, 10) || 0;
  if (start === target) return;
  const duration = 700;
  const t0 = performance.now();
  function frame(now) {
    const p = Math.min((now - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function render() {
  const list = allVolunteers.filter((v) => v.status === currentStatus);

  if (!list.length) {
    rows.innerHTML = `
      <tr><td colspan="5" class="empty">
        ${ICONS.inbox}
        <div>No ${currentStatus} volunteers</div>
      </td></tr>`;
    return;
  }

  rows.innerHTML = list
    .map((v, i) => {
      const skills = (v.skills || []).length
        ? `<div class="chips">${v.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>`
        : `<span class="muted">—</span>`;

      return `
        <tr style="--i:${i}">
          <td>
            <div class="person">
              <div class="avatar sm">${esc(initials(v.name))}</div>
              <div><strong>${esc(v.name)}</strong><small>${esc(v.location) || "No location"} · ${esc(v.availability) || "—"}</small></div>
            </div>
          </td>
          <td>${esc(v.email)}<br><small class="muted">${esc(v.phone) || ""}</small></td>
          <td>${skills}</td>
          <td>
            <span class="badge ${v.status}">${v.status}</span>
            ${v.rejectionReason ? `<span class="reason">“${esc(v.rejectionReason)}”</span>` : ""}
          </td>
          <td class="right">
            <div class="actions">
              ${v.status !== "approved" ? `<button class="btn btn-success btn-sm" data-id="${v.id}" data-decision="approved">${ICONS.check}Approve</button>` : ""}
              ${v.status !== "rejected" ? `<button class="btn btn-outline-danger btn-sm" data-id="${v.id}" data-decision="rejected">${ICONS.x}Reject</button>` : ""}
            </div>
          </td>
        </tr>`;
    })
    .join("");
}

// Sends the decision to the server
async function decide(id, decision, reason = "") {
  try {
    const data = await api(`/admin/volunteers/${id}`, { method: "PATCH", body: { decision, reason } });
    showMessage(msg, "");
    toast(data.message);
    loadVolunteers();
    loadAlerts();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---------- Reject modal ----------
const modal = document.getElementById("rejectModal");
const reasonInput = document.getElementById("rejectReason");
let rejectingId = null;

function openRejectModal(id) {
  const v = allVolunteers.find((x) => x.id === id);
  rejectingId = id;
  reasonInput.value = "";
  document.getElementById("rejectWho").textContent =
    `${v ? v.name : "The volunteer"} will see this reason when they log in.`;
  modal.classList.remove("hidden");
  reasonInput.focus();
}
function closeRejectModal() {
  modal.classList.add("hidden");
  rejectingId = null;
}

document.getElementById("rejectCancel").addEventListener("click", closeRejectModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeRejectModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRejectModal(); });

document.getElementById("rejectConfirm").addEventListener("click", async () => {
  const reason = reasonInput.value.trim();
  if (!reason) {
    reasonInput.focus();
    return toast("A reason is required when rejecting", "error");
  }
  const id = rejectingId;
  closeRejectModal();
  await decide(id, "rejected", reason);
});

// ---------- Approve / Reject buttons in the table ----------
rows.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-id]");
  if (!button) return;
  const { id, decision } = button.dataset;

  if (decision === "rejected") return openRejectModal(id);

  button.disabled = true;
  decide(id, "approved");
});

loadVolunteers();
