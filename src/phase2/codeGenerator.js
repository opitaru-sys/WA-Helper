const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Pattern Analysis ─────────────────────────────────────────────────────────
/**
 * Analyzes sheet data to find improvement opportunities.
 * Returns a suggestion object or null if nothing noteworthy.
 */
async function analyzePatterns(sheetSnapshot) {
  const prompt = `You are analyzing usage data for a WhatsApp household assistant bot used by a couple — Ilana and Omri — with a baby named Emma.

The bot currently handles: notes, shopping list, task delegation, Emma's log, and passwords.

Here is their recent data across all categories:
${JSON.stringify(sheetSnapshot, null, 2)}

Look for meaningful improvement opportunities:
1. Topics in EmmaLog that might deserve a dedicated feature (e.g., medication tracking, appointment logging)
2. Shopping items that recur frequently (→ suggest a "staples" auto-list)
3. Tasks always assigned to the same person (→ suggest workload insights)
4. Information types that appear in Notes but would be better as a structured category
5. Anything missing that a household with a baby clearly needs

RULES:
- Only suggest something if there's genuine signal in the data
- Prefer specific, implementable features over vague ideas
- The WhatsApp message must be casual, warm Hebrew, 1-2 sentences + "רוצה שאמשיך? (כן/לא)"

If you find a meaningful opportunity, return:
{
  "foundPattern": true,
  "patternDescription": "what you noticed (English, for logs)",
  "proposedFeature": "what you'd implement (English, for code generation)",
  "message": "WhatsApp message to send (Hebrew, casual)"
}

If nothing interesting:
{
  "foundPattern": false
}

Respond with ONLY valid JSON (no markdown, no explanation).`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('[Phase2] Claude returned invalid JSON for pattern analysis');
    return null;
  }

  return parsed.foundPattern ? parsed : null;
}

// ── Code Generation ───────────────────────────────────────────────────────────
/**
 * Uses Claude Sonnet to generate code changes implementing a proposed feature.
 * Returns { changes: [{ file, operation, content }], description } or throws.
 */
async function generateCodeChange(suggestion) {
  const srcDir = path.join(__dirname, '..');

  // Read the key source files to give Claude full context
  const sourceFiles = ['messageHandler.js', 'gemini.js', 'sheets.js'];
  const fileContents = {};
  for (const filename of sourceFiles) {
    try {
      fileContents[filename] = fs.readFileSync(path.join(srcDir, filename), 'utf8');
    } catch (err) {
      console.warn(`[Phase2] Could not read ${filename}:`, err.message);
    }
  }

  const prompt = `You are implementing a feature improvement for a WhatsApp household assistant bot written in Node.js.

FEATURE TO IMPLEMENT:
Pattern detected: ${suggestion.patternDescription}
Proposed feature: ${suggestion.proposedFeature}

CURRENT SOURCE CODE:
${Object.entries(fileContents)
  .map(([name, content]) => `=== src/${name} ===\n${content}`)
  .join('\n\n')}

STRICT SAFETY RULES — you MUST follow these:
1. Never modify the WhatsApp authentication or session management logic in src/index.js
2. Never modify the core message-handling loop structure in messageHandler.js
3. Keep changes minimal and focused on the proposed feature
4. Preserve all existing functionality — only ADD, never break
5. If you need a new sheet tab, add it to the TABS array in initSheets.js

Return a JSON object describing exactly what to change:
{
  "changes": [
    {
      "file": "src/filename.js",
      "operation": "modify" | "create",
      "content": "complete new file content as a string"
    }
  ],
  "description": "one-sentence description of what this change does (English)"
}

Respond with ONLY valid JSON (no markdown, no explanation).`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Claude returned invalid JSON for code generation');
  }

  if (!parsed.changes || parsed.changes.length === 0) {
    throw new Error('Claude generated no file changes');
  }

  // Safety: reject any change targeting index.js (core loop protection)
  const dangerous = parsed.changes.find((c) => c.file.includes('index.js'));
  if (dangerous) {
    throw new Error('Safety violation: generated change targets index.js (core loop)');
  }

  return parsed;
}

module.exports = { analyzePatterns, generateCodeChange };
