// A chapter's text as paragraphs ("blocks") — what a reader highlights and
// notes. Blocks are the markdown between blank lines (a fenced code block
// stays whole). A highlight remembers its block's place and words, so it can
// be found again after the author edits: at its place if the words still
// match there, else wherever those words now are.

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
