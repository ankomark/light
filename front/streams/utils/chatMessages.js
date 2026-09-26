// Pure list helpers for the chat screen, kept out of the component so they can
// be tested without rendering it.

export const isDataUri = (uri) => typeof uri === 'string' && uri.startsWith('data:');

// What a chat caches for its next open: the newest messages, server-confirmed
// only (a half-sent optimistic row must not resurrect), and never a legacy
// base64 attachment — one of those can be megabytes of text.
export const CHAT_CACHE_SIZE = 60;

export const cacheableMessages = (list, size = CHAT_CACHE_SIZE) =>
  list
    .filter((m) => (typeof m.id === 'number' && !isDataUri(m.attachment)) || isOutboxText(m))
    .slice(-size);

// A text that failed to send is kept (the outbox): it survives leaving the
// chat, and "Tap to retry" sends it with the same client id, so a send that
// did reach the server can't land twice. (A failed photo or voice note isn't:
// its local file may be gone.)
export const isOutboxText = (m) => !!m && m.failed && (m.message_type || 'text') === 'text' && !!m.client_id;

// Temp ids must be unique even for two sends inside the same millisecond.
// Also the message's client id: unique per sender, across devices and restarts.
let tempSeq = 0;
export const nextTempId = () => `temp_${Date.now()}_${tempSeq++}_${Math.random().toString(36).slice(2, 8)}`;

// Replace an optimistic row with the server's copy — unless a poll already
// delivered that copy, in which case keeping both would show the message twice
// (and give the list two rows with the same key).
export const reconcileSent = (list, tempId, saved) =>
  list.some((m) => m.id === saved?.id)
    ? list.filter((m) => m.id !== tempId)
    : list.map((m) => (m.id === tempId ? saved : m));

// A full reload replaces the list with the server's, but keeps bubbles that are
// still sending — they aren't on the server yet, and dropping them would make a
// message vanish mid-send.
export const mergeFullLoad = (prev, data) => {
  const pending = prev.filter((m) => typeof m.id !== 'number');
  return pending.length ? [...data, ...pending] : data;
};

// A message that arrived live (or by poll). The same message can come three
// ways — the send's answer, the socket, the poll — so: already here by id →
// the newer copy; mine still sending (same client id) → the server's copy in
// its place; otherwise it's new, at the end.
export const addIncoming = (list, msg) => {
  if (!msg || msg.id == null) return list;
  const at = list.findIndex((m) => m.id === msg.id);
  if (at >= 0) {
    const next = list.slice();
    next[at] = { ...list[at], ...msg };
    return next;
  }
  if (msg.client_id) {
    const temp = list.findIndex((m) => typeof m.id !== 'number' && m.client_id === msg.client_id);
    if (temp >= 0) {
      const next = list.slice();
      next[temp] = msg;
      return next;
    }
  }
  return [...list, msg];
};

// A send that failed: the bubble stays, marked, for "Tap to retry".
export const markFailed = (list, tempId) =>
  list.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m));

// Retrying: sending again.
export const markRetrying = (list, tempId) =>
  list.map((m) => (m.id === tempId ? { ...m, pending: true, failed: false } : m));

// One message changed (edited, deleted, reacted): patch it where it is.
export const patchMessage = (list, id, patch) =>
  list.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m));