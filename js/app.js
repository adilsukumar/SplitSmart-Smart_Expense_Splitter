// ===== INIT SUPABASE =====
const { createClient } = supabase;
const db = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// ===== STATE =====
let currentGroup = null;
let members = [];
let expenses = [];
let settlements = [];
let splitType = "equal";
let realtimeChannel = null;

// ===== DOM HELPERS =====
const $ = (id) => document.getElementById(id);
const showView = (id) => {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $(id).classList.add("active");
};

function showToast(msg, type = "success") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => (t.className = "toast"), 3000);
}

function showLoading(text = "Loading...") {
  $("loadingText").textContent = text;
  $("loadingOverlay").style.display = "flex";
}

function hideLoading() {
  $("loadingOverlay").style.display = "none";
}

function emptyState(icon, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${text}</p></div>`;
}

// ===== LANDING PAGE =====
async function loadRecentGroups() {
  const saved = JSON.parse(localStorage.getItem("recentGroups") || "[]");
  if (!saved.length) return;

  const { data } = await db.from("expense_groups").select("*").in("id", saved).order("created_at", { ascending: false });
  if (!data?.length) return;

  $("recentGroupsCard").style.display = "block";
  $("recentGroupsList").innerHTML = data
    .map(
      (g) => `
    <div class="group-list-item" onclick="openGroup('${g.id}', '${g.name.replace(/'/g, "\\'")}')">
      <div>
        <div class="group-list-name">📁 ${g.name}</div>
        <div class="group-list-meta">${new Date(g.created_at).toLocaleDateString()}</div>
      </div>
      <span style="color:var(--text-muted)">→</span>
    </div>`
    )
    .join("");
}

$("createGroupBtn").addEventListener("click", async () => {
  const name = $("newGroupName").value.trim();
  if (!name) return showToast("Enter a group name", "error");

  showLoading("Creating group...");
  const { data, error } = await db.from("expense_groups").insert({ name }).select().single();
  hideLoading();

  if (error) return showToast("Error creating group", "error");

  saveRecentGroup(data.id);
  showToast(`Group "${name}" created!`);
  openGroup(data.id, data.name);
});

$("newGroupName").addEventListener("keydown", (e) => e.key === "Enter" && $("createGroupBtn").click());

function saveRecentGroup(id) {
  const saved = JSON.parse(localStorage.getItem("recentGroups") || "[]");
  if (!saved.includes(id)) saved.unshift(id);
  localStorage.setItem("recentGroups", JSON.stringify(saved.slice(0, 10)));
}

// ===== OPEN GROUP =====
async function openGroup(groupId, groupName) {
  showLoading("Loading group...");
  currentGroup = { id: groupId, name: groupName };
  saveRecentGroup(groupId);

  await Promise.all([fetchMembers(), fetchExpenses(), fetchSettlements()]);

  $("groupTitle").textContent = groupName;
  $("groupMeta").textContent = `${members.length} members · ${expenses.length} expenses`;
  $("shareGroupBtn").style.display = "inline-flex";

  renderAll();
  subscribeRealtime();
  switchTab("expenses");
  showView("groupView");
  hideLoading();
}

$("backBtn").addEventListener("click", () => {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  showView("landingView");
  $("shareGroupBtn").style.display = "none";
  loadRecentGroups();
});

// ===== SHARE GROUP =====
$("shareGroupBtn").addEventListener("click", () => {
  const url = `${location.origin}${location.pathname}?group=${currentGroup.id}&name=${encodeURIComponent(currentGroup.name)}`;
  navigator.clipboard.writeText(url).then(() => showToast("Link copied to clipboard! 🔗"));
});

// ===== CHECK URL PARAMS (join via link) =====
function checkUrlParams() {
  const params = new URLSearchParams(location.search);
  const groupId = params.get("group");
  const groupName = params.get("name");
  if (groupId && groupName) {
    history.replaceState({}, "", location.pathname);
    openGroup(groupId, decodeURIComponent(groupName));
  }
}

// ===== FETCH DATA =====
async function fetchMembers() {
  const { data } = await db.from("members").select("*").eq("group_id", currentGroup.id).order("created_at");
  members = data || [];
}

async function fetchExpenses() {
  const { data } = await db
    .from("expenses")
    .select("*, expense_splits(*)")
    .eq("group_id", currentGroup.id)
    .order("created_at", { ascending: false });
  expenses = data || [];
}

async function fetchSettlements() {
  const { data } = await db
    .from("settlements")
    .select("*")
    .eq("group_id", currentGroup.id)
    .order("settled_at", { ascending: false });
  settlements = data || [];
}

// ===== REALTIME =====
function subscribeRealtime() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  realtimeChannel = db
    .channel(`group-${currentGroup.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `group_id=eq.${currentGroup.id}` }, async () => {
      await fetchMembers();
      renderAll();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "expenses", filter: `group_id=eq.${currentGroup.id}` }, async () => {
      await fetchExpenses();
      renderAll();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "settlements", filter: `group_id=eq.${currentGroup.id}` }, async () => {
      await fetchSettlements();
      renderAll();
    })
    .subscribe();
}

