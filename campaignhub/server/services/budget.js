// =========================================================
// Budget Utilization Monitoring (Req 11 — Complex Engineering Problem)
//
//   Utilization Rate = Total logged expenses ÷ Approved budget × 100
//
//   below 80%   -> "ok"        (green)
//   80% – 100%  -> "warning"   (yellow: "Close to budget limit")
//   above 100%  -> "exceeded"  (red:    "Budget Exceeded")
// =========================================================

const WARNING_AT = 80;

function utilization(budget, spent) {
  const b = Number(budget) || 0;
  const s = Number(spent) || 0;
  const rate = b > 0 ? (s / b) * 100 : s > 0 ? Infinity : 0;
  let status = "ok";
  if (rate > 100) status = "exceeded";
  else if (rate >= WARNING_AT) status = "warning";
  return {
    budget: b,
    spent: s,
    remaining: b - s, // negative when over budget
    rate: Number.isFinite(rate) ? Math.round(rate * 10) / 10 : 999,
    status,
  };
}

// expenses: [{ campaign, amount, category }]  ->  { campaignId: { spent, byCategory: { cat: amount } } }
function totalsByCampaign(expenses) {
  const out = {};
  for (const e of expenses) {
    const id = String(e.campaign && e.campaign._id ? e.campaign._id : e.campaign);
    const t = (out[id] = out[id] || { spent: 0, count: 0, byCategory: {} });
    t.spent += e.amount;
    t.count++;
    t.byCategory[e.category] = (t.byCategory[e.category] || 0) + e.amount;
  }
  return out;
}

module.exports = { utilization, totalsByCampaign, WARNING_AT };
