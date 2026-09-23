/**
 * The phone's region as a two-letter code ('KE' from a 'sw-KE' or 'en-KE'
 * locale), for country charts; '' when the locale names none. Read from Intl,
 * like the app's language — no native module.
 */
export function regionFromLocale(locale) {
  const parts = String(locale || '').replace('_', '-').split('-');
  const code = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
  return code ? code.toUpperCase() : '';
}

let cached = null;
export function deviceCountry() {
  if (cached !== null) return cached;
  try {
    cached = regionFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    cached = '';
  }
  return cached;
}

// Names for the countries the app is used in most; others show their code.
const NAMES = {
  KE: 'Kenya', UG: 'Uganda', TZ: 'Tanzania', RW: 'Rwanda', BI: 'Burundi', ET: 'Ethiopia',
  SS: 'South Sudan', CD: 'DR Congo', ZM: 'Zambia', MW: 'Malawi', ZW: 'Zimbabwe', NG: 'Nigeria',
  GH: 'Ghana', ZA: 'South Africa', US: 'USA', GB: 'UK', CA: 'Canada', AU: 'Australia', IN: 'India',
};
export const countryName = (code) => NAMES[code] || code || '';