// ===== RENDER ALL =====
function renderAll() {
  renderMembers();
  renderMemberSelects();
  renderExpenses();
  renderBalances();
  renderSettlements();
  renderCategoryBreakdown();
  renderTopSpenders();
  $("groupMeta").textContent = `${members.length} members · ${expenses.length} expenses`;
}

// ===== MEMBERS =====
function renderMembers() {
  if (!members.length) {
    $("membersList").innerHTML = `<span class="muted">No members yet</span>`;
    return;
  }
  $("membersList").innerHTML = members
    .map((m) => `<div class="member-chip"><div class="avatar">${m.name[0].toUpperCase()}</div>${m.name}</div>`)
    .join("");
}

function renderMemberSelects() {
  const options = members.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
  $("paidBy").innerHTML = options || `<option disabled>Add members first</option>`;
  $("settleFrom").innerHTML = options || `<option disabled>Add members first</option>`;
  $("settleTo").innerHTML = options || `<option disabled>Add members first</option>`;
  renderCustomSplitInputs();
}

$("addMemberBtn").addEventListener("click", async () => {
  const name = $("newMemberName").value.trim();
  if (!name) return showToast("Enter a member name", "error");
  if (members.find((m) => m.name.toLowerCase() === name.toLowerCase())) return showToast("Member already exists", "error");

  const { error } = await db.from("members").insert({ group_id: currentGroup.id, name });
  if (error) return showToast("Error adding member", "error");

  $("newMemberName").value = "";
  showToast(`${name} added!`);
});

$("newMemberName").addEventListener("keydown", (e) => e.key === "Enter" && $("addMemberBtn").click());

// ===== SPLIT TYPE TOGGLE =====
document.querySelectorAll(".split-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".split-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    splitType = btn.dataset.split;
    $("customSplitSection").style.display = splitType === "custom" ? "block" : "none";
    renderCustomSplitInputs();
  });
});

function renderCustomSplitInputs() {
  if (splitType !== "custom") return;
  $("customSplitInputs").innerHTML = members
    .map(
      (m) => `
    <div class="input-row" style="margin-bottom:8px">
      <label style="min-width:100px;display:flex;align-items:center;font-size:0.85rem;color:var(--text-secondary)">${m.name}</label>
      <input type="number" class="custom-split-input" data-member="${m.id}" placeholder="0.00" min="0" step="0.01" oninput="updateSplitRemaining()" />
    </div>`
    )
    .join("");
}

function updateSplitRemaining() {
  const total = parseFloat($("expenseAmount").value) || 0;
  const entered = [...document.querySelectorAll(".custom-split-input")].reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
  const remaining = total - entered;
  $("splitRemaining").textContent = `₹${remaining.toFixed(2)}`;
  $("splitRemaining").style.color = Math.abs(remaining) < 0.01 ? "var(--green-primary)" : "var(--red)";
}

$("expenseAmount").addEventListener("input", updateSplitRemaining);

// ===== AI CATEGORIZATION =====
let categoryDebounce;
$("expenseDesc").addEventListener("input", () => {
  clearTimeout(categoryDebounce);
  const desc = $("expenseDesc").value.trim();
  if (!desc) { $("categoryBadge").textContent = "🏷️ —"; return; }
  $("categoryBadge").textContent = "🏷️ ...";
  categoryDebounce = setTimeout(() => categorizeExpense(desc), 800);
});

async function categorizeExpense(description) {
  const category = await geminiCategorize(description);
  $("categoryBadge").textContent = `🏷️ ${category}`;
  $("categoryBadge").dataset.category = category;
}

