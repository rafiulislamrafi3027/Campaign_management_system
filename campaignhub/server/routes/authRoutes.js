const router = require("express").Router();
const { register, login, logout, me, updateMe, changePassword, forgotPassword, resetPassword } = require("../controllers/authController");
const { auth } = require("../middleware/auth");

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", auth, me);
router.put("/me", auth, updateMe);
router.put("/password", auth, changePassword);

// Forgot password
router.post("/forgot", forgotPassword);
router.post("/reset", resetPassword);

module.exports = router;
