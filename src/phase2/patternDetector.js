const cron = require('node-cron');
const { analyzePatterns } = require('./codeGenerator');
const sheets = require('../sheets');
const { setPending } = require('../pendingState');

/**
 * Weekly pattern detection job.
 * Runs every Sunday at midnight Israel time.
 * Reads sheet data, uses Claude to find improvement opportunities,
 * and sends a suggestion to the WhatsApp group for approval.
 */
function startPatternDetector(whatsappClient) {
  // Every Sunday at 00:00 Israel time
  cron.schedule(
    '0 0 * * 0',
    async () => {
      console.log('[Phase2] Running weekly pattern detection...');
      try {
        await runPatternDetection(whatsappClient);
      } catch (err) {
        console.error('[Phase2] Pattern detection error:', err.message);
      }
    },
    { timezone: 'Asia/Jerusalem' }
  );

  console.log('[Phase2] Pattern detector scheduled — runs Sundays at midnight (IL)');
}

async function runPatternDetection(whatsappClient) {
  const groupId = process.env.WHATSAPP_GROUP_ID;
  if (!groupId) {
    console.error('[Phase2] WHATSAPP_GROUP_ID not set — cannot send suggestion');
    return;
  }

  const snapshot = await sheets.getSheetSnapshot();
  const suggestion = await analyzePatterns(snapshot);

  if (!suggestion) {
    console.log('[Phase2] No improvement suggestions this week');
    return;
  }

  console.log('[Phase2] Suggestion found:', suggestion.patternDescription);

  // Store pending state so messageHandler can catch the yes/no reply
  setPending(groupId, {
    type: 'improvement_proposal',
    suggestion,
  });

  await whatsappClient.sendMessage(groupId, suggestion.message);
}

module.exports = { startPatternDetector, runPatternDetection };
