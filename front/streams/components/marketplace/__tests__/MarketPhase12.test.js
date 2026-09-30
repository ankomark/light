/**
 * Marketplace phases 1–2: the cart and wishlist on the phone (instant, taken
 * back when the server refuses, offline said as offline), money per currency,
 * search by the server, products that open at once, Buy now, orders that
 * remember what was bought, and paying a seller (copy, WhatsApp message).
 */
import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { writeCache, dropCache } from '../../../utils/screenCache';

jest.setTimeout(20000);

const mockApi = {
  fetchCart: jest.fn(), addToCart: jest.fn(), updateCartItem: jest.fn(), removeFromCart: jest.fn(),
  checkoutCart: jest.fn(), buyNow: jest.fn(),
  fetchWishlist: jest.fn(async () => ({ products: [] })), addToWishlist: jest.fn(), removeFromWishlist: jest.fn(),
  fetchProducts: jest.fn(), fetchProductCategories: jest.fn(async () => []),
  fetchProductById: jest.fn(), fetchProductReviews: jest.fn(async () => []), addProductReview: jest.fn(),
  fetchOrderById: jest.fn(), fetchOrders: jest.fn(), apiRequest: jest.fn(),
};
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
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
const mockClip = { setStringAsync: jest.fn(async () => {}) };
jest.mock('../../../utils/optionalNative', () => ({ clipboard: () => mockClip, viewShot: () => null }));

const store = require('../../../utils/cartStore');
const Cart = require('../Cart').default;
const ProductList = require('../ProductList').default;
const ProductDetail = require('../ProductDetail').default;
const OrderDetail = require('../OrderDetail').default;

const product = (id, extra) => ({
  id, slug: `p-${id}`, title: `Thing ${id}`, price: '100.00', currency: 'KES', quantity: 5,
  is_available: true, images: [], seller: { id: 2, username: 'sella' }, ...extra,
});
const line = (id, p, qty = 1) => ({ id, product: p, quantity: qty });

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.fetchWishlist.mockResolvedValue({ products: [] });
  mockApi.fetchProductReviews.mockResolvedValue([]);
  mockApi.fetchProductCategories.mockResolvedValue([]);
  mockNav.navigate.mockClear();
  mockNav.replace.mockClear();
  mockClip.setStringAsync.mockClear();
  mockParams = {};
  store.resetMarketStore();
  dropCache('u7:market:cart');
  dropCache('u7:market:wishlist');
});

