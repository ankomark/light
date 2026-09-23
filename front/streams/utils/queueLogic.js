/**
 * Pure queue index-math for the audio player. No React/RN/expo-av imports, so
 * it is unit-testable on its own (see __tests__/queueLogic.test.js).
 *
 * Terms:
 *   - `length`           number of tracks in the queue
 *   - `order`            playback order: a permutation of [0..length-1] that
 *                        indexes into the queue (identity when not shuffled)
 *   - `pos`              cursor within `order`
 *   - `repeat`           'off' | 'all' | 'one'
 */

const range = (n) => Array.from({ length: n }, (_, i) => i);

/** Fisher-Yates shuffle (pure: returns a new array). `rng` is injectable for tests. */
function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build the initial playback order for a fresh queue.
 * Shuffled queues keep the chosen track first, then randomize the rest.
 */
function makeOrder(length, startIndex, shuffleOn, rng = Math.random) {
  const indices = range(length);
  if (shuffleOn) {
    return { order: [startIndex, ...shuffle(indices.filter((i) => i !== startIndex), rng)], pos: 0 };
  }
  return { order: indices, pos: startIndex };
}

/**
 * Recompute order when shuffle is toggled mid-playback, keeping the currently
 * playing track in place. `currentQueueIdx` is the queue index now playing
 * (i.e. order[pos]).
 */
function reshuffleOrder(length, currentQueueIdx, shuffleOn, rng = Math.random) {
  if (shuffleOn) {
    return { order: [currentQueueIdx, ...shuffle(range(length).filter((i) => i !== currentQueueIdx), rng)], pos: 0 };
  }
  return { order: range(length), pos: currentQueueIdx };
}

/** Next cursor for a manual "next" / autoplay-on-finish. Returns null to stop. */
function nextPos(length, pos, repeat) {
  if (length === 0) return null;
  if (pos < length - 1) return pos + 1;
  if (repeat === 'all') return 0;
  return null;
}

/** Previous cursor. Returns null when there is no previous (caller restarts current). */
function prevPos(length, pos, repeat) {
  if (length === 0) return null;
  if (pos > 0) return pos - 1;
  if (repeat === 'all') return length - 1;
  return null;
}

function canNext(length, pos, repeat) {
  return length > 0 && (pos < length - 1 || (repeat === 'all' && length > 1));
}

function canPrev(length, pos, repeat) {
  return length > 0 && (pos > 0 || (repeat === 'all' && length > 1));
}

// ── Editing the queue ────────────────────────────────────────────────────────
// Only what's still to come can change: entries at or before `pos` (played, or
// playing now) are left alone, so the cursor never moves under the listener.

/** Put queue index `idx` right after the current track ("Play next"). */
function insertNext(order, pos, idx) {
  const o = [...order];
  o.splice(Math.max(0, pos + 1), 0, idx);
  return o;
}

/** Put queue index `idx` at the end ("Add to queue"). */
function appendToOrder(order, idx) {
  return [...order, idx];
}

/** Drop the upcoming entry at order position `at`. */
function removeAt(order, pos, at) {
  if (at <= pos || at >= order.length) return order;
  const o = [...order];
  o.splice(at, 1);
  return o;
}

/** Move an upcoming entry from order position `from` to `to`. */
function moveUpcoming(order, pos, from, to) {
  if (from === to || from <= pos || to <= pos || from >= order.length || to >= order.length) return order;
  const o = [...order];
  const [item] = o.splice(from, 1);
  o.splice(to, 0, item);
  return o;
}

module.exports = {
  insertNext,
  appendToOrder,
  removeAt,
  moveUpcoming,
  range,
  shuffle,
  makeOrder,
  reshuffleOrder,
  nextPos,
  prevPos,
  canNext,
  canPrev,
};
