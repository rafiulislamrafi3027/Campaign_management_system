// Already logged in? Go straight to the dashboard
const existing = getUser();
if (getToken() && existing) window.location.href = dashboardFor(existing.role);

// Pass the typed email to the forgot-password page
document.getElementById("forgotLink").addEventListener("click", (e) => {
  const email = document.getElementById("email").value.trim();
  if (email) e.currentTarget.href = `/forgot.html?email=${encodeURIComponent(email)}`;
});

const form = document.getElementById("loginForm");
const msg = document.getElementById("msg");
const btn = document.getElementById("loginBtn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  btn.disabled = true;
  showMessage(msg, "");

  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: {
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value,
      },
    });
    saveSession(data.token, data.user);
    window.location.href = dashboardFor(data.user.role);
  } catch (err) {
    showMessage(msg, err.message);
  } finally {
    btn.disabled = false;
  }
});
