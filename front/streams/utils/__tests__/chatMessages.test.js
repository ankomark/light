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
  addIncoming, markFailed, markRetrying, patchMessage,
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

  it('keeps a text that failed to send (the outbox), not a failed photo', () => {
    const out = cacheableMessages([
      msg(1),
      msg('temp_a', { failed: true, client_id: 'temp_a', message_type: 'text' }),
      msg('temp_b', { failed: true, client_id: 'temp_b', message_type: 'image', attachment: 'file://x.jpg' }),
      msg('temp_c', { pending: true, client_id: 'temp_c' }),
    ]);
    expect(out.map((m) => m.id)).toEqual([1, 'temp_a']);
  });
});

describe('addIncoming', () => {
  it('appends a new message', () => {
    expect(addIncoming([msg(1)], msg(2)).map((m) => m.id)).toEqual([1, 2]);
  });

  it('takes the place of my bubble still sending, by client id', () => {
    const list = [msg(1), msg('temp_a', { pending: true, client_id: 'temp_a' }), msg('temp_b', { client_id: 'temp_b' })];
    const out = addIncoming(list, msg(7, { client_id: 'temp_a' }));
    expect(out.map((m) => m.id)).toEqual([1, 7, 'temp_b']);
    expect(out[1].pending).toBeUndefined();
  });

  it('never doubles a message that came both ways', () => {
    const once = addIncoming([msg(1)], msg(2));
    const twice = addIncoming(once, msg(2, { read: true }));
    expect(twice.map((m) => m.id)).toEqual([1, 2]);
    expect(twice[1].read).toBe(true);
  });
});

describe('failed sends', () => {
  it('marks failed, then retrying', () => {
    const failed = markFailed([msg('temp_a', { pending: true })], 'temp_a');
    expect(failed[0]).toMatchObject({ pending: false, failed: true });
    expect(markRetrying(failed, 'temp_a')[0]).toMatchObject({ pending: true, failed: false });
  });

  it('patches one message', () => {
    const out = patchMessage([msg(1), msg(2)], 2, (m) => ({ content: m.content + '!' }));
    expect(out.map((m) => m.content)).toEqual(['m1', 'm2!']);
  });
});