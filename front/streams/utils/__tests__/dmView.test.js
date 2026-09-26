/**
 * Direct messages in words: the inbox's times and previews, day separators,
 * presence, and the edit / delete windows and reaction toggling the chat
 * shows before the server answers.
 */
import {
  shortAgo, previewText, dayLabel, newDay, presenceLine, canEdit, canDeleteForAll,
  toggleReaction, withReactions,
} from '../dmView';

const t = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
const NOW = new Date('2026-09-26T12:00:00').getTime();
const ago = (s) => new Date(NOW - s * 1000).toISOString();

describe('shortAgo', () => {
  it('reads now, minutes, hours, days, then a date', () => {
    expect(shortAgo(t, ago(20), NOW)).toBe('dm.now');
    expect(shortAgo(t, ago(5 * 60), NOW)).toBe('dm.minutesShort:5');
    expect(shortAgo(t, ago(3 * 3600), NOW)).toBe('dm.hoursShort:3');
    expect(shortAgo(t, ago(2 * 86400), NOW)).toBe('dm.daysShort:2');
    expect(shortAgo(t, ago(30 * 86400), NOW)).not.toMatch(/^dm\./);
    expect(shortAgo(t, null, NOW)).toBe('');
  });
});

describe('previewText', () => {
  it('says what the last message was, and "You:" before mine', () => {
    expect(previewText(t, null)).toBe('dm.noMessages');
    expect(previewText(t, { content: 'hi', sender_id: 2 }, 1)).toBe('hi');
    expect(previewText(t, { content: 'hi', sender_id: 1 }, 1)).toBe('dm.youPrefix:hi');
    expect(previewText(t, { message_type: 'image' })).toBe('📷 chat.photo');
    expect(previewText(t, { message_type: 'file', file_name: 'a.pdf' })).toBe('📎 a.pdf');
    expect(previewText(t, { message_type: 'audio' })).toBe('🎤 dm.voiceNote');
    expect(previewText(t, { is_deleted: true, content: '' })).toBe('dm.deleted');
  });
});

describe('days', () => {
  it('labels today and yesterday, and tells a new day apart', () => {
    expect(dayLabel(t, ago(60), NOW)).toBe('dm.today');
    expect(dayLabel(t, ago(86400), NOW)).toBe('dm.yesterday');
    expect(dayLabel(t, ago(10 * 86400), NOW)).not.toMatch(/^dm\./);
    const a = { created_at: '2026-09-25T23:50:00' };
    const b = { created_at: '2026-09-26T00:10:00' };
    const c = { created_at: '2026-09-26T09:00:00' };
    expect(newDay(null, a)).toBe(true);
    expect(newDay(a, b)).toBe(true);
    expect(newDay(b, c)).toBe(false);
  });
});

describe('presenceLine', () => {
  it('typing beats online beats last seen', () => {
    expect(presenceLine(t, { typing: true, online: true }, NOW)).toBe('dm.typing');
    expect(presenceLine(t, { online: true, lastSeen: ago(60) }, NOW)).toBe('dm.online');
    expect(presenceLine(t, { online: false, lastSeen: ago(600) }, NOW)).toBe('dm.lastSeen:dm.minutesShort:10');
    expect(presenceLine(t, {}, NOW)).toBe('');
  });
});

describe('edit and delete windows', () => {
  const mine = (secs, extra = {}) => ({ id: 5, sender: { id: 1 }, message_type: 'text', created_at: ago(secs), ...extra });
  it('edits my text for 15 minutes', () => {
    expect(canEdit(mine(60), 1, NOW)).toBe(true);
    expect(canEdit(mine(16 * 60), 1, NOW)).toBe(false);
    expect(canEdit(mine(60), 2, NOW)).toBe(false);                       // not mine
    expect(canEdit(mine(60, { message_type: 'image' }), 1, NOW)).toBe(false);
    expect(canEdit(mine(60, { id: 'temp_x' }), 1, NOW)).toBe(false);     // not sent yet
    expect(canEdit(mine(60, { is_deleted: true }), 1, NOW)).toBe(false);
  });
  it('deletes mine for everyone for 48 hours', () => {
    expect(canDeleteForAll(mine(47 * 3600), 1, NOW)).toBe(true);
    expect(canDeleteForAll(mine(49 * 3600), 1, NOW)).toBe(false);
    expect(canDeleteForAll(mine(60), 2, NOW)).toBe(false);
  });
});

describe('reactions', () => {
  it('toggles mine: add, replace, take back', () => {
    const added = toggleReaction([{ emoji: '❤️', count: 1, mine: false }], '👍');
    expect(added).toEqual([{ emoji: '❤️', count: 1, mine: false }, { emoji: '👍', count: 1, mine: true }]);
    const replaced = toggleReaction(added, '❤️');
    expect(replaced).toEqual([{ emoji: '❤️', count: 2, mine: true }]);
    expect(toggleReaction(replaced, '❤️')).toEqual([{ emoji: '❤️', count: 1, mine: false }]);
  });
  it('reads a live event for me', () => {
    const m = withReactions({ id: 1 }, [{ emoji: '😂', count: 2, user_ids: [1, 2] }, { emoji: '🙏', count: 1, user_ids: [3] }], 1);
    expect(m.reactions).toEqual([{ emoji: '😂', count: 2, mine: true }, { emoji: '🙏', count: 1, mine: false }]);
  });
});
