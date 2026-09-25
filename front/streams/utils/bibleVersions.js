// The Bible versions the reader offers, by language, and the books of the
// Bible by their standard (USFM) codes.
//
// Text comes from the Free Use Bible API (bible.helloao.org): free, no key,
// the eBible.org collection of public-domain and openly licensed Bibles. Each
// version's `credit` is shown under every chapter — the Creative Commons
// licences require it (Attribution); public-domain texts just name
// themselves.
//
// Ekegusii: the Bible Society of Kenya's "Ebibilia Enchenu" is "All rights
// reserved" — eBible.org shows it with their permission, other apps may not
// copy it. So it's never fetched, stored or re-published by the app: each
// chapter is eBible's own page, loaded from eBible into the reader (a
// `web` version), with its copyright notice. Until the Society grants use.

const PD = 'Public domain';
const BIBLICA_SA = 'CC BY-SA 4.0';

export const BIBLE_LANGUAGES = [
  {
    code: 'en', name: 'English',
    versions: [
      { id: 'eng_kjv', abbr: 'KJV', name: 'King James Version', credit: `King James Version · ${PD}` },
      { id: 'ENGWEBP', abbr: 'WEB', name: 'World English Bible', credit: `World English Bible · ${PD}` },
      { id: 'BSB', abbr: 'BSB', name: 'Berean Standard Bible', credit: `Berean Standard Bible · ${PD}` },
      { id: 'eng_asv', abbr: 'ASV', name: 'American Standard Version (1901)', credit: `American Standard Version · ${PD}` },
      { id: 'eng_bbe', abbr: 'BBE', name: 'Bible in Basic English', credit: `Bible in Basic English · ${PD}` },
    ],
  },
  {
    code: 'sw', name: 'Kiswahili',
    versions: [
      { id: 'swh_bib', abbr: 'NENO', name: 'Neno: Bibilia Takatifu (Kiswahili Contemporary)',
        credit: `Neno: Bibilia Takatifu © 1984, 1989, 2009, 2015 Biblica, Inc. · ${BIBLICA_SA}` },
      { id: 'swh_onmm', abbr: 'ONMM', name: 'Neno: Maandiko Matakatifu',
        credit: `Neno: Maandiko Matakatifu © 2018, 2024 Biblica, Inc. · ${BIBLICA_SA}` },
      { id: 'swh_ulb', abbr: 'ULB', name: 'Biblia Takatifu (Unlocked Literal Bible)',
        credit: `Swahili Unlocked Literal Bible © 2019 Door43 World Missions Community · ${BIBLICA_SA}` },
    ],
  },
  {
    code: 'luo', name: 'Dholuo',
    versions: [
      { id: 'luo_bib', abbr: 'DHOLUO', name: 'Dholuo Bible (Biblica)',
        credit: `Dholuo Bible © 2020 Biblica, Inc. · ${BIBLICA_SA}` },
    ],
  },
  {
    code: 'guz', name: 'Ekegusii',
    versions: [
      // Not ours to copy (see above): eBible's own pages, shown in the reader.
      { id: 'guz_bsk', abbr: 'EKEGUSII', name: 'Ebibilia Enchenu (Bible Society of Kenya)',
        web: 'https://ebible.org/guz/',
        credit: 'Ebibilia Enchenu © 2021 Bible Society of Kenya · from eBible.org' },
    ],
  },
  {
    code: 'kik', name: 'Gĩkũyũ',
    versions: [
      { id: 'kik_bib', abbr: 'KIKUYU', name: 'Kiugo Gĩtheru Kĩa Ngai (Kikuyu Bible)',
        credit: `Kikuyu Bible © 2013 Biblica, Inc. · ${BIBLICA_SA}` },
    ],
  },
  {
    code: 'lug', name: 'Luganda',
    versions: [
      { id: 'lug_bib', abbr: 'LUGANDA', name: 'Bayibuli Entukuvu (Luganda Bible)',
        credit: `Luganda Bible © 1984, 1986, 1993, 2014 Biblica, Inc. · ${BIBLICA_SA}` },
    ],
  },
];

const BY_ID = new Map(BIBLE_LANGUAGES.flatMap((l) => l.versions.map((v) => [v.id, { ...v, language: l.name, lang: l.code }])));

export const DEFAULT_BIBLE_VERSION = 'eng_kjv';

/** A version with its language, or the default when the id is unknown. */
export const getBibleVersion = (id) => BY_ID.get(id) || BY_ID.get(DEFAULT_BIBLE_VERSION);

