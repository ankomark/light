/**
 * Group chat bookkeeping: a message can reach the list from the cache, the
 * send, the socket and the poll — one copy must survive, in order, and what
 * the cache painted must give way to the server's first page correctly.
 */
import {
  mergeMessages, freshPage, cacheableGroupMessages, unsent, replyLabel,
} from '../groupChat';

const at = (s) => new Date(Date.UTC(2026, 8, 26, 10, 0, s)).toISOString();
const msg = (id, s, extra = {}) => ({ id, created_at: at(s), content: `m${id}`, ...extra });

describe('mergeMessages', () => {
  it('one copy per id (the later wins), oldest first, ties by id', () => {
    const out = mergeMessages([msg(2, 5), msg(1, 5)], [msg(3, 1), msg(2, 5, { content: 'edited' })]);
    expect(out.map((m) => m.id)).toEqual([3, 1, 2]);
    expect(out[2].content).toBe('edited');
  });
});

describe('freshPage', () => {
  const sending = msg('temp_a', 99, { _status: 'sending' });
  const failed = msg('temp_b', 98, { _status: 'failed' });

  it("drops what the server no longer has in the page's span; keeps unsent bubbles", () => {
    const cached = [msg(1, 1), msg(2, 2), msg(3, 3), msg(4, 4), sending, failed];
    const page = [msg(2, 2), msg(4, 4), msg(5, 5)];                // 3 was deleted while away
    const out = freshPage(cached, page);
    expect(out.map((m) => m.id)).toEqual([1, 2, 4, 5, 'temp_b', 'temp_a']);
  });

  it('far behind (no overlap): the older cache is dropped rather than hide a gap', () => {
    const cached = [msg(1, 1), msg(2, 2)];
    const page = [msg(50, 50), msg(51, 51)];
    expect(freshPage(cached, page).map((m) => m.id)).toEqual([50, 51]);
  });

  it('an empty chat leaves only unsent bubbles', () => {
    expect(freshPage([msg(1, 1), failed], []).map((m) => m.id)).toEqual(['temp_b']);
  });
});

describe('cacheableGroupMessages', () => {
  it('keeps confirmed messages and failed texts; never uploads, local files or base64', () => {
    const out = cacheableGroupMessages([
      msg(1, 1),
      msg(2, 2, { attachment: 'data:image/png;base64,AAA' }),
      msg('temp_a', 3, { _status: 'sending', _payload: { content: 'x' } }),
      msg('temp_b', 4, { _status: 'failed', _payload: { content: 'y' } }),
      msg('temp_c', 5, { _status: 'failed', _retryMedia: { localUri: 'file://x' } }),
    ]);
    expect(out.map((m) => m.id)).toEqual([1, 'temp_b']);
  });

  it('keeps the newest N', () => {
    const list = Array.from({ length: 10 }, (_, i) => msg(i + 1, i));
    expect(cacheableGroupMessages(list, 3).map((m) => m.id)).toEqual([8, 9, 10]);
  });
});

test('unsent and reply labels', () => {
  expect(unsent([msg(1, 1), msg('temp_x', 2, { _status: 'sending' }), msg('temp_y', 3)]).map((m) => m.id)).toEqual(['temp_x']);
  const t = (k) => k;
  expect(replyLabel({ content: 'hi' }, t)).toBe('hi');
  expect(replyLabel({ message_type: 'image' }, t)).toBe('group.preview.photo');
});
