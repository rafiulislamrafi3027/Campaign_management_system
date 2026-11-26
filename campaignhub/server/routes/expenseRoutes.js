const router = require("express").Router();
const e = require("../controllers/expenseController");
const { auth, allowRoles } = require("../middleware/auth");

router.use(auth);

// Admin — budget monitoring
router.get("/admin", allowRoles("admin"), e.adminSummary);
router.get("/admin/:campaignId", allowRoles("admin"), e.adminCampaignExpenses);

// Manager — own campaigns
router.get("/manager", allowRoles("manager"), e.managerExpenses);
router.post("/", allowRoles("manager"), e.createExpense);
router.put("/:id", allowRoles("manager"), e.updateExpense);
router.delete("/:id", allowRoles("manager"), e.deleteExpense);

module.exports = router;
