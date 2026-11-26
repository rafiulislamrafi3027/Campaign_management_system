// AI-Assisted Features (Req 18–22)
// AI only SUGGESTS. Nothing is saved until the user reviews it and clicks Save.

const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");
const Task = require("../models/Task");
const Application = require("../models/Application");
const Expense = require("../models/Expense");
const AiLog = require("../models/AiLog");
const { generateJSON, isConfigured, AiError } = require("../services/ai");

const DAY = 24 * 60 * 60 * 1000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

// Saves the AI log; never breaks the request if logging fails
async function log(req, feature, data) {
  try {
    const entry = await AiLog.create({ user: req.user._id, role: req.user.role, feature, ...data });
    return entry._id;
  } catch (e) {
    console.error("AI log failed:", e.message);
    return null;
  }
}

function aiFail(res, err) {
  if (err instanceof AiError) return res.status(503).json({ message: err.message, code: err.code, fallback: "manual" });
  console.error(err);
  return res.status(500).json({ message: "Server error" });
}

// GET /api/ai/status
function status(req, res) {
  res.json({ enabled: isConfigured(), model: isConfigured() ? process.env.GEMINI_MODEL || "gemini-3.5-flash-lite" : null });
}

// =========================================================
// (18) AI Task Planner — manager
// POST /api/ai/task-plan   body: { campaign }
// =========================================================
async function taskPlan(req, res) {
  const t0 = Date.now();
  try {
    if (!mongoose.isValidObjectId(req.body.campaign)) return res.status(404).json({ message: "Campaign not found" });
    const c = await Campaign.findOne({ _id: req.body.campaign, manager: req.user._id });
    if (!c) return res.status(404).json({ message: "Campaign not found" });
    if (c.status !== "active") return res.status(400).json({ message: "AI can plan tasks only for active campaigns" });

    const existing = await Task.find({ campaign: c._id });
    const accepted = await Application.find({ campaign: c._id, status: "accepted" }).populate("volunteer", "skills");
    const teamSkills = [...new Set(accepted.flatMap((a) => (a.volunteer && a.volunteer.skills) || []))];

    const today = startOfToday();
    const first = new Date(Math.max(today.getTime(), new Date(c.startDate).getTime()));
    const last = new Date(c.endDate);

    // Only campaign facts are sent — no names, emails or phone numbers (NFR 31)
    const prompt = `You are helping a volunteer campaign manager in Bangladesh plan the work for a social campaign.
Suggest between 4 and 8 practical tasks that volunteers can do for this campaign.

CAMPAIGN
- Title: ${c.title}
- Category: ${c.category}
- Goal / description: ${c.description}
- Location: ${c.location}
- Campaign dates: ${iso(c.startDate)} to ${iso(c.endDate)}
- Today: ${iso(today)}
- Expected beneficiaries: ${c.beneficiaries || "not given"}
- Volunteers needed: ${c.volunteersNeeded || "not given"}
- Skills the campaign needs: ${(c.requiredSkills || []).join(", ") || "not given"}
- Skills the accepted volunteers have: ${teamSkills.join(", ") || "unknown"}
- Tasks that already exist (do NOT repeat them): ${existing.map((t) => t.title).join("; ") || "none"}

RULES
- Each task must be one clear piece of work for one volunteer, with a short title (max 70 characters).
- The description says what to do and what PROOF the volunteer should submit (for example photos, a list, a link).
- requiredSkill must be ONE skill, preferably taken from the campaign's or the volunteers' skills.
- priority is "high" if the campaign cannot happen without it, "medium" if it is important, "low" if it is nice to have.
- deadline is a date between ${iso(first)} and ${iso(last)} in YYYY-MM-DD format. Preparation tasks come earlier.
- Write in simple English.

Answer ONLY with JSON in this exact shape:
{"tasks":[{"title":"","description":"","requiredSkill":"","priority":"high|medium|low","deadline":"YYYY-MM-DD"}]}`;

    const out = await generateJSON({ prompt });
    const raw = Array.isArray(out) ? out : out.tasks;
    if (!Array.isArray(raw) || !raw.length) throw new AiError("The AI did not suggest any tasks. Please try again.", "empty");

    // Clean every suggestion so a bad AI answer can never create bad data
    const seen = new Set(existing.map((t) => t.title.toLowerCase()));
    const tasks = [];
    for (const t of raw) {
      const title = String(t.title || "").trim().slice(0, 120);
      if (!title || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      let deadline = new Date(t.deadline);
      if (isNaN(deadline) || deadline < first) deadline = first;
      if (deadline > last) deadline = last;
      tasks.push({
        title,
        description: String(t.description || "").trim().slice(0, 2000),
        requiredSkill: String(t.requiredSkill || "").trim().slice(0, 40),
        priority: ["low", "medium", "high"].includes(String(t.priority).toLowerCase()) ? String(t.priority).toLowerCase() : "medium",
        deadline: iso(deadline),
      });
      if (tasks.length >= 8) break;
    }
    if (!tasks.length) throw new AiError("The AI only suggested tasks that already exist. Please try again.", "empty");

    const logId = await log(req, "task_planner", { ms: Date.now() - t0, meta: { campaign: c._id, suggestions: tasks.length } });
    res.json({ tasks, logId, tookMs: Date.now() - t0 });
  } catch (err) {
    await log(req, "task_planner", { ok: false, ms: Date.now() - t0, error: err.message });
    aiFail(res, err);
  }
}

// =========================================================
// (19) AI Receipt Scanner — manager
// POST /api/ai/receipt   body: { image: "data:image/jpeg;base64,..." }
// =========================================================
async function scanReceipt(req, res) {
  const t0 = Date.now();
  try {
    const m = /^data:(image\/jpeg|image\/png|application\/pdf);base64,(.+)$/.exec(String(req.body.image || ""));
    if (!m) return res.status(400).json({ message: "Send a JPG, PNG or PDF receipt" });
    const size = Math.floor((m[2].length * 3) / 4);
    if (size > 5 * 1024 * 1024) return res.status(400).json({ message: "The receipt is larger than 5 MB" });

    const today = iso(new Date());
    const prompt = `Read this shop receipt / invoice / money memo (it may be in Bangla or English, printed or handwritten).
Extract these fields. If a field cannot be read with confidence, use null — never guess.

- title: a short description of what was bought or paid for, in English (max 60 characters)
- amount: the TOTAL amount paid as a number (no currency symbol, no commas). Bangla digits must be converted to English digits.
- date: the receipt date as YYYY-MM-DD (it cannot be after ${today})
- vendor: the shop or company name
- category: exactly one of ${Expense.CATEGORIES.map((c) => `"${c}"`).join(", ")}

Answer ONLY with JSON: {"title":null,"amount":null,"date":null,"vendor":null,"category":null}`;

    const out = await generateJSON({ prompt, image: { mimeType: m[1], base64: m[2] }, maxOutputTokens: 1024 });

    // Check and clean the AI answer
    const fields = {};
    const amount = Number(String(out.amount ?? "").replace(/[^\d.]/g, ""));
    fields.amount = amount > 0 && amount < 10000000 ? Math.round(amount * 100) / 100 : null;
    const d = out.date ? new Date(out.date) : null;
    fields.date = d && !isNaN(d) && d <= new Date() && d > new Date(Date.now() - 365 * DAY) ? iso(d) : null;
    fields.title = out.title ? String(out.title).trim().slice(0, 120) : null;
    fields.vendor = out.vendor ? String(out.vendor).trim().slice(0, 120) : null;
    fields.category = Expense.CATEGORIES.includes(out.category) ? out.category : null;

    const found = Object.values(fields).filter((v) => v !== null).length;
    const logId = await log(req, "receipt_scanner", { ms: Date.now() - t0, meta: { fieldsFound: found } });
    res.json({ fields, logId, tookMs: Date.now() - t0 });
  } catch (err) {
    await log(req, "receipt_scanner", { ok: false, ms: Date.now() - t0, error: err.message });
    aiFail(res, err);
  }
}

// =========================================================
// (20) AI Campaign Recommendation — volunteer
// GET /api/ai/recommendations
// =========================================================
const recCache = new Map(); // userId -> { key, at, data } (saves AI calls; 30 minutes)

function skillFallback(user, campaigns) {
  const mine = (user.skills || []).map((s) => s.toLowerCase());
  return campaigns
    .map((c) => ({ c, match: (c.requiredSkills || []).filter((s) => mine.includes(s.toLowerCase())) }))
    .filter((x) => x.match.length)
    .sort((a, b) => b.match.length - a.match.length || new Date(a.c.startDate) - new Date(b.c.startDate))
    .slice(0, 3)
    .map((x) => ({ campaignId: String(x.c._id), reason: `Needs ${x.match.join(", ")}, which ${x.match.length > 1 ? "match" : "matches"} your skills.` }));
}

async function recommendations(req, res) {
  const t0 = Date.now();
  const user = req.user;
  try {
    const applied = await Application.find({ volunteer: user._id });
    const appliedIds = new Set(applied.map((a) => String(a.campaign)));
    const campaigns = (await Campaign.find({ status: "active" }).populate("manager", "organization name")).filter((c) => !appliedIds.has(String(c._id)));

    const build = (list, source) =>
      list
        .map((r) => {
          const c = campaigns.find((x) => String(x._id) === String(r.campaignId));
          if (!c) return null;
          return {
            campaign: { _id: c._id, title: c.title, category: c.category, location: c.location, startDate: c.startDate, endDate: c.endDate, requiredSkills: c.requiredSkills, organization: c.manager && (c.manager.organization || c.manager.name) },
            reason: String(r.reason || "").trim().slice(0, 200),
          };
        })
        .filter(Boolean)
        .slice(0, 3);

    if (!campaigns.length) return res.json({ items: [], source: "none" });

    const key = campaigns.map((c) => String(c._id)).sort().join(",") + "|" + (user.skills || []).join(",") + "|" + (user.availability || "");
    const cached = recCache.get(String(user._id));
    if (cached && cached.key === key && Date.now() - cached.at < 30 * 60 * 1000) return res.json({ ...cached.data, cached: true });

    if (!isConfigured()) {
      const data = { items: build(skillFallback(user, campaigns), "skills"), source: "skills", note: "AI is not set up — showing campaigns that match your skills." };
      return res.json(data);
    }

    // Only skills, availability and area are sent — no name, email or phone (NFR 31)
    const list = campaigns.slice(0, 30).map((c) => ({
      id: String(c._id),
      title: c.title,
      category: c.category,
      location: c.location,
      dates: `${iso(c.startDate)} to ${iso(c.endDate)}`,
      skillsNeeded: c.requiredSkills,
      about: String(c.description || "").slice(0, 300),
    }));
    const prompt = `Recommend up to 3 volunteer campaigns for this volunteer in Bangladesh.

VOLUNTEER
- Skills: ${(user.skills || []).join(", ") || "none listed"}
- Availability: ${user.availability || "not given"}
- Area: ${user.location || "not given"}

ACTIVE CAMPAIGNS (JSON)
${JSON.stringify(list)}

Choose the campaigns where this volunteer can help most: skills first, then nearby area, then dates that fit the availability.
Only recommend a campaign if it is a reasonable fit. For each one write ONE friendly sentence (max 25 words) that tells the volunteer why it fits them, mentioning the matching skill or area.
Use only ids from the list.

Answer ONLY with JSON: {"recommendations":[{"campaignId":"","reason":""}]}`;

    try {
      const out = await generateJSON({ prompt, maxOutputTokens: 1024 });
      const items = build(Array.isArray(out) ? out : out.recommendations || [], "ai");
      const data = { items, source: "ai" };
      recCache.set(String(user._id), { key, at: Date.now(), data });
      await log(req, "campaign_recommendation", { ms: Date.now() - t0, meta: { shown: items.length } });
      return res.json(data);
    } catch (err) {
      // Req 21: if AI fails, the volunteer still gets useful suggestions
      await log(req, "campaign_recommendation", { ok: false, source: "fallback", ms: Date.now() - t0, error: err.message });
      return res.json({ items: build(skillFallback(user, campaigns), "skills"), source: "skills", note: "AI is not available right now — showing campaigns that match your skills." });
    }
  } catch (err) {
    aiFail(res, err);
  }
}

// =========================================================
// (22) Record what the user did with a suggestion
// PATCH /api/ai/logs/:id   body: { outcome: "accepted" | "edited" | "rejected" }
// =========================================================
async function setOutcome(req, res) {
  try {
    const { outcome } = req.body;
    if (!["accepted", "edited", "rejected"].includes(outcome)) return res.status(400).json({ message: "Invalid outcome" });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Log not found" });
    const entry = await AiLog.findOne({ _id: req.params.id, user: req.user._id });
    if (!entry) return res.status(404).json({ message: "Log not found" });
    entry.outcome = outcome;
    await entry.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = { status, taskPlan, scanReceipt, recommendations, setOutcome };
