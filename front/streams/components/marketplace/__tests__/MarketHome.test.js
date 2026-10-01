/**
 * The marketplace's front page: what people are selling shows at once from
 * the copy the app got ready in the background, products still show when the
 * categories fail, the grid goes on as it is scrolled, and the warm-up only
 * fetches when its copy is old.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { writeCache, dropCache, peekCache } from '../../../utils/screenCache';

jest.setTimeout(20000);

const mockApi = {
  fetchProducts: jest.fn(), fetchProductCategories: jest.fn(),
  fetchCart: jest.fn(async () => ({ items: [] })), fetchWishlist: jest.fn(async () => ({ products: [] })),
};
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), addListener: () => () => {} };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({ params: {} }) }));
jest.mock('react-native-vector-icons/FontAwesome', () => () => null);
jest.mock('@expo/vector-icons', () => {
  const { View } = require('react-native');
  return { MaterialCommunityIcons: ({ name }) => <View testID={`mci-${name}`} /> };
});
const mockPrefetch = jest.fn(() => Promise.resolve(true));
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  const Image = (props) => <View {...props} />;
  Image.prefetch = (...a) => mockPrefetch(...a);
  return { Image };
});

const { MARKET_HOME_KEY, warmMarket } = require('../../../utils/marketFeed');
const MarketplaceHome = require('../MarketplaceHome').default;

const product = (id) => ({
  id, slug: `p-${id}`, title: `Thing ${id}`, price: '10.00', currency: 'KES', quantity: 3,
  images: [{ image_url: `https://cdn/${id}.jpg` }], seller: { id: 2, username: 'sella' },
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.fetchCart.mockResolvedValue({ items: [] });
  mockPrefetch.mockClear();
  dropCache(MARKET_HOME_KEY);
});

test('what people are selling shows at once from the copy the app got ready', () => {
  writeCache(MARKET_HOME_KEY, { products: [product(1), product(2)], categories: [], next: false, at: Date.now() });
  mockApi.fetchProducts.mockImplementation(() => new Promise(() => {}));
  mockApi.fetchProductCategories.mockImplementation(() => new Promise(() => {}));
  const screen = render(<MarketplaceHome />);
  expect(screen.getByTestId('home-product-1')).toBeTruthy();
  expect(screen.getByTestId('home-product-2')).toBeTruthy();
});

test('products still show when the categories fail', async () => {
  mockApi.fetchProducts.mockResolvedValue({ results: [product(1)], next: null });
  mockApi.fetchProductCategories.mockRejectedValue(new Error('500'));
  const screen = render(<MarketplaceHome />);
  await waitFor(() => expect(screen.getByTestId('home-product-1')).toBeTruthy());
  expect(mockPrefetch).toHaveBeenCalledWith(expect.arrayContaining(['https://cdn/1.jpg']));
});

test('the grid goes on as it is scrolled', async () => {
  mockApi.fetchProducts.mockImplementation(async (page) => (page === 1
    ? { results: [product(1)], next: 'x' }
    : { results: [product(2)], next: null }));
  mockApi.fetchProductCategories.mockResolvedValue([]);
  const screen = render(<MarketplaceHome />);
  await waitFor(() => expect(screen.getByTestId('home-product-1')).toBeTruthy());
  await act(async () => { fireEvent(screen.getByTestId('market-home'), 'endReached'); });
  await waitFor(() => expect(screen.getByTestId('home-product-2')).toBeTruthy());
  expect(mockApi.fetchProducts).toHaveBeenLastCalledWith(2, { page_size: 20 });
});

test('a spotlight, rows that scroll sideways and named category chips', async () => {
  const cats = [
    { id: 1, name: 'Electronics', product_count: 4 },
    { id: 2, name: 'Clothing', product_count: 1 },
  ];
  mockApi.fetchProducts.mockImplementation(async (page, opts = {}) => {
    if (opts.sort === 'popular') {
      return { results: [{ ...product(50), views: 9 }, { ...product(51), views: 0 }], next: null };
    }
    if (opts.category === 1) return { results: [product(60), product(61)], next: null };
    return { results: Array.from({ length: 14 }, (_, i) => product(i + 1)), next: null };
  });
  mockApi.fetchProductCategories.mockResolvedValue(cats);
  const screen = render(<MarketplaceHome />);
  await waitFor(() => expect(screen.getByTestId('spot-50')).toBeTruthy());
  // Nothing looked at yet is no spotlight: it would only repeat the newest.
  expect(screen.queryByTestId('spot-51')).toBeNull();
  // The newest ten go sideways; the grid goes on after them, nothing twice.
  expect(screen.getByTestId('strip-new-1')).toBeTruthy();
  expect(screen.queryByTestId('home-product-1')).toBeNull();
  expect(screen.getByTestId('home-product-11')).toBeTruthy();
  expect(screen.getByTestId('strip-cat-1-60')).toBeTruthy();
  // Only categories with two or more things get a row of their own.
  expect(screen.queryByTestId('strip-cat-2')).toBeNull();
  expect(mockApi.fetchProducts).not.toHaveBeenCalledWith(1, expect.objectContaining({ category: 2 }));
  // The chips are names, no icons; the Electronics row's title keeps its own.
  expect(screen.getByTestId('home-category-2')).toHaveTextContent('Clothing');
  expect(screen.queryByTestId('mci-tshirt-crew')).toBeNull();
  expect(screen.getAllByTestId('mci-chip')).toHaveLength(1);
  fireEvent.press(screen.getByTestId('home-category-2'));
  expect(mockNav.navigate).toHaveBeenCalledWith('ProductList', { categoryId: 2, categoryName: 'Clothing' });
});

test('with only a few products, the grid shows them all and no strip repeats them', async () => {
  mockApi.fetchProducts.mockResolvedValue({ results: [1, 2, 3].map(product), next: null });
  mockApi.fetchProductCategories.mockResolvedValue([]);
  const screen = render(<MarketplaceHome />);
  await waitFor(() => expect(screen.getByTestId('home-product-3')).toBeTruthy());
  expect(screen.queryByTestId('strip-new')).toBeNull();
});

test('category rows are asked for as soon as the categories arrive, not after the products', async () => {
  mockApi.fetchProducts.mockImplementation((page, opts = {}) => (opts.category
    ? Promise.resolve({ results: [product(60)], next: null })
    : new Promise(() => {})));
  mockApi.fetchProductCategories.mockResolvedValue([{ id: 1, name: 'Shoes', product_count: 3 }]);
  render(<MarketplaceHome />);
  await waitFor(() => expect(mockApi.fetchProducts)
    .toHaveBeenCalledWith(1, expect.objectContaining({ category: 1 })));
});

test('the cart, My orders and Sell wear their coloured artwork', () => {
  writeCache(MARKET_HOME_KEY, { products: [product(1)], categories: [], next: false, at: Date.now() });
  mockApi.fetchProducts.mockImplementation(() => new Promise(() => {}));
  mockApi.fetchProductCategories.mockImplementation(() => new Promise(() => {}));
  const screen = render(<MarketplaceHome />);
  expect(screen.getByTestId('cart-art')).toBeTruthy();
  expect(screen.getByTestId('cart-button')).toHaveTextContent('market.cart.title');
  expect(screen.getByTestId('home-OrderHistory-art')).toBeTruthy();
  expect(screen.getByTestId('home-SellerDashboard-art')).toBeTruthy();
  fireEvent.press(screen.getByTestId('home-SellerDashboard'));
  expect(mockNav.navigate).toHaveBeenCalledWith('SellerDashboard');
});

describe('the background warm-up', () => {
  test('fills the copy, with photos, when there is none', async () => {
    mockApi.fetchProducts.mockResolvedValue({ results: [product(1)], next: null });
    mockApi.fetchProductCategories.mockResolvedValue([{ id: 1, name: 'Books', product_count: 1 }]);
    await warmMarket();
    expect(peekCache(MARKET_HOME_KEY).products[0].id).toBe(1);
    expect(mockPrefetch).toHaveBeenCalled();
  });

  test('leaves a fresh copy alone', async () => {
    writeCache(MARKET_HOME_KEY, { products: [product(9)], categories: [], at: Date.now() });
    await warmMarket();
    expect(mockApi.fetchProducts).not.toHaveBeenCalled();
  });

  test('keeps the old products if only the categories arrived', async () => {
    writeCache(MARKET_HOME_KEY, { products: [product(9)], categories: [], at: Date.now() - 60 * 60 * 1000 });
    mockApi.fetchProducts.mockRejectedValue(new Error('offline'));
    mockApi.fetchProductCategories.mockResolvedValue([]);
    await warmMarket();
    expect(peekCache(MARKET_HOME_KEY).products[0].id).toBe(9);
  });
});
