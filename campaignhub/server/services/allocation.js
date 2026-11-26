// =========================================================
// Smart Task Allocation (Req 9 — Complex Engineering Problem)
//
// For a new task, every volunteer ACCEPTED in the campaign gets a score out of 100:
//
//   score = 50% Skill match
//         + 20% Availability match
//         + 15% Verified task completion rate
//         + 15% Average manager rating
//
// Each part is a number from 0 to 1, so the result is easy to explain in the viva.
// =========================================================

const WEIGHTS = { skill: 0.5, availability: 0.2, completion: 0.15, rating: 0.15 };
const OPEN_STATUSES = ["pending", "in_progress", "submitted", "revision_required"];

const lower = (list) => (list || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);

// ---------- 1) Skill match (0..1) ----------
// - Volunteer has the task's required skill            -> 1
// - Otherwise: share of the campaign's skills they have -> up to 0.5
function skillScore(volunteer, task, campaign) {
  const mine = lower(volunteer.skills);
  const wanted = String(task.requiredSkill || "").trim().toLowerCase();
  const campaignSkills = lower(campaign.requiredSkills);
  const overlap = campaignSkills.length ? campaignSkills.filter((s) => mine.includes(s)).length / campaignSkills.length : 0;

  if (wanted) return mine.includes(wanted) ? 1 : overlap * 0.5;
  return campaignSkills.length ? overlap : 0.5; // nothing to compare -> neutral
}

// ---------- 2) Availability match (0..1) ----------
// 70% "is the volunteer free on the days before the deadline?" + 30% "how busy are they already?"
// Bangladesh weekend = Friday (5) and Saturday (6).
function availabilityScore(volunteer, task, openTaskCount, today = new Date()) {
  const days = [];
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  const end = new Date(task.deadline);
  for (let i = 0; i < 31 && d <= end; i++) {
    days.push(d.getDay());
    d.setDate(d.getDate() + 1);
  }
  const hasWeekend = days.some((x) => x === 5 || x === 6);
  const hasWeekday = days.some((x) => x !== 5 && x !== 6);

  let fit;
  switch (String(volunteer.availability || "").toLowerCase()) {
    case "flexible": fit = 1; break;
    case "weekends": fit = hasWeekend ? 1 : 0.2; break;
    case "weekdays": fit = hasWeekday ? 1 : 0.2; break;
    case "evenings": fit = 0.8; break; // usually free in the evening of any day
    default: fit = 0.5; // not given
  }

  const workload = 1 / (1 + openTaskCount); // 0 open tasks -> 1, 1 -> 0.5, 3 -> 0.25
  return fit * 0.7 + workload * 0.3;
}

// ---------- 3) Verified completion rate (0..1) ----------
// Only tasks VERIFIED as completed by a manager count. New volunteers get a neutral 0.5.
function completionScore(stats) {
  if (!stats.assigned) return 0.5;
  return stats.completed / stats.assigned;
}

// ---------- 4) Rating (0..1) ----------
function ratingScore(volunteer) {
  return volunteer.avgRating ? volunteer.avgRating / 5 : 0.5; // not rated yet -> neutral
}

/**
 * Ranks the volunteers for a task.
 * @param {Object}   task       { requiredSkill, deadline }
 * @param {Object}   campaign   { requiredSkills }
 * @param {Object[]} volunteers accepted volunteers (plain objects with skills, availability, avgRating)
 * @param {Object[]} tasks      all existing tasks of these volunteers (any campaign) — { assignedTo, status }
 * @returns {Object[]} sorted best first: { volunteer, score, parts, reasons }
 */
function rankVolunteers(task, campaign, volunteers, tasks, today = new Date()) {
  // Pre-count each volunteer's tasks once: O(V + T) instead of O(V × T)
  const stats = {};
  for (const t of tasks) {
    const id = String(t.assignedTo && t.assignedTo._id ? t.assignedTo._id : t.assignedTo);
    const s = (stats[id] = stats[id] || { assigned: 0, completed: 0, open: 0 });
    s.assigned++;
    if (t.status === "completed") s.completed++;
    if (OPEN_STATUSES.includes(t.status)) s.open++;
  }

  return volunteers
    .map((v) => {
      const s = stats[String(v._id)] || { assigned: 0, completed: 0, open: 0 };
      const parts = {
        skill: skillScore(v, task, campaign),
        availability: availabilityScore(v, task, s.open, today),
        completion: completionScore(s),
        rating: ratingScore(v),
      };
      const score = Math.round(
        100 *
          (parts.skill * WEIGHTS.skill +
            parts.availability * WEIGHTS.availability +
            parts.completion * WEIGHTS.completion +
            parts.rating * WEIGHTS.rating)
      );

      const reasons = [];
      if (task.requiredSkill && parts.skill === 1) reasons.push(`Has "${task.requiredSkill}"`);
      if (s.open === 0) reasons.push("No open tasks");
      else reasons.push(`${s.open} open task${s.open > 1 ? "s" : ""}`);
      if (s.assigned) reasons.push(`${s.completed}/${s.assigned} tasks verified`);
      if (v.avgRating) reasons.push(`Rated ${v.avgRating.toFixed(1)}★`);

      return { volunteer: v, score, parts, reasons, stats: s };
    })
    .sort((a, b) => b.score - a.score || a.stats.open - b.stats.open);
}

module.exports = { rankVolunteers, WEIGHTS, skillScore, availabilityScore };