// The 66 books in order: standard code, English name, chapters (as a
// fallback until a version's own list loads, and for English search).
export const BIBLE_BOOKS = [
  ['GEN', 'Genesis', 50], ['EXO', 'Exodus', 40], ['LEV', 'Leviticus', 27], ['NUM', 'Numbers', 36],
  ['DEU', 'Deuteronomy', 34], ['JOS', 'Joshua', 24], ['JDG', 'Judges', 21], ['RUT', 'Ruth', 4],
  ['1SA', '1 Samuel', 31], ['2SA', '2 Samuel', 24], ['1KI', '1 Kings', 22], ['2KI', '2 Kings', 25],
  ['1CH', '1 Chronicles', 29], ['2CH', '2 Chronicles', 36], ['EZR', 'Ezra', 10], ['NEH', 'Nehemiah', 13],
  ['EST', 'Esther', 10], ['JOB', 'Job', 42], ['PSA', 'Psalms', 150], ['PRO', 'Proverbs', 31],
  ['ECC', 'Ecclesiastes', 12], ['SNG', 'Song of Solomon', 8], ['ISA', 'Isaiah', 66], ['JER', 'Jeremiah', 52],
  ['LAM', 'Lamentations', 5], ['EZK', 'Ezekiel', 48], ['DAN', 'Daniel', 12], ['HOS', 'Hosea', 14],
  ['JOL', 'Joel', 3], ['AMO', 'Amos', 9], ['OBA', 'Obadiah', 1], ['JON', 'Jonah', 4],
  ['MIC', 'Micah', 7], ['NAM', 'Nahum', 3], ['HAB', 'Habakkuk', 3], ['ZEP', 'Zephaniah', 3],
  ['HAG', 'Haggai', 2], ['ZEC', 'Zechariah', 14], ['MAL', 'Malachi', 4],
  ['MAT', 'Matthew', 28], ['MRK', 'Mark', 16], ['LUK', 'Luke', 24], ['JHN', 'John', 21],
  ['ACT', 'Acts', 28], ['ROM', 'Romans', 16], ['1CO', '1 Corinthians', 16], ['2CO', '2 Corinthians', 13],
  ['GAL', 'Galatians', 6], ['EPH', 'Ephesians', 6], ['PHP', 'Philippians', 4], ['COL', 'Colossians', 4],
  ['1TH', '1 Thessalonians', 5], ['2TH', '2 Thessalonians', 3], ['1TI', '1 Timothy', 6], ['2TI', '2 Timothy', 4],
  ['TIT', 'Titus', 3], ['PHM', 'Philemon', 1], ['HEB', 'Hebrews', 13], ['JAS', 'James', 5],
  ['1PE', '1 Peter', 5], ['2PE', '2 Peter', 3], ['1JN', '1 John', 5], ['2JN', '2 John', 1],
  ['3JN', '3 John', 1], ['JUD', 'Jude', 1], ['REV', 'Revelation', 22],
].map(([id, english, chapters], i) => ({ id, english, name: english, chapters, order: i + 1 }));

export const OT_COUNT = 39;

// The books' names in Ekegusii (as eBible.org lists them).
export const EKEGUSII_BOOK_NAMES = {
  GEN: 'Omochakano', EXO: 'Okong’anya', LEV: 'Abalawi', NUM: 'Omobaro', DEU: 'Okoiranerera',
  JOS: 'Yoshua', JDG: 'Abagambi', RUT: 'Rutu', '1SA': '1 Samweli', '2SA': '2 Samweli',
  '1KI': '1 Abarwoti', '2KI': '2 Abarwoti', '1CH': '1 Amang’ana ’Ebiro', '2CH': '2 Amang’ana ’Ebiro',
  EZR: 'Ezra', NEH: 'Nehemia', EST: 'Esiteri', JOB: 'Ayubu', PSA: 'Zaburi', PRO: 'Egetabu ki’Emebeyano',
  ECC: 'Omorandia', SNG: 'Ogoteera gwa Sulemani', ISA: 'Isaya', JER: 'Yeremia', LAM: 'Ekerero',
  EZK: 'Ezekieli', DAN: 'Danieli', HOS: 'Hosea', JOL: 'Yoeli', AMO: 'Amosi', OBA: 'Obadia', JON: 'Yona',
  MIC: 'Mika', NAM: 'Nahumu', HAB: 'Habakuki', ZEP: 'Sefania', HAG: 'Hagai', ZEC: 'Zakaria', MAL: 'Malaki',
  MAT: 'Matayo', MRK: 'Mariko', LUK: 'Luka', JHN: 'Yohana', ACT: 'Ogokora Kw’abatomwa', ROM: 'Abarumi',
  '1CO': '1 Abakorinto', '2CO': '2 Abakorinto', GAL: 'Abagalatia', EPH: 'Abaefeso', PHP: 'Abafilipi',
  COL: 'Abakolosai', '1TH': '1 Abatesaloniki', '2TH': '2 Abatesaloniki', '1TI': '1 Timotheo',
  '2TI': '2 Timotheo', TIT: 'Tito', PHM: 'Filemoni', HEB: 'Abaiberania', JAS: 'Yakobo', '1PE': '1 Petero',
  '2PE': '2 Petero', '1JN': '1 Yohana', '2JN': '2 Yohana', '3JN': '3 Yohana', JUD: 'Yuda', REV: 'Okomaanoka',
};

/** A `web` version's page for a chapter: eBible names them GEN01.htm, and
 *  PSA001.htm (three digits: Psalms runs past 99). */
export const webChapterUrl = (version, bookId, chapter) =>
  `${version.web}${bookId}${String(chapter).padStart(bookId === 'PSA' ? 3 : 2, '0')}.htm`;

/** eBible's chapter page with our look built in: our <style> last in its
 *  <head> (so it wins), and its address as the base for its own links. Built
 *  into the page itself — injecting it as the page loads raced on Android and
 *  some chapters kept eBible's black text. */
export const styleWebChapter = (html, css, baseUrl) => {
  const style = `<base href="${baseUrl}"><style>${css}</style>`;
  const page = String(html || '');
  if (/<\/head>/i.test(page)) return page.replace(/<\/head>/i, `${style}</head>`);
  if (/<body[^>]*>/i.test(page)) return page.replace(/<body[^>]*>/i, (b) => `<head>${style}</head>${b}`);
  return `<head>${style}</head>${page}`;
};

/** Which pages the reader may open inside a `web` version's chapter: that
 *  chapter itself (its footnote links jump within it). Anything else — a
 *  link to eBible's home, the copyright page — opens outside the app. */
export const staysInReader = (url, chapterUrl) => {
  const bare = (u) => String(u || '').split('#')[0].replace(/^https?:\/\//i, '').toLowerCase();
  return /^(about:blank|data:)/i.test(String(url || '')) || bare(url) === bare(chapterUrl);
};
