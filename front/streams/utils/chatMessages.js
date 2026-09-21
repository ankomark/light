// Pure list helpers for the chat screen, kept out of the component so they can
// be tested without rendering it.

export const isDataUri = (uri) => typeof uri === 'string' && uri.startsWith('data:');

// What a chat caches for its next open: the newest messages, server-confirmed
// only (a half-sent optimistic row must not resurrect), and never a legacy
// base64 attachment — one of those can be megabytes of text.
export const CHAT_CACHE_SIZE = 60;

export const cacheableMessages = (list, size = CHAT_CACHE_SIZE) =>
  list
    .filter((m) => typeof m.id === 'number' && !isDataUri(m.attachment))
    .slice(-size);

// Temp ids must be unique even for two sends inside the same millisecond.
let tempSeq = 0;
export const nextTempId = () => `temp_${Date.now()}_${tempSeq++}`;

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
