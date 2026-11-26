// Sends the password-reset code.
//
// Two modes:
//  1) Real email — if the "nodemailer" package is installed AND SMTP_* values are set in .env
//     (e.g. a Gmail account with an App Password). See README.
//  2) Development mode — otherwise the code is printed in the server terminal,
//     so you can test "Forgot password" without any email setup.

let nodemailer = null;
try {
  nodemailer = require("nodemailer"); // optional: npm install nodemailer
} catch (e) {
  nodemailer = null;
}

function emailConfigured() {
  return Boolean(nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendResetCode(user, code) {
  const subject = "CampaignHub password reset code";
  const text =
    `Hello ${user.name},\n\n` +
    `Your CampaignHub password reset code is: ${code}\n\n` +
    `It expires in 10 minutes. If you did not ask for this, you can ignore this email.\n`;

  if (emailConfigured()) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || `CampaignHub <${process.env.SMTP_USER}>`,
      to: user.email,
      subject,
      text,
    });
    return { mode: "email" };
  }

  // Development mode: show the code in the terminal where "npm run dev" is running
  console.log("\n==============================================");
  console.log("  PASSWORD RESET CODE (development mode)");
  console.log(`  User : ${user.name} <${user.email}>`);
  console.log(`  Code : ${code}   (valid for 10 minutes)`);
  console.log("==============================================\n");
  return { mode: "console" };
}

module.exports = { sendResetCode, emailConfigured };
