const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Checks a JWT and returns { user, decoded } or { error }. Used for API calls and for private files.
async function userFromToken(token) {
  if (!token) return { error: "Please log in first" };
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return { error: "Invalid or expired token" };
  }
  const user = await User.findById(decoded.id);
  if (!user) return { error: "User not found" };
  if (user.status === "removed") return { error: "Your account was removed by the Admin" };
  // Log out old sessions after the password was changed or reset
  if (user.passwordChangedAt && decoded.iat && decoded.iat * 1000 < user.passwordChangedAt.getTime() - 1000) {
    return { error: "Your password was changed. Please log in again." };
  }
  return { user, decoded };
}

// Private files (NFR 25): the browser also keeps the login in a cookie that only the
// /uploads path can use and JavaScript cannot read (HttpOnly). A copied file link
// therefore opens only in the same browser while the same person is logged in.
const FILE_COOKIE = "ch_files";
function setFileCookie(req, res, token, decoded) {
  if (String(req.headers.cookie || "").includes(`${FILE_COOKIE}=${token}`)) return;
  // Same lifetime as the login token (no expiry in the token -> cookie lasts until the browser closes)
  const life = decoded.exp ? `; Max-Age=${Math.max(0, decoded.exp - Math.floor(Date.now() / 1000))}` : "";
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.append("Set-Cookie", `${FILE_COOKIE}=${token}; Path=/uploads; HttpOnly; SameSite=Strict${life}${secure}`);
}
function readCookie(req, name) {
  const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

// 1) Checks the JWT token and loads the logged-in user into req.user
async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const { user, decoded, error } = await userFromToken(token);
  if (error) return res.status(401).json({ message: error });
  req.user = user;
  setFileCookie(req, res, token, decoded);
  next();
}

// 2) Allows only the given roles, e.g. allowRoles("admin")  (Req 1.3 - RBAC)
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have permission for this action" });
    }
    next();
  };
}

// 3) Blocks volunteers who are not yet approved by the Admin (Req 1.6)
function verifiedOnly(req, res, next) {
  if (req.user.role === "volunteer" && req.user.status !== "approved") {
    return res.status(403).json({ message: "Your account is not verified by the Admin yet" });
  }
  next();
}

module.exports = { auth, allowRoles, verifiedOnly, userFromToken, readCookie, FILE_COOKIE };
