/**
 * The cart page and the store behind it: quick taps reach the server in
 * order, a refusal takes back only its own change, a read from the server
 * never undoes a change in flight, one order per checkout, lines that can no
 * longer be bought say so, and removing can be undone.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { dropCache } from '../../../utils/screenCache';

jest.setTimeout(20000);

const mockApi = {
  fetchCart: jest.fn(), addToCart: jest.fn(), updateCartItem: jest.fn(), removeFromCart: jest.fn(),
  checkoutCart: jest.fn(), fetchWishlist: jest.fn(async () => ({ products: [] })),
};
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), addListener: () => () => {} };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({ params: {} }) }));
jest.mock('react-native-vector-icons/FontAwesome', () => () => null);

const store = require('../../../utils/cartStore');
const Cart = require('../Cart').default;

const product = (id, extra) => ({
  id, slug: `p-${id}`, title: `Thing ${id}`, price: '100.00', currency: 'KES', quantity: 5,
  is_available: true, images: [], seller: { id: 2, username: 'sella' }, ...extra,
});
const line = (id, p, qty = 1) => ({ id, product: p, quantity: qty });
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const qtyOf = (screen, id) => screen.getByTestId(`cart-line-${id}`);

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.fetchWishlist.mockResolvedValue({ products: [] });
  mockNav.navigate.mockClear();
  store.resetMarketStore();
  dropCache('u7:market:cart');
});

const open = async (items) => {
  mockApi.fetchCart.mockResolvedValue({ items });
  const screen = render(<Cart />);
  await waitFor(() => expect(screen.getByTestId('cart-checkout')).toBeTruthy());
  return screen;
};

test('quick taps go to the server one at a time, and the last number wins', async () => {
  const screen = await open([line(9, product(1), 1)]);
  const first = deferred();
  mockApi.updateCartItem.mockImplementationOnce(() => first.promise).mockResolvedValue({});
  fireEvent.press(screen.getByTestId('cart-more-1'));
  fireEvent.press(screen.getByTestId('cart-more-1'));
  expect(screen.getByTestId('cart-total').props.children).toBe('Ksh 300.00');
  expect(mockApi.updateCartItem).toHaveBeenCalledTimes(1);
  expect(mockApi.updateCartItem).toHaveBeenLastCalledWith(9, 2);
  await act(async () => { first.resolve({}); });
  await waitFor(() => expect(mockApi.updateCartItem).toHaveBeenLastCalledWith(9, 3));
  expect(mockApi.updateCartItem).toHaveBeenCalledTimes(2);
});

test('a refused change takes back only its own line', async () => {
  const screen = await open([line(9, product(1), 1), line(10, product(2), 1)]);
  const refused = deferred();
  mockApi.updateCartItem.mockImplementation((id) => (id === 9 ? refused.promise : Promise.resolve({})));
  fireEvent.press(screen.getByTestId('cart-more-1'));
  fireEvent.press(screen.getByTestId('cart-more-2'));
  await act(async () => { refused.reject({ response: { data: { error: 'Only 1 in stock.' } } }); });
  // Line 1 back to 1, line 2 keeps its 2: 100 + 200.
  await waitFor(() => expect(screen.getByTestId('cart-total').props.children).toBe('Ksh 300.00'));
  expect(screen.getByText('Only 1 in stock.')).toBeTruthy();
});

test('a cart read from the server while a change is on its way does not undo it', async () => {
  const screen = await open([line(9, product(1), 1)]);
  const slow = deferred();
  mockApi.updateCartItem.mockImplementation(() => slow.promise);
  fireEvent.press(screen.getByTestId('cart-more-1'));
  // An older answer arrives meanwhile (pull to refresh, another screen).
  await act(async () => { await store.refreshCart(); });
  expect(screen.getByTestId('cart-total').props.children).toBe('Ksh 200.00');
  mockApi.fetchCart.mockResolvedValue({ items: [line(9, product(1), 2)] });
  await act(async () => { slow.resolve({}); });
  await waitFor(() => expect(mockApi.fetchCart).toHaveBeenCalledTimes(3));
  expect(screen.getByTestId('cart-total').props.children).toBe('Ksh 200.00');
  expect(qtyOf(screen, 1)).toBeTruthy();
});

test('two quick taps on checkout make one order, after the quantities have landed', async () => {
  const screen = await open([line(9, product(1), 1)]);
  const slow = deferred();
  mockApi.updateCartItem.mockImplementation(() => slow.promise);
  mockApi.checkoutCart.mockResolvedValue({ id: 42, items: [] });
  fireEvent.press(screen.getByTestId('cart-more-1'));
  fireEvent.press(screen.getByTestId('cart-checkout'));
  fireEvent.press(screen.getByTestId('cart-checkout'));
  expect(mockApi.checkoutCart).not.toHaveBeenCalled();
  await act(async () => { slow.resolve({}); });
  await waitFor(() => expect(mockApi.checkoutCart).toHaveBeenCalledTimes(1));
  expect(mockNav.navigate).toHaveBeenCalledWith('Checkout', { orderId: 42, order: { id: 42, items: [] } });
});

test('a line no longer for sale says so, is left out of the total, and holds checkout', async () => {
  const screen = await open([
    line(9, product(1), 1),
    line(10, product(2, { is_available: false }), 1),
    line(11, product(3, { quantity: 0 }), 1),
  ]);
  expect(screen.getByTestId('cart-gone-2')).toBeTruthy();
  expect(screen.getByTestId('cart-gone-3')).toBeTruthy();
  expect(screen.getByTestId('cart-total').props.children).toBe('Ksh 100.00');
  expect(screen.getByText('market.cart.removeGone')).toBeTruthy();
  fireEvent.press(screen.getByTestId('cart-checkout'));
  expect(mockApi.checkoutCart).not.toHaveBeenCalled();
});

test('a removed line can be put back', async () => {
  const screen = await open([line(9, product(1), 2)]);
  mockApi.removeFromCart.mockResolvedValue({});
  mockApi.addToCart.mockResolvedValue({});
  await act(async () => { fireEvent.press(screen.getByTestId('cart-remove-1')); });
  expect(screen.getByText('market.cart.removed')).toBeTruthy();
  mockApi.fetchCart.mockResolvedValue({ items: [line(12, product(1), 2)] });
  await act(async () => { fireEvent.press(screen.getByTestId('market-toast-action')); });
  expect(mockApi.addToCart).toHaveBeenCalledWith(1, 2);
  await waitFor(() => expect(screen.getByTestId('cart-line-1')).toBeTruthy());
});

test('a line opens its product, and says who sells it', async () => {
  const screen = await open([line(9, product(1), 1)]);
  expect(screen.getByText('market.product.soldBy:sella')).toBeTruthy();
  fireEvent.press(screen.getByTestId('cart-open-1'));
  expect(mockNav.navigate).toHaveBeenCalledWith('ProductDetail', expect.objectContaining({ slug: 'p-1' }));
});
