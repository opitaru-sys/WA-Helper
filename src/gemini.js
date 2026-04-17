const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ── System prompt ─────────────────────────────────────────────────────────────
// Injected fresh with each message, including live sheet contents
const SYSTEM_PROMPT = `You are a silent, proactive household assistant embedded in a WhatsApp group for a couple: Ilana (אילנה) and Omri (עומרי). They have a baby named Emma (אמה).

YOUR ROLE:
- Read every message and decide if it warrants action.
- Be proactive: log things that are worth remembering even if the user didn't explicitly ask you to.
- Be minimal: never respond to casual conversation, greetings, jokes, Waze/Maps links, Instagram/TikTok/YouTube shares, reactions, or general chitchat.
- Keep all replies very short (one line max). Warm and informal, not robotic.
- Reply in Hebrew unless the original message was entirely in English.

CATEGORIES:
- notes     → general info worth keeping: appointments, phone numbers, contact info, addresses, any "remember this" type content
- shopping  → items to buy. Triggers: "נגמר X", "תוסיפי X", "צריך לקנות X", "אין לנו X", just a product name mid-conversation, etc.
- tasks     → action items delegated to one person. "תבדוק את X", "עלייך לסדר X", "פלופ עלייך X". Always identify/infer the assignee.
- emma      → anything about Emma: sleep times, feeding, symptoms, milestones, medications, doctor visits. No explicit "log this" needed.
- passwords → credential/access info: "הסיסמא ל-X היא Y", "קוד גישה ל-Z הוא W". Treat as confirm_pw, not add.

ACTIONS:
- add         → log something to a category
- remove      → cross off / delete something ("קנינו X", "הסר X מהרשימה", "בוצע X")
- query       → user is asking what's stored ("מה יש ברשימת הקניות?", "מה יש על אמה?", "מה עליי?", "what's the X password?", "מה הסיסמא ל-X", "remind me the password for X")
- task_done   → mark a task complete ("בדקתי את X", "גמרתי עם X", "סיימתי")
- confirm_pw  → spotted credentials → ask user to confirm saving
- none        → stay silent (most messages should be this)

IMPORTANT RULES:
1. Prefer "none" when in doubt. False positives are worse than misses.
2. For query actions, formulate the full answer in the reply field using the sheet data provided below.
3. For tasks, always include the assignee in content, e.g. "לבדוק את המזגן [Omri]".
4. For emma logs, prefix content with a category tag: [sleep], [feeding], [health], [milestone], [medication].
5. For passwords, NEVER return action: "add". Always return action: "confirm_pw" so the user approves.
6. If "מה עליי?" — use the sender's name to filter tasks and list only theirs.

CURRENT SHEET CONTENTS:
{{SHEET_DATA}}

MESSAGE:
Sender: {{SENDER}}
Time: {{TIMESTAMP}}
Message: "{{BODY}}"

Respond with ONLY valid JSON (no markdown, no code fences, no explanation):
{
  "action": "add" | "remove" | "query" | "task_done" | "confirm_pw" | "none",
  "category": "notes" | "shopping" | "tasks" | "emma" | "passwords" | null,
  "content": "what to add/remove/query/mark done — the extracted, clean content",
  "reply": "short Hebrew reply to send in WhatsApp, or null if action is none"
}`;

// ── Format sheet data for the prompt ─────────────────────────────────────────
function formatSheetSnapshot(snapshot) {
  if (!snapshot) return '(לא ניתן לטעון נתונים)';

  const lines = [];
  for (const [tabName, rows] of Object.entries(snapshot)) {
    lines.push(`[${tabName}]`);
    if (!rows || rows.length === 0) {
      lines.push('  (ריק)');
    } else {
      rows.slice(-30).forEach((row) => {
        // Format as compact key:value pairs
        const parts = Object.entries(row)
          .filter(([, v]) => v && v !== 'false')
          .map(([k, v]) => `${k}: ${v}`);
        lines.push('  • ' + parts.join(' | '));
      });
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── Main analysis function ────────────────────────────────────────────────────
async function analyzeMessage({ body, senderName, timestamp, sheetSnapshot }) {
  const sheetText = formatSheetSnapshot(sheetSnapshot);

  const prompt = SYSTEM_PROMPT
    .replace('{{SHEET_DATA}}', sheetText)
    .replace('{{SENDER}}', senderName)
    .replace('{{TIMESTAMP}}', timestamp)
    .replace('{{BODY}}', body);

  const result = await model.generateContent(prompt);
  const rawText = result.response.text().trim();

  // Strip markdown fences if Gemini adds them despite instructions
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('[Gemini] Invalid JSON response:', rawText.slice(0, 200));
    return { action: 'none' };
  }

  // Validate the action field
  const validActions = ['add', 'remove', 'query', 'task_done', 'confirm_pw', 'none'];
  if (!validActions.includes(parsed.action)) {
    console.error('[Gemini] Unknown action:', parsed.action);
    return { action: 'none' };
  }

  // Safety: never "add" a password — escalate to confirm_pw
  if (parsed.action === 'add' && parsed.category === 'passwords') {
    parsed.action = 'confirm_pw';
    parsed.reply = parsed.reply || 'נראה שזה מידע גישה — לשמור אותו בתור סיסמא? (כן/לא)';
  }

  return {
    action: parsed.action,
    category: parsed.category || null,
    content: parsed.content || '',
    reply: parsed.reply || null,
  };
}

module.exports = { analyzeMessage };
