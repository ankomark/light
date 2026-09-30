/**
 * One product's page: a fresh page for each product, never more than is in
 * stock, the seller sees Edit (not Buy), a product gone or not loaded says
 * so, photos swipe with a count, and more like it below.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { dropCache } from '../../../utils/screenCache';

jest.setTimeout(20000);

const mockApi = {
  fetchCart: jest.fn(async () => ({ items: [] })), addToCart: jest.fn(), buyNow: jest.fn(),
  fetchWishlist: jest.fn(async () => ({ products: [] })), addToWishlist: jest.fn(), removeFromWishlist: jest.fn(),
  fetchProducts: jest.fn(), fetchProductById: jest.fn(), fetchProductReviews: jest.fn(), addProductReview: jest.fn(),
};
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockNav = { navigate: jest.fn(), push: jest.fn(), goBack: jest.fn(), addListener: () => () => {} };
let mockParams = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: (fn) => require('react').useEffect(fn, []),
}));
jest.mock('react-native-vector-icons/FontAwesome', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../ReportModal', () => () => null);
jest.mock('../../ShareCardSheet', () => () => null);
jest.mock('../../../utils/optionalNative', () => ({ clipboard: () => null, viewShot: () => null }));

const store = require('../../../utils/cartStore');
const ProductDetail = require('../ProductDetail').default;

const product = (id, extra) => ({
  id, slug: `p-${id}`, title: `Thing ${id}`, price: '100.00', currency: 'KES', quantity: 5,
  is_available: true, category: 'Shoes', images: [], seller: { id: 2, username: 'sella' }, ...extra,
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.fetchWishlist.mockResolvedValue({ products: [] });
  mockApi.fetchCart.mockResolvedValue({ items: [] });
  mockApi.fetchProductReviews.mockResolvedValue([]);
  mockApi.fetchProducts.mockResolvedValue({ results: [] });
  mockNav.navigate.mockClear();
  mockNav.push.mockClear();
  mockParams = {};
  store.resetMarketStore();
  ['p-1', 'p-2'].forEach((s) => dropCache(`market:product:${s}`));
});

test('never more than is in stock, even when the stock is re-read lower', async () => {
  mockParams = { slug: 'p-1', preview: product(1) };
  mockApi.fetchProductById.mockResolvedValue(product(1, { quantity: 2 }));
  mockApi.buyNow.mockResolvedValue({ id: 50 });
  const screen = render(<ProductDetail />);
  fireEvent.press(screen.getByTestId('product-more'));
  fireEvent.press(screen.getByTestId('product-more'));
  fireEvent.press(screen.getByTestId('product-more'));
  await waitFor(() => expect(screen.getByTestId('product-qty').props.children).toBe(2));
  await act(async () => { fireEvent.press(screen.getByTestId('product-buy-now')); });
  expect(mockApi.buyNow).toHaveBeenCalledWith(1, 2);
});

test('the seller sees Edit, not Buy now, Add to cart or a quantity', async () => {
  mockParams = { slug: 'p-1' };
  mockApi.fetchProductById.mockResolvedValue(product(1, { is_owner: true }));
  const screen = render(<ProductDetail />);
  await waitFor(() => expect(screen.getByTestId('product-edit')).toBeTruthy());
  expect(screen.queryByTestId('product-buy-now')).toBeNull();
  expect(screen.queryByTestId('product-add-to-cart')).toBeNull();
  expect(screen.queryByTestId('product-qty')).toBeNull();
  fireEvent.press(screen.getByTestId('product-edit'));
  expect(mockNav.navigate).toHaveBeenCalledWith('EditProduct', { slug: 'p-1' });
});

test('a product gone since it was listed says so and cannot be bought', async () => {
  mockParams = { slug: 'p-1', preview: product(1) };
  mockApi.fetchProductById.mockRejectedValue(new Error('Product not found'));
  const screen = render(<ProductDetail />);
  await waitFor(() => expect(screen.getByTestId('product-gone')).toBeTruthy());
  expect(screen.getByTestId('product-buy-now').props.accessibilityState?.disabled).toBe(true);
});

test('a failed load offers to try again instead of spinning for ever', async () => {
  mockParams = { slug: 'p-1', preview: product(1) };
  mockApi.fetchProductById.mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce(product(1, { description: 'Leather, size 42' }));
  const screen = render(<ProductDetail />);
  await waitFor(() => expect(screen.getByTestId('product-retry')).toBeTruthy());
  fireEvent.press(screen.getByTestId('product-retry'));
  await waitFor(() => expect(screen.getByText('Leather, size 42')).toBeTruthy());
});

test('empty contact fields are left out, not rendered as stray text', async () => {
  mockParams = { slug: 'p-1' };
  mockApi.fetchProductById.mockResolvedValue(product(1, { whatsapp_number: '', contact_number: '', location: '' }));
  const screen = render(<ProductDetail />);
  await waitFor(() => expect(screen.getByText('Thing 1')).toBeTruthy());
  expect(screen.queryByText('market.product.contactInfo')).toBeNull();
});

test('handed another product, the page starts afresh for it', async () => {
  mockParams = { slug: 'p-1', preview: product(1) };
  mockApi.fetchProductById.mockImplementation(() => new Promise(() => {}));
  const screen = render(<ProductDetail />);
  fireEvent.press(screen.getByTestId('product-more'));
  expect(screen.getByTestId('product-qty').props.children).toBe(2);
  mockParams = { slug: 'p-2', preview: product(2) };
  screen.rerender(<ProductDetail />);
  expect(screen.getByText('Thing 2')).toBeTruthy();
  expect(screen.queryByText('Thing 1')).toBeNull();
  expect(screen.getByTestId('product-qty').props.children).toBe(1);
});

test('photos swipe, with a count; a thumbnail jumps to its photo', async () => {
  const images = [1, 2, 3].map((i) => ({ id: i, image_url: `https://cdn/${i}.jpg` }));
  mockParams = { slug: 'p-1', preview: product(1, { images }) };
  mockApi.fetchProductById.mockImplementation(() => new Promise(() => {}));
  const screen = render(<ProductDetail />);
  fireEvent(screen.getByTestId('product-gallery'), 'layout', { nativeEvent: { layout: { width: 300 } } });
  expect(screen.getByText('1/3')).toBeTruthy();
  fireEvent.press(screen.getByTestId('thumb-2'));
  expect(screen.getByText('3/3')).toBeTruthy();
});

test('more like it, from the same category, not itself; opens on top of this one', async () => {
  mockParams = { slug: 'p-1' };
  mockApi.fetchProductById.mockResolvedValue(product(1));
  mockApi.fetchProducts.mockResolvedValue({ results: [product(1), product(2)] });
  const screen = render(<ProductDetail />);
  await waitFor(() => expect(screen.getByTestId('more-2')).toBeTruthy());
  expect(mockApi.fetchProducts).toHaveBeenCalledWith(1, { page_size: 11, category: 'Shoes' });
  expect(screen.queryByTestId('more-1')).toBeNull();
  fireEvent.press(screen.getByTestId('more-2'));
  expect(mockNav.push).toHaveBeenCalledWith('ProductDetail', expect.objectContaining({ slug: 'p-2' }));
});

test('my earlier review is filled in, so posting again edits it', async () => {
  mockParams = { slug: 'p-1' };
  mockApi.fetchProductById.mockResolvedValue(product(1, { can_review: true }));
  mockApi.fetchProductReviews.mockResolvedValue([
    { id: 4, rating: 4, comment: 'Fits well', reviewer: { id: 7, username: 'mark' } },
  ]);
  const screen = render(<ProductDetail />);
  await waitFor(() => expect(screen.getByDisplayValue('Fits well')).toBeTruthy());
});

test('no review form until it is known whether I may review', () => {
  mockParams = { slug: 'p-1', preview: product(1) };
  mockApi.fetchProductById.mockImplementation(() => new Promise(() => {}));
  const screen = render(<ProductDetail />);
  expect(screen.queryByText('market.product.submitReview')).toBeNull();
});
