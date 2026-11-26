const router = require("express").Router();
const ai = require("../controllers/aiController");
const { auth, allowRoles, verifiedOnly } = require("../middleware/auth");

router.use(auth);

router.get("/status", ai.status);
router.post("/task-plan", allowRoles("manager"), ai.taskPlan);
router.post("/receipt", allowRoles("manager"), ai.scanReceipt);
router.get("/recommendations", allowRoles("volunteer"), verifiedOnly, ai.recommendations);
router.patch("/logs/:id", ai.setOutcome);

module.exports = router;
