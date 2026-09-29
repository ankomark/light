/**
 * SHA-256 in plain JavaScript, checked against the standard's test vectors
 * and against the server's word fingerprint.
 */
import sha256 from '../sha256';
import { wordKey, judgeWord } from '../puzzleKeys';

test('the standard test vectors', () => {
  expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
    .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  expect(sha256('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
});

test('UTF-8 input', () => {
  expect(sha256('Mungu ni mwema — é')).toBe(require('crypto').createHash('sha256').update('Mungu ni mwema — é').digest('hex'));
});

test("the server's fingerprint for the same word (songs/tests/test_puzzle.py)", () => {
  expect(wordKey(7, 'GRACE')).toBe('9f813bdfc2d728fa');
});

describe('judging a spelled word on the board', () => {
  const puzzle = {
    id: 7,
    slots: [{ length: 5, key: wordKey(7, 'GRACE') }, { length: 4, key: wordKey(7, 'RACE') }],
    bonus_keys: [wordKey(7, 'CARE')],
  };
  test('an answer, and which slot it fills', () => {
    expect(judgeWord(puzzle, 'RACE')).toEqual({ kind: 'slot', index: 1 });
  });
  test('a bonus word', () => {
    expect(judgeWord(puzzle, 'CARE')).toEqual({ kind: 'bonus' });
  });
  test('neither', () => {
    expect(judgeWord(puzzle, 'ACRE')).toEqual({ kind: 'none' });
  });
  test('an older server sends no keys: ask it instead', () => {
    expect(judgeWord({ id: 7, slots: [{ length: 5 }] }, 'GRACE')).toBeNull();
  });
});

describe('applying a find to the board', () => {
  const { applyFind } = require('../puzzleKeys');
  const board = () => ({
    id: 7, found: ['GRACE'], bonus: [], revealed: [{ word: 'GRACE', row: 0, col: 0, dir: 'across' }],
    slots: [
      { length: 5, row: 0, col: 0, dir: 'across', key: wordKey(7, 'GRACE') },
      { length: 4, row: 0, col: 1, dir: 'down', key: wordKey(7, 'RACE') },
    ],
    bonus_keys: [wordKey(7, 'CARE')],
  });

  test('an answer fills its slot, and the last one finishes the board', () => {
    const out = applyFind(board(), 'RACE');
    expect(out.kind).toBe('slot');
    expect(out.done).toBe(true);
    expect(out.puzzle.is_complete).toBe(true);
    expect(out.puzzle.revealed[1]).toEqual({ word: 'RACE', row: 0, col: 1, dir: 'down' });
  });

  test('a bonus word is kept, and does not bring the end closer', () => {
    const out = applyFind(board(), 'CARE');
    expect(out.kind).toBe('bonus');
    expect(out.puzzle.bonus).toEqual(['CARE']);
    expect(out.puzzle.found).toEqual(['GRACE']);
  });

  test('anything else changes nothing', () => {
    const b = board();
    expect(applyFind(b, 'ACRE')).toEqual({ kind: 'none', done: false, puzzle: b });
  });

  test('a board without keys is left for the server to judge', () => {
    const b = { ...board(), slots: [{ length: 5 }] };
    expect(applyFind(b, 'GRACE').kind).toBeNull();
  });
});
