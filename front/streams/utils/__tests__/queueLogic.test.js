const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shuffle, makeOrder, reshuffleOrder, nextPos, prevPos, canNext, canPrev,
} = require('../queueLogic');

// Deterministic rng: always returns 0, so Fisher-Yates becomes a fixed reversal
// of the tail — enough to assert "current stays first, rest reordered".
const zeroRng = () => 0;

test('shuffle preserves the multiset of elements', () => {
  const out = shuffle([0, 1, 2, 3, 4], zeroRng);
  assert.deepEqual([...out].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.equal(out.length, 5);
});

test('makeOrder (no shuffle) is identity with pos at startIndex', () => {
  assert.deepEqual(makeOrder(4, 2, false), { order: [0, 1, 2, 3], pos: 2 });
});

test('makeOrder (shuffle) keeps the chosen track first at pos 0', () => {
  const { order, pos } = makeOrder(4, 2, true, zeroRng);
  assert.equal(pos, 0);
  assert.equal(order[0], 2);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3]);
});

test('reshuffleOrder off restores identity with pos at the current track', () => {
  // currently playing queue index 3 -> identity order, cursor lands on it
  assert.deepEqual(reshuffleOrder(5, 3, false), { order: [0, 1, 2, 3, 4], pos: 3 });
});

test('reshuffleOrder on keeps current first', () => {
  const { order, pos } = reshuffleOrder(5, 3, true, zeroRng);
  assert.equal(pos, 0);
  assert.equal(order[0], 3);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
});

test('nextPos advances, stops at end when repeat off', () => {
  assert.equal(nextPos(3, 0, 'off'), 1);
  assert.equal(nextPos(3, 1, 'off'), 2);
  assert.equal(nextPos(3, 2, 'off'), null);
});

test('nextPos loops to 0 at end when repeat all', () => {
  assert.equal(nextPos(3, 2, 'all'), 0);
});

test('nextPos on empty queue is null', () => {
  assert.equal(nextPos(0, 0, 'all'), null);
});

test('prevPos goes back, null at start when repeat off', () => {
  assert.equal(prevPos(3, 2, 'off'), 1);
  assert.equal(prevPos(3, 0, 'off'), null);
});

test('prevPos wraps to last when repeat all', () => {
  assert.equal(prevPos(3, 0, 'all'), 2);
});

test('canNext / canPrev reflect bounds and repeat-all (needs >1 track)', () => {
  assert.equal(canNext(3, 0, 'off'), true);
  assert.equal(canNext(3, 2, 'off'), false);
  assert.equal(canNext(3, 2, 'all'), true);
  assert.equal(canNext(1, 0, 'all'), false); // single track: nowhere to go

  assert.equal(canPrev(3, 2, 'off'), true);
  assert.equal(canPrev(3, 0, 'off'), false);
  assert.equal(canPrev(3, 0, 'all'), true);
  assert.equal(canPrev(1, 0, 'all'), false);
});
