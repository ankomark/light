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
