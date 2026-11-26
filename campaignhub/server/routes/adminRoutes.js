const router = require("express").Router();
const { listVolunteers, reviewVolunteer, listManagers, removeManager, restoreManager } = require("../controllers/adminController");
const { getReports, getAudit, exportAudit } = require("../controllers/reportController");
const { auth, allowRoles } = require("../middleware/auth");

// Every route in this file needs a logged-in Admin
router.use(auth, allowRoles("admin"));

router.get("/volunteers", listVolunteers);
router.patch("/volunteers/:id", reviewVolunteer);

router.get("/managers", listManagers);
router.patch("/managers/:id/remove", removeManager);
router.patch("/managers/:id/restore", restoreManager);

// Reports (Req 4.4, 16) and the read-only audit log (Req 15, 22)
router.get("/reports", getReports);
router.get("/audit", getAudit);
router.get("/audit/export", exportAudit);

module.exports = router;
