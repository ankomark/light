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
