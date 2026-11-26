const admin = requireRole("admin");
if (admin) {
  fillUserChip(admin);
  renderSidebar("admin", "budgets");
}

const $ = (id) => document.getElementById(id);
const TABS = [
  { key: "all", label: "All" },
  { key: "exceeded", label: "Over budget" },
  { key: "warning", label: "Close to limit" },
  { key: "ok", label: "On track" },
];
let data = { totals: {}, campaigns: [], byCategory: {} };
let tab = "all";

async function load() {
  try {
    data = await api("/expenses/admin");
    const t = data.totals;
    $("sRequested").textContent = formatMoney(t.requestedBudget);
    $("sApproved").textContent = formatMoney(t.approvedBudget);
    $("sSpent").textContent = formatMoney(t.spent);
    $("sOver").textContent = t.exceeded;

    const rate = t.approvedBudget ? Math.round((t.spent / t.approvedBudget) * 1000) / 10 : 0;
    $("overall").innerHTML = budgetMeter({
      budget: t.approvedBudget,
      spent: t.spent,
      remaining: t.approvedBudget - t.spent,
      rate,
      status: rate > 100 ? "exceeded" : rate >= 80 ? "warning" : "ok",
    });
    $("cats").innerHTML = categoryBars(data.byCategory);
    renderTabs();
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderTabs() {
  const n = (k) => (k === "all" ? data.campaigns.length : data.campaigns.filter((c) => c.status === k).length);
  $("tabs").innerHTML = TABS.map((t) => `<button class="tab ${t.key === tab ? "active" : ""}" data-tab="${t.key}">${t.label} <span class="count">${n(t.key)}</span></button>`).join("");
}
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  renderTabs();
  render();
});

function render() {
  const order = { exceeded: 0, warning: 1, ok: 2 };
  const list = data.campaigns.filter((c) => tab === "all" || c.status === tab).sort((a, b) => order[a.status] - order[b.status] || b.rate - a.rate);
  if (!list.length) {
    $("rows").innerHTML = `<tr><td colspan="4" class="empty">${ICONS.inbox}<div>No campaigns here</div></td></tr>`;
    return;
  }
  $("rows").innerHTML = list
    .map(
      (c, i) => `
      <tr style="--i:${i}" class="${c.status === "exceeded" ? "row-exceeded" : ""}">
        <td><strong style="color:#fff">${esc(c.title)}</strong><br><small class="muted"><span class="badge ${c.campaignStatus}" style="margin-right:6px">${STATUS_LABEL[c.campaignStatus] || c.campaignStatus}</span>${formatDate(c.startDate)} – ${formatDate(c.endDate)} · ${c.expenseCount} expense${c.expenseCount === 1 ? "" : "s"}</small></td>
        <td>${c.manager ? `${esc(c.manager.name)}<br><small class="muted">${esc(c.manager.organization || "")}</small>` : "—"}</td>
        <td>${budgetMeter(c, { compact: true })}</td>
        <td class="right"><button class="btn btn-light btn-sm" data-id="${c._id}">${META_ICONS.eye}Expenses</button></td>
      </tr>`
    )
    .join("");
}

$("rows").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-id]");
  if (!b) return;
  try {
    const { campaign, expenses } = await api(`/expenses/admin/${b.dataset.id}`);
    openModal(
      `<h3>${esc(campaign.title)}</h3>
       <p>${campaign.manager ? esc(campaign.manager.name) + " · " + esc(campaign.manager.organization || "") : ""}</p>
       ${budgetMeter(campaign)}
       <p class="section-title">By category</p>
       ${categoryBars(campaign.byCategory)}
       <p class="section-title">All entries (${expenses.length})</p>
       ${
         expenses.length
           ? `<div class="exp-list">${expenses
               .map(
                 (x) => `
             <div class="exp-row">
               <div class="exp-ico" style="background:${CATEGORY_COLORS[x.category] || "#94a3b8"}">${esc(x.category.slice(0, 2).toUpperCase())}</div>
               <div><strong>${esc(x.title)}</strong>
                 <small>${esc(x.category)} · ${formatDate(x.date)}${x.vendor ? " · " + esc(x.vendor) : ""}
                 ${x.receipt && x.receipt.url ? ` · <a class="receipt-link" href="${esc(x.receipt.url)}" target="_blank" rel="noopener">${NAV_ICONS.file}Receipt</a>` : ` · <span style="color:#fcd34d">No receipt</span>`}</small></div>
               <div class="exp-amt">${formatMoney(x.amount)}</div><div></div>
             </div>`
               )
               .join("")}</div>`
           : `<p class="muted">No expenses logged yet.</p>`
       }`,
      { wide: true }
    );
  } catch (err) {
    toast(err.message, "error");
  }
});

load();
