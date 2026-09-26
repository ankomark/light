// Group chat list bookkeeping, kept out of the screen so it can be tested
// alone. The same message can reach the list four ways — the cache, the send's
// answer, the socket and the poll — so these decide which copy survives.

import { userKey } from './screenCache';

export const GROUP_CACHE_SIZE = 60;

export const groupChatKey = (userId, slug) => userKey(userId, `group-chat:${slug}`);
export const groupListKey = (userId, mode, view) => userKey(userId, `groups:${mode}:${view}`);

export const isTemp = (m) => String(m?.id).startsWith('temp_');
const isData = (uri) => typeof uri === 'string' && uri.startsWith('data:');

// Oldest first; two messages in the same instant keep their server order.
const byTime = (x, y) => {
  const d = new Date(x.created_at) - new Date(y.created_at);
  if (d) return d;
  const a = typeof x.id === 'number' ? x.id : Infinity;
  const b = typeof y.id === 'number' ? y.id : Infinity;
  return a - b;
};

/** One list from two, by id (the later copy wins), in time order. */
export const mergeMessages = (a, b) => {
  const map = new Map();
  [...a, ...b].forEach((m) => map.set(String(m.id), m));
  return Array.from(map.values()).sort(byTime);
};

/** Bubbles not on the server yet: still sending, or failed (kept for retry). */
export const unsent = (list) => list.filter((m) => isTemp(m) && (m._status === 'sending' || m._status === 'failed'));

/**
 * The first fresh page after painting from cache: the server's page is the
 * truth for its span (a message deleted while away must go), older cached
 * rows before it stay (they're still history), and unsent bubbles stay.
 */
export const freshPage = (prev, page) => {
  if (!page.length) return unsent(prev);          // nothing there any more
  const oldest = page[0];
  // Older cached rows join on only if the page overlaps them — otherwise more
  // arrived while away than a page holds, and keeping them would hide a gap.
  const had = new Set(prev.filter((m) => !isTemp(m)).map((m) => String(m.id)));
  const overlaps = page.some((m) => had.has(String(m.id)));
  const before = overlaps ? prev.filter((m) => !isTemp(m) && byTime(m, oldest) < 0) : [];
  return mergeMessages([...before, ...page], unsent(prev));
};

/**
 * What a chat keeps for its next open: the newest confirmed messages, plus
 * texts that failed to send (the outbox, retried with their payload) — never
 * a bubble mid-upload, a local file, or a legacy base64 attachment.
 */
export const cacheableGroupMessages = (list, size = GROUP_CACHE_SIZE) => {
  const keep = list.filter((m) => {
    if (isTemp(m)) return m._status === 'failed' && !!m._payload && !m._retryMedia;
    return !isData(m.attachment);
  });
  return keep.slice(-size);
};

/** A reply's quoted line. */
export const replyLabel = (m, t) => m.content || ({
  image: t('group.preview.photo'), file: t('group.preview.file'), audio: t('group.preview.voiceNote'),
}[m.message_type] || t('group.preview.message'));

/**
 * A message that arrived live. Mine (sent from here, or another device of
 * mine) takes the place of the bubble with its client id; anyone's is merged
 * by id. A copy already here keeps what the live one can't know (my reaction).
 */
export const absorb = (list, msg) => {
  if (!msg || msg.id == null) return list;
  const temp = msg.client_id ? list.findIndex((m) => m.id === msg.client_id) : -1;
  if (temp >= 0) {
    const next = list.filter((m) => String(m.id) !== String(msg.id));
    const at = next.findIndex((m) => m.id === msg.client_id);
    next[at] = { ...msg, _status: undefined };
    return next;
  }
  const had = list.find((m) => String(m.id) === String(msg.id));
  const merged = had ? { ...had, ...msg, reactions: msg.reactions ? { ...msg.reactions, mine: had.reactions?.mine ?? null } : had.reactions } : msg;
  return mergeMessages(list, [merged]);
};

/** A live reaction: the counts for everyone; "mine" only if it was me. */
export const applyReaction = (list, evt, meId) => list.map((m) => (String(m.id) === String(evt.id)
  ? { ...m, reactions: { summary: evt.summary || [], mine: evt.user_id === meId ? (evt.emoji ?? null) : (m.reactions?.mine ?? null) } }
  : m));

/**
 * The send's answer. The socket may have delivered the same message first
 * (absorb put it in the bubble's place already) — then there's nothing to do;
 * otherwise the bubble becomes the saved message, and any other copy goes.
 */
export const settle = (list, tempId, saved) => {
  if (!saved || saved.id == null) return list;
  if (!list.some((m) => m.id === tempId)) {
    return list.some((m) => String(m.id) === String(saved.id)) ? list : mergeMessages(list, [saved]);
  }
  return list
    .filter((m) => m.id === tempId || String(m.id) !== String(saved.id))
    .map((m) => (m.id === tempId ? { ...saved } : m));
};
