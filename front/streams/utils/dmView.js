// How direct messages read, in words: the inbox's times and previews, the
// chat's day separators and "last seen". Pure (given `t`), so tested alone.

const DAY = 86400000;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

/** Inbox time: now · 5m · 3h · 2d · then the date. */
export function shortAgo(t, dateStr, now = Date.now()) {
  if (!dateStr) return '';
  const diff = Math.max(0, Math.floor((now - new Date(dateStr)) / 1000));
  if (diff < 60) return t('dm.now');
  if (diff < 3600) return t('dm.minutesShort', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('dm.hoursShort', { n: Math.floor(diff / 3600) });
  if (diff < 7 * 86400) return t('dm.daysShort', { n: Math.floor(diff / 86400) });
  return new Date(dateStr).toLocaleDateString();
}

/** A chat's last message, in a line. `meId`: "You: " before mine. */
export function previewText(t, last, meId) {
  if (!last) return t('dm.noMessages');
  if (last.is_deleted) return t('dm.deleted');
  let body;
  if (last.content) body = last.content;
  else {
    switch (last.message_type) {
      case 'image': body = `📷 ${t('chat.photo')}`; break;
      case 'file': body = `📎 ${last.file_name || t('dm.file')}`; break;
      case 'audio': body = `🎤 ${t('dm.voiceNote')}`; break;
      default: body = t('dm.message');
    }
  }
  const senderId = last.sender_id ?? last.sender?.id;
  return meId && senderId === meId ? t('dm.youPrefix', { text: body }) : body;
}

/** The label over a day's messages: Today · Yesterday · the date. */
export function dayLabel(t, dateStr, now = Date.now()) {
  const d = startOfDay(dateStr);
  const today = startOfDay(now);
  if (d === today) return t('dm.today');
  if (d === today - DAY) return t('dm.yesterday');
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    weekday: today - d < 7 * DAY ? 'long' : undefined,
    day: 'numeric', month: 'short',
    year: new Date(now).getFullYear() === date.getFullYear() ? undefined : 'numeric',
  });
}

/** Is this message on a different day from the one before it? */
export const newDay = (prev, msg) => !prev || startOfDay(prev.created_at) !== startOfDay(msg.created_at);

/** The header under a name: Online · typing… · last seen 5m ago. */
export function presenceLine(t, { online, lastSeen, typing }, now = Date.now()) {
  if (typing) return t('dm.typing');
  if (online) return t('dm.online');
  if (lastSeen) return t('dm.lastSeen', { when: shortAgo(t, lastSeen, now) });
  return '';
}

/** A message can be edited by its sender for 15 minutes (text only). */
export const canEdit = (m, meId, now = Date.now()) => !!m && m.sender?.id === meId && !m.is_deleted
  && (m.message_type || 'text') === 'text' && typeof m.id === 'number'
  && now - new Date(m.created_at) < 15 * 60 * 1000;

/** …and deleted for everyone for 48 hours. */
export const canDeleteForAll = (m, meId, now = Date.now()) => !!m && m.sender?.id === meId && !m.is_deleted
  && typeof m.id === 'number' && now - new Date(m.created_at) < 48 * 3600 * 1000;

export const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

/** Apply a live reaction event ({emoji, count, user_ids}[]) to a message. */
export const withReactions = (m, list, meId) => ({
  ...m,
  reactions: (list || []).map((r) => ({ emoji: r.emoji, count: r.count, mine: (r.user_ids || []).includes(meId) })),
});

/** My reaction, toggled (optimistically): the same emoji takes mine back,
 * another replaces it — one each, as the server keeps it. */
export function toggleReaction(reactions = [], emoji) {
  const mine = reactions.find((r) => r.mine);
  let out = reactions.map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r)).filter((r) => r.count > 0);
  if (mine?.emoji !== emoji) {
    const at = out.findIndex((r) => r.emoji === emoji);
    out = at >= 0
      ? out.map((r, i) => (i === at ? { ...r, count: r.count + 1, mine: true } : r))
      : [...out, { emoji, count: 1, mine: true }];
  }
  return out;
}
