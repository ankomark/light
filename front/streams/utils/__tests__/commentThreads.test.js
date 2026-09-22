/**
 * Comment sheet list logic: thread layout and optimistic reactions. The
 * reaction toggle must agree with the server (songs/comments.set_reaction),
 * or the heart would flicker when the real response lands.
 */
import {
  buildRows, toggleReaction, updateComment, addReply, mergeReplies, EMPTY_REACTIONS,
} from '../commentThreads';

const c = (id, extra = {}) => ({ id, content: `c${id}`, replies_count: 0, ...extra });

describe('buildRows', () => {
  it('shows a "view N replies" row under a closed thread', () => {
    const rows = buildRows([c(1, { replies_count: 3 }), c(2)]);
    expect(rows.map((r) => r.key)).toEqual(['c_1', 'm_1', 'c_2']);
    expect(rows[1]).toMatchObject({ label: 'view', remaining: 3 });
  });

  it('lays out an open thread, then "more" while replies remain', () => {
    const rows = buildRows([c(1, { replies_count: 3 })], { 1: { items: [c(10), c(11)], open: true, hasMore: true } });
    expect(rows.map((r) => r.key)).toEqual(['c_1', 'r_10', 'r_11', 'm_1']);
    expect(rows[1].depth).toBe(1);
    expect(rows[3]).toMatchObject({ label: 'more', remaining: 1 });
  });

  it('offers "hide" once every reply is shown', () => {
    const rows = buildRows([c(1, { replies_count: 1 })], { 1: { items: [c(10)], open: true, hasMore: false } });
    expect(rows[2]).toMatchObject({ label: 'hide' });
  });
});

describe('toggleReaction', () => {
  it('adds, switches and removes like the server', () => {
    const liked = toggleReaction(EMPTY_REACTIONS, '❤️');
    expect(liked).toEqual({ total: 1, top: ['❤️'], mine: '❤️' });
    const switched = toggleReaction(liked, '😂');
    expect(switched).toMatchObject({ total: 1, mine: '😂' });
    expect(switched.top[0]).toBe('😂');
    expect(toggleReaction(switched, '😂')).toEqual({ total: 0, top: [], mine: null });
  });

  it("keeps other people's reactions in the count", () => {
    const others = { total: 5, top: ['🔥', '❤️'], mine: null };
    expect(toggleReaction(others, '❤️')).toMatchObject({ total: 6, mine: '❤️' });
    const mineOn = { total: 6, top: ['🔥', '❤️'], mine: '❤️' };
    expect(toggleReaction(mineOn, '❤️')).toMatchObject({ total: 5, mine: null, top: ['🔥', '❤️'] });
  });
});

describe('updateComment / addReply / mergeReplies', () => {
  it('updates a reply inside its thread', () => {
    const threads = { 1: { items: [c(10)], open: true } };
    const out = updateComment([c(1)], threads, 10, (x) => ({ ...x, content: 'edited' }));
    expect(out.threads[1].items[0].content).toBe('edited');
    expect(out.comments[0].content).toBe('c1');
  });

  it('adds a reply, opens the thread and bumps the count', () => {
    const out = addReply([c(1, { replies_count: 2 })], {}, 1, c(99));
    expect(out.comments[0].replies_count).toBe(3);
    expect(out.threads[1]).toMatchObject({ open: true, items: [expect.objectContaining({ id: 99 })] });
  });

  it('merges pages without duplicates', () => {
    expect(mergeReplies([c(1), c(2)], [c(2), c(3)]).map((r) => r.id)).toEqual([1, 2, 3]);
  });
});
