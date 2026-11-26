const roleSelect = document.getElementById("role");
const managerFields = document.getElementById("managerFields");
const volunteerFields = document.getElementById("volunteerFields");
const form = document.getElementById("registerForm");
const msg = document.getElementById("msg");
const btn = document.getElementById("registerBtn");

// Show the right extra fields for the chosen role
function toggleFields() {
  const isManager = roleSelect.value === "manager";
  managerFields.classList.toggle("hidden", !isManager);
  volunteerFields.classList.toggle("hidden", isManager);
}
roleSelect.addEventListener("change", toggleFields);
toggleFields();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  btn.disabled = true;
  showMessage(msg, "");

  const role = roleSelect.value;
  const body = {
    role,
    name: document.getElementById("name").value.trim(),
    email: document.getElementById("email").value.trim(),
    password: document.getElementById("password").value,
    phone: document.getElementById("phone").value.trim(),
    location: document.getElementById("location").value.trim(),
  };

  if (role === "manager") {
    body.organization = document.getElementById("organization").value.trim();
  } else {
    body.skills = document
      .getElementById("skills")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    body.availability = document.getElementById("availability").value;
  }

  try {
    const data = await api("/auth/register", { method: "POST", body });
    showMessage(msg, data.message, "success");
    form.reset();
    toggleFields();
    setTimeout(() => (window.location.href = "/index.html"), 2500);
  } catch (err) {
    showMessage(msg, err.message);
  } finally {
    btn.disabled = false;
  }
});

// Clear anything the browser auto-filled from a saved login (another person's email/password)
window.addEventListener("load", () => {
  setTimeout(() => {
    ["email", "password"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && document.activeElement !== el) el.value = "";
    });
  }, 300);
});
