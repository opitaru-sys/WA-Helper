# 🏠 WhatsApp Household Bot

A proactive, AI-powered household assistant for Ilana & Omri's WhatsApp group.

Reads every message through Gemini Flash. Logs shopping items, tasks, Emma updates, notes, and passwords silently — and confirms in one line. Stays completely silent for casual conversation.

---

## Features

| Category | What triggers it | Example |
|---|---|---|
| **Shopping** | Anything that sounds like an item to buy | "נגמר השמפו", "תוסיפי אורז" |
| **Tasks** | Delegated action items | "תבדוק את המזגן", "עלייך לסדר את זה" |
| **Emma Log** | Anything about Emma | "אמה ישנה ב19:15", "יש לה חום" |
| **Notes** | Info worth keeping | "הטלפון של הרופא הוא 03-XXXXXXX" |
| **Passwords** | Credential info → prompts to save | "הסיסמא ל-wifi היא 12345" |

Retrieval works naturally: "מה יש ברשימת הקניות?", "מה עליי?", "מתי אמה ישנה לאחרונה?"

---

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/whatsapp-household-bot.git
cd whatsapp-household-bot
npm install
```

### 2. Airtable Setup

**a. Create a free Airtable account** at [airtable.com](https://airtable.com)

**b. Create a new Base:**
1. Click **Add a base → Start from scratch**
2. Name it anything (e.g. "Household Bot")
3. Copy the Base ID from the URL: `https://airtable.com/appXXXXXXXXXXXXXX/...` — the part starting with `app`

**c. Create a Personal Access Token:**
1. Go to [airtable.com/create/tokens](https://airtable.com/create/tokens)
2. Click **Create token**
3. Give it these **scopes**:
   - `data.records:read`
   - `data.records:write`
   - `schema.bases:read`
   - `schema.bases:write`
4. Under **Access**, select your new base
5. Copy the token (starts with `pat...`)

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
GEMINI_API_KEY=          # from Google AI Studio: aistudio.google.com
AIRTABLE_TOKEN=pat...    # your Personal Access Token
AIRTABLE_BASE_ID=app...  # from your base URL

WHATSAPP_GROUP_ID=       # fill in after first run (see step 5)
ILANA_NUMBER=972XXXXXXXXX@c.us
OMRI_NUMBER=972XXXXXXXXX@c.us
```

### 4. Initialize Airtable Tables

Creates all 6 tables with the correct fields in your base:

```bash
npm run init-sheets
```

You should see:
```
✅ Notes: created
✅ Shopping: created
...
🎉 Airtable initialization complete!
```

> 💡 After init, open your base at airtable.com to verify the tables look right.

### 5. First-Time QR Scan

```bash
npm start
```

A QR code prints in the terminal. Open WhatsApp → **Linked Devices → Link a Device** and scan it.

After scanning, the bot prints all available group chats and their IDs:
```
📋 Available group chats:
  "הבית שלנו 🏠" → 120363XXXXXXXXXX@g.us
```

Copy the correct group ID into `WHATSAPP_GROUP_ID` in `.env`, then restart:
```bash
npm start
```

The bot is now live.

### 6. Test It

Send these to your group and verify the replies:
- `"צריך לקנות חלב"` → bot replies "הוספתי ✓"
- `"מה יש ברשימת הקניות?"` → bot lists items
- `"קנינו חלב"` → bot marks it done
- `"אמה ישנה ב19:15"` → bot logs silently + confirms
- `"הסיסמא לwifi היא 1234"` → bot asks to save (כן/לא)
- `"מה מצב האגם?"` → bot stays silent

---

## Render Deployment

### Free Tier Notes
- 512MB RAM — the Chromium instance (used by whatsapp-web.js) is tight but works
- **Persistent disk is required** for WhatsApp session persistence

### Steps

1. **Push to GitHub:**
```bash
git add .
git commit -m "initial"
git push origin main
```

2. **Create a Render Web Service** connected to your repo

3. **Add a Persistent Disk** (required for session):
   - Mount path: `/data`
   - Size: 1 GB (free tier allows this)

4. **Set environment variables** in Render dashboard — all vars from `.env`, plus:
   ```
   SESSION_DATA_PATH=/data/.wwebjs_auth
   ```
   (Airtable credentials are just two simple strings — no JSON file needed)

5. Set **Start Command:** `npm start`

6. First deploy will show a QR code in Render logs — scan it once. After that, the session persists on the disk.

> ⚠️ **Free tier sleeps after 15 minutes of inactivity.** WhatsApp will disconnect the bot when it sleeps. Use [UptimeRobot](https://uptimerobot.com) (free) to ping your Render URL every 10 minutes to keep it awake.

---

## Phase 2 — Self-Improvement (Optional)

Phase 2 lets the bot propose and deploy improvements to itself, with your approval via WhatsApp.

### How it works
1. Every Sunday midnight, the bot reviews sheet data and looks for patterns
2. If it spots something worth improving, it sends a suggestion to the group
3. On approval, Claude Sonnet generates the code change
4. Code is pushed to a new GitHub branch — you get a WhatsApp link for review
5. On your final approval, the branch is merged → Render auto-deploys

### Enable Phase 2

1. Get an [Anthropic API key](https://console.anthropic.com)
2. Create a [GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` scope
3. Add to `.env`:
   ```env
   ENABLE_PHASE2=true
   ANTHROPIC_API_KEY=sk-ant-...
   GITHUB_TOKEN=ghp_...
   GITHUB_OWNER=your_github_username
   GITHUB_REPO=whatsapp-household-bot
   ```
4. Restart the bot

### Safety Rules
- Never modifies `src/index.js` (core auth/loop)
- Always pushes to a branch, never directly to `main`
- Every attempt (success or failure) is logged to the Changelog sheet
- On code generation failure, bot notifies you and cancels — nothing is deployed

---

## Project Structure

```
src/
├── index.js           # WhatsApp client setup & entry point
├── messageHandler.js  # Message routing logic
├── gemini.js          # Gemini Flash integration + system prompt
├── sheets.js          # Google Sheets read/write
├── pendingState.js    # In-memory yes/no confirmation state
├── initSheets.js      # One-time sheet initialization (run via npm run init-sheets)
└── phase2/
    ├── patternDetector.js  # Weekly cron job
    ├── codeGenerator.js    # Claude Sonnet code generation
    └── githubDeployer.js   # GitHub API branch/PR/merge flow
```

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | From [Google AI Studio](https://aistudio.google.com) |
| `AIRTABLE_TOKEN` | ✅ | Personal Access Token from [airtable.com/create/tokens](https://airtable.com/create/tokens) |
| `AIRTABLE_BASE_ID` | ✅ | Base ID from your base URL (starts with `app`) |
| `WHATSAPP_GROUP_ID` | ✅ | Group chat ID (printed on first run) |
| `ILANA_NUMBER` | ✅ | e.g. `972501234567@c.us` |
| `OMRI_NUMBER` | ✅ | e.g. `972521234567@c.us` |
| `SESSION_DATA_PATH` | — | Where to store WA session (default: `./.wwebjs_auth`) |
| `ENABLE_PHASE2` | — | `true` to activate self-improvement module |
| `ANTHROPIC_API_KEY` | Phase 2 | Claude Sonnet API key |
| `GITHUB_TOKEN` | Phase 2 | Personal access token with `repo` scope |
| `GITHUB_OWNER` | Phase 2 | Your GitHub username |
| `GITHUB_REPO` | Phase 2 | Repository name |
