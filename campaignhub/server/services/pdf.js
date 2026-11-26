// =========================================================
// A very small PDF writer (one page, shapes + text) — no package needed.
//
// Uses the standard PDF fonts (Helvetica, Times) that every PDF reader has built in,
// so the file stays small (about 5 KB). Coordinates are in points (1/72 inch),
// measured from the TOP-LEFT corner to make layout easier.
// Note: standard fonts support English letters only (WinAnsi); other letters become "?".
// =========================================================

const WIDTHS = require("./pdfFontWidths");

// Unicode -> WinAnsi byte for the few special characters we use
const SPECIAL = { "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "©": 0xa9, "·": 0xb7 };

function toBytes(str) {
  const out = [];
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code < 127) out.push(code);
    else if (SPECIAL[ch]) out.push(SPECIAL[ch]);
    else if (ch === "\n" || ch === "\t") out.push(32);
    else out.push(63); // "?"
  }
  return out;
}

const rgb = (hex) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");
};
const n = (v) => Number(v.toFixed(2));

class SimplePdf {
  constructor(width = 842, height = 595) {
    this.W = width;
    this.H = height;
    this.ops = [];
    this.fonts = {}; // "Helvetica" -> "F1"
  }

  fontKey(name) {
    if (!WIDTHS[name]) throw new Error("Unknown font " + name);
    if (!this.fonts[name]) this.fonts[name] = "F" + (Object.keys(this.fonts).length + 1);
    return this.fonts[name];
  }

  // Width of a text in points
  width(str, font, size, spacing = 0) {
    const w = WIDTHS[font];
    const bytes = toBytes(str);
    return bytes.reduce((sum, b) => sum + (w[b] !== undefined ? w[b] : 500), 0) * (size / 1000) + spacing * bytes.length;
  }

  // Split text into lines that fit maxWidth
  wrap(str, font, size, maxWidth) {
    const lines = [];
    let line = "";
    for (const word of String(str).split(/\s+/).filter(Boolean)) {
      const test = line ? line + " " + word : word;
      if (this.width(test, font, size) <= maxWidth || !line) line = test;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  rect(x, y, w, h, { fill, stroke, lineWidth = 1 } = {}) {
    const o = [];
    if (fill) o.push(`${rgb(fill)} rg`);
    if (stroke) o.push(`${rgb(stroke)} RG ${lineWidth} w`);
    o.push(`${n(x)} ${n(this.H - y - h)} ${n(w)} ${n(h)} re ${fill && stroke ? "B" : fill ? "f" : "S"}`);
    this.ops.push(o.join(" "));
  }

  line(x1, y1, x2, y2, { color = "#000000", lineWidth = 1, dash } = {}) {
    this.ops.push(`${rgb(color)} RG ${lineWidth} w ${dash ? `[${dash.join(" ")}] 0 d` : "[] 0 d"} ${n(x1)} ${n(this.H - y1)} m ${n(x2)} ${n(this.H - y2)} l S [] 0 d`);
  }

  circle(cx, cy, r, { fill, stroke, lineWidth = 1 } = {}) {
    const k = 0.5523 * r, y = this.H - cy;
    const p = `${n(cx + r)} ${n(y)} m ${n(cx + r)} ${n(y + k)} ${n(cx + k)} ${n(y + r)} ${n(cx)} ${n(y + r)} c ${n(cx - k)} ${n(y + r)} ${n(cx - r)} ${n(y + k)} ${n(cx - r)} ${n(y)} c ${n(cx - r)} ${n(y - k)} ${n(cx - k)} ${n(y - r)} ${n(cx)} ${n(y - r)} c ${n(cx + k)} ${n(y - r)} ${n(cx + r)} ${n(y - k)} ${n(cx + r)} ${n(y)} c`;
    const o = [];
    if (fill) o.push(`${rgb(fill)} rg`);
    if (stroke) o.push(`${rgb(stroke)} RG ${lineWidth} w`);
    o.push(`${p} ${fill && stroke ? "B" : fill ? "f" : "S"}`);
    this.ops.push(o.join(" "));
  }

  // y = baseline measured from the top
  text(str, x, y, { font = "Helvetica", size = 12, color = "#000000", align = "left", spacing = 0 } = {}) {
    const w = this.width(str, font, size, spacing);
    const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    const hex = toBytes(str).map((b) => b.toString(16).padStart(2, "0")).join("");
    this.ops.push(`BT /${this.fontKey(font)} ${size} Tf ${rgb(color)} rg ${spacing} Tc ${n(left)} ${n(this.H - y)} Td <${hex}> Tj ET`);
    return w;
  }

  toBuffer({ title = "Document", author = "CampaignHub" } = {}) {
    const objs = [];
    const fontEntries = Object.entries(this.fonts);
    const fontStart = 6;
    const content = this.ops.join("\n");
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
    objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Contents 4 0 R /Resources << /Font << ${fontEntries.map(([, key], i) => `/${key} ${fontStart + i} 0 R`).join(" ")} >> >> >>`;
    objs[4] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
    const esc = (s) => String(s).replace(/[()\\]/g, "\\$&").replace(/[^\x20-\x7e]/g, "?");
    objs[5] = `<< /Title (${esc(title)}) /Author (${esc(author)}) /Producer (CampaignHub) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z) >>`;
    fontEntries.forEach(([name], i) => {
      objs[fontStart + i] = `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
    });

    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = Buffer.byteLength(out, "latin1");
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) out += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }
}

module.exports = { SimplePdf };
