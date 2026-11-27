const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendResetCode, emailConfigured } = require("../services/mailer");
const { logAction } = require("../services/audit");

const AVAILABILITY = ["Weekends", "Weekdays", "Evenings", "Flexible"];

// Cleans a skills list: trims, removes empty/duplicate (case-insensitive), max 15 skills
function cleanSkills(list) {
  const arr = Array.isArray(list) ? list : String(list || "").split(",");
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const s = String(raw).trim().replace(/\s+/g, " ").slice(0, 40);
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out.slice(0, 15);
}

const hashCode = (code, userId) => crypto.createHash("sha256").update(`${code}:${userId}`).digest("hex");

function makeToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

// Data that is safe to send to the browser
function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    rejectionReason: user.rejectionReason,
    removalReason: user.removalReason,
    phone: user.phone,
    organization: user.organization,
    skills: user.skills,
    availability: user.availability,
    location: user.location,
    avgRating: user.avgRating || 0,
    createdAt: user.createdAt,
  };
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { name, email, password, role, phone, organization, skills, availability, location } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "Name, email, password and role are required" });
    }
    // Admin accounts cannot be created from the public register form
    if (!["manager", "volunteer"].includes(role)) {
      return res.status(400).json({ message: "Role must be manager or volunteer" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ message: "This email is already registered" });

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashed,
      role,
      // Volunteers must wait for Admin approval; managers are active immediately
      status: role === "volunteer" ? "pending" : "approved",
      phone,
      organization: role === "manager" ? organization : "",
      skills: role === "volunteer" ? cleanSkills(skills) : [],
      availability,
      location,
    });

    const message =
      role === "volunteer"
        ? "Registration submitted. You can use the platform after the Admin approves your account."
        : "Registration successful. You can log in now.";

    await logAction(req, "account.register", { type: "User", id: user._id, label: user.name }, `${role} · ${user.email}`, user);
    res.status(201).json({ message, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

// ---------- Login lock (NFR 25) ----------
// 5 wrong passwords for the same email from the same computer within 15 minutes
// -> that email is locked on that computer for 15 minutes. Stops password guessing.
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map(); // "email|ip" -> { count, first, lockedUntil }

function lockKey(req, email) {
  return `${String(email).toLowerCase()}|${req.ip || ""}`;
}
function lockedFor(key) {
  const f = fails.get(key);
  if (!f || !f.lockedUntil) return 0;
  const left = f.lockedUntil - Date.now();
  if (left <= 0) {
    fails.delete(key);
    return 0;
  }
  return left;
}
function addFail(key) {
  const now = Date.now();
  let f = fails.get(key);
  if (!f || now - f.first > LOCK_MS) f = { count: 0, first: now, lockedUntil: 0 };
  f.count++;
  if (f.count >= MAX_FAILS) f.lockedUntil = now + LOCK_MS;
  fails.set(key, f);
  if (fails.size > 5000) for (const [k, v] of fails) if (now - v.first > LOCK_MS) fails.delete(k); // keep memory small
  return f;
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });

    const key = lockKey(req, email);
    const wait = lockedFor(key);
    if (wait) {
      return res.status(429).json({ message: `Too many wrong passwords. Try again in ${Math.ceil(wait / 60000)} minute(s), or use "Forgot password".` });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    const ok = user ? await bcrypt.compare(password, user.password) : false;
    if (!ok) {
      const f = addFail(key);
      if (user) {
        await logAction(req, f.lockedUntil ? "account.login_locked" : "account.login_failed", { type: "User", id: user._id, label: user.name }, f.lockedUntil ? `Locked for 15 minutes after ${f.count} wrong passwords` : `Wrong password (${f.count}/${MAX_FAILS})`, user);
      }
      if (f.lockedUntil) {
        return res.status(429).json({ message: `Too many wrong passwords. This login is locked for 15 minutes. You can use "Forgot password".` });
      }
      const left = MAX_FAILS - f.count;
      return res.status(401).json({ message: `Wrong email or password${left <= 2 ? ` (${left} attempt${left === 1 ? "" : "s"} left)` : ""}` });
    }
    fails.delete(key);

    // Accounts removed by the Admin cannot log in; show them the reason (Req 17)
    if (user.status === "removed") {
      return res.status(403).json({
        message: `Your account was removed by the Admin. Reason: ${user.removalReason || "Not given"}`,
      });
    }

    // Pending/rejected volunteers can log in, but only to see their status (Req 1.6).
    // Other routes are protected by the verifiedOnly middleware.
    res.json({ token: makeToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

// POST /api/auth/logout — removes the private-files cookie (the token itself lives in the browser)
function logout(req, res) {
  res.append("Set-Cookie", "ch_files=; Path=/uploads; HttpOnly; SameSite=Strict; Max-Age=0");
  res.json({ message: "Logged out" });
}

// GET /api/auth/me
async function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

// PUT /api/auth/me  (Req 1.4 - update profile)
async function updateMe(req, res) {
  try {
    const u = req.user;
    const b = req.body;

    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (name.length < 2) return res.status(400).json({ message: "Name must be at least 2 characters" });
      u.name = name.slice(0, 80);
    }
    if (b.phone !== undefined) {
      const phone = String(b.phone).trim();
      if (phone && !/^[0-9+\-\s]{6,20}$/.test(phone)) return res.status(400).json({ message: "Please enter a valid phone number" });
      u.phone = phone;
    }
    if (b.location !== undefined) u.location = String(b.location).trim().slice(0, 100);

    if (u.role === "manager" && b.organization !== undefined) u.organization = String(b.organization).trim().slice(0, 120);

    if (u.role === "volunteer") {
      if (b.skills !== undefined) u.skills = cleanSkills(b.skills);
      if (b.availability !== undefined) {
        if (!AVAILABILITY.includes(b.availability)) return res.status(400).json({ message: "Invalid availability" });
        u.availability = b.availability;
      }
    }

    await u.save();
    res.json({ message: "Profile updated", user: publicUser(u) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

// PUT /api/auth/password   body: { currentPassword, newPassword }
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: "Both current and new password are required" });
    if (String(newPassword).length < 6) return res.status(400).json({ message: "New password must be at least 6 characters" });
    if (currentPassword === newPassword) return res.status(400).json({ message: "The new password must be different" });

    const user = await User.findById(req.user._id).select("+password");
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ message: "Your current password is wrong" });

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    await user.save();

    await logAction(req, "account.password_change", { type: "User", id: user._id, label: user.name });
    // Other devices are logged out; this one gets a fresh token
    res.json({ message: "Password changed", token: makeToken(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

// =========================================================
// FORGOT PASSWORD (6-digit code, valid 10 minutes)
// =========================================================

const SAME_REPLY = "If this email is registered, a 6-digit reset code has been sent.";
// Shown for EVERY email in development mode, so the reply never tells who is registered
const devHint = () =>
  emailConfigured() ? undefined : "Development mode: the code is shown in the server terminal (where npm run dev is running).";

// POST /api/auth/forgot   body: { email }
async function forgotPassword(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Enter your email" });

    const user = await User.findOne({ email }).select("+resetRequestedAt");

    // Same answer whether or not the email exists, so nobody can find out who is registered
    if (!user || user.status === "removed") return res.json({ message: SAME_REPLY, devHint: devHint() });

    // Wait 60 seconds between two codes
    if (user.resetRequestedAt && Date.now() - new Date(user.resetRequestedAt).getTime() < 60 * 1000) {
      return res.status(429).json({ message: "Please wait a minute before asking for a new code" });
    }

    const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
    user.resetCodeHash = hashCode(code, user._id);
    user.resetCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.resetAttempts = 0;
    user.resetRequestedAt = new Date();
    await user.save();

    const sent = await sendResetCode(user, code);
    const how = sent.mode === "console" ? "shown in server terminal" : sent.ok ? `sent by email (${sent.mode})` : `email failed: ${sent.error}`;
    await logAction(req, "account.reset_request", { type: "User", id: user._id, label: user.name }, `6-digit code ${how}`, user);
    res.json({ message: SAME_REPLY, devHint: devHint() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not send the code. Please try again." });
  }
}

// POST /api/auth/reset   body: { email, code, newPassword }
async function resetPassword(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!/^\d{6}$/.test(code)) return res.status(400).json({ message: "Enter the 6-digit code" });
    if (newPassword.length < 6) return res.status(400).json({ message: "New password must be at least 6 characters" });

    const user = await User.findOne({ email }).select("+password +resetCodeHash +resetCodeExpires +resetAttempts");
    const invalid = () => res.status(400).json({ message: "The code is wrong or has expired" });
    if (!user || !user.resetCodeHash || user.status === "removed") return invalid();

    if (!user.resetCodeExpires || new Date(user.resetCodeExpires) < new Date()) return invalid();
    if ((user.resetAttempts || 0) >= 5) {
      return res.status(400).json({ message: "Too many wrong tries. Please ask for a new code." });
    }

    if (hashCode(code, user._id) !== user.resetCodeHash) {
      user.resetAttempts = (user.resetAttempts || 0) + 1;
      await user.save();
      const left = 5 - user.resetAttempts;
      return res.status(400).json({ message: left > 0 ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Please ask for a new code." });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    user.resetCodeHash = undefined;
    user.resetCodeExpires = undefined;
    user.resetAttempts = 0;
    await user.save();

    for (const k of fails.keys()) if (k.startsWith(`${user.email}|`)) fails.delete(k); // unlock after a reset
    await logAction(req, "account.reset_done", { type: "User", id: user._id, label: user.name }, "", user);
    res.json({ message: "Password reset! You can log in with your new password." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = { register, login, me, updateMe, changePassword, forgotPassword, resetPassword, publicUser, cleanSkills, logout };
