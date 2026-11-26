// Saves proof files that the browser sends as base64 "data URLs".
// No extra package is needed (no multer). Files go to server/uploads/proofs/ (task proof), server/uploads/receipts/ (expense receipts) or server/uploads/reports/ (completion report photos).
//
// Rules (NFR 23): only JPG, PNG or PDF, at most 5 MB each, at most 5 files.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_FILES = 5;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");

// Checks the first bytes of the file, so a renamed .exe cannot pass as a .jpg
const SIGNATURES = {
  "image/jpeg": { ext: ".jpg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: ".png", check: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "application/pdf": { ext: ".pdf", check: (b) => b.slice(0, 4).toString() === "%PDF" },
};

class FileError extends Error {}

// files: [{ name, data: "data:image/png;base64,...." }]
// returns: [{ url, name, type, size }]
// folder: "proofs" (task proof) or "receipts" (expense receipts)
function saveProofFiles(files = [], { folder = "proofs", maxFiles = MAX_FILES } = {}) {
  if (!Array.isArray(files)) throw new FileError("Invalid files");
  if (files.length > maxFiles) throw new FileError(`You can upload at most ${maxFiles} file${maxFiles === 1 ? "" : "s"}`);
  const UPLOAD_DIR = path.join(UPLOAD_ROOT, folder);

  // Check every file first, then save — so nothing is saved if one file is bad
  const ready = files.map((f) => {
    const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(f.data || ""));
    if (!m) throw new FileError(`"${f.name}" could not be read`);
    const type = m[1];
    const rule = SIGNATURES[type];
    if (!rule) throw new FileError(`"${f.name}": only JPG, PNG or PDF files are allowed`);
    const buffer = Buffer.from(m[2], "base64");
    if (buffer.length > MAX_SIZE) throw new FileError(`"${f.name}" is larger than 5 MB`);
    if (!rule.check(buffer)) throw new FileError(`"${f.name}" is not a real ${rule.ext.slice(1).toUpperCase()} file`);
    return { buffer, type, ext: rule.ext, name: String(f.name || "file").slice(0, 120) };
  });

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return ready.map((f) => {
    const fileName = crypto.randomBytes(12).toString("hex") + f.ext; // random name, hard to guess
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), f.buffer);
    return { url: `/uploads/${folder}/${fileName}`, name: f.name, type: f.type, size: f.buffer.length };
  });
}

module.exports = { saveProofFiles, FileError, MAX_FILES, MAX_SIZE };
