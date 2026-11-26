const $ = (id) => document.getElementById(id);
const msg = $("msg");
let email = "";

function goStep(n) {
  [1, 2, 3].forEach((i) => {
    $("step" + i).classList.toggle("hidden", i !== n);
    $("bar" + i).classList.toggle("on", i <= n);
  });
  $("backLink").classList.toggle("hidden", n === 3);
  showMessage(msg, "");
}

// If the user typed an email on the login page, start with it
const fromLogin = new URLSearchParams(location.search).get("email");
if (fromLogin) $("f_email").value = fromLogin;

async function sendCode(btn) {
  btn.disabled = true;
  showMessage(msg, "");
  try {
    const data = await api("/auth/forgot", { method: "POST", body: { email } });
    $("sentTo").textContent = `${data.message} Check ${email}.`;
    const hint = $("devHint");
    hint.classList.toggle("hidden", !data.devHint);
    hint.textContent = data.devHint || "";
    goStep(2);
    $("f_code").focus();
    startResendTimer();
  } catch (err) {
    showMessage(msg, err.message);
  } finally {
    btn.disabled = false;
  }
}

$("emailForm").addEventListener("submit", (e) => {
  e.preventDefault();
  email = $("f_email").value.trim().toLowerCase();
  sendCode($("sendBtn"));
});

// "Send again" is available after 60 seconds (same limit as the server)
let timer;
function startResendTimer() {
  const btn = $("resendBtn");
  let left = 60;
  btn.disabled = true;
  clearInterval(timer);
  btn.textContent = `Send again (${left}s)`;
  timer = setInterval(() => {
    left--;
    btn.textContent = left > 0 ? `Send again (${left}s)` : "Send again";
    if (left <= 0) {
      clearInterval(timer);
      btn.disabled = false;
    }
  }, 1000);
}
$("resendBtn").addEventListener("click", () => sendCode($("resendBtn")));

// Only digits in the code box
$("f_code").addEventListener("input", (e) => (e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6)));

$("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("f_code").value.trim();
  const newPassword = $("f_new").value;
  if (!/^\d{6}$/.test(code)) return showMessage(msg, "Enter the 6-digit code");
  if (newPassword.length < 6) return showMessage(msg, "New password must be at least 6 characters");
  if (newPassword !== $("f_confirm").value) return showMessage(msg, "The two passwords do not match");

  const btn = $("resetBtn");
  btn.disabled = true;
  showMessage(msg, "");
  try {
    await api("/auth/reset", { method: "POST", body: { email, code, newPassword } });
    $("devHint").classList.add("hidden");
    goStep(3);
  } catch (err) {
    showMessage(msg, err.message);
  } finally {
    btn.disabled = false;
  }
});
