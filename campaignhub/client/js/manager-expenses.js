const me = requireRole("manager");
if (me) {
  fillUserChip(me);
  renderSidebar("manager", "expenses");
}

const $ = (id) => document.getElementById(id);
const newBtn = $("newBtn");
newBtn.innerHTML = `${META_ICONS.plus}Add expense`;

let campaigns = [];
let expenses = [];
let categories = [];
let current = ""; // selected campaign id

async function load() {
  try {
    const data = await api("/expenses/manager");
    campaigns = data.campaigns;
    expenses = data.expenses;
    categories = data.categories;
    if (!current || !campaigns.find((c) => c._id === current)) {
      // Start with the campaign that needs attention most
      const order = { exceeded: 0, warning: 1, ok: 2 };
      const live = campaigns.filter((c) => c.canEdit).sort((a, b) => order[a.status] - order[b.status]);
      current = (live[0] || campaigns[0] || {})._id || "";
    }
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

function render() {
  renderSummary();
  const c = campaigns.find((x) => x._id === current);
  $("detail").classList.toggle("hidden", !c);
  newBtn.disabled = !c || !c.canEdit;
  newBtn.title = !c ? "No campaign" : !c.canEdit ? "Expenses are locked while the completion report is checked or after completion" : "";
  if (!c) return;

  $("campTitle").textContent = `${c.title} · ${c.campaignStatus === "completed" ? "Completed (expenses locked)" : c.campaignStatus === "completion_review" ? "Report under review (expenses locked)" : STATUS_LABEL[c.campaignStatus]}`;
  $("meter").innerHTML = budgetMeter(c);
  $("cats").innerHTML = categoryBars(c.byCategory);

  const list = expenses.filter((e) => e.campaign === c._id);
  $("listHint").textContent = `${list.length} entr${list.length === 1 ? "y" : "ies"} · total ${formatMoney(c.spent)}`;
  if (!list.length) {
    $("list").innerHTML = `
      <div class="empty-box">${ICONS.inbox}
        <h3>No expenses yet</h3>
        <p>Log each payment with a receipt so the Admin can see where the money went.</p>
        ${c.canEdit ? `<button class="btn btn-primary-grad" onclick="openForm()">${META_ICONS.plus}Add expense</button>` : ""}
      </div>`;
    return;
  }
  $("list").innerHTML = list
    .map(
      (e, i) => `
      <div class="exp-row" style="animation-delay:${i * 40}ms">
        <div class="exp-ico" style="background:${CATEGORY_COLORS[e.category] || "#94a3b8"}">${esc(e.category.slice(0, 2).toUpperCase())}</div>
        <div>
          <strong>${esc(e.title)}</strong>
          <small>${esc(e.category)} · ${formatDate(e.date)}${e.vendor ? " · " + esc(e.vendor) : ""}
            ${e.receipt && e.receipt.url ? ` · <a class="receipt-link" href="${esc(e.receipt.url)}" target="_blank" rel="noopener">${NAV_ICONS.file}Receipt</a>` : ` · <span style="color:#fcd34d">No receipt</span>`}</small>
          ${e.note ? `<small>${esc(e.note)}</small>` : ""}
        </div>
        <div class="exp-amt">${e.receipt && e.receipt.url && (e.receipt.type || "").startsWith("image/") ? `<a href="${esc(e.receipt.url)}" target="_blank" rel="noopener"><img class="receipt-thumb" src="${esc(e.receipt.url)}" alt="Receipt" /></a>` : ""}${formatMoney(e.amount)}</div>
        <div class="exp-actions">${
          c.canEdit
            ? `<button class="icon-btn" title="Edit" data-edit="${e._id}">${META_ICONS.edit}</button>
               <button class="icon-btn danger" title="Delete" data-del="${e._id}">${META_ICONS.trash}</button>`
            : ""
        }</div>
      </div>`
    )
    .join("");
}

function renderSummary() {
  const el = $("summary");
  if (!campaigns.length) {
    el.innerHTML = `
      <div class="empty-box">${ICONS.inbox}
        <h3>No approved campaigns yet</h3>
        <p>You can log expenses once the Admin approves a campaign.</p>
        <a class="btn btn-primary-grad" href="/manager/campaigns.html">Go to My Campaigns</a>
      </div>`;
    return;
  }
  el.innerHTML = campaigns
    .map(
      (c, i) => `
      <div class="item ${c._id === current ? "active" : ""}" data-camp="${c._id}" style="animation-delay:${i * 60}ms">
        <h4 title="${esc(c.title)}">${esc(c.title)}</h4>
        ${budgetMeter(c, { compact: true })}
      </div>`
    )
    .join("");
}

$("summary").addEventListener("click", (e) => {
  const item = e.target.closest("[data-camp]");
  if (!item) return;
  current = item.dataset.camp;
  render();
});

$("list").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-del]");
  if (edit) openForm(expenses.find((x) => x._id === edit.dataset.edit));
  if (del) {
    const x = expenses.find((y) => y._id === del.dataset.del);
    const ok = await confirmDialog({ title: "Delete expense?", text: `"${x.title}" (${formatMoney(x.amount)}) will be removed.`, okText: "Delete", danger: true });
    if (!ok) return;
    try {
      const data = await api(`/expenses/${x._id}`, { method: "DELETE" });
      toast(data.message);
      await load();
      loadAlerts();
    } catch (err) {
      toast(err.message, "error");
    }
  }
});

