const router = require("express").Router();
const { getAlerts, markSeen } = require("../controllers/alertController");
const { auth } = require("../middleware/auth");

router.get("/", auth, getAlerts);
router.post("/seen", auth, markSeen);

module.exports = router;
