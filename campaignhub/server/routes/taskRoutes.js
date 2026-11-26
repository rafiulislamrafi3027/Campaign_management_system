const router = require("express").Router();
const t = require("../controllers/taskController");
const { auth, allowRoles, verifiedOnly } = require("../middleware/auth");

router.use(auth);

// Manager
router.get("/recommend", allowRoles("manager"), t.recommend);
router.get("/manager", allowRoles("manager"), t.managerTasks);
router.post("/", allowRoles("manager"), t.createTask);
router.put("/:id", allowRoles("manager"), t.updateTask);
router.delete("/:id", allowRoles("manager"), t.deleteTask);
router.patch("/:id/review", allowRoles("manager"), t.reviewTask);

// Volunteer
router.get("/mine", allowRoles("volunteer"), verifiedOnly, t.myTasks);
router.patch("/:id/start", allowRoles("volunteer"), verifiedOnly, t.startTask);
router.post("/:id/submit", allowRoles("volunteer"), verifiedOnly, t.submitProof);

module.exports = router;
