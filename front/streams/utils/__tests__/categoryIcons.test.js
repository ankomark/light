import { categoryIcon } from '../categoryIcons';

test.each([
  ['Electronics', 'chip'],
  ['Electrical appliances', 'chip'],
  ['Clothing', 'tshirt-crew'],
  ['Nguo na mavazi', 'tshirt-crew'],
  ['Headphones', 'headphones'],
  ['Phones & Tablets', 'cellphone'],
  ['Shoes', 'shoe-sneaker'],
  ['Books', 'book-open-variant'],
  ['Bibles', 'book-cross'],
  ['Scarves', 'shopping-outline'],
  ['', 'shopping-outline'],
])('%s -> %s', (name, icon) => {
  expect(categoryIcon(name).icon).toBe(icon);
});

describe('the marketplace categories', () => {
  const { MARKET_CATEGORIES, categoryKey, categoryLabel, categoryIcon: icon } = require('../categoryIcons');
  test('every one has its own picture, except Other', () => {
    MARKET_CATEGORIES.filter((n) => n !== 'Other').forEach((n) => {
      expect([n, icon(n).icon]).not.toEqual([n, 'shopping-outline']);
    });
  });
  test('named in the reader language, as it is when not on the list', () => {
    const t = (k) => ({ 'market.cat.phones_tablets': 'Simu na Tableti' }[k] || k);
    expect(categoryKey('Phones & Tablets')).toBe('phones_tablets');
    expect(categoryLabel('Phones & Tablets', t)).toBe('Simu na Tableti');
    expect(categoryLabel('Something staff added', t)).toBe('Something staff added');
  });
});