// ===== ADD EXPENSE =====
$("addExpenseBtn").addEventListener("click", async () => {
  const desc = $("expenseDesc").value.trim();
  const amount = parseFloat($("expenseAmount").value);
  const paidBy = $("paidBy").value;
  const category = $("categoryBadge").dataset.category || "General";

  if (!desc) return showToast("Enter a description", "error");
  if (!amount || amount <= 0) return showToast("Enter a valid amount", "error");
  if (!paidBy) return showToast("Select who paid", "error");
  if (!members.length) return showToast("Add members first", "error");

  let splits = [];

  if (splitType === "equal") {
    const share = amount / members.length;
    splits = members.map((m) => ({ member_id: m.id, amount: parseFloat(share.toFixed(2)) }));
  } else {
    const inputs = [...document.querySelectorAll(".custom-split-input")];
    splits = inputs.map((i) => ({ member_id: i.dataset.member, amount: parseFloat(i.value) || 0 }));
    const total = splits.reduce((s, i) => s + i.amount, 0);
    if (Math.abs(total - amount) > 0.01) return showToast("Custom splits must add up to total amount", "error");
  }

  showLoading("Adding expense...");
  const { data: expense, error } = await db
    .from("expenses")
    .insert({ group_id: currentGroup.id, description: desc, amount, paid_by: paidBy, split_type: splitType, category })
    .select()
    .single();

  if (error) { hideLoading(); return showToast("Error adding expense", "error"); }

  const splitsWithExpense = splits.map((s) => ({ ...s, expense_id: expense.id }));
  await db.from("expense_splits").insert(splitsWithExpense);

  hideLoading();
  $("expenseDesc").value = "";
  $("expenseAmount").value = "";
  $("categoryBadge").textContent = "🏷️ —";
  delete $("categoryBadge").dataset.category;
  showToast("Expense added! 💳");
});

// ===== RENDER EXPENSES =====
function renderExpenses() {
  const filter = $("categoryFilter").value;
  const filtered = filter ? expenses.filter((e) => e.category === filter) : expenses;

  if (!filtered.length) {
    $("expensesList").innerHTML = emptyState("💳", "No expenses yet. Add one above!");
    return;
  }

  $("expensesList").innerHTML = filtered
    .map((e) => {
      const payer = members.find((m) => m.id === e.paid_by)?.name || "Unknown";
      const date = new Date(e.created_at).toLocaleDateString();
      return `
      <div class="expense-item">
        <div class="expense-top">
          <span class="expense-desc">${e.description}</span>
          <span class="expense-amount">₹${parseFloat(e.amount).toFixed(2)}</span>
        </div>
        <div class="expense-meta">
          <span class="muted">Paid by <strong style="color:var(--text-secondary)">${payer}</strong></span>
          <span class="category-tag">${categoryEmoji(e.category)} ${e.category}</span>
          <span class="muted">${e.split_type} split · ${date}</span>
        </div>
        <div class="expense-actions">
          <button class="btn btn-danger" onclick="deleteExpense('${e.id}')">🗑 Delete</button>
        </div>
      </div>`;
    })
    .join("");
}

$("categoryFilter").addEventListener("change", renderExpenses);

async function deleteExpense(id) {
  if (!confirm("Delete this expense?")) return;
  showLoading("Deleting...");
  await db.from("expenses").delete().eq("id", id);
  hideLoading();
  showToast("Expense deleted");
}

// ===== BALANCE CALCULATION =====
function calculateBalances() {
  const balances = {};
  members.forEach((m) => (balances[m.id] = 0));

  expenses.forEach((e) => {
    // payer gets credited
    balances[e.paid_by] = (balances[e.paid_by] || 0) + parseFloat(e.amount);
    // each split member gets debited
    (e.expense_splits || []).forEach((s) => {
      balances[s.member_id] = (balances[s.member_id] || 0) - parseFloat(s.amount);
    });
  });

  // apply settlements: from_member paid cash so their debt reduces (balance goes up)
  // to_member received cash so what they're owed reduces (balance goes down)
  settlements.forEach((s) => {
    balances[s.from_member] = (balances[s.from_member] || 0) + parseFloat(s.amount);
    balances[s.to_member] = (balances[s.to_member] || 0) - parseFloat(s.amount);
  });

  return balances;
}

function simplifyDebts(balances) {
  const creditors = [], debtors = [];
  Object.entries(balances).forEach(([id, bal]) => {
    if (bal > 0.01) creditors.push({ id, amount: bal });
    else if (bal < -0.01) debtors.push({ id, amount: -bal });
  });

  const debts = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    debts.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }
  return debts;
}

