const router = require("express").Router();
const c = require("../controllers/certificateController");
const { auth, allowRoles } = require("../middleware/auth");

// PUBLIC — anyone (an employer, the university) can check a certificate ID
router.get("/verify/:code", c.verifyCertificate);

// Everything below needs a logged-in user
router.use(auth);
router.get("/mine", allowRoles("volunteer"), c.myCertificates);
router.get("/campaign/:id", allowRoles("manager", "admin"), c.campaignCertificates);
router.post("/campaign/:id/issue", allowRoles("admin"), c.issueCertificates);
router.get("/:id/pdf", c.downloadPdf);

module.exports = router;
