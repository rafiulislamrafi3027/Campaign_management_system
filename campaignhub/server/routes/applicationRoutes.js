const router = require("express").Router();
const a = require("../controllers/applicationController");
const { auth, allowRoles, verifiedOnly } = require("../middleware/auth");

router.use(auth);

// Volunteer (must be verified by the Admin)
router.post("/", allowRoles("volunteer"), verifiedOnly, a.apply);
router.get("/mine", allowRoles("volunteer"), verifiedOnly, a.myApplications);
router.delete("/:id", allowRoles("volunteer"), verifiedOnly, a.withdraw);

// Manager
router.get("/manager", allowRoles("manager"), a.managerApplications);
router.patch("/:id/decision", allowRoles("manager"), a.decide);

module.exports = router;
