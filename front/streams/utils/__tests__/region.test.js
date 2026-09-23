import { regionFromLocale, countryName } from '../region';
import { genreName } from '../genres';

test('the region comes from the locale', () => {
  expect(regionFromLocale('sw-KE')).toBe('KE');
  expect(regionFromLocale('en_ke')).toBe('KE');
  expect(regionFromLocale('zh-Hant-TW')).toBe('TW');
  expect(regionFromLocale('en')).toBe('');
  expect(regionFromLocale(undefined)).toBe('');
});

test('country names, falling back to the code', () => {
  expect(countryName('KE')).toBe('Kenya');
  expect(countryName('FR')).toBe('FR');
});

test('genre names are translated when the app knows them', () => {
  const t = (k) => ({ 'genre.hymns': 'Nyimbo za Kristo' }[k] || k);
  expect(genreName(t, { slug: 'hymns', name: 'Hymns' })).toBe('Nyimbo za Kristo');
  expect(genreName(t, { slug: 'reggae', name: 'Reggae' })).toBe('Reggae');
  expect(genreName(t, null)).toBe('');
});