newBtn.addEventListener("click", () => openForm());

// ---------- Add / edit expense ----------
function openForm(existing = null) {
  const c = campaigns.find((x) => x._id === (existing ? existing.campaign : current));
  if (!c || !c.canEdit) return toast("Choose an approved or active campaign", "error");
  let receiptFile = null;
  let removeReceipt = false;
  let scanLogId = null;  // AI log of the last scan (Req 22)
  let aiFields = null;   // what the AI filled in
  let saved = false;

  const modal = openModal(
    `
    <h3>${existing ? "Edit expense" : "Add expense"} · <span class="muted" style="font-weight:600">${esc(c.title)}</span></h3>
    <p>${existing ? "Change the details and save." : "Log a payment for this campaign. Attach the receipt if you have it."}</p>
    <form id="expForm">
      <div class="form-grid">
        <div class="field full">
          <label for="x_title">What was it for? *</label>
          <input id="x_title" required maxlength="120" placeholder="e.g. 200 blankets" value="${esc(existing ? existing.title : "")}" />
        </div>
        <div class="field">
          <label for="x_amount">Amount (৳) *</label>
          <input id="x_amount" type="number" min="1" step="0.01" required placeholder="15000" value="${existing ? existing.amount : ""}" />
        </div>
        <div class="field">
          <label for="x_cat">Category</label>
          <select id="x_cat">${categories.map((k) => `<option ${(existing ? existing.category : "Purchase") === k ? "selected" : ""}>${esc(k)}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label for="x_date">Date *</label>
          <input id="x_date" type="date" required max="${toInputDate(new Date())}" value="${toInputDate(existing ? existing.date : new Date())}" />
        </div>
        <div class="field">
          <label for="x_vendor">Shop / vendor</label>
          <input id="x_vendor" maxlength="120" placeholder="e.g. Bongo Bazar" value="${esc(existing ? existing.vendor : "")}" />
        </div>
        <div class="field full">
          <label for="x_note">Note</label>
          <input id="x_note" maxlength="600" placeholder="Optional" value="${esc(existing ? existing.note : "")}" />
        </div>
        <div class="field full">
          <label>Receipt <span class="muted">(JPG, PNG or PDF · max 5 MB)</span></label>
          <div class="dropzone" id="drop" style="padding:16px">
            <div id="dropText">${
              existing && existing.receipt && existing.receipt.url
                ? `<div class="receipt-pv">${(existing.receipt.type || "").startsWith("image/") ? `<img src="${esc(existing.receipt.url)}" alt="Receipt" />` : `<span class="pdf-pv">${NAV_ICONS.file}PDF</span>`}
                   <span>Current: <a href="${esc(existing.receipt.url)}" target="_blank">${esc(existing.receipt.name || "receipt")}</a><br><small class="muted">click to replace</small></span></div>`
                : "Click to choose a receipt, or drag it here"
            }</div>
          </div>
          <input type="file" id="x_file" accept=".jpg,.jpeg,.png,.pdf" hidden />
          <div class="scan-row hidden" id="scanRow"><button type="button" class="btn btn-ai btn-sm" id="scanBtn">${AI_ICON}Scan receipt with AI</button></div>
          <div id="scanNote"></div>
          ${existing && existing.receipt && existing.receipt.url ? `<button type="button" class="link-like" id="rmReceipt" style="margin-top:6px;font-size:13px">Remove receipt</button>` : ""}
        </div>
      </div>
      <div id="preview" class="exp-preview"></div>
      <div id="xMsg" class="msg"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-light" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary-grad" id="xSave">${existing ? "Save changes" : META_ICONS.plus + "Add expense"}</button>
      </div>
    </form>`,
    { wide: true }
  );
  modal.querySelector("[data-close]").addEventListener("click", () => modal.close());
  modal.querySelector("#x_title").focus();

  // Live preview: what the budget will look like after this expense
  const amountEl = modal.querySelector("#x_amount");
  const previewEl = modal.querySelector("#preview");
  function preview() {
    const amt = Number(amountEl.value) || 0;
    const spent = c.spent - (existing ? existing.amount : 0) + amt;
    const rate = c.budget ? Math.round((spent / c.budget) * 1000) / 10 : 0;
    const status = rate > 100 ? "exceeded" : rate >= 80 ? "warning" : "ok";
    previewEl.className = `exp-preview ${status}`;
    previewEl.innerHTML = amt
      ? `After this: <b>${formatMoney(spent)}</b> of ${formatMoney(c.budget)} used (<b>${rate}%</b>)${status === "exceeded" ? ` — ⚠ this goes <b>${formatMoney(spent - c.budget)}</b> over the budget` : status === "warning" ? " — close to the limit" : ""}`
      : `Budget: ${formatMoney(c.budget)} · already spent ${formatMoney(c.spent - (existing ? existing.amount : 0))}`;
  }
  amountEl.addEventListener("input", preview);
  preview();

  const drop = modal.querySelector("#drop");
  const fileEl = modal.querySelector("#x_file");
  const setFile = (f) => {
    if (!f) return;
    if (!["image/jpeg", "image/png", "application/pdf"].includes(f.type)) return toast("Only JPG, PNG or PDF", "error");
    if (f.size > 5 * 1024 * 1024) return toast("The receipt is larger than 5 MB", "error");
    receiptFile = f;
    removeReceipt = false;
    const isImg = f.type.startsWith("image/");
    modal.querySelector("#scanRow").classList.remove("hidden");
    modal.querySelector("#scanNote").innerHTML = "";
    modal.querySelector("#dropText").innerHTML = `
      <div class="receipt-pv">
        ${isImg ? `<img src="${URL.createObjectURL(f)}" alt="Receipt preview" />` : `<span class="pdf-pv">${NAV_ICONS.file}PDF</span>`}
        <span>✓ ${esc(f.name)}<br><small class="muted">${Math.round(f.size / 1024)} KB · click to change</small></span>
      </div>`;
  };
  drop.addEventListener("click", (e) => { if (!e.target.closest("a")) fileEl.click(); });
  fileEl.addEventListener("change", () => setFile(fileEl.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); setFile(e.dataTransfer.files[0]); });
  // ---------- (19) AI Receipt Scanner ----------
  const FIELD_IDS = { title: "#x_title", amount: "#x_amount", date: "#x_date", vendor: "#x_vendor", category: "#x_cat" };
  modal.querySelector("#scanBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const note = modal.querySelector("#scanNote");
    if (!receiptFile) return;
    btn.disabled = true;
    btn.innerHTML = `${AI_ICON}Reading the receipt...`;
    note.innerHTML = "";
    Object.values(FIELD_IDS).forEach((id) => modal.querySelector(id).classList.remove("ai-filled", "ai-missing"));
    try {
      if (scanLogId) aiOutcome(scanLogId, "rejected"); // scanning again replaces the old suggestion
      const data = await api("/ai/receipt", { method: "POST", body: { image: await readAsDataURL(receiptFile) } });
      scanLogId = data.logId;
      aiFields = data.fields;
      const missing = [];
      for (const [key, id] of Object.entries(FIELD_IDS)) {
        const el = modal.querySelector(id);
        const v = data.fields[key];
        if (v === null || v === undefined || v === "") {
          if (key !== "category") { el.value = ""; }
          el.classList.add("ai-missing"); // Req 19: fields the AI could not read are left empty and highlighted
          missing.push(key);
        } else {
          el.value = v;
          el.classList.add("ai-filled");
        }
      }
      preview();
      note.className = missing.length ? "scan-note warn" : "scan-note";
      note.innerHTML = missing.length
        ? `✨ AI filled what it could read. Please fill the <b>yellow</b> field${missing.length > 1 ? "s" : ""} (${missing.join(", ")}) and check everything before saving.`
        : `✨ AI filled the form from the receipt in ${(data.tookMs / 1000).toFixed(1)}s. Please check the values before saving.`;
    } catch (err) {
      note.innerHTML = aiErrorBox(err.message, "You can type the expense details yourself — the receipt will still be attached.");
      note.className = "";
      note.querySelector("[data-retry]")?.addEventListener("click", () => btn.click());
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${AI_ICON}Scan again`;
    }
  });

  // Closing without saving = the AI suggestion was rejected
  const closeObs = new MutationObserver(() => {
    if (!document.body.contains(modal)) {
      closeObs.disconnect();
      if (scanLogId && !saved) aiOutcome(scanLogId, "rejected");
    }
  });
  closeObs.observe(document.body, { childList: true });

  modal.querySelector("#rmReceipt")?.addEventListener("click", (e) => {
    removeReceipt = true;
    receiptFile = null;
    e.currentTarget.remove();
    modal.querySelector("#dropText").textContent = "Receipt will be removed. Click to choose a new one.";
  });

  modal.querySelector("#expForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = modal.querySelector("#xSave");
    const msg = modal.querySelector("#xMsg");
    const body = {
      campaign: c._id,
      title: modal.querySelector("#x_title").value.trim(),
      amount: amountEl.value,
      category: modal.querySelector("#x_cat").value,
      date: modal.querySelector("#x_date").value,
      vendor: modal.querySelector("#x_vendor").value.trim(),
      note: modal.querySelector("#x_note").value.trim(),
    };
    if (!(Number(body.amount) > 0)) return showMessage(msg, "Amount must be greater than 0");
    btn.disabled = true;
    showMessage(msg, "");
    try {
      if (receiptFile) body.receipt = { name: receiptFile.name, data: await readAsDataURL(receiptFile) };
      else if (removeReceipt) body.receipt = null;
      const data = existing ? await api(`/expenses/${existing._id}`, { method: "PUT", body }) : await api("/expenses", { method: "POST", body });
      saved = true;
      if (scanLogId && aiFields) {
        const same = (k, v) => aiFields[k] === null || String(aiFields[k]) === String(v);
        const unchanged = same("title", body.title) && same("amount", Number(body.amount)) && same("date", body.date) && same("vendor", body.vendor) && same("category", body.category);
        aiOutcome(scanLogId, unchanged ? "accepted" : "edited");
      }
      toast(data.message, data.budget && data.budget.status === "exceeded" ? "error" : "success");
      modal.close();
      await load();
      loadAlerts();
    } catch (err) {
      showMessage(msg, err.message);
      btn.disabled = false;
    }
  });
}

load();
