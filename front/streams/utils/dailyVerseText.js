// The verse of the day in the reader's own Bible.
//
// The server chooses the verse and sends it in the KJV it imported. Everyone
// reading in Swahili (or in any version they picked in the reader) should see
// it in that Bible, so the text is fetched the way the reader fetches it —
// from the same source, cached on the phone the same way — and the KJV stays
// as the fallback while that loads or when it can't.
//
// Versification: the online versions number verses as the KJV does (checked
// for all 202 curated verses in NENO, including titled psalms like 51:10), so
// a (book, chapter, verse) from the server finds the same verse there.
import { BIBLE_BOOKS, DEFAULT_BIBLE_VERSION, getBibleVersion } from './bibleVersions';
import { fetchBibleBooks, fetchBibleChapter } from '../services/bible';
import { formatRef } from '../services/bibleLibrary';

// The server names books as the KJV import does ("Psalms", "1 Corinthians");
// the reader wants its code ("PSA", "1CO"). Same English names on both sides.
const BOOK_IDS = new Map(BIBLE_BOOKS.map((b) => [b.english, b.id]));
export const bookIdFor = (name) => BOOK_IDS.get(name) || null;

/** "Song of Solomon 2:4" → { bookId: 'SNG', chapter: 2, verse: 4 }, the way
 *  the Bible reader opens at a verse; null for anything it cannot place. */
export const parseReference = (reference) => {
  const m = /^(.+?)\s+(\d+):(\d+)/.exec(String(reference || '').trim());
  const bookId = m && bookIdFor(m[1]);
  return bookId ? { bookId, chapter: Number(m[2]), verse: Number(m[3]) } : null;
};

// The version shown when someone reads the app in Swahili but has never
// chosen a Bible: NENO, the reader's first Swahili version.
const SWAHILI_DEFAULT = 'swh_bib';

/**
 * Which version the verse is shown in. The reader's own choice when they made
 * one; otherwise the app's language decides. The preference defaults to the
 * KJV, so "chose the KJV" and "never chose" look alike — in a Swahili app the
 * second is far likelier, and that reader gets Swahili.
 */
export const versionForVerse = (preferred, language) => {
  const chosen = preferred && preferred !== DEFAULT_BIBLE_VERSION ? getBibleVersion(preferred) : null;
  // A `web` version (Ekegusii) is eBible's pages, not text we can lift a verse from.
  if (chosen && chosen.id === preferred && !chosen.web) return chosen.id;
  if (language === 'sw') return SWAHILI_DEFAULT;
  return DEFAULT_BIBLE_VERSION;
};

// Speech marks that open in this verse and close in a later one (or the
// reverse) — the card draws its own quotation mark around the verse.
const STRAY_QUOTES = /^[\s“”‘’"']+|[\s“”‘’"']+$/g;

/**
 * { text, reference, bookName, versionId, abbr, lang } for `verse` in
 * `versionId`, or null when that is the KJV (the server's own text is it).
 * Throws when the version cannot be reached and was never cached.
 */
export const translateVerse = async (verse, versionId) => {
  if (!verse || versionId === DEFAULT_BIBLE_VERSION) return null;
  const bookId = bookIdFor(verse.book);
  if (!bookId) return null;

  const [books, chapter] = await Promise.all([
    fetchBibleBooks(versionId),
    fetchBibleChapter(versionId, bookId, verse.chapter),
  ]);
  const item = chapter.items.find((i) => i.type === 'verse' && Number(i.number) === Number(verse.verse));
  if (!item) throw new Error('verse not in this version');

  // Poetry lines become one line: the card centres a sentence, not a stanza.
  const text = item.parts.map((p) => p.text).join('')
    .replace(/\s*\n\s*/g, ' ').replace(STRAY_QUOTES, '').trim();
  if (!text) throw new Error('empty verse');

  const bookName = books.find((b) => b.id === bookId)?.name || verse.book;
  const version = getBibleVersion(versionId);
  return {
    text,
    reference: formatRef(bookName, verse.chapter, [verse.verse]),
    bookName,
    versionId,
    abbr: version.abbr,
    lang: version.lang,
  };
};
