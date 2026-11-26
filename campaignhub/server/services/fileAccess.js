// =========================================================
// Protected uploads (NFR 25)
//
// Proof photos, receipts and report photos are NOT public any more.
// A file can be opened only with a "signed link" that the server adds to the
// file URL when it sends data to a user who is allowed to see it:
//
//   /uploads/receipts/8f3a...jpg?exp=1764140400&sig=Qm9...
//
//   exp = when the link stops working (a few hours later)
//   sig = a secret stamp made with JWT_SECRET; changing the file name or exp breaks it
//
// The stamp is made for ONE user, and the file opens only if that same user is
// logged in in this browser (private cookie, see middleware/auth.js).
// So: no login -> the file does not open, even with a copied link.
// Another user cannot use your link, and a copied link stops working after a few hours.
// =========================================================

const crypto = require("crypto");
const { userFromToken, readCookie, FILE_COOKIE } = require("../middleware/auth");
const path = require("path");
const fs = require("fs");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const FILE_URL = /^\/uploads\/(proofs|receipts|reports)\/([a-f0-9]{24}\.(?:jpg|png|pdf))$/;
const HOUR = 3600;
const LIFETIME_HOURS = Number(process.env.FILE_LINK_HOURS) || 4;

const secret = () => process.env.JWT_SECRET || "dev-secret";
const stamp = (urlPath, exp, userId) => crypto.createHmac("sha256", secret()).update(`${urlPath}:${exp}:${userId}`).digest("base64url").slice(0, 32);

function signUrl(urlPath, userId) {
  // Round up to the hour so the same file gets the same link for a while (lets the browser cache it)
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.ceil(now / HOUR) * HOUR + (LIFETIME_HOURS - 1) * HOUR;
  return `${urlPath}?exp=${exp}&sig=${stamp(urlPath, exp, userId)}`;
}

// Walks any JSON answer and signs every upload URL inside it
function signDeep(value, userId) {
  if (typeof value === "string") return FILE_URL.test(value) ? signUrl(value, userId) : value;
  if (Array.isArray(value)) return value.map((v) => signDeep(v, userId));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = signDeep(v, userId);
    return out;
  }
  return value;
}

// Middleware for /api: every res.json() answer gets signed file links
function signUploadLinks(req, res, next) {
  const original = res.json.bind(res);
  res.json = (body) => {
    try {
      if (!req.user) return original(body); // public answers never contain private files
      const text = JSON.stringify(body);
      if (text && text.includes('"/uploads/')) return original(signDeep(JSON.parse(text), String(req.user._id)));
    } catch (e) {
      /* fall back to the unsigned body */
    }
    return original(body);
  };
  next();
}

function denied(res, status, title, text) {
  res.status(status).set("Content-Type", "text/html; charset=utf-8").send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b1a;color:#e5e7eb;font-family:system-ui,sans-serif}
div{max-width:420px;text-align:center;padding:32px;border:1px solid #2a2a44;border-radius:18px;background:#141428}h1{font-size:20px;color:#fff}p{color:#a5a5c0;line-height:1.6}a{color:#67e8f9}</style></head>
<body><div><h1>🔒 ${title}</h1><p>${text}</p><p><a href="/index.html">Go to login</a></p></div></body></html>`);
}

// GET /uploads/:folder/:file?exp=&sig=
async function serveUpload(req, res) {
  const urlPath = `/uploads/${req.params.folder}/${req.params.file}`;
  if (!FILE_URL.test(urlPath)) return denied(res, 404, "File not found", "This file does not exist.");

  const exp = Number(req.query.exp);
  const sig = String(req.query.sig || "");
  if (!exp || !sig) {
    return denied(res, 401, "Login required", "Files in CampaignHub are private. Log in and open the file from inside the app.");
  }
  // Who is logged in in this browser?
  const { user } = await userFromToken(readCookie(req, FILE_COOKIE));
  if (!user) {
    return denied(res, 401, "Login required", "Files in CampaignHub are private. Log in and open the file from inside the app.");
  }
  const expected = stamp(urlPath, exp, String(user._id));
  const valid = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) return denied(res, 403, "Not your link", "This file link was made for another account, or it was changed. Open the file from inside the app.");
  if (exp < Math.floor(Date.now() / 1000)) {
    return denied(res, 403, "Link expired", "For safety, file links stop working after a few hours. Refresh the page in the app and open the file again.");
  }

  const filePath = path.join(UPLOAD_DIR, req.params.folder, req.params.file);
  if (!fs.existsSync(filePath)) return denied(res, 404, "File not found", "This file does not exist any more.");
  res.sendFile(filePath, {
    headers: {
      Vary: "Cookie",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
    },
  });
}

module.exports = { signUrl, signDeep, signUploadLinks, serveUpload };
