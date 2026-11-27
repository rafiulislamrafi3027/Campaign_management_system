// =========================================================
// Password-reset email (Req 1.7)
//
// Three ways to deliver the 6-digit code, tried in this order:
//
//  1) Brevo email API (recommended) — works on your PC AND on Render.
//     Render's free plan blocks normal email ports (SMTP 25/465/587), so we send
//     over HTTPS instead. Free: 300 emails per day. No package needed.
//     .env:  BREVO_API_KEY=...   MAIL_FROM_EMAIL=you@gmail.com   MAIL_FROM_NAME=CampaignHub
//
//  2) SMTP (e.g. Gmail App Password) — works on your PC only (blocked on Render free).
//     Needs:  npm install nodemailer   and SMTP_HOST / SMTP_USER / SMTP_PASS in .env
//
//  3) Development mode — nothing set up: the code is printed in the server terminal.
//
// Once email is set up, the code goes ONLY to the user's inbox — never to the terminal/logs,
// because anyone who can read the logs could otherwise reset other people's passwords.
// If sending fails, only the reason is logged (and written to the Audit Log); the site keeps working.
// =========================================================

let nodemailer = null;
try {
  nodemailer = require("nodemailer"); // optional
} catch (e) {
  nodemailer = null;
}

const BREVO_URL = process.env.BREVO_BASE_URL || "https://api.brevo.com/v3/smtp/email";

const brevoConfigured = () => Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM_EMAIL);
const smtpConfigured = () => Boolean(nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const emailConfigured = () => brevoConfigured() || smtpConfigured();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function buildEmail(user, code) {
  const subject = `Your CampaignHub reset code: ${code}`;
  const text =
    `Hello ${user.name},\n\n` +
    `Your CampaignHub password reset code is: ${code}\n\n` +
    `It expires in 10 minutes. If you did not ask for this, you can ignore this email — your password stays the same.\n\n` +
    `— CampaignHub`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f3fb;font-family:Segoe UI,Arial,sans-serif;color:#1f1147">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e3f5">
      <tr><td style="background:linear-gradient(120deg,#6d28d9,#22d3ee);padding:22px 28px;color:#fff;font-size:20px;font-weight:700">CampaignHub</td></tr>
      <tr><td style="padding:28px">
        <p style="margin:0 0 12px;font-size:16px">Hello ${esc(user.name)},</p>
        <p style="margin:0 0 20px;font-size:15px;color:#4b4766">Use this code to reset your CampaignHub password:</p>
        <div style="font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;background:#f4f1ff;border:1px dashed #a78bfa;border-radius:12px;padding:16px 0;color:#4c1d95">${esc(code)}</div>
        <p style="margin:20px 0 0;font-size:13px;color:#6b6785">The code expires in <b>10 minutes</b>. If you did not ask for this, ignore this email — your password stays the same.</p>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #eee;font-size:12px;color:#8a86a3">Campaign Management System · This is an automatic email, please do not reply.</td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { subject, text, html };
}

async function sendWithBrevo(user, mail) {
  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM_EMAIL, name: process.env.MAIL_FROM_NAME || "CampaignHub" },
      to: [{ email: user.email, name: user.name }],
      subject: mail.subject,
      textContent: mail.text,
      htmlContent: mail.html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Brevo ${res.status}: ${body.message || body.code || "request failed"}`);
  }
}

async function sendWithSmtp(user, mail) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || `CampaignHub <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

function printToConsole(user, code, reason) {
  console.log("\n==============================================");
  console.log(`  PASSWORD RESET CODE (${reason})`);
  console.log(`  User : ${user.name} <${user.email}>`);
  console.log(`  Code : ${code}   (valid for 10 minutes)`);
  console.log("==============================================\n");
}

/**
 * Sends the code. Never throws.
 * @returns {Promise<{mode: "brevo"|"smtp"|"console", ok: boolean, error?: string}>}
 */
async function sendResetCode(user, code) {
  const mail = buildEmail(user, code);

  if (brevoConfigured()) {
    try {
      await sendWithBrevo(user, mail);
      return { mode: "brevo", ok: true };
    } catch (err) {
      console.error(`Email (Brevo) to ${user.email} failed: ${err.message}`);
      if (!smtpConfigured()) return { mode: "brevo", ok: false, error: err.message };
    }
  }

  if (smtpConfigured()) {
    try {
      await sendWithSmtp(user, mail);
      return { mode: "smtp", ok: true };
    } catch (err) {
      console.error(`Email (SMTP) to ${user.email} failed: ${err.message}`);
      return { mode: "smtp", ok: false, error: err.message };
    }
  }

  // Nothing set up yet (development): show the code in the terminal so it can still be tested
  printToConsole(user, code, "development mode");
  return { mode: "console", ok: true };
}

module.exports = { sendResetCode, emailConfigured };
