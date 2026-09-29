// A word's fingerprint on one board — the same the server sends with each
// slot (songs/serializers/puzzle.py → word_key): the first 16 hex characters
// of SHA-256 over "<puzzle id>:<WORD>". Comparing fingerprints lets a find
// land the instant the finger lifts; the server still decides what it pays.
import sha256 from './sha256';

export const wordKey = (puzzleId, word) => sha256(`${puzzleId}:${word}`).slice(0, 16);

/** Stars for a finished board, as the server gives them (songs/puzzle.py →
 *  stars_for): 3 with no help, 2 with up to a word's worth (a word counts
 *  as three letters), 1 with more. */
export const starsFor = (p) => {
  const used = (p?.hints_used || 0) * 3 + (p?.letters_used || 0);
  if (used === 0) return 3;
  return used <= 3 ? 2 : 1;
};

/**
 * What the spelled `word` is on this board, decided here and now:
 *   { kind: 'slot', index }   one of the answers (which slot it fills)
 *   { kind: 'bonus' }         a real word the board never asked for
 *   { kind: 'none' }          neither
 *   null                      the board carries no keys (an older server): ask it
 */
export const judgeWord = (puzzle, word) => {
  const slots = puzzle?.slots || [];
  if (!slots.length || !slots.every((s) => typeof s.key === 'string')) return null;
  const key = wordKey(puzzle.id, word);
  const index = slots.findIndex((s) => s.key === key && s.length === word.length);
  if (index !== -1) return { kind: 'slot', index };
  if ((puzzle.bonus_keys || []).includes(key)) return { kind: 'bonus' };
  return { kind: 'none' };
};

/**
 * The board after `word` is spelled, decided here: → { kind, puzzle, done }.
 * `kind` is 'slot' | 'bonus' | 'none', or null for a board without keys (ask
 * the server). The returned puzzle has the find on it; `done` is whether that
 * finished the board.
 */
export const applyFind = (puzzle, word) => {
  const verdict = judgeWord(puzzle, word);
  if (!verdict) return { kind: null, puzzle, done: false };
  if (verdict.kind === 'slot') {
    const slot = puzzle.slots[verdict.index];
    const found = [...(puzzle.found || []), word];
    const done = new Set(found).size >= puzzle.slots.length;
    return {
      kind: 'slot',
      done,
      puzzle: {
        ...puzzle,
        found,
        revealed: [...(puzzle.revealed || []), { word, row: slot.row, col: slot.col, dir: slot.dir }],
        is_complete: done,
        ...(done ? { stars: starsFor(puzzle) } : {}),
      },
    };
  }
  if (verdict.kind === 'bonus') {
    return { kind: 'bonus', done: false, puzzle: { ...puzzle, bonus: [...(puzzle.bonus || []), word] } };
  }
  return { kind: 'none', done: false, puzzle };
};
