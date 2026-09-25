// A chapter's text as paragraphs ("blocks") — what a reader highlights and
// notes. Blocks are the markdown between blank lines (a fenced code block
// stays whole). A highlight remembers its block's place and words, so it can
// be found again after the author edits: at its place if the words still
// match there, else wherever those words now are.

const FOOTREF = /\[\^([\w-]{1,20})\](?!:)/g;
const FOOTDEF = /^\[\^([\w-]{1,20})\]:[ \t]*(.*)$/gm;
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n) => String(n).split('').map((d) => SUP[d]).join('');

/** Footnotes, as the EPUB draws them: "[^1]" in the text becomes a small
 *  raised number, and the "[^1]: note" lines gather under Notes at the end.
 *  → { body, notes: [{ n, text }] } */
export const splitFootnotes = (md = '') => {
  const defs = {};
  let body = String(md).replace(FOOTDEF, (m, key, text) => { defs[key] = text.trim(); return ''; });
  const order = [];
  body = body.replace(FOOTREF, (m, key) => {
    if (!(key in defs)) return m;
    if (!order.includes(key)) order.push(key);
    return sup(order.indexOf(key) + 1);
  });
  return { body, notes: order.map((k, i) => ({ n: i + 1, text: defs[k] })) };
};

/** Markdown → [block markdown]. */
export const splitBlocks = (md = '') => {
  const blocks = [];
  let cur = [];
  let fence = false;
  for (const line of String(md).replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && !line.trim()) {
      if (cur.length) { blocks.push(cur.join('\n')); cur = []; }
      continue;
    }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur.join('\n'));
  return blocks;
};

/** A block's words without markdown: for quotes, sharing and reading aloud. */
export const plainText = (md = '') => String(md)
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')          // pictures
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')         // links → their words
  .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')   // headings, quotes, list marks
  .replace(/(\*\*|__|\*|_|~~|`)/g, '')
  .replace(/^\s*(-{3,}|\*{3,})\s*$/gm, '')        // dividers
  .replace(/\s+/g, ' ')
  .trim();

/** Words a reader reads — counted as the server counts them (pictures and
 *  link addresses aren't words), so the editor and the book page agree. */
export const countWords = (md = '') => {
  const text = String(md)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const words = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
};

export const QUOTE_MAX = 2000;
export const quoteOf = (block) => plainText(block).slice(0, QUOTE_MAX);

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Where a highlight is now: its block's index, or -1 if its words are gone. */
export const findBlock = (plainBlocks, hl) => {
  const want = norm(hl.quote).slice(0, 120);
  if (!want) return -1;
  const at = plainBlocks[hl.block];
  if (at != null && norm(at).startsWith(want)) return hl.block;
  const i = plainBlocks.findIndex((b) => norm(b).startsWith(want));
  if (i >= 0) return i;
  return plainBlocks.findIndex((b) => norm(b).includes(want.slice(0, 60)));
};
