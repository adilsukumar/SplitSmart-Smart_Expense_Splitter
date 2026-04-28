const { createClient } = supabase;
const db = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

let group = null;
let members = [], expenses = [], settlements = [];
let splitType = "equal";
let rtChannel = null;

const $ = id => document.getElementById(id);

function toast(msg, type = "success") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.className = "toast", 3000);
}

function empty(icon, msg) {
  return `<div class="empty"><span>${icon}</span>${msg}</div>`;
}

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $(id).classList.add("active");
}

// ---- LANDING ----

async function loadRecent() {
  const saved = JSON.parse(localStorage.getItem("recentGroups") || "[]");
  if (!saved.length) return;
  const { data } = await db.from("expense_groups").select("*").in("id", saved).order("created_at", { ascending: false });
  if (!data?.length) return;
  $("recentCard").style.display = "block";
  $("recentList").innerHTML = data.map(g => `
    <div class="recent-item" onclick="openGroup('${g.id}','${g.name.replace(/'/g,"\\'")}')">
      <span>📁 ${g.name}</span>
      <span class="dim">${new Date(g.created_at).toLocaleDateString()}</span>
    </div>`).join("");
}

$('createGroupBtn').addEventListener('click', async () => {
  const name = $('newGroupName').value.trim();
  if (!name) return toast('Enter a group name', 'error');
  const btn = $('createGroupBtn');
  btn.textContent = 'Creating...';
  btn.disabled = true;
  const { data, error } = await db.from('expense_groups').insert({ name }).select().single();
  btn.textContent = 'Create';
  btn.disabled = false;
  if (error) return toast('Error creating group', 'error');
  saveRecent(data.id);
  openGroup(data.id, data.name);
});

$("newGroupName").addEventListener("keydown", e => { if (e.key === "Enter") $("createGroupBtn").click(); });

function saveRecent(id) {
  const saved = JSON.parse(localStorage.getItem("recentGroups") || "[]");
  if (!saved.includes(id)) saved.unshift(id);
  localStorage.setItem("recentGroups", JSON.stringify(saved.slice(0, 10)));
}

// ---- OPEN GROUP ----

async function openGroup(id, name) {
  group = { id, name };
  saveRecent(id);
  await Promise.all([fetchMembers(), fetchExpenses(), fetchSettlements()]);
  $('groupTitle').textContent = name;
  $('shareBtn').style.display = 'inline-flex';
  renderAll();
  subscribeRealtime();
  switchTab('expenses');
  showView('groupView');
}

$("backBtn").addEventListener("click", () => {
  if (rtChannel) db.removeChannel(rtChannel);
  $("shareBtn").style.display = "none";
  showView("landingView");
  loadRecent();
});

$("shareBtn").addEventListener("click", () => {
  const url = `${location.origin}${location.pathname}?g=${group.id}&n=${encodeURIComponent(group.name)}`;
  navigator.clipboard.writeText(url).then(() => toast("Link copied! 🔗"));
});

function checkUrl() {
  const p = new URLSearchParams(location.search);
  if (p.get("g") && p.get("n")) {
    history.replaceState({}, "", location.pathname);
    openGroup(p.get("g"), decodeURIComponent(p.get("n")));
  }
}

// ---- FETCH ----

async function fetchMembers() {
  const { data } = await db.from("members").select("*").eq("group_id", group.id).order("created_at");
  members = data || [];
}
async function fetchExpenses() {
  const { data } = await db.from("expenses").select("*, expense_splits(*)").eq("group_id", group.id).order("created_at", { ascending: false });
  expenses = data || [];
}
async function fetchSettlements() {
  const { data } = await db.from("settlements").select("*").eq("group_id", group.id).order("settled_at", { ascending: false });
  settlements = data || [];
}

