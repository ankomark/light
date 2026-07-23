// Catalog integrity. Translation is incremental — `sw` is allowed to be behind
// `en` and falls back to English — but these invariants must hold, because each
// one fails silently at runtime rather than throwing.
import { STRINGS, SUPPORTED_LANGS, LANGUAGES } from '../strings';

const en = STRINGS.en;

describe('string catalog', () => {
  it('has a dictionary for every supported language', () => {
    for (const lang of SUPPORTED_LANGS) {
      expect(STRINGS[lang]).toBeDefined();
    }
  });

  it('offers no language in the picker without a dictionary', () => {
    for (const { code } of LANGUAGES) {
      if (code === 'system') continue;
      expect(SUPPORTED_LANGS).toContain(code);
    }
  });

  it('has no translation key absent from the English baseline', () => {
    // A key only in `sw` is a typo: `en` is the fallback, so the English build
    // would render the raw key string to the user.
    for (const lang of SUPPORTED_LANGS) {
      if (lang === 'en') continue;
      const orphans = Object.keys(STRINGS[lang]).filter((k) => !(k in en));
      expect(orphans).toEqual([]);
    }
  });

  it('keeps interpolation placeholders identical across languages', () => {
    // The real trap: 'Block @{name}?' translated without {name} drops the
    // username entirely, and nothing errors — the user just sees a blank.
    const placeholders = (s) => (s.match(/\{(\w+)\}/g) || []).sort();

    for (const lang of SUPPORTED_LANGS) {
      if (lang === 'en') continue;
      for (const [key, value] of Object.entries(STRINGS[lang])) {
        if (!(key in en)) continue;
        expect({ key, placeholders: placeholders(value) })
          .toEqual({ key, placeholders: placeholders(en[key]) });
      }
    }
  });

  it('has no empty or whitespace-only translation', () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const [key, value] of Object.entries(STRINGS[lang])) {
        expect(typeof value === 'string' && value.trim().length > 0).toBe(true);
        if (!value.trim()) throw new Error(`${lang}.${key} is empty`);
      }
    }
  });

  it('leaves no translation identical to a key name', () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const [key, value] of Object.entries(STRINGS[lang])) {
        expect(value).not.toBe(key);
      }
    }
  });
});
