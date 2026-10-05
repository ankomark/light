// Finding a hymn the way people look for one: by its number, by the first
// words of its title, or by a line they remember — in church, quickly.
//
// Each hymnal is read once into an index of plain text: lower case, no
// accents, no punctuation, and every kind of apostrophe gone, so "tis so
// sweet" finds "'Tis So Sweet" and "mungu" finds "Mũngu". Results are ranked:
//
//   the number exactly  >  a number starting with it  >  the title as typed
//   >  a title starting with it  >  the title containing it  >  every word
//   in the title  >  the refrain  >  a verse  >  every word somewhere in it
//
// and each says where it matched (the line, for a verse or the refrain), so
// the list can show the line the person remembered.
import { HYMNALS } from './hymnals';

const ACCENTS = /[̀-ͯ]/g;
const APOSTROPHES = /['’‘`´ʼ]/g;
const OTHER = /[^a-z0-9]+/g;

/** Text as it is compared: "O’er the Hills — Mũngu!" → "oer the hills mungu". */
export const fold = (text) => {
  let s = String(text || '').toLowerCase();
  if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(ACCENTS, '');
  return s.replace(APOSTROPHES, '').replace(OTHER, ' ').trim();
};

const indexes = new Map();

/** The hymnal's index, built the first time it is searched. */
export const hymnIndex = (lang) => {
  if (!indexes.has(lang)) {
    const hymns = HYMNALS[lang]?.data?.hymns || [];
    indexes.set(lang, hymns.map((hymn) => {
      const lines = [];
      (hymn.verses || []).forEach((verse, v) => String(verse).split('\n').forEach((line) => {
        if (line.trim()) lines.push({ raw: line.trim(), text: fold(line), verse: v + 1 });
      }));
      const refrain = String(hymn.refrain || '').split('\n').filter((l) => l.trim())
        .map((line) => ({ raw: line.trim(), text: fold(line), refrain: true }));
      const title = fold(hymn.title);
      return {
        hymn,
        number: String(hymn.number),
        title,
        titleWords: new Set(title.split(' ')),
        refrain,
        lines,
        all: [title, ...refrain.map((l) => l.text), ...lines.map((l) => l.text)].join(' '),
      };
    }));
  }
  return indexes.get(lang);
};

// How strongly each kind of match counts.
const SCORE = {
  number: 1000, numberStart: 600, titleIs: 500, titleStarts: 400, titleHas: 300,
  titleWords: 200, refrain: 150, verse: 100, words: 50,
};

/** How well one indexed hymn matches a folded query: { score, line } or null. */
const rate = (entry, q, words, digits) => {
  if (digits) {
    if (entry.number === q) return { score: SCORE.number };
    if (entry.number.startsWith(q)) return { score: SCORE.numberStart - entry.number.length };
  }
  if (entry.title === q) return { score: SCORE.titleIs };
  if (entry.title.startsWith(q)) return { score: SCORE.titleStarts };
  if (entry.title.includes(q)) return { score: SCORE.titleHas };
  if (words.length > 1 && words.every((w) => entry.titleWords.has(w) || entry.title.includes(w))) {
    return { score: SCORE.titleWords };
  }
  const inRefrain = entry.refrain.find((l) => l.text.includes(q));
  if (inRefrain) return { score: SCORE.refrain, line: inRefrain };
  const inVerse = entry.lines.find((l) => l.text.includes(q));
  if (inVerse) return { score: SCORE.verse, line: inVerse };
  if (words.length > 1 && words.every((w) => entry.all.includes(w))) {
    const line = entry.lines.find((l) => l.text.includes(words[0])) || entry.refrain.find((l) => l.text.includes(words[0]));
    return { score: SCORE.words, line };
  }
  return null;
};

/**
 * Search `rows` ([{ lang, hymn, ... }]) for `query`. Returns the matching rows,
 * best first (then in the order given), each with `match` ({ line, verse,
 * refrain }) when the match was in the words rather than the title. An empty
 * query returns the rows as they are.
 */
export const searchHymns = (rows, query) => {
  const q = fold(query);
  if (!q) return rows;
  const words = q.split(' ');
  const digits = /^\d+$/.test(q);
  const byLang = new Map();
  const entryFor = (row) => {
    if (!byLang.has(row.lang)) {
      byLang.set(row.lang, new Map(hymnIndex(row.lang).map((e) => [e.hymn.number, e])));
    }
    return byLang.get(row.lang).get(row.hymn.number);
  };
  const found = [];
  rows.forEach((row, order) => {
    const entry = entryFor(row);
    const hit = entry && rate(entry, q, words, digits);
    if (hit) found.push({ row, order, ...hit });
  });
  found.sort((a, b) => b.score - a.score || a.order - b.order);
  return found.map(({ row, line }) => (line
    ? { ...row, match: { line: line.raw, verse: line.verse, refrain: !!line.refrain } }
    : row));
};
