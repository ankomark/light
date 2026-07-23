// Guards the class of miss that survived the original localisation sweep.
//
// That sweep looked for three shapes — >Text<, placeholder="…", Alert.alert('…'
// — so it could not see a user-facing sentence passed as an ARGUMENT or held in
// a module-level array. 139 strings hid there. This test looks for the *shape of
// a sentence* anywhere in the source instead, which is the check that would have
// caught them.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['components', 'pages'];

// Starts with a capital, contains a space, long enough to be prose rather than
// an identifier, a key, or a MIME type.
const SENTENCE = /'([A-Z][^']{18,140})'/g;

const IGNORE_SUBSTRINGS = [
  'http', 'require(', 'import ', 'StyleSheet', '@expo', 'react-native', './',
  'Content-Type', 'application/', 'image/', 'video/', 'audio/', 'multipart',
  'Bearer', 'YYYY',
  // developer-facing log text, never rendered
  'Error fetching', 'Error loading', 'Error picking', 'error:', 'Error:',
];

// ErrorBoundary is intentionally English: it is a class component AND the
// last-resort crash screen, so it must render even if i18n is what failed.
const ALLOWED_FILES = ['components/ErrorBoundary.js'];

const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...walk(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
};

describe('no hardcoded user-facing sentences', () => {
  it('every prose string goes through t()', () => {
    const offenders = [];

    for (const dir of DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        if (ALLOWED_FILES.includes(rel)) continue;

        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
          if (line.includes('console.') || line.includes('throw new Error')) return;

          for (const m of line.matchAll(SENTENCE)) {
            const text = m[1];
            if (!text.includes(' ')) continue;
            if (IGNORE_SUBSTRINGS.some((s) => text.includes(s))) continue;
            offenders.push(`${rel}:${i + 1}  ${text}`);
          }
        });
      }
    }

    if (offenders.length) {
      throw new Error(
        `${offenders.length} hardcoded user-facing string(s) found — move them into ` +
        `i18n/strings.js and read them with t():\n  ` + offenders.join('\n  ')
      );
    }
  });
});
