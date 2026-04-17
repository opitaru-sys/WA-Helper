const { analyzeMessage } = require('./gemini');
const sheets = require('./sheets');
const { setPending, getPending, clearPending } = require('./pendingState');

// Map phone numbers → display names
const KNOWN_USERS = {
  [process.env.ILANA_NUMBER]: 'Ilana',
  [process.env.OMRI_NUMBER]: 'Omri',
};

// Replies that count as "yes" or "no" in a pending confirmation
const YES_REPLIES = new Set(['כן', 'yes', 'y', '✓', 'ok', 'אוקי', 'בסדר', 'כן!', 'נכון']);
const NO_REPLIES = new Set(['לא', 'no', 'n', 'x', 'לא!', 'לא תודה']);

// Numbers of known household members (built once at module load)
const KNOWN_NUMBERS = new Set(
  [process.env.ILANA_NUMBER, process.env.OMRI_NUMBER].filter(Boolean)
);

// ── Loop prevention ───────────────────────────────────────────────────────────
// Track IDs of messages the bot sent as replies so we don't re-process them
// when message_create fires for our own outgoing messages.
const botSentIds = new Set();
const processedMessageIds = new Set();

async function sendReply(msg, text) {
  if (!text) return;
  const replyText = text.startsWith('🤖') ? text : `🤖 ${text}`;
  const sent = await msg.reply(replyText);
  if (sent?.id?._serialized) {
    botSentIds.add(sent.id._serialized);
    // Auto-clean after 60 s — more than enough time for the event to fire
    setTimeout(() => botSentIds.delete(sent.id._serialized), 60_000);
  }
}

async function handleMessage(msg, client) {
  // ── Guards ────────────────────────────────────────────────────────────────

  // Deduplication: prevent both 'message' and 'message_create' from processing the same event
  if (msg.id?._serialized) {
    if (processedMessageIds.has(msg.id._serialized)) return;
    processedMessageIds.add(msg.id._serialized);
    // Cleanup after 60s
    setTimeout(() => processedMessageIds.delete(msg.id._serialized), 60_000);
  }

  // Skip replies the bot itself sent — they arrive here via message_create and
  // would otherwise create an infinite loop.
  if (msg.fromMe && botSentIds.has(msg.id?._serialized)) {
    botSentIds.delete(msg.id._serialized);
    return;
  }

  // Only handle text messages (ignore media, stickers, voice, reactions, etc.)
  if (msg.type !== 'chat') return;

  const isGroup = msg.from.endsWith('@g.us');
  const isDM    = msg.from.endsWith('@c.us');
  const isLid   = msg.from.endsWith('@lid'); // WhatsApp multi-device LID (always fromMe)

  // Reject status broadcasts, newsletter channels, etc.
  if (!isGroup && !isDM && !isLid) return;

  // Group: only the configured household group (if set)
  const configuredGroup = process.env.WHATSAPP_GROUP_ID;
  if (isGroup && configuredGroup && msg.from !== configuredGroup) return;

  // DM: only accept messages from known numbers — @lid is exempt (always fromMe)
  if (isDM && !KNOWN_NUMBERS.has(msg.from)) return;

  const body = msg.body?.trim();
  if (!body) return;

  // Bot's own replies always start with 🤖 - ignore them immediately
  if (body.startsWith('🤖')) return;

  // Skip pure URLs (Waze links, Instagram shares, etc.)
  const isJustALink = /^https?:\/\/\S+$/.test(body);
  if (isJustALink) return;

  // ── Identify sender ───────────────────────────────────────────────────────
  const chat = await msg.getChat();
  const chatId = chat.id._serialized;
  const timestamp = new Date(msg.timestamp * 1000).toISOString();

  // @lid messages are always fromMe — getContact() fails on them, so short-circuit.
  let senderName;
  if (isLid) {
    senderName = 'Omri';
  } else {
    const contact = await msg.getContact();
    const senderNumber = contact.id._serialized;
    senderName = KNOWN_USERS[senderNumber] || contact.pushname || 'Unknown';
  }

  // ── Handle pending confirmations ──────────────────────────────────────────
  const pending = getPending(chatId);
  if (pending) {
    const lowerBody = body.toLowerCase().trim();

    // Password save confirmation
    if (pending.type === 'confirm_pw') {
      if (YES_REPLIES.has(lowerBody)) {
        await sheets.addRow('passwords', {
          content: pending.data.content,
          addedBy: senderName,
          timestamp,
        });
        clearPending(chatId);
        await sendReply(msg, '🔐 נשמר ✓');
        return;
      } else if (NO_REPLIES.has(lowerBody)) {
        clearPending(chatId);
        await sendReply(msg, '👍 בסדר, לא שמרתי');
        return;
      }
      // Not a yes/no — fall through to Gemini (and keep pending alive)
    }

    // Phase 2: improvement proposal approval
    if (pending.type === 'improvement_proposal' && process.env.ENABLE_PHASE2 === 'true') {
      const { deployImprovement } = require('./phase2/githubDeployer');
      if (YES_REPLIES.has(lowerBody)) {
        clearPending(chatId);
        await deployImprovement(pending.suggestion, client);
        return;
      } else if (NO_REPLIES.has(lowerBody)) {
        clearPending(chatId);
        await sendReply(msg, '👍 בסדר, לא אעשה כלום');
        return;
      }
    }

    // Phase 2: deploy approval
    if (pending.type === 'deploy_approval' && process.env.ENABLE_PHASE2 === 'true') {
      const { mergeBranch } = require('./phase2/githubDeployer');
      if (YES_REPLIES.has(lowerBody)) {
        clearPending(chatId);
        await mergeBranch(pending.branchName, client);
        return;
      } else if (NO_REPLIES.has(lowerBody)) {
        clearPending(chatId);
        await sendReply(msg, '👍 ביטלתי. הענף נשאר פתוח ב-GitHub אם תרצו לחזור אליו.');
        return;
      }
    }
  }

  // ── Fetch sheet context ───────────────────────────────────────────────────
  let sheetSnapshot = null;
  try {
    sheetSnapshot = await sheets.getSheetSnapshot();
  } catch (err) {
    console.error('[Sheets] Failed to fetch snapshot:', err.message);
  }

  // ── Analyze with Gemini ───────────────────────────────────────────────────
  let result;
  try {
    result = await analyzeMessage({ body, senderName, timestamp, sheetSnapshot });
  } catch (err) {
    console.error('[Gemini] Analysis failed:', err.message);
    return;
  }

  console.log(`[${senderName}] "${body.slice(0, 60)}" → ${result.action}${result.category ? `/${result.category}` : ''}`);

  // ── Execute action ────────────────────────────────────────────────────────
  switch (result.action) {
    case 'add': {
      await sheets.addRow(result.category, {
        content: result.content,
        addedBy: senderName,
        timestamp,
      });
      await sendReply(msg, result.reply);
      break;
    }

    case 'remove': {
      await sheets.removeRow(result.category, result.content);
      await sendReply(msg, result.reply);
      break;
    }

    case 'query': {
      // Gemini already formulates the reply using the sheet data it was given
      await sendReply(msg, result.reply);
      break;
    }

    case 'task_done': {
      await sheets.markTaskDone(result.content);
      await sendReply(msg, result.reply);
      break;
    }

    case 'confirm_pw': {
      setPending(chatId, {
        type: 'confirm_pw',
        data: { content: result.content, addedBy: senderName, timestamp },
      });
      await sendReply(msg, result.reply);
      break;
    }

    case 'none':
    default:
      // Stay silent
      break;
  }
}

module.exports = { handleMessage };
