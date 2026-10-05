/**
 * Finding a hymn: by its number first, then its title, then a line someone
 * remembers — with apostrophes, accents and capitals not getting in the way.
 */
import { fold, searchHymns } from '../hymnSearch';
import { HYMNALS } from '../hymnals';

const rows = (lang) => HYMNALS[lang].data.hymns.map((hymn) => ({ lang, hymn }));
const numbers = (found) => found.map((r) => Number(r.hymn.number));

test('text is compared plainly', () => {
  expect(fold('O’er the Hills — Mũngu!')).toBe('oer the hills mungu');
  expect(fold("'Tis So Sweet")).toBe('tis so sweet');
});

test('a number finds that hymn first, then the numbers starting with it', () => {
  const found = numbers(searchHymns(rows('en'), '10'));
  expect(found[0]).toBe(10);
  expect(found.slice(1, 11)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
});

test('a title beats a line that only mentions the words', () => {
  const amazing = HYMNALS.en.data.hymns.find((h) => /^amazing grace/i.test(h.title));
  const found = searchHymns(rows('en'), 'amazing grace');
  expect(found[0].hymn.number).toBe(amazing.number);
  expect(found[0].match).toBeUndefined();          // matched on its title
});

test('a remembered line finds its hymn and says where it is', () => {
  const hymn = HYMNALS.en.data.hymns[20];
  const line = hymn.verses[1].split('\n')[1];
  const found = searchHymns(rows('en'), line.toUpperCase().replace(/[,.;:!?']/g, ''));
  const hit = found.find((r) => r.hymn.number === hymn.number);
  expect(hit).toBeTruthy();
  expect(hit.match.line).toBe(line.trim());
});

test('an empty search gives the list back as it was', () => {
  const all = rows('sw');
  expect(searchHymns(all, '   ')).toBe(all);
});
