# 💸 SplitSmart — Smart Expense Splitter

> Split expenses with friends, roommates, and teams — without the awkward math.

SplitSmart is a lightweight, real-time expense splitting web app. No sign-up required. Just create a group, share the link, and start tracking.

🔗 **Live Demo**: [[Link SplitSmart](https://splitsmart-finance.vercel.app/)]  
📹 **Demo Video**: [[Link_Video](https://drive.google.com/file/d/1ofJDoJqaGJ4o9unK8us7brOEEajMSBbo/view?usp=sharing)]

---

## ✨ Features

### Core
| Feature | Description |
|---|---|
| 📁 Create Groups | Named groups for trips, flat expenses, team activities |
| 👥 Add Members | Add any number of people to a group |
| 💳 Add Expenses | Log what was spent, how much, and who paid |
| ⚖️ Equal Split | Auto-split costs evenly among all members |
| 🎯 Custom Split | Assign exact amounts to specific people |
| 📊 Real-time Balances | Live balance updates the moment anyone adds an expense |
| 💸 Debt Summary | Simplified "who owes whom" using minimum transactions |
| ✅ Settle Up | Record payments and track full settlement history |
| 📋 Expense History | View, filter by category, and delete past expenses |
| 🔗 Share via Link | One link to invite friends directly into your group |

### AI-Powered (Groq + LLaMA 3.3)
| Feature | Description |
|---|---|
| 🏷️ Smart Categorization | Auto-detects category (Food, Travel, Rent, etc.) as you type |
| 🤖 Spending Insights | AI analyzes your group's patterns and gives actionable tips |
| 📊 Category Breakdown | Visual bar chart of spending per category |
| 🏆 Top Spenders | Ranked leaderboard of who paid the most |

---

## 🏗️ Architecture

```
smart-expense-splitter/
├── index.html              # Single page app — full UI structure
├── css/
│   └── style.css           # Dark green aesthetic, fully responsive
├── js/
│   ├── config.js           # API keys and endpoint config (gitignored)
│   └── app.js              # All logic — Supabase, Groq AI, balance calc
├── build.js                # Generates config.js from env variables at build time
├── vercel.json             # Vercel deployment config
└── README.md
```

### Tech Stack
- **Frontend** — HTML, CSS, Vanilla JavaScript
- **Database** — Supabase (PostgreSQL)
- **Real-time** — Supabase Realtime
- **AI** — Groq API (LLaMA 3.3)
- **Deployed on** — Vercel

### Database Tables
- `expense_groups` — group name and date
- `members` — members in a group
- `expenses` — expense records with payer, amount, category
- `expense_splits` — each person's share per expense
- `settlements` — recorded payments between members

---

## 🚀 Setup Instructions

### 1. Clone the repo
```bash
git clone https://github.com/your-username/smart-expense-splitter.git
cd smart-expense-splitter
```

### 2. Set up Supabase
1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → **New Query** and run the following:
```sql
create table expense_groups (id uuid default gen_random_uuid() primary key, name text not null, created_at timestamp default now());
create table members (id uuid default gen_random_uuid() primary key, group_id uuid references expense_groups(id) on delete cascade, name text not null, created_at timestamp default now());
create table expenses (id uuid default gen_random_uuid() primary key, group_id uuid references expense_groups(id) on delete cascade, description text not null, amount numeric not null, paid_by uuid references members(id) on delete cascade, split_type text default 'equal', category text default 'General', created_at timestamp default now());
create table expense_splits (id uuid default gen_random_uuid() primary key, expense_id uuid references expenses(id) on delete cascade, member_id uuid references members(id) on delete cascade, amount numeric not null);
create table settlements (id uuid default gen_random_uuid() primary key, group_id uuid references expense_groups(id) on delete cascade, from_member uuid references members(id) on delete cascade, to_member uuid references members(id) on delete cascade, amount numeric not null, settled_at timestamp default now());
alter table expense_groups disable row level security;
alter table members disable row level security;
alter table expenses disable row level security;
alter table expense_splits disable row level security;
alter table settlements disable row level security;
alter publication supabase_realtime add table expense_groups;
alter publication supabase_realtime add table members;
alter publication supabase_realtime add table expenses;
alter publication supabase_realtime add table expense_splits;
alter publication supabase_realtime add table settlements;
```
3. Go to **Project Settings** → **API** and note down:
   - Project URL (`https://xxxx.supabase.co`)
   - Anon/public key

### 3. Get a Groq API Key
1. Sign up free at [console.groq.com](https://console.groq.com)
2. Go to **API Keys** → **Create API Key**
3. Free tier gives 14,400 requests/day — more than enough

### 4. Configure keys
Edit `js/config.js`:
```js
const CONFIG = {
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-key",
  GROQ_API_KEY: "your-groq-key",
  GROQ_URL: "https://api.groq.com/openai/v1/chat/completions",
  GROQ_MODEL: "llama-3.3-70b-versatile"
};
```

### 5. Run locally
Just open `index.html` in your browser — no build step, no server needed.

### 6. Deploy to Vercel
1. Push the repo to GitHub (make sure it's public)
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import from Git
3. Select your repo, set Framework Preset to **Other**, leave build settings blank
4. Click **Deploy** — live in ~30 seconds

---

## 💡 How It Works

### Balance Calculation
Every expense credits the payer's balance and debits each split participant's balance by their share. When a settlement is recorded, the payer's balance increases (debt reduced) and the receiver's decreases. A greedy algorithm then simplifies all outstanding balances into the minimum number of transactions needed.

### AI Categorization
As you type an expense description, the app debounces 800ms then sends the text to Groq's LLaMA 3.3 model with a strict system prompt to return exactly one category word. The response is cleaned and matched against the valid category list before being saved.

### Real-time Sync
Supabase Realtime subscribes to Postgres changes on all 5 tables, filtered by `group_id`. Any insert, update, or delete by any user instantly re-fetches and re-renders the UI for everyone in the group — no polling, no refresh needed.

---

## 📸 Screenshots
> Add screenshots here after deployment

---

## 🔮 Future Improvements
- User authentication & personal dashboards
- Export expenses to CSV / PDF
- Multi-currency support with live conversion
- Push notifications when a new expense is added
- Recurring expense tracking
- Mobile app (PWA)
