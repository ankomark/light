/**
 * Chat list bookkeeping.
 *
 * The chat sends optimistically and polls every 3 seconds, so the same message
 * can reach the list two ways: the send response and the poll. These helpers
 * decide which copy survives. A mistake here shows up as a doubled bubble or a
 * message that vanishes while it's sending, so the orderings are pinned exactly.
 */
import {
  cacheableMessages, nextTempId, reconcileSent, mergeFullLoad,
} from '../chatMessages';

const msg = (id, extra = {}) => ({ id, content: `m${id}`, ...extra });

describe('reconcileSent', () => {
  it('swaps the optimistic row for the server copy in place', () => {
    const list = [msg(1), msg('temp_a', { pending: true }), msg(2)];
    const out = reconcileSent(list, 'temp_a', msg(9));
    expect(out.map((m) => m.id)).toEqual([1, 9, 2]);
    expect(out[1].pending).toBeUndefined();
  });

  it('drops the optimistic row when a poll already delivered the message', () => {
    // Poll landed first: the real message 9 is already in the list.
    const list = [msg(1), msg('temp_a', { pending: true }), msg(9)];
    const out = reconcileSent(list, 'temp_a', msg(9));
    expect(out.map((m) => m.id)).toEqual([1, 9]);
  });

  it('leaves other in-flight messages alone', () => {
    const list = [msg('temp_a'), msg('temp_b')];
    const out = reconcileSent(list, 'temp_a', msg(5));
    expect(out.map((m) => m.id)).toEqual([5, 'temp_b']);
  });
});

describe('nextTempId', () => {
  it('is unique even within the same millisecond', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const ids = new Set(Array.from({ length: 50 }, nextTempId));
    spy.mockRestore();
    expect(ids.size).toBe(50);
  });
});

describe('mergeFullLoad', () => {
  it('keeps bubbles that are still sending', () => {
    const prev = [msg(1), msg('temp_x', { pending: true })];
    const out = mergeFullLoad(prev, [msg(1), msg(2)]);
    expect(out.map((m) => m.id)).toEqual([1, 2, 'temp_x']);
  });

  it('returns the server list untouched when nothing is pending', () => {
    const data = [msg(1), msg(2)];
    expect(mergeFullLoad([msg(1)], data)).toBe(data);
  });
});

describe('cacheableMessages', () => {
  it('keeps only server-confirmed messages', () => {
    const out = cacheableMessages([msg(1), msg('temp_a'), msg(2)]);
    expect(out.map((m) => m.id)).toEqual([1, 2]);
  });

  it('never caches a legacy base64 attachment', () => {
    const out = cacheableMessages([
      msg(1, { attachment: 'data:image/jpeg;base64,AAAA' }),
      msg(2, { attachment: 'https://res.cloudinary.com/x/upload/a.jpg' }),
    ]);
    expect(out.map((m) => m.id)).toEqual([2]);
  });

  it('keeps the newest N', () => {
    const list = Array.from({ length: 10 }, (_, i) => msg(i + 1));
    expect(cacheableMessages(list, 3).map((m) => m.id)).toEqual([8, 9, 10]);
  });
});
