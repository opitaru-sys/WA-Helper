/**
 * In-memory store for pending confirmations (password saves, Phase 2 approvals).
 * Simple Map with auto-expiry. Resets on process restart, which is fine —
 * pending confirmations older than a few minutes aren't meaningful anyway.
 */

const pendingMap = new Map();
const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function setPending(chatId, data) {
  // Clear any existing timer for this chat
  const existing = pendingMap.get(chatId);
  if (existing?._timer) clearTimeout(existing._timer);

  const timer = setTimeout(() => pendingMap.delete(chatId), EXPIRY_MS);
  pendingMap.set(chatId, { ...data, _timer: timer });
}

function getPending(chatId) {
  const entry = pendingMap.get(chatId);
  if (!entry) return null;
  const { _timer, ...data } = entry;
  return data;
}

function clearPending(chatId) {
  const entry = pendingMap.get(chatId);
  if (entry?._timer) clearTimeout(entry._timer);
  pendingMap.delete(chatId);
}

module.exports = { setPending, getPending, clearPending };
