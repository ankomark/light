/**
 * Paying the sellers: the order number to quote, one Done (not two), a
 * delivery note that failed to save says so and stays, one already saved is
 * not sent again, and a part called off has nothing to pay.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockApi = { fetchOrderById: jest.fn(), apiRequest: jest.fn() };
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockNav = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), addListener: () => () => {} };
let mockParams = {};
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({ params: mockParams }) }));
jest.mock('react-native-vector-icons/FontAwesome', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../utils/optionalNative', () => ({ clipboard: () => null }));

const Checkout = require('../Checkout').default;

const seller = (id, name) => ({ id, username: name });
const lineOf = (id, s, price, extra) => ({
  id, quantity: 1, title: `Thing ${id}`, price_at_purchase: price, currency: 'KES',
  product: { id, seller: s, mpesa_number: '0712', whatsapp_number: '254712' }, ...extra,
});
const order = (extra) => ({
  id: 42, status: 'PENDING', shipping_address: '',
  items: [lineOf(1, seller(2, 'ann'), '100.00'), lineOf(2, seller(3, 'ben'), '50.00')],
  totals: [{ currency: 'KES', amount: '150.00' }], ...extra,
});

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockNav.replace.mockClear();
  mockApi.fetchOrderById.mockImplementation(() => new Promise(() => {}));
});

test('shows the order number to quote to the sellers', () => {
  mockParams = { orderId: 42, order: order() };
  const screen = render(<Checkout />);
  expect(screen.getByTestId('checkout-number').props.children).toBe('market.order.number:42');
});

test('a note that could not be saved says so and stays; Skip goes on', async () => {
  mockParams = { orderId: 42, order: order() };
  mockApi.apiRequest.mockRejectedValue(new Error('Network Error'));
  const screen = render(<Checkout />);
  fireEvent.changeText(screen.getByTestId('checkout-note'), 'Kisumu, Oginga Odinga St');
  await act(async () => { fireEvent.press(screen.getByTestId('checkout-done')); });
  expect(screen.getByText('market.checkout.noteFailed')).toBeTruthy();
  expect(mockNav.replace).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('market-toast-action'));
  expect(mockNav.replace).toHaveBeenCalledWith('OrderDetail', expect.objectContaining({ orderId: 42 }));
});

test('two quick taps on Done save once, and the next screen gets the saved order', async () => {
  mockParams = { orderId: 42, order: order() };
  let answer;
  mockApi.apiRequest.mockImplementation(() => new Promise((res) => { answer = res; }));
  const screen = render(<Checkout />);
  fireEvent.changeText(screen.getByTestId('checkout-note'), 'Gate B');
  fireEvent.press(screen.getByTestId('checkout-done'));
  fireEvent.press(screen.getByTestId('checkout-done'));
  await act(async () => { answer(order({ shipping_address: 'Gate B' })); });
  expect(mockApi.apiRequest).toHaveBeenCalledTimes(1);
  expect(mockNav.replace).toHaveBeenCalledTimes(1);
  expect(mockNav.replace.mock.calls[0][1].order.shipping_address).toBe('Gate B');
});

test('a note already saved is not sent again', async () => {
  mockParams = { orderId: 42, order: order({ shipping_address: 'Gate B' }) };
  const screen = render(<Checkout />);
  await act(async () => { fireEvent.press(screen.getByTestId('checkout-done')); });
  expect(mockApi.apiRequest).not.toHaveBeenCalled();
  expect(mockNav.replace).toHaveBeenCalled();
});

test('a part called off has nothing to pay and no paid message', () => {
  const o = order();
  o.items[1] = { ...o.items[1], cancelled_at: '2026-09-30T10:00:00Z' };
  mockParams = { orderId: 42, order: o };
  const screen = render(<Checkout />);
  expect(screen.getByTestId('seller-total-2')).toBeTruthy();
  expect(screen.queryByTestId('seller-total-3')).toBeNull();
  expect(screen.getAllByTestId('seller-whatsapp')).toHaveLength(1);
});

test('without an order to show, it says so instead of asking for nothing', async () => {
  mockParams = {};
  const screen = render(<Checkout />);
  await waitFor(() => expect(screen.getByText('market.checkout.loadFailed')).toBeTruthy());
  expect(mockApi.fetchOrderById).not.toHaveBeenCalled();
});
