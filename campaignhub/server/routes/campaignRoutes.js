const router = require("express").Router();
const c = require("../controllers/campaignController");
const { auth, allowRoles, verifiedOnly } = require("../middleware/auth");

// Every campaign route needs a logged-in user
router.use(auth);

// Volunteers (verified only) — browse active campaigns
router.get("/active", verifiedOnly, c.listActiveCampaigns);

// Admin — review campaigns
router.get("/admin", allowRoles("admin"), c.adminListCampaigns);
router.patch("/:id/review", allowRoles("admin"), c.reviewCampaign);
router.patch("/:id/remove", allowRoles("admin"), c.removeCampaign);
router.patch("/:id/restore", allowRoles("admin"), c.restoreCampaign);
router.delete("/:id/permanent", allowRoles("admin"), c.deleteCampaignPermanently);
router.get("/:id/completion/admin", allowRoles("admin"), c.adminGetCompletion);
router.patch("/:id/completion/review", allowRoles("admin"), c.reviewCompletion);

// Manager — own campaigns
router.get("/mine", allowRoles("manager"), c.getMyCampaigns);
router.post("/", allowRoles("manager"), c.createCampaign);
router.put("/:id", allowRoles("manager"), c.updateCampaign);
router.delete("/:id", allowRoles("manager"), c.deleteCampaign);
router.patch("/:id/submit", allowRoles("manager"), c.submitCampaign);
router.patch("/:id/activate", allowRoles("manager"), c.activateCampaign);
// Completion report (replaces the old "mark as completed" button)
router.get("/:id/completion", allowRoles("manager"), c.getCompletion);
router.post("/:id/completion", allowRoles("manager"), c.submitCompletion);

module.exports = router;
