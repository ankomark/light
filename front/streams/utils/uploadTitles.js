// Song titles and order from the files an album upload picked.
//
//   "03 - Amazing_Grace.mp3" → "Amazing Grace"
//
// Files named with their track numbers sort into album order (2 before 10).

// A leading track number: "01 ", "1.", "01 - ", "1_", "Track 03 - ".
const LEADING_NUMBER = /^\s*(?:track\s*)?\d{1,3}\s*(?:[-._)]\s*|\s+)/i;

export const titleFromFileName = (name = '') => {
  const base = String(name).replace(/\.[^/.]+$/, '');   // no extension
  const words = base.replace(/_/g, ' ');
  const stripped = words.replace(LEADING_NUMBER, '');
  // A file named only "01" keeps its number rather than becoming nothing.
  return (stripped.trim() || words.trim()).replace(/\s+/g, ' ');
};

const collator = typeof Intl !== 'undefined' && Intl.Collator
  ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  : null;

export const byFileName = (a, b) => {
  const x = a?.name || '';
  const y = b?.name || '';
  return collator ? collator.compare(x, y) : x.localeCompare(y);
};
