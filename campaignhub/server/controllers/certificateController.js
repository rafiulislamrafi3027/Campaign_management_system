// =========================================================
// Certificates (Req 14)
// =========================================================

const mongoose = require("mongoose");
const Certificate = require("../models/Certificate");
const Campaign = require("../models/Campaign");
const { certificatePdf, issueForCampaign } = require("../services/certificates");
const { logAction } = require("../services/audit");

const serverError = (res, err) => {
  console.error(err);
  res.status(500).json({ message: "Server error" });
};

// Link printed on the certificate, e.g. http://localhost:5001/verify.html?code=CH-2026-7KQ4XM
const verifyUrl = (req, code) => `${process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`}/verify.html?code=${code}`;

// GET /api/certificates/mine  — volunteer
async function myCertificates(req, res) {
  try {
    const list = await Certificate.find({ volunteer: req.user._id }).sort({ issuedAt: -1 });
    res.json({ certificates: list });
  } catch (err) {
    serverError(res, err);
  }
}

// GET /api/certificates/campaign/:id  — the campaign's manager or the Admin
async function campaignCertificates(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Campaign not found" });
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    if (req.user.role === "manager" && String(campaign.manager) !== String(req.user._id)) {
      return res.status(404).json({ message: "Campaign not found" });
    }
    const list = await Certificate.find({ campaign: campaign._id }).sort({ volunteerName: 1 });
    res.json({ certificates: list });
  } catch (err) {
    serverError(res, err);
  }
}

// POST /api/certificates/campaign/:id/issue  — Admin
// For a completed campaign whose report the Admin verified (e.g. verified before certificates existed).
// Safe to press again: volunteers who already have a certificate are skipped.
async function issueCertificates(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Campaign not found" });
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    if (campaign.status !== "completed" || !campaign.completionReport || campaign.completionReport.status !== "approved") {
      return res.status(400).json({ message: "Certificates are issued only after the Admin verifies the completion report" });
    }
    const issued = await issueForCampaign(campaign, req.user._id);
    if (issued) await logAction(req, "certificate.issue", { type: "Campaign", id: campaign._id, label: campaign.title }, `${issued} certificate(s) issued manually`);
    res.json({ message: issued ? `${issued} certificate${issued === 1 ? "" : "s"} issued` : "Everyone who earned a certificate already has one", issued });
  } catch (err) {
    serverError(res, err);
  }
}

// GET /api/certificates/:id/pdf  — the volunteer, the campaign's manager, or the Admin
async function downloadPdf(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Certificate not found" });
    const cert = await Certificate.findById(req.params.id);
    if (!cert) return res.status(404).json({ message: "Certificate not found" });

    const me = String(req.user._id);
    let allowed = req.user.role === "admin" || String(cert.volunteer) === me;
    if (!allowed && req.user.role === "manager") {
      const campaign = await Campaign.findById(cert.campaign);
      allowed = campaign && String(campaign.manager) === me;
    }
    if (!allowed) return res.status(404).json({ message: "Certificate not found" });

    const pdf = certificatePdf(cert, verifyUrl(req, cert.code));
    const file = `Certificate-${cert.code}.pdf`;
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${file}"`, "Content-Length": pdf.length });
    res.send(pdf);
  } catch (err) {
    serverError(res, err);
  }
}

// GET /api/certificates/verify/:code  — PUBLIC: anyone can check if a certificate is real
async function verifyCertificate(req, res) {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!/^CH-\d{4}-[A-Z0-9]{6}$/.test(code)) {
      return res.status(400).json({ valid: false, message: "Certificate IDs look like CH-2026-7KQ4XM" });
    }
    const cert = await Certificate.findOne({ code });
    if (!cert) return res.status(404).json({ valid: false, message: "No certificate with this ID was found" });

    // Only what is printed on the certificate — no email or phone
    res.json({
      valid: true,
      certificate: {
        code: cert.code,
        volunteerName: cert.volunteerName,
        campaignTitle: cert.campaignTitle,
        category: cert.category,
        organization: cert.organization,
        location: cert.location,
        startDate: cert.startDate,
        endDate: cert.endDate,
        tasksCompleted: cert.tasksCompleted,
        issuedAt: cert.issuedAt,
      },
    });
  } catch (err) {
    serverError(res, err);
  }
}

module.exports = { myCertificates, campaignCertificates, issueCertificates, downloadPdf, verifyCertificate };