function subscribeRealtime() {
  if (rtChannel) db.removeChannel(rtChannel);
  const refresh = async (fetch) => { await fetch(); renderAll(); };
  rtChannel = db.channel(`g-${group.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "members",     filter: `group_id=eq.${group.id}` }, () => refresh(fetchMembers))
    .on("postgres_changes", { event: "*", schema: "public", table: "expenses",    filter: `group_id=eq.${group.id}` }, () => refresh(fetchExpenses))
    .on("postgres_changes", { event: "*", schema: "public", table: "settlements", filter: `group_id=eq.${group.id}` }, () => refresh(fetchSettlements))
    .subscribe();
}

// ---- RENDER ----

function renderAll() {
  renderMembers();
  renderExpenses();
  renderBalances();
  renderSettlements();
  renderInsightCharts();
  $("groupMeta").textContent = `${members.length} members · ${expenses.length} expenses`;
}

function renderMembers() {
  const opts = members.map(m => `<option value="${m.id}">${m.name}</option>`).join("");
  $("membersList").innerHTML = members.length
    ? members.map(m => `<div class="chip"><div class="av">${m.name[0].toUpperCase()}</div>${m.name}</div>`).join("")
    : `<span class="dim">No members yet</span>`;
  ["paidBy","settleFrom","settleTo"].forEach(id => {
    $(id).innerHTML = opts || `<option disabled>Add members first</option>`;
  });
  renderCustomFields();
}

$("addMemberBtn").addEventListener("click", async () => {
  const name = $("newMember").value.trim();
  if (!name) return toast("Enter a name", "error");
  if (members.find(m => m.name.toLowerCase() === name.toLowerCase())) return toast("Already exists", "error");
  const { error } = await db.from("members").insert({ group_id: group.id, name });
  if (error) return toast("Error", "error");
  $("newMember").value = "";
  toast(`${name} added!`);
});
$("newMember").addEventListener("keydown", e => { if (e.key === "Enter") $("addMemberBtn").click(); });

// ---- SPLIT TOGGLE ----

document.querySelectorAll(".tog").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tog").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    splitType = btn.dataset.split;
    $("customInputs").style.display = splitType === "custom" ? "block" : "none";
    renderCustomFields();
  });
});

function renderCustomFields() {
  if (splitType !== "custom") return;
  $("customFields").innerHTML = members.map(m => `
    <div class="row mb12">
      <label style="min-width:90px;margin:0;color:var(--text2)">${m.name}</label>
      <input type="number" class="csplit" data-id="${m.id}" placeholder="0.00" oninput="updateRemaining()" />
    </div>`).join("");
}

function updateRemaining() {
  const total = parseFloat($("expAmount").value) || 0;
  const used = [...document.querySelectorAll(".csplit")].reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
  const rem = total - used;
  $("remaining").textContent = `₹${rem.toFixed(2)}`;
  $("remaining").style.color = Math.abs(rem) < 0.01 ? "var(--green)" : "var(--red)";
}
$("expAmount").addEventListener("input", updateRemaining);

// ---- AI CATEGORIZE ----

let catTimer;
$("expDesc").addEventListener("input", () => {
  clearTimeout(catTimer);
  const desc = $("expDesc").value.trim();
  if (!desc) { $("catBadge").textContent = "🏷️ —"; return; }
  $("catBadge").textContent = "🏷️ ...";
  catTimer = setTimeout(async () => {
    const cat = await aiCategory(desc);
    $("catBadge").textContent = `🏷️ ${cat}`;
    $("catBadge").dataset.cat = cat;
  }, 800);
});

// ---- ADD EXPENSE ----

$('addExpBtn').addEventListener('click', async () => {
  const desc = $('expDesc').value.trim();
  const amount = parseFloat($('expAmount').value);
  const paidBy = $('paidBy').value;
  const category = $('catBadge').dataset.cat || 'General';

  if (!desc) return toast('Enter a description', 'error');
  if (!amount || amount <= 0) return toast('Enter a valid amount', 'error');
  if (!members.length) return toast('Add members first', 'error');

  let splits = [];
  if (splitType === 'equal') {
    const share = parseFloat((amount / members.length).toFixed(2));
    splits = members.map(m => ({ member_id: m.id, amount: share }));
  } else {
    splits = [...document.querySelectorAll('.csplit')].map(i => ({ member_id: i.dataset.id, amount: parseFloat(i.value) || 0 }));
    const total = splits.reduce((s, i) => s + i.amount, 0);
    if (Math.abs(total - amount) > 0.01) return toast('Splits must add up to total', 'error');
  }

  const btn = $('addExpBtn');
  btn.textContent = 'Adding...';
  btn.disabled = true;
  const { data: exp, error } = await db.from('expenses')
    .insert({ group_id: group.id, description: desc, amount, paid_by: paidBy, split_type: splitType, category })
    .select().single();
  if (!error) await db.from('expense_splits').insert(splits.map(s => ({ ...s, expense_id: exp.id })));
  btn.textContent = 'Add Expense';
  btn.disabled = false;
  if (error) return toast('Error adding expense', 'error');
  $('expDesc').value = '';
  $('expAmount').value = '';
  $('catBadge').textContent = '🏷️ —';
  delete $('catBadge').dataset.cat;
  toast('Expense added! 💳');
});

function renderExpenses() {
  const filter = $("catFilter").value;
  const list = filter ? expenses.filter(e => e.category === filter) : expenses;
  if (!list.length) { $("expList").innerHTML = empty("💳", "No expenses yet"); return; }
  $("expList").innerHTML = list.map(e => {
    const payer = members.find(m => m.id === e.paid_by)?.name || "?";
    const date = new Date(e.created_at).toLocaleDateString();
    return `
    <div class="exp-item">
      <div class="exp-top">
        <span class="exp-name">${e.description}</span>
        <span class="exp-amt">₹${parseFloat(e.amount).toFixed(2)}</span>
      </div>
      <div class="exp-meta">
        <span class="dim">by ${payer} · ${date}</span>
        <span class="tag">${catEmoji(e.category)} ${e.category}</span>
        <button class="btn danger" onclick="deleteExp('${e.id}')">🗑</button>
      </div>
    </div>`;
  }).join("");
}

$("catFilter").addEventListener("change", renderExpenses);

async function deleteExp(id) {
  if (!confirm('Delete this expense?')) return;
  await db.from('expenses').delete().eq('id', id);
  toast('Deleted');
}

// ---- BALANCES ----

function getBalances() {
  const bal = {};
  members.forEach(m => bal[m.id] = 0);
  expenses.forEach(e => {
    bal[e.paid_by] += parseFloat(e.amount);
    (e.expense_splits || []).forEach(s => bal[s.member_id] -= parseFloat(s.amount));
  });
  settlements.forEach(s => {
    bal[s.from_member] += parseFloat(s.amount);
    bal[s.to_member] -= parseFloat(s.amount);
  });
  return bal;
}

function getDebts(bal) {
  const creditors = [], debtors = [];
  Object.entries(bal).forEach(([id, b]) => {
    if (b > 0.01) creditors.push({ id, amount: b });
    else if (b < -0.01) debtors.push({ id, amount: -b });
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
  const bal = getBalances();
  if (!members.length) { $("balList").innerHTML = empty("⚖️", "Add members first"); $("debtList").innerHTML = ""; return; }

  $("balList").innerHTML = members.map(m => {
    const b = bal[m.id] || 0;
    const cls = b > 0.01 ? "pos" : b < -0.01 ? "neg" : "zero";
    const label = b > 0.01 ? "gets back" : b < -0.01 ? "owes" : "settled up";
    return `<div class="bal-item">
      <div class="chip" style="display:inline-flex"><div class="av">${m.name[0].toUpperCase()}</div>${m.name}</div>
      <span><span class="${cls}">₹${Math.abs(b).toFixed(2)}</span> <span class="dim">${label}</span></span>
    </div>`;
  }).join("");

  const debts = getDebts(bal);
  $("debtList").innerHTML = debts.length
    ? debts.map(d => {
        const from = members.find(m => m.id === d.from)?.name || "?";
        const to = members.find(m => m.id === d.to)?.name || "?";
        return `<div class="debt-item"><span><b>${from}</b> owes <b>${to}</b></span><span class="neg">₹${d.amount.toFixed(2)}</span></div>`;
      }).join("")
    : empty("🎉", "All settled up!");
}

// ---- SETTLEMENTS ----

$('settleBtn').addEventListener('click', async () => {
  const from = $('settleFrom').value;
  const to = $('settleTo').value;
  const amount = parseFloat($('settleAmt').value);
  if (!from || !to) return toast('Select both members', 'error');
  if (from === to) return toast("Can't settle with yourself", 'error');
  if (!amount || amount <= 0) return toast('Enter a valid amount', 'error');
  const btn = $('settleBtn');
  btn.textContent = 'Saving...';
  btn.disabled = true;
  const { error } = await db.from('settlements').insert({ group_id: group.id, from_member: from, to_member: to, amount });
  btn.textContent = 'Mark Settled';
  btn.disabled = false;
  if (error) return toast('Error', 'error');
  $('settleAmt').value = '';
  toast('Settled! ✅');
});

function renderSettlements() {
  if (!settlements.length) { $("settleList").innerHTML = empty("📜", "No settlements yet"); return; }
  $("settleList").innerHTML = settlements.map(s => {
    const from = members.find(m => m.id === s.from_member)?.name || "?";
    const to = members.find(m => m.id === s.to_member)?.name || "?";
    return `<div class="settle-item">
      <span class="dim">💸 <b style="color:var(--text)">${from}</b> paid <b style="color:var(--text)">${to}</b> · ${new Date(s.settled_at).toLocaleDateString()}</span>
      <span class="pos">₹${parseFloat(s.amount).toFixed(2)}</span>
    </div>`;
  }).join("");
}

// ---- INSIGHTS CHARTS ----

function renderInsightCharts() {
  if (!expenses.length) {
    $("catBreakdown").innerHTML = empty("📊", "No data yet");
    $("topSpenders").innerHTML = empty("🏆", "No data yet");
    return;
  }

  const cats = {};
  expenses.forEach(e => cats[e.category] = (cats[e.category] || 0) + parseFloat(e.amount));
  const total = Object.values(cats).reduce((a, b) => a + b, 0);
  $("catBreakdown").innerHTML = Object.entries(cats).sort((a,b) => b[1]-a[1]).map(([cat, amt]) => {
    const pct = ((amt / total) * 100).toFixed(1);
    return `<div class="bar-item">
      <div class="bar-label"><span>${catEmoji(cat)} ${cat}</span><span>₹${amt.toFixed(2)} (${pct}%)</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join("");

  const spent = {};
  members.forEach(m => spent[m.id] = 0);
  expenses.forEach(e => spent[e.paid_by] = (spent[e.paid_by] || 0) + parseFloat(e.amount));
  $("topSpenders").innerHTML = members
    .map(m => ({ name: m.name, amt: spent[m.id] || 0 }))
    .sort((a, b) => b.amt - a.amt)
    .map((s, i) => `<div class="spender"><div class="rank">${i+1}</div><span style="flex:1">${s.name}</span><span class="pos">₹${s.amt.toFixed(2)}</span></div>`)
    .join("");
}

// ---- AI INSIGHTS ----

$("insightsBtn").addEventListener("click", async () => {
  if (!expenses.length) return toast("Add expenses first", "error");
  $("insightsBtn").disabled = true;
  $("insightsBtn").textContent = "⏳ Analyzing...";
  $("insightsOut").className = "insight-box";
  $("insightsOut").textContent = "Analyzing spending patterns...";

  const bal = getBalances();
  const debts = getDebts(bal);
  const cats = {};
  expenses.forEach(e => cats[e.category] = (cats[e.category] || 0) + parseFloat(e.amount));
  const total = expenses.reduce((s, e) => s + parseFloat(e.amount), 0).toFixed(2);

  try {
    const res = await fetch(CONFIG.GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: CONFIG.GROQ_MODEL,
        messages: [
          { role: "system", content: "You are a friendly expense analyst. Be concise and use emojis." },
          { role: "user", content: `Give 4-5 short insights about this group's spending. Under 180 words.\n\nTotal: ₹${total}\nMembers: ${members.map(m=>m.name).join(", ")}\nCategories: ${JSON.stringify(cats)}\nDebts: ${JSON.stringify(debts.map(d => ({ from: members.find(m=>m.id===d.from)?.name, to: members.find(m=>m.id===d.to)?.name, amount: d.amount.toFixed(2) })))}` }
        ],
        max_tokens: 350,
        temperature: 0.7
      })
    });
    if (!res.ok) throw new Error((await res.json()).error?.message);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response");
    $("insightsOut").textContent = text;
    $("insightsOut").className = "insight-box loaded";
  } catch (err) {
    $("insightsOut").textContent = `❌ ${err.message}`;
  }

  $("insightsBtn").disabled = false;
  $("insightsBtn").textContent = "Analyze";
});

// ---- TABS ----

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.toggle("active", p.id === `tab-${name}`));
}

// ---- HELPERS ----

async function aiCategory(desc) {
  const valid = ["Food","Travel","Rent","Entertainment","Shopping","Utilities","General"];
  try {
    const res = await fetch(CONFIG.GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: CONFIG.GROQ_MODEL,
        messages: [
          { role: "system", content: "Reply with ONE word only from the list given. No punctuation." },
          { role: "user", content: `Category for: "${desc}". Choose from: Food, Travel, Rent, Entertainment, Shopping, Utilities, General` }
        ],
        max_tokens: 5, temperature: 0
      })
    });
    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content || "").replace(/[^a-zA-Z]/g, "");
    return valid.find(v => v.toLowerCase() === raw.toLowerCase()) || "General";
  } catch { return "General"; }
}

function catEmoji(cat) {
  return { Food:"🍔", Travel:"✈️", Rent:"🏠", Entertainment:"🎬", Shopping:"🛍️", Utilities:"💡", General:"📦" }[cat] || "📦";
}

// ---- INIT ----
loadRecent();
checkUrl();