describe('the cart on the phone', () => {
  test('an item added shows at once, and is taken back when the server says no', async () => {
    let refuse;
    mockApi.addToCart.mockImplementation(() => new Promise((_, rej) => { refuse = rej; }));
    const seen = [];
    const Probe = () => { seen.push(store.useMarket().cart?.items?.length ?? 0); return null; };
    render(<Probe />);
    const p = store.addProductToCart(product(1), 2);
    await waitFor(() => expect(seen[seen.length - 1]).toBe(1));
    await act(async () => {
      refuse({ response: { data: { error: 'Only 1 in stock.' } } });
      await expect(p).rejects.toBeTruthy();
    });
    expect(seen[seen.length - 1]).toBe(0);
  });

  test('offline, the kept cart is shown and says so; totals stay per currency', async () => {
    writeCache('u7:market:cart', { items: [
      line(1, product(1), 2),
      line(2, product(2, { price: '90.00', currency: 'USD' })),
    ] });
    mockApi.fetchCart.mockRejectedValue(new Error('Network Error'));
    const screen = render(<Cart />);
    await waitFor(() => expect(screen.getByTestId('cart-offline')).toBeTruthy());
    expect(screen.getByTestId('cart-total').props.children).toBe('Ksh 200.00 + $90.00');
    expect(screen.getByText('market.cart.offlineButton')).toBeTruthy();
  });

  test('a quantity change shows at once and goes to the server', async () => {
    mockApi.fetchCart.mockResolvedValue({ items: [line(9, product(1), 1)] });
    mockApi.updateCartItem.mockResolvedValue({});
    const screen = render(<Cart />);
    await waitFor(() => expect(screen.getByTestId('cart-more-1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('cart-more-1'));
    await waitFor(() => expect(screen.getByTestId('cart-total').props.children).toBe('Ksh 200.00'));
    expect(mockApi.updateCartItem).toHaveBeenCalledWith(9, 2);
  });

  test('checkout goes on with the order in hand and empties the cart', async () => {
    mockApi.fetchCart.mockResolvedValue({ items: [line(9, product(1), 1)] });
    mockApi.checkoutCart.mockResolvedValue({ id: 42, items: [] });
    const screen = render(<Cart />);
    await waitFor(() => expect(screen.getByTestId('cart-checkout')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('cart-checkout')); });
    expect(mockNav.navigate).toHaveBeenCalledWith('Checkout', { orderId: 42, order: { id: 42, items: [] } });
  });
});

describe('browsing', () => {
  test('search is asked of the server, after the typing stops', async () => {
    mockApi.fetchProducts.mockResolvedValue({ results: [product(1)], next: null });
    const screen = render(<ProductList />);
    await waitFor(() => expect(mockApi.fetchProducts).toHaveBeenCalledWith(1, {}));
    fireEvent.changeText(screen.getByTestId('list-search'), 'hymnal');
    await waitFor(() => expect(mockApi.fetchProducts).toHaveBeenLastCalledWith(1, { q: 'hymnal' }), { timeout: 3000 });
    fireEvent.press(screen.getByTestId('sort-price_low'));
    await waitFor(() => expect(mockApi.fetchProducts).toHaveBeenLastCalledWith(1, { q: 'hymnal', sort: 'price_low' }));
  });

  test('a category opens with that category', async () => {
    mockParams = { categoryId: 3, categoryName: 'Books' };
    mockApi.fetchProducts.mockResolvedValue({ results: [], next: null });
    render(<ProductList />);
    await waitFor(() => expect(mockApi.fetchProducts).toHaveBeenCalledWith(1, { category: 3 }));
  });
});

describe('a product', () => {
  test('opens at once on the card that was tapped, and Buy now makes an order', async () => {
    mockParams = { slug: 'p-1', preview: product(1) };
    mockApi.fetchProductById.mockImplementation(() => new Promise(() => {}));
    mockApi.buyNow.mockResolvedValue({ id: 50, items: [] });
    const screen = render(<ProductDetail />);
    expect(screen.getByText('Thing 1')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('product-buy-now')); });
    expect(mockApi.buyNow).toHaveBeenCalledWith(1, 1);
    expect(mockNav.navigate).toHaveBeenCalledWith('Checkout', { orderId: 50, order: { id: 50, items: [] } });
  });

  test('add to cart says so at once, and the server is told', async () => {
    mockParams = { slug: 'p-1', preview: product(1) };
    mockApi.fetchProductById.mockResolvedValue(product(1, { can_review: false }));
    mockApi.addToCart.mockResolvedValue({});
    mockApi.fetchCart.mockResolvedValue({ items: [line(3, product(1))] });
    const screen = render(<ProductDetail />);
    fireEvent.press(screen.getByTestId('product-add-to-cart'));
    expect(screen.getByText('market.product.addedToCart')).toBeTruthy();
    await waitFor(() => expect(mockApi.addToCart).toHaveBeenCalledWith(1, 1));
    await waitFor(() => expect(screen.getByText('market.product.reviewAfterBuying')).toBeTruthy());
  });
});

describe('an order', () => {
  const order = {
    id: 42, status: 'PENDING', payment_status: 'PENDING', created_at: '2026-09-30T10:00:00Z',
    totals: [{ currency: 'KES', amount: '200.00' }],
    items: [{
      id: 1, product: null, seller: 2, quantity: 2, price_at_purchase: '100.00',
      title: 'Hymnal (deleted since)', image_url: '', currency: 'KES',
    }, {
      id: 2, quantity: 1, price_at_purchase: '90.00', seller: 3, currency: 'USD', title: 'Guitar',
      product: product(9, { seller: { id: 3, username: 'guitars' }, whatsapp_number: '+254 712 345678', mpesa_number: '0712' }),
    }],
  };

  test('shows what was bought even when the product is gone, and totals per currency', async () => {
    mockParams = { orderId: 42, order };
    mockApi.fetchOrderById.mockImplementation(() => new Promise(() => {}));
    const screen = render(<OrderDetail />);
    expect(screen.getByText('Hymnal (deleted since)')).toBeTruthy();
    expect(screen.getByTestId('order-total').props.children).toBe('Ksh 200.00');
  });

  test('WhatsApp opens with the payment message written; a number can be copied', async () => {
    mockParams = { orderId: 42, order };
    mockApi.fetchOrderById.mockImplementation(() => new Promise(() => {}));
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const screen = render(<OrderDetail />);
    fireEvent.press(screen.getAllByTestId('seller-whatsapp')[1]);
    const url = open.mock.calls[0][0];
    expect(url.startsWith('https://wa.me/254712345678?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1])).toBe('market.pay.whatsappMessage:42,1× Guitar,$90.00');
    await act(async () => { fireEvent.press(screen.getByTestId('copy-market.pay.mpesa')); });
    expect(mockClip.setStringAsync).toHaveBeenCalledWith('0712');
  });
});