function renderBalances() {
  const balances = calculateBalances();

  if (!members.length) {
    $("balancesList").innerHTML = emptyState("⚖️", "Add members to see balances");
    $("debtsList").innerHTML = "";
    return;
  }

  $("balancesList").innerHTML = members
    .map((m) => {
      const bal = balances[m.id] || 0;
      const cls = bal > 0.01 ? "positive" : bal < -0.01 ? "negative" : "zero";
      const label = bal > 0.01 ? "gets back" : bal < -0.01 ? "owes" : "settled";
      return `
      <div class="balance-item">
        <div class="balance-name">
          <div class="member-chip" style="display:inline-flex">
            <div class="avatar">${m.name[0].toUpperCase()}</div>${m.name}
          </div>
        </div>
        <div>
          <span class="balance-amount ${cls}">₹${Math.abs(bal).toFixed(2)}</span>
          <span class="muted" style="margin-left:6px">${label}</span>
        </div>
      </div>`;
    })
    .join("");

  const debts = simplifyDebts(balances);
  if (!debts.length) {
    $("debtsList").innerHTML = emptyState("🎉", "All settled up!");
    return;
  }

  $("debtsList").innerHTML = debts
    .map((d) => {
      const from = members.find((m) => m.id === d.from)?.name || "?";
      const to = members.find((m) => m.id === d.to)?.name || "?";
      return `
      <div class="debt-item">
        <div class="debt-text"><strong>${from}</strong> owes <strong>${to}</strong></div>
        <span class="debt-amount">₹${d.amount.toFixed(2)}</span>
      </div>`;
    })
    .join("");
}

// ===== SETTLEMENTS =====
$("settleBtn").addEventListener("click", async () => {
  const from = $("settleFrom").value;
  const to = $("settleTo").value;
  const amount = parseFloat($("settleAmount").value);

  if (!from || !to) return showToast("Select both members", "error");
  if (from === to) return showToast("Cannot settle with yourself", "error");
  if (!amount || amount <= 0) return showToast("Enter a valid amount", "error");

  showLoading("Recording settlement...");
  const { error } = await db.from("settlements").insert({ group_id: currentGroup.id, from_member: from, to_member: to, amount });
  hideLoading();

  if (error) return showToast("Error recording settlement", "error");

  $("settleAmount").value = "";
  showToast("Settlement recorded! ✅");
});

function renderSettlements() {
  if (!settlements.length) {
    $("settlementHistory").innerHTML = emptyState("📜", "No settlements yet");
    return;
  }

  $("settlementHistory").innerHTML = settlements
    .map((s) => {
      const from = members.find((m) => m.id === s.from_member)?.name || "?";
      const to = members.find((m) => m.id === s.to_member)?.name || "?";
      const date = new Date(s.settled_at).toLocaleDateString();
      return `
      <div class="settlement-item">
        <span class="settlement-text">💸 <strong>${from}</strong> paid <strong>${to}</strong> · ${date}</span>
        <span class="settlement-amount">₹${parseFloat(s.amount).toFixed(2)}</span>
      </div>`;
    })
    .join("");
}

