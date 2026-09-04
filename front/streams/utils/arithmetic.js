/**
 * Evaluate a calculator expression, without eval().
 *
 * `eval` would be shorter, but it runs whatever it is handed: a calculator is
 * exactly the kind of screen where text ends up being pasted in, and Hermes
 * disallows it anyway. This is a tokenizer and a precedence-climbing parser —
 * a few dozen lines, and it can only ever produce a number.
 *
 * It understands: + − × ÷, percent, parentheses, unary minus, decimals.
 * Anything malformed returns null rather than throwing, because a calculator
 * that crashes on a half-typed sum is worse than one that simply waits.
 */

const isDigit = (c) => c >= '0' && c <= '9';

/** Split a string into numbers, operators and brackets. */
export const tokenize = (input) => {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === ' ') { i += 1; continue; }
    if (isDigit(c) || c === '.') {
      let n = '';
      while (i < input.length && (isDigit(input[i]) || input[i] === '.')) {
        n += input[i];
        i += 1;
      }
      // "1.2.3" is not a number; refuse rather than guess which dot was meant.
      if ((n.match(/\./g) || []).length > 1) return null;
      tokens.push({ type: 'num', value: parseFloat(n) });
      continue;
    }
    if ('+-*/%()'.includes(c)) {
      tokens.push({ type: c });
      i += 1;
      continue;
    }
    return null;                       // a character a calculator cannot mean
  }
  return tokens;
};

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2 };

const apply = (op, a, b) => {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    // Dividing by zero gives Infinity in JS, which is not an answer anyone
    // wants to see on a calculator.
    case '/': return b === 0 ? null : a / b;
    default: return null;
  }
};

/**
 * Precedence climbing: read a term, then keep absorbing operators that bind at
 * least as tightly as the caller allows.
 */
const parseExpression = (tokens, pos, minPrecedence) => {
  let left = parseTerm(tokens, pos);
  if (left === null) return null;

  for (;;) {
    const token = tokens[pos.i];
    if (!token || !(token.type in PRECEDENCE)) break;
    const precedence = PRECEDENCE[token.type];
    if (precedence < minPrecedence) break;
    pos.i += 1;
    const right = parseExpression(tokens, pos, precedence + 1);
    if (right === null) return null;
    left = apply(token.type, left, right);
    if (left === null) return null;
  }
  return left;
};

const parseTerm = (tokens, pos) => {
  const token = tokens[pos.i];
  if (!token) return null;

  if (token.type === '-') {            // unary minus: -5, or 3 × -2
    pos.i += 1;
    const value = parseTerm(tokens, pos);
    return value === null ? null : -value;
  }
  if (token.type === '+') {
    pos.i += 1;
    return parseTerm(tokens, pos);
  }
  if (token.type === '(') {
    pos.i += 1;
    const value = parseExpression(tokens, pos, 1);
    if (value === null || !tokens[pos.i] || tokens[pos.i].type !== ')') return null;
    pos.i += 1;
    return withPercent(tokens, pos, value);
  }
  if (token.type === 'num') {
    pos.i += 1;
    return withPercent(tokens, pos, token.value);
  }
  return null;
};

/** A trailing % turns the value it follows into hundredths. */
const withPercent = (tokens, pos, value) => {
  let out = value;
  while (tokens[pos.i] && tokens[pos.i].type === '%') {
    out /= 100;
    pos.i += 1;
  }
  return out;
};

/**
 * The answer, or null when the expression is incomplete or malformed.
 *
 * Null is the normal case while someone is still typing — callers show the
 * running total only when there is one.
 */
export const evaluate = (input) => {
  const tokens = tokenize(String(input || ''));
  if (!tokens || !tokens.length) return null;

  const pos = { i: 0 };
  const value = parseExpression(tokens, pos, 1);
  if (value === null || pos.i !== tokens.length) return null;
  if (!Number.isFinite(value)) return null;
  return value;
};

/**
 * Render a result the way a calculator does: no trailing zeros, no exponent
 * for ordinary numbers, and grouped thousands so a long answer stays readable.
 */
export const format = (value) => {
  if (value === null || value === undefined) return '';
  if (!Number.isFinite(value)) return '';

  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-9 || abs >= 1e15)) return value.toExponential(6);

  // Twelve significant digits is where floating point stops being trustworthy;
  // rounding here is what keeps 0.1 + 0.2 from reading as 0.30000000000000004.
  const rounded = parseFloat(value.toPrecision(12));
  const [whole, fraction] = String(rounded).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
};
