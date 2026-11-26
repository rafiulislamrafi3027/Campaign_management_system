let user = requireLogin();
let picker = null;

const ROLE_TITLE = { admin: "Admin Panel", manager: "Campaign Manager", volunteer: "Volunteer" };
const $ = (id) => document.getElementById(id);

async function init() {
  if (!user) return;
  renderSidebar(user.role, "profile");
  $("crumb").textContent = ROLE_TITLE[user.role] || "Account";

  // Always load fresh data from the server
  const data = await api("/auth/me");
  user = data.user;
  localStorage.setItem("user", JSON.stringify(user));
  fillUserChip(user);
  fillForm();
  renderSummary();
}

function fillForm() {
  $("p_name").value = user.name || "";
  $("p_email").value = user.email || "";
  $("p_phone").value = user.phone || "";
  $("p_location").value = user.location || "";

  if (user.role === "manager") {
    $("orgField").classList.remove("hidden");
    $("p_org").value = user.organization || "";
    $("infoHint").textContent = "Volunteers see your name and organization on your campaigns.";
  }
  if (user.role === "volunteer") {
    $("availField").classList.remove("hidden");
    $("skillsField").classList.remove("hidden");
    $("p_avail").value = user.availability || "Flexible";
    picker = skillPicker($("skillPicker"), user.skills || []);
    $("infoHint").textContent = "Managers use your skills and availability to pick the right person for each task.";
  }
}

async function renderSummary() {
  const facts = [
    ["Email", esc(user.email)],
    ["Phone", esc(user.phone || "—")],
    ["Location", esc(user.location || "—")],
  ];
  if (user.role === "manager") facts.push(["Organization", esc(user.organization || "—")]);
  if (user.role === "volunteer") facts.push(["Availability", esc(user.availability || "—")]);
  if (user.createdAt) facts.push(["Member since", formatDate(user.createdAt)]);

  let statusLine = "";
  if (user.role === "volunteer" && user.status !== "approved") {
    statusLine = `<p style="margin-top:10px"><span class="badge ${user.status}">${user.status === "pending" ? "Waiting for verification" : "Not approved"}</span></p>`;
  }

  $("summary").innerHTML = `
    <div class="avatar xl">${esc(initials(user.name))}</div>
    <h2>${esc(user.name)}</h2>
    <span class="role-tag">${esc(user.role)}</span>
    ${statusLine}
    ${user.role === "volunteer" && (user.skills || []).length ? `<div style="margin-top:16px">${skillChips(user.skills)}</div>` : ""}
    <div id="miniStats"></div>
    <div class="facts">${facts.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>`;

  // Small numbers for each role
  try {
    let stats = [];
    if (user.role === "volunteer" && user.status === "approved") {
      const { tasks } = await api("/tasks/mine");
      const done = tasks.filter((t) => t.status === "completed").length;
      stats = [
        [done, "Tasks verified"],
        [user.avgRating ? user.avgRating.toFixed(1) + "★" : "—", "Average rating"],
      ];
    }
    if (user.role === "manager") {
      const { campaigns } = await api("/campaigns/mine");
      stats = [
        [campaigns.length, "Campaigns"],
        [campaigns.filter((c) => c.status === "active").length, "Active now"],
      ];
    }
    if (stats.length) $("miniStats").innerHTML = `<div class="mini-stats">${stats.map(([n, l]) => `<div><strong>${n}</strong><small>${l}</small></div>`).join("")}</div>`;
  } catch (e) {
    /* numbers are optional */
  }
}

// ---------- Save personal info ----------
$("infoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("infoBtn");
  const msg = $("infoMsg");
  const body = {
    name: $("p_name").value.trim(),
    phone: $("p_phone").value.trim(),
    location: $("p_location").value.trim(),
  };
  if (user.role === "manager") body.organization = $("p_org").value.trim();
  if (user.role === "volunteer") {
    body.availability = $("p_avail").value;
    body.skills = picker.get();
    if (!body.skills.length) return showMessage(msg, "Choose at least one skill");
  }

  btn.disabled = true;
  showMessage(msg, "");
  try {
    const data = await api("/auth/me", { method: "PUT", body });
    user = data.user;
    localStorage.setItem("user", JSON.stringify(user));
    fillUserChip(user);
    renderSummary();
    toast(data.message);
  } catch (err) {
    showMessage(msg, err.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Change password ----------
$("pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("pwBtn");
  const msg = $("pwMsg");
  const currentPassword = $("pw_current").value;
  const newPassword = $("pw_new").value;
  if (newPassword.length < 6) return showMessage(msg, "New password must be at least 6 characters");
  if (newPassword !== $("pw_confirm").value) return showMessage(msg, "The two new passwords do not match");

  btn.disabled = true;
  showMessage(msg, "");
  try {
    const data = await api("/auth/password", { method: "PUT", body: { currentPassword, newPassword } });
    localStorage.setItem("token", data.token); // stay logged in on this device
    $("pwForm").reset();
    toast(data.message);
  } catch (err) {
    showMessage(msg, err.message);
  } finally {
    btn.disabled = false;
  }
});

init();