// ===== CATEGORY BREAKDOWN =====
function renderCategoryBreakdown() {
  if (!expenses.length) {
    $("categoryBreakdown").innerHTML = emptyState("📊", "No expenses to analyze");
    return;
  }

  const cats = {};
  expenses.forEach((e) => {
    cats[e.category] = (cats[e.category] || 0) + parseFloat(e.amount);
  });

  const total = Object.values(cats).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);

  $("categoryBreakdown").innerHTML = sorted
    .map(([cat, amt]) => {
      const pct = ((amt / total) * 100).toFixed(1);
      return `
      <div class="category-bar-item">
        <div class="category-bar-label">
          <span>${categoryEmoji(cat)} ${cat}</span>
          <span>₹${amt.toFixed(2)} (${pct}%)</span>
        </div>
        <div class="category-bar-track">
          <div class="category-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
    })
    .join("");
}

// ===== TOP SPENDERS =====
function renderTopSpenders() {
  if (!expenses.length || !members.length) {
    $("topSpenders").innerHTML = emptyState("🏆", "No data yet");
    return;
  }

  const spent = {};
  members.forEach((m) => (spent[m.id] = 0));
  expenses.forEach((e) => {
    spent[e.paid_by] = (spent[e.paid_by] || 0) + parseFloat(e.amount);
  });

  const sorted = members
    .map((m) => ({ name: m.name, amount: spent[m.id] || 0 }))
    .sort((a, b) => b.amount - a.amount);

  $("topSpenders").innerHTML = sorted
    .map((s, i) => `
      <div class="spender-item">
        <div class="spender-rank">${i + 1}</div>
        <div class="spender-name">${s.name}</div>
        <div class="spender-amount">₹${s.amount.toFixed(2)}</div>
      </div>`)
    .join("");
}

// ===== GEMINI AI =====
async function geminiCategorize(description) {
  const valid = ["Food", "Travel", "Rent", "Entertainment", "Shopping", "Utilities", "General"];
  try {
    const res = await fetch(CONFIG.GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: CONFIG.GROQ_MODEL,
        messages: [
          { role: "system", content: "You are an expense categorizer. Reply with ONLY one word from the given list. No punctuation, no explanation." },
          { role: "user", content: `Categorize this expense into exactly ONE word from: Food, Travel, Rent, Entertainment, Shopping, Utilities, General.\nExpense: "${description}"` }
        ],
        max_tokens: 10,
        temperature: 0
      })
    });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const cleaned = raw.replace(/[^a-zA-Z]/g, "").trim();
    const match = valid.find((v) => v.toLowerCase() === cleaned.toLowerCase());
    return match || "General";
  } catch {
    return "General";
  }
}

$("generateInsightsBtn").addEventListener("click", async () => {
  if (!expenses.length) return showToast("Add some expenses first", "error");

  $("generateInsightsBtn").disabled = true;
  $("generateInsightsBtn").textContent = "⏳ Analyzing...";
  $("insightsOutput").className = "insights-output";
  $("insightsOutput").textContent = "Analyzing your group's spending patterns...";

  const balances = calculateBalances();
  const debts = simplifyDebts(balances);

  const summary = {
    totalExpenses: expenses.reduce((s, e) => s + parseFloat(e.amount), 0).toFixed(2),
    expenseCount: expenses.length,
    members: members.map((m) => m.name),
    categories: (() => {
      const c = {};
      expenses.forEach((e) => (c[e.category] = (c[e.category] || 0) + parseFloat(e.amount)));
      return c;
    })(),
    topPayer: (() => {
      const p = {};
      expenses.forEach((e) => (p[e.paid_by] = (p[e.paid_by] || 0) + parseFloat(e.amount)));
      const top = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
      return top ? members.find((m) => m.id === top[0])?.name : "N/A";
    })(),
    pendingDebts: debts.map((d) => ({
      from: members.find((m) => m.id === d.from)?.name,
      to: members.find((m) => m.id === d.to)?.name,
      amount: d.amount.toFixed(2),
    })),
  };

  try {
    const res = await fetch(CONFIG.GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: CONFIG.GROQ_MODEL,
        messages: [
          { role: "system", content: "You are a smart expense analyst. Be concise, friendly, and use emojis." },
          { role: "user", content: `Analyze this group expense data and provide 4-5 concise insights. Include spending patterns, who's contributing most, category observations, and tips to save money. Under 200 words.\n\nGroup Data:\n- Total spent: ₹${summary.totalExpenses}\n- Number of expenses: ${summary.expenseCount}\n- Members: ${summary.members.join(", ")}\n- Category breakdown: ${JSON.stringify(summary.categories)}\n- Top payer: ${summary.topPayer}\n- Pending debts: ${JSON.stringify(summary.pendingDebts)}` }
        ],
        max_tokens: 400,
        temperature: 0.7
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response from Groq");
    $("insightsOutput").textContent = text;
    $("insightsOutput").className = "insights-output loaded";
  } catch (err) {
    $("insightsOutput").textContent = `❌ Error: ${err.message}`;
  }

  $("generateInsightsBtn").disabled = false;
  $("generateInsightsBtn").textContent = "Generate Insights";
});

// ===== TABS =====
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.toggle("active", c.id === `tab-${name}`));
}

// ===== CATEGORY EMOJI HELPER =====
function categoryEmoji(cat) {
  const map = { Food: "🍔", Travel: "✈️", Rent: "🏠", Entertainment: "🎬", Shopping: "🛍️", Utilities: "💡", General: "📦" };
  return map[cat] || "📦";
}

// ===== INIT =====
loadRecentGroups();
checkUrlParams();
