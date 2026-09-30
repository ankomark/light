/**
 * Marketplace phases 3–5: following an order (timeline, sent, received,
 * cancelling one seller's part, buying again, the tabs), selling (the
 * dashboard's numbers, quick edits, the shop front, a product's error in the
 * server's words) and "near me".
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { writeCache, dropCache } from '../../../utils/screenCache';

jest.setTimeout(20000);

const mockApi = {
  fetchOrderById: jest.fn(), confirmOrderPayment: jest.fn(), shipOrderPart: jest.fn(),
  markOrderReceived: jest.fn(), cancelOrderPart: jest.fn(), fetchOrders: jest.fn(),
  addToCart: jest.fn(async () => ({})), fetchCart: jest.fn(async () => ({ items: [] })),
  fetchSellerStats: jest.fn(), fetchProducts: jest.fn(), quickUpdateProduct: jest.fn(),
  deleteProduct: jest.fn(), fetchSellerProfile: jest.fn(async () => ({})), saveSellerProfile: jest.fn(),
  fetchShop: jest.fn(), fetchWishlist: jest.fn(async () => ({ products: [] })),
};
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
let mockUser = { id: 2, username: 'aseller' };
jest.mock('../../../context/useAuth', () => ({
  useAuth: () => ({ currentUser: mockUser, isAuthenticated: true, isLoading: false }),
}));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), addListener: () => () => {} };
let mockParams = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: (fn) => require('react').useEffect(fn, []),
}));
jest.mock('react-native-vector-icons/FontAwesome', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../ReportModal', () => () => null);
jest.mock('../../../utils/optionalNative', () => ({ clipboard: () => null, viewShot: () => null }));
let mockPlace = null;
jest.mock('../../../utils/preferences', () => ({
  getPreference: async () => mockPlace, PREF_KEYS: { weatherPlace: 'weatherPlace' },
}));

const store = require('../../../utils/cartStore');
const OrderDetail = require('../OrderDetail').default;
const OrderHistory = require('../OrderHistory').default;
const SellerDashboard = require('../SellerDashboard').default;
const SellerShop = require('../SellerShop').default;
const ProductList = require('../ProductList').default;
const { productError } = require('../AddProduct');

const product = (id, extra) => ({
  id, slug: `p-${id}`, title: `Thing ${id}`, price: '10.00', currency: 'KES', quantity: 5,
  is_available: true, images: [], seller: { id: 2, username: 'aseller' }, ...extra,
});
const line = (id, seller, extra) => ({
  id, quantity: 1, price_at_purchase: '10.00', currency: 'KES', title: `Line ${id}`, seller,
  product: product(id, { seller: { id: seller, username: `s${seller}` } }), ...extra,
});
const order = (items, extra) => ({
  id: 42, status: 'PROCESSING', payment_status: 'PENDING', created_at: '2026-09-30T10:00:00Z',
  buyer: { id: 9, username: 'buyer' }, items,
  timeline: [
    { step: 'placed', at: '2026-09-30T10:00:00Z' }, { step: 'paid', at: null },
    { step: 'shipped', at: null }, { step: 'delivered', at: null },
  ],
  ...extra,
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockNav.navigate.mockClear();
  mockParams = {};
  mockUser = { id: 2, username: 'aseller' };
  mockPlace = null;
  store.resetMarketStore();
  ['u2', 'u9'].forEach((u) => ['market:orders:buyer', 'market:seller:stats', 'market:seller:products',
    'market:seller:orders', 'market:cart'].forEach((k) => dropCache(`${u}:${k}`)));
});

describe('following an order', () => {
  test('the timeline shows where it is', () => {
    mockParams = { orderId: 42, order: order([line(1, 2)]) };
    mockApi.fetchOrderById.mockImplementation(() => new Promise(() => {}));
    const screen = render(<OrderDetail />);
    expect(screen.getByTestId('order-timeline')).toBeTruthy();
    expect(screen.getByText('market.step.placed')).toBeTruthy();
  });

  test('a paid seller marks their part sent, with a note', async () => {
    const paid = order([line(1, 2, { payment_confirmed_at: '2026-09-30T11:00:00Z' })]);
    mockParams = { orderId: 42, order: paid };
    mockApi.fetchOrderById.mockImplementation(() => new Promise(() => {}));
    mockApi.shipOrderPart.mockResolvedValue(order([line(1, 2, {
      payment_confirmed_at: '2026-09-30T11:00:00Z', shipped_at: '2026-09-30T12:00:00Z', tracking_note: 'Rider Joe',
    })], { status: 'SHIPPED' }));
    const screen = render(<OrderDetail />);
    fireEvent.press(screen.getByTestId('ship-open'));
    fireEvent.changeText(screen.getByTestId('ship-note'), 'Rider Joe');
    await act(async () => { fireEvent.press(screen.getByTestId('ship-send')); });
    expect(mockApi.shipOrderPart).toHaveBeenCalledWith(42, 'Rider Joe');
    expect(screen.getByTestId('part-2-shipped')).toBeTruthy();
    expect(screen.getByText('market.part.shipped · Rider Joe')).toBeTruthy();
  });

  test('the buyer says it arrived, then can buy it again', async () => {
    mockUser = { id: 9, username: 'buyer' };
    const sent = order([line(1, 2, { payment_confirmed_at: 'x', shipped_at: '2026-09-30T12:00:00Z' })], { status: 'SHIPPED' });
    mockParams = { orderId: 42, order: sent };
    mockApi.fetchOrderById.mockImplementation(() => new Promise(() => {}));
    mockApi.markOrderReceived.mockResolvedValue(order([line(1, 2, {
      payment_confirmed_at: 'x', shipped_at: 'y', delivered_at: '2026-10-01T09:00:00Z',
    })], { status: 'DELIVERED' }));
    const screen = render(<OrderDetail />);
    await act(async () => { fireEvent.press(screen.getByTestId('part-received')); });
    expect(mockApi.markOrderReceived).toHaveBeenCalledWith(42, 2);
    await act(async () => { fireEvent.press(screen.getByTestId('order-buy-again')); });
    expect(mockApi.addToCart).toHaveBeenCalledWith(1, 1);
    expect(mockNav.navigate).toHaveBeenCalledWith('Cart');
  });

  test("the buyer cancels one seller's part, after saying yes", async () => {
    mockUser = { id: 9, username: 'buyer' };
    mockParams = { orderId: 42, order: order([line(1, 2), line(2, 3)]) };
    mockApi.fetchOrderById.mockImplementation(() => new Promise(() => {}));
    mockApi.cancelOrderPart.mockResolvedValue(order([line(1, 2), line(2, 3, { cancelled_at: 'z' })]));
    jest.spyOn(Alert, 'alert').mockImplementation((title, body, buttons) => buttons[1].onPress());
    const screen = render(<OrderDetail />);
    await act(async () => { fireEvent.press(screen.getAllByTestId('part-cancel')[1]); });
    expect(mockApi.cancelOrderPart).toHaveBeenCalledWith(42, 3);
    expect(screen.getByTestId('part-3-cancelled')).toBeTruthy();
    Alert.alert.mockRestore();
  });

  test('My Orders in three piles', async () => {
    mockUser = { id: 9, username: 'buyer' };
    writeCache('u9:market:orders:buyer', [
      order([line(1, 2)], { id: 1, status: 'PENDING' }),
      order([line(2, 2)], { id: 2, status: 'DELIVERED' }),
      order([line(3, 2)], { id: 3, status: 'CANCELLED' }),
    ]);
    mockApi.fetchOrders.mockImplementation(() => new Promise(() => {}));
    const screen = render(<OrderHistory />);
    expect(screen.getByTestId('order-1')).toBeTruthy();
    expect(screen.queryByTestId('order-2')).toBeNull();
    fireEvent.press(screen.getByTestId('orders-tab-completed'));
    expect(screen.getByTestId('order-2')).toBeTruthy();
    fireEvent.press(screen.getByTestId('orders-tab-cancelled'));
    expect(screen.getByTestId('order-3')).toBeTruthy();
  });
});

describe('selling', () => {
  test("the dashboard's numbers, and a quick edit", async () => {
    mockApi.fetchSellerStats.mockResolvedValue({
      week: [{ currency: 'KES', amount: '1200' }], all_time: [], awaiting_payment: 2, to_send: 1,
      products: 1, views: 7, low_stock: [{ id: 1, slug: 'p-1', title: 'Hymnal', quantity: 1 }],
    });
    mockApi.fetchProducts.mockResolvedValue({ results: [product(1, { title: 'Hymnal', quantity: 1 })] });
    mockApi.fetchOrders.mockResolvedValue([]);
    mockApi.quickUpdateProduct.mockResolvedValue(product(1, { title: 'Hymnal', quantity: 9, price: '8.00' }));
    const screen = render(<SellerDashboard />);
    await waitFor(() => expect(screen.getByText('Ksh 1,200.00')).toBeTruthy());
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByTestId('low-stock')).toBeTruthy();
    fireEvent.press(screen.getByTestId('quick-1'));
    fireEvent.changeText(screen.getByTestId('quick-stock'), '9');
    fireEvent.changeText(screen.getByTestId('quick-price'), '8');
    await act(async () => { fireEvent.press(screen.getByTestId('quick-save')); });
    expect(mockApi.quickUpdateProduct).toHaveBeenCalledWith('p-1', { price: '8.00', quantity: 9, is_available: true });
    await waitFor(() => expect(screen.getByText('market.inStock:9')).toBeTruthy());
  });

  test('the shop front, with its tick and its products', async () => {
    mockParams = { username: 'aseller' };
    mockApi.fetchShop.mockResolvedValue({
      seller: { id: 2, username: 'aseller' }, is_verified: true, location: 'Nairobi',
      selling_since: '2026-01-01T00:00:00Z', products_on_offer: 1, sales: 3, rating: 4.5, review_count: 2,
    });
    mockApi.fetchProducts.mockResolvedValue({ results: [product(1)] });
    const screen = render(<SellerShop />);
    await waitFor(() => expect(screen.getByTestId('shop-verified')).toBeTruthy());
    expect(mockApi.fetchProducts).toHaveBeenCalledWith(1, { seller: 2, page_size: 40 });
    expect(screen.getByTestId('shop-product-1')).toBeTruthy();
  });

  test("a product's error is said in the server's words", () => {
    expect(productError({ title: ['This field is required.'] }, 'fallback')).toBe('This field is required.');
    expect(productError({ response: { data: { price: ['Too big.'] } } }, 'fallback')).toBe('Too big.');
    expect(productError(new Error('boom'), 'fallback')).toBe('fallback');
  });
});

test('"near me" narrows to the weather town', async () => {
  mockPlace = { name: 'Kisumu, Kenya', latitude: 0, longitude: 0 };
  mockApi.fetchProducts.mockResolvedValue({ results: [], next: null });
  const screen = render(<ProductList />);
  await waitFor(() => expect(screen.getByText('market.list.near:Kisumu')).toBeTruthy());
  fireEvent.press(screen.getByTestId('near-me'));
  await waitFor(() => expect(mockApi.fetchProducts).toHaveBeenLastCalledWith(1, { near: 'Kisumu' }));
});
