const {
  shuffle, makeOrder, reshuffleOrder, nextPos, prevPos, canNext, canPrev,
} = require('../queueLogic');

// Deterministic rng: always returns 0 so Fisher-Yates is a fixed permutation —
// enough to assert "current stays first, rest reordered".
const zeroRng = () => 0;
const sorted = (a) => [...a].sort((x, y) => x - y);

test('shuffle preserves the multiset of elements', () => {
  const out = shuffle([0, 1, 2, 3, 4], zeroRng);
  expect(sorted(out)).toEqual([0, 1, 2, 3, 4]);
  expect(out).toHaveLength(5);
});

test('makeOrder (no shuffle) is identity with pos at startIndex', () => {
  expect(makeOrder(4, 2, false)).toEqual({ order: [0, 1, 2, 3], pos: 2 });
});

test('makeOrder (shuffle) keeps the chosen track first at pos 0', () => {
  const { order, pos } = makeOrder(4, 2, true, zeroRng);
  expect(pos).toBe(0);
  expect(order[0]).toBe(2);
  expect(sorted(order)).toEqual([0, 1, 2, 3]);
});

test('reshuffleOrder off restores identity with pos at the current track', () => {
  expect(reshuffleOrder(5, 3, false)).toEqual({ order: [0, 1, 2, 3, 4], pos: 3 });
});

test('reshuffleOrder on keeps current first', () => {
  const { order, pos } = reshuffleOrder(5, 3, true, zeroRng);
  expect(pos).toBe(0);
  expect(order[0]).toBe(3);
  expect(sorted(order)).toEqual([0, 1, 2, 3, 4]);
});

test('nextPos advances, stops at end when repeat off', () => {
  expect(nextPos(3, 0, 'off')).toBe(1);
  expect(nextPos(3, 1, 'off')).toBe(2);
  expect(nextPos(3, 2, 'off')).toBeNull();
});

test('nextPos loops to 0 at end when repeat all', () => {
  expect(nextPos(3, 2, 'all')).toBe(0);
});

test('nextPos on empty queue is null', () => {
  expect(nextPos(0, 0, 'all')).toBeNull();
});

test('prevPos goes back, null at start when repeat off', () => {
  expect(prevPos(3, 2, 'off')).toBe(1);
  expect(prevPos(3, 0, 'off')).toBeNull();
});

test('prevPos wraps to last when repeat all', () => {
  expect(prevPos(3, 0, 'all')).toBe(2);
});

test('canNext / canPrev reflect bounds and repeat-all (needs >1 track)', () => {
  expect(canNext(3, 0, 'off')).toBe(true);
  expect(canNext(3, 2, 'off')).toBe(false);
  expect(canNext(3, 2, 'all')).toBe(true);
  expect(canNext(1, 0, 'all')).toBe(false); // single track: nowhere to go

  expect(canPrev(3, 2, 'off')).toBe(true);
  expect(canPrev(3, 0, 'off')).toBe(false);
  expect(canPrev(3, 0, 'all')).toBe(true);
  expect(canPrev(1, 0, 'all')).toBe(false);
});
