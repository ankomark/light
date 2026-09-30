/**
 * One order: a seller sees the buyer (and can message them), not their own
 * payment details or buttons that would call themselves; a buyer can message
 * a seller in the app; a fresh page per order; a failed refresh says so;
 * it is read again when back in view; Buy again buys what was bought.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { dropCache } from '../../../utils/screenCache';

jest.setTimeout(20000);

const mockApi = {
  fetchOrderById: jest.fn(), getOrCreateConversation: jest.fn(), addToCart: jest.fn(),
  fetchCart: jest.fn(async () => ({ items: [] })), confirmOrderPayment: jest.fn(),
};
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
let mockMe = { id: 2, username: 'ann' };
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: mockMe }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockFocus = [];
const mockNav = {
  navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(),
  addListener: (name, fn) => { if (name === 'focus') mockFocus.push(fn); return () => {}; },
};
let mockParams = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav, useRoute: () => ({ params: mockParams }),
  useFocusEffect: () => {},
}));
jest.mock('react-native-vector-icons/FontAwesome', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../utils/optionalNative', () => ({ clipboard: () => null }));

const store = require('../../../utils/cartStore');
const OrderDetail = require('../OrderDetail').default;

const lineOf = (id, sellerId, extra) => ({
  id, quantity: 1, title: `Thing ${id}`, price_at_purchase: '10.00', currency: 'KES', seller: sellerId,
  product: {
    id: 100 + id, slug: `p-${id}`, title: `Thing ${id}`, price: '10.00', currency: 'KES', quantity: 5,
    is_available: true, seller: { id: sellerId, username: `s${sellerId}` },
    mpesa_number: '0712 SELLER', whatsapp_number: '254712',
  },
  ...extra,
});
const order = (extra) => ({
  id: 42, status: 'PENDING', buyer: { id: 9, username: 'mark' },
  items: [lineOf(1, 2)], timeline: [], ...extra,
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.fetchCart.mockResolvedValue({ items: [] });
  mockNav.navigate.mockClear();
  mockFocus.length = 0;
  mockMe = { id: 2, username: 'ann' };
  store.resetMarketStore();
  [42, 43].forEach((id) => { dropCache(`u2:market:order:${id}`); dropCache(`u9:market:order:${id}`); });
});

test('the seller sees who bought it and can message them, not their own pay details', async () => {
  mockParams = { orderId: 42, order: order() };
  mockApi.fetchOrderById.mockResolvedValue(order());
  mockApi.getOrCreateConversation.mockResolvedValue({ id: 5, other_participant: { id: 9, username: 'mark' } });
  const screen = render(<OrderDetail />);
  expect(screen.getByText('market.order.boughtBy:mark')).toBeTruthy();
  expect(screen.queryByText('0712 SELLER')).toBeNull();
  expect(screen.queryByTestId('seller-whatsapp')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('message-buyer')); });
  expect(mockApi.getOrCreateConversation).toHaveBeenCalledWith(9);
  expect(mockNav.navigate).toHaveBeenCalledWith('Chat', {
    conversationId: 5, otherUser: { id: 9, username: 'mark' }, draft: 'market.order.chatDraft:42',
  });
});

test('the buyer can message a seller in the app', async () => {
  mockMe = { id: 9, username: 'mark' };
  mockParams = { orderId: 42, order: order() };
  mockApi.fetchOrderById.mockResolvedValue(order());
  mockApi.getOrCreateConversation.mockRejectedValue(new Error('offline'));
  const screen = render(<OrderDetail />);
  expect(screen.getByText('0712 SELLER')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('message-seller')); });
  expect(mockApi.getOrCreateConversation).toHaveBeenCalledWith(2);
  expect(screen.getByText('market.order.chatFailed')).toBeTruthy();
});

test('handed another order, the page starts afresh for it', () => {
  mockParams = { orderId: 42, order: order() };
  mockApi.fetchOrderById.mockImplementation(() => new Promise(() => {}));
  const screen = render(<OrderDetail />);
  expect(screen.getByText('market.order.number:42')).toBeTruthy();
  mockParams = { orderId: 43 };
  screen.rerender(<OrderDetail />);
  expect(screen.queryByText('market.order.number:42')).toBeNull();
});

test('a refresh that fails says so above the order kept, and tries again', async () => {
  mockParams = { orderId: 42, order: order() };
  mockApi.fetchOrderById.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue(order());
  const screen = render(<OrderDetail />);
  await waitFor(() => expect(screen.getByTestId('order-stale')).toBeTruthy());
  fireEvent.press(screen.getByTestId('order-stale'));
  await waitFor(() => expect(screen.queryByTestId('order-stale')).toBeNull());
  expect(mockApi.fetchOrderById).toHaveBeenCalledTimes(2);
});

test('back in view, it is read again', async () => {
  mockParams = { orderId: 42, order: order() };
  mockApi.fetchOrderById.mockResolvedValue(order());
  render(<OrderDetail />);
  await waitFor(() => expect(mockApi.fetchOrderById).toHaveBeenCalledTimes(1));
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + 60000);
  await act(async () => { mockFocus.forEach((fn) => fn()); });
  Date.now.mockRestore();
  expect(mockApi.fetchOrderById).toHaveBeenCalledTimes(2);
});

test('Buy again puts back what was bought, as many as were, and not what was called off', async () => {
  mockMe = { id: 9, username: 'mark' };
  const done = order({
    status: 'DELIVERED',
    items: [
      lineOf(1, 2, { quantity: 3 }),
      lineOf(2, 2, { cancelled_at: '2026-09-30T10:00:00Z' }),
    ],
  });
  mockParams = { orderId: 42, order: done };
  mockApi.fetchOrderById.mockResolvedValue(done);
  mockApi.addToCart.mockResolvedValue({});
  const screen = render(<OrderDetail />);
  await act(async () => { fireEvent.press(screen.getByTestId('order-buy-again')); });
  await waitFor(() => expect(mockNav.navigate).toHaveBeenCalledWith('Cart'));
  expect(mockApi.addToCart).toHaveBeenCalledTimes(1);
  expect(mockApi.addToCart).toHaveBeenCalledWith(101, 3);
});
