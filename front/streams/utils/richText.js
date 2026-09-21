// #hashtags and @mentions in captions — the client half of the server's
// songs/captions.py. Same rules, so what the author sees highlighted while
// typing is exactly what the server links:
//   - a token starts at the beginning of the text or after a non-word char
//     ("a#b" and "##x" are not tags);
//   - a tag is letters/digits/underscore in any script, not all digits;
//   - a mention is a username: word chars plus . + - (trailing ones dropped,
//     so "thanks @john." mentions john).
//
// Written as a scanner rather than regex lookbehind, which not every JS
// engine this app runs on supports.

let WORD;
try {
  WORD = new RegExp('[\\p{L}\\p{N}_]', 'u');
} catch {
  WORD = /[A-Za-z0-9_À-￿]/; // engines without \p{}: close enough
}
const isWord = (ch) => !!ch && WORD.test(ch);
const isNameChar = (ch) => isWord(ch) || ch === '.' || ch === '+' || ch === '-';

const MAX_TAG = 100;
const MAX_NAME = 150;

/**
 * Split text into [{ type: 'text'|'hashtag'|'mention', text, value? }].
 * `value` is the tag (lowercased, no '#') or the username (no '@').
 */
export const parseRichText = (text = '') => {
  const out = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { out.push({ type: 'text', text: buf }); buf = ''; } };

  while (i < text.length) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : '';
    if ((ch === '#' || ch === '@') && !isWord(prev) && prev !== ch) {
      const test = ch === '#' ? isWord : isNameChar;
      const max = ch === '#' ? MAX_TAG : MAX_NAME;
      let j = i + 1;
      while (j < text.length && j - i - 1 < max && test(text[j])) j++;
      let body = text.slice(i + 1, j);
      if (ch === '@') {
        const trimmed = body.replace(/[.+-]+$/, '');
        j -= body.length - trimmed.length;
        body = trimmed;
      }
      const valid = body.length > 0 && !(ch === '#' && /^\d+$/.test(body));
      if (valid) {
        flush();
        out.push(ch === '#'
          ? { type: 'hashtag', text: `#${body}`, value: body.toLowerCase() }
          : { type: 'mention', text: `@${body}`, value: body });
        i = j;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
};

/**
 * The #tag or @name the cursor is currently inside (for autocomplete), or
 * null. `query` may be '' right after typing the trigger.
 */
export const activeToken = (text = '', cursor = text.length) => {
  let i = cursor;
  while (i > 0 && isNameChar(text[i - 1])) i--;
  const trigger = text[i - 1];
  if (trigger !== '#' && trigger !== '@') return null;
  const before = i >= 2 ? text[i - 2] : '';
  if (isWord(before) || before === trigger) return null;
  const query = text.slice(i, cursor);
  if (trigger === '#' && /[.+-]/.test(query)) return null;
  return { trigger, query, start: i - 1, end: cursor };
};

/** Replace the active token with a chosen suggestion plus a trailing space. */
export const applySuggestion = (text, token, value) => {
  const insert = `${token.trigger}${value} `;
  // Swallow the rest of a half-typed word after the cursor too.
  let end = token.end;
  while (end < text.length && isNameChar(text[end])) end++;
  const next = text.slice(0, token.start) + insert + text.slice(end).replace(/^ /, '');
  return { text: next, cursor: token.start + insert.length };
};
