// =========================================================
// Certificates (Req 14): who gets one, the unique code, and the PDF design
// =========================================================

const crypto = require("crypto");
const Certificate = require("../models/Certificate");
const Application = require("../models/Application");
const Task = require("../models/Task");
const User = require("../models/User");
const { SimplePdf } = require("./pdf");

// No 0/O or 1/I so the code is easy to read and type
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode() {
  const bytes = crypto.randomBytes(6);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `CH-${new Date().getFullYear()}-${s}`;
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/**
 * Gives a certificate to every accepted volunteer of the campaign who has at least one
 * verified task. Safe to run again: volunteers who already have one are skipped.
 * @returns {Promise<number>} how many new certificates were issued
 */
async function issueForCampaign(campaign, adminId) {
  const [apps, tasks, manager] = await Promise.all([
    Application.find({ campaign: campaign._id, status: "accepted" }),
    Task.find({ campaign: campaign._id, status: "completed" }),
    User.findById(campaign.manager),
  ]);

  let issued = 0;
  for (const app of apps) {
    const vid = String(app.volunteer && app.volunteer._id ? app.volunteer._id : app.volunteer);
    const mine = tasks.filter((t) => String(t.assignedTo && t.assignedTo._id ? t.assignedTo._id : t.assignedTo) === vid);
    if (!mine.length) continue; // joined but did no verified work -> no certificate
    if (await Certificate.findOne({ volunteer: vid, campaign: campaign._id })) continue;

    const volunteer = await User.findById(vid);
    if (!volunteer) continue;
    const rated = mine.filter((t) => t.rating);

    const data = {
      volunteer: vid,
      campaign: campaign._id,
      volunteerName: volunteer.name,
      campaignTitle: campaign.title,
      category: campaign.category,
      organization: (manager && manager.organization) || "",
      location: campaign.location,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      managerName: manager ? manager.name : "",
      tasksCompleted: mine.length,
      taskTitles: mine.map((t) => t.title).slice(0, 10),
      avgRating: rated.length ? Math.round((rated.reduce((s, t) => s + t.rating, 0) / rated.length) * 10) / 10 : 0,
      issuedAt: new Date(),
      issuedBy: adminId,
    };

    // A code clash is almost impossible, but try again just in case
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await Certificate.create({ ...data, code: newCode() });
        issued++;
        break;
      } catch (err) {
        if (err && err.code === 11000 && /code/.test(JSON.stringify(err.keyPattern || err.message))) continue;
        if (err && err.code === 11000) break; // volunteer+campaign already exists
        throw err;
      }
    }
  }
  return issued;
}

// ---------- PDF design (A4 landscape) ----------
function certificatePdf(cert, verifyUrl) {
  const pdf = new SimplePdf(842, 595);
  const C = 421; // centre
  const purple = "#4c1d95", violet = "#6d28d9", gold = "#c8961e", ink = "#1f1147", grey = "#5b5670";

  pdf.rect(0, 0, 842, 595, { fill: "#fffdf8" });
  pdf.rect(18, 18, 806, 559, { stroke: purple, lineWidth: 5 });
  pdf.rect(30, 30, 782, 535, { stroke: gold, lineWidth: 1.2 });
  // corner ornaments
  for (const [x, y] of [[30, 30], [812, 30], [30, 565], [812, 565]]) {
    pdf.circle(x, y, 7, { fill: gold });
    pdf.circle(x, y, 3, { fill: "#fffdf8" });
  }
  // top ribbon
  pdf.rect(C - 70, 30, 140, 6, { fill: violet });

  pdf.text("CAMPAIGNHUB", C, 76, { font: "Helvetica-Bold", size: 11, color: violet, align: "center", spacing: 3 });
  if (cert.organization) pdf.text(cert.organization, C, 93, { font: "Helvetica", size: 10, color: grey, align: "center" });

  pdf.text("CERTIFICATE", C, 150, { font: "Times-Bold", size: 46, color: ink, align: "center", spacing: 6 });
  pdf.text("OF PARTICIPATION", C, 176, { font: "Helvetica-Bold", size: 12.5, color: gold, align: "center", spacing: 5 });
  pdf.line(C - 60, 191, C + 60, 191, { color: gold, lineWidth: 1 });

  pdf.text("This certificate is proudly presented to", C, 228, { font: "Times-Italic", size: 15, color: grey, align: "center" });

  // Name: shrink the font if the name is long
  let size = 40;
  while (size > 22 && pdf.width(cert.volunteerName, "Times-BoldItalic", size) > 600) size -= 2;
  pdf.text(cert.volunteerName, C, 280, { font: "Times-BoldItalic", size, color: purple, align: "center" });
  pdf.line(C - 210, 295, C + 210, 295, { color: gold, lineWidth: 1 });

  const tasks = `${cert.tasksCompleted} task${cert.tasksCompleted === 1 ? "" : "s"}`;
  const body =
    `for volunteering in the campaign “${cert.campaignTitle}”` +
    (cert.organization ? `, organized by ${cert.organization}` : "") +
    (cert.location ? ` at ${cert.location}` : "") +
    ` from ${fmtDate(cert.startDate)} to ${fmtDate(cert.endDate)}, and successfully completing ${tasks} verified by the campaign manager.`;
  let y = 326;
  for (const line of pdf.wrap(body, "Times-Roman", 14.5, 600)) {
    pdf.text(line, C, y, { font: "Times-Roman", size: 14.5, color: "#2d2a3e", align: "center" });
    y += 21;
  }
  if (cert.avgRating) {
    pdf.text(`Average manager rating: ${cert.avgRating} / 5`, C, y + 6, { font: "Helvetica", size: 10, color: grey, align: "center" });
  }

  // Signatures
  const sigY = 478;
  pdf.text(cert.managerName || "Campaign Manager", 205, sigY - 10, { font: "Times-Italic", size: 15, color: ink, align: "center" });
  pdf.line(120, sigY, 290, sigY, { color: "#9a94b0", lineWidth: 0.8 });
  pdf.text("Campaign Manager", 205, sigY + 15, { font: "Helvetica", size: 9.5, color: grey, align: "center" });

  pdf.text(fmtDate(cert.issuedAt), 637, sigY - 10, { font: "Times-Italic", size: 15, color: ink, align: "center" });
  pdf.line(552, sigY, 722, sigY, { color: "#9a94b0", lineWidth: 0.8 });
  pdf.text("Verified by CampaignHub Admin", 637, sigY + 15, { font: "Helvetica", size: 9.5, color: grey, align: "center" });

  // Seal
  pdf.circle(C, 470, 44, { fill: violet });
  pdf.circle(C, 470, 38, { stroke: "#fde68a", lineWidth: 1 });
  pdf.text("VERIFIED", C, 467, { font: "Helvetica-Bold", size: 11, color: "#ffffff", align: "center", spacing: 1.5 });
  pdf.text("COMPLETED", C, 481, { font: "Helvetica", size: 6.5, color: "#fde68a", align: "center", spacing: 1.2 });
  pdf.text(String(new Date(cert.issuedAt).getFullYear()), C, 456, { font: "Helvetica", size: 6.5, color: "#fde68a", align: "center", spacing: 1.2 });

  pdf.text(`Certificate ID: ${cert.code}   ·   Verify at ${verifyUrl}`, C, 548, { font: "Helvetica", size: 8.5, color: "#7a7590", align: "center" });

  return pdf.toBuffer({ title: `Certificate - ${cert.volunteerName} - ${cert.campaignTitle}` });
}

module.exports = { issueForCampaign, certificatePdf, newCode };
