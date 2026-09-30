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
  expect(mockPrefetch).toHaveBeenCalledWith(['https://cdn/1.jpg']);
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
