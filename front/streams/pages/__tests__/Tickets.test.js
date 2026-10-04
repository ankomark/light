/**
 * Events & Tickets, screen by screen, against a stand-in ticketing server:
 * browse, choose a ticket, pay with an M-Pesa prompt, wait, get QR tickets,
 * find them again in My tickets, recover them on a new phone.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockT = (k, p) => {
  if (k === 'tix.months') return 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec';
  if (k === 'tix.weekdays') return 'Sun,Mon,Tue,Wed,Thu,Fri,Sat';
  return p ? `${k}:${Object.values(p).join(',')}` : k;
};
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT, resolvedLanguage: 'en' }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }) => children || null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0' } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
const mockSecure = new Map();
jest.mock('../../services/secureStorage', () => ({
  getItemAsync: async (k) => (mockSecure.has(k) ? mockSecure.get(k) : null),
  setItemAsync: async (k, v) => { mockSecure.set(k, v); },
}));
// Poll fast, give up fast: the behaviour is the same, the test is quicker.
jest.mock('../../services/tickets', () => ({
  ...jest.requireActual('../../services/tickets'),
  POLL_MS: 20,
  POLL_LIMIT_MS: 300,
}));

const { __resetTickets, cacheOrder } = require('../../services/tickets');
const { clearAllCaches } = require('../../utils/screenCache');
const { default: TicketsHome } = require('../tickets/TicketsHome');
const { default: TicketEvent } = require('../tickets/TicketEvent');
const { default: TicketCheckout } = require('../tickets/TicketCheckout');
const { default: TicketOrder } = require('../tickets/TicketOrder');
const { default: MyTickets } = require('../tickets/MyTickets');
const { default: TicketRecover } = require('../tickets/TicketRecover');

const API = 'https://tickets.smartbillsolution.com/api/v1/';
const reply = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
const EVENT = {
  slug: 'gospel-night', title: 'Gospel Night', venue: 'KICC', city: 'Nairobi', poster: null,
  starts_at: future(10), organiser: 'Amani Choir', min_price: 500, on_sale: true, status: 'published',
};
const SECOND = { ...EVENT, slug: 'youth-camp', title: 'Youth Camp', city: 'Kisumu', starts_at: future(20), min_price: 1500 };
const DETAIL = {
  ...EVENT, description: 'An evening of worship.', sales_end_at: future(9),
  ticket_types: [
    { id: 1, name: 'Regular', price: 500, remaining: 120 },
    { id: 2, name: 'VIP', price: 2000, remaining: 3 },
    { id: 3, name: 'Table of 8', price: 12000, remaining: 0 },
  ],
};
const ORDER = {
  reference: 'ref-123', code: 'GN-4821', status: 'pending', event: 'Gospel Night', event_slug: 'gospel-night',
  starts_at: EVENT.starts_at, venue: 'KICC', ticket_type: 'VIP', quantity: 2, amount: 4000, message: '',
  mpesa_receipt: null, tickets: [],
};
const PAID = {
  ...ORDER, status: 'paid', mpesa_receipt: 'SJK3H2L9QX',
  tickets: [{ code: 'TK-AAA111', checked_in: false }, { code: 'TK-BBB222', checked_in: true }],
};

let routes;
beforeEach(async () => {
  mockSecure.clear();
  __resetTickets(7);
  await clearAllCaches();
  routes = {};
  global.fetch = jest.fn(async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url.replace(API, '')}`;
    const r = routes[key];
    if (typeof r === 'function') return r(init);
    return r || reply(404, { detail: 'Not found.' });
  });
});

const nav = (extra = {}) => ({ push: jest.fn(), replace: jest.fn(), goBack: jest.fn(), navigate: jest.fn(), ...extra });

test('events: the soonest leads, the rest follow, and a search asks the server', async () => {
  routes['GET public/events/?kind=event'] = reply(200, { count: 2, next: null, results: [EVENT, SECOND] });
  routes['GET public/events/?search=camp&kind=event'] = reply(200, { count: 1, next: null, results: [SECOND] });
  const navigation = nav();
  const screen = render(<TicketsHome navigation={navigation} />);
  await waitFor(() => expect(screen.getByText('Gospel Night')).toBeTruthy());
  expect(screen.getByText('tix.featured')).toBeTruthy();
  expect(screen.getByText('Youth Camp')).toBeTruthy();
  expect(screen.getByText('tix.from:KES 500')).toBeTruthy();
  // Two cities seen: the chips appear.
  expect(screen.getByText('Kisumu')).toBeTruthy();

  fireEvent.changeText(screen.getByLabelText('tix.searchPlaceholder'), 'camp');
  await waitFor(() => expect(global.fetch.mock.calls.map((c) => c[0])).toContain(`${API}public/events/?search=camp&kind=event`));
  await waitFor(() => expect(screen.queryByText('Gospel Night')).toBeNull());

  fireEvent.press(screen.getByText('Youth Camp'));
  expect(navigation.push).toHaveBeenCalledWith('TicketEvent', { slug: 'youth-camp', preview: SECOND });
  // And a button that says so, for anyone who wouldn't think to tap the poster.
  navigation.push.mockClear();
  fireEvent.press(screen.getByTestId('cta-youth-camp'));
  expect(navigation.push).toHaveBeenCalledWith('TicketEvent', { slug: 'youth-camp', preview: SECOND });
});

test('events: an empty server says so, plainly', async () => {
  routes['GET public/events/?kind=event'] = reply(200, { count: 0, next: null, results: [] });
  const screen = render(<TicketsHome navigation={nav()} />);
  await waitFor(() => expect(screen.getByText('tix.emptyTitle')).toBeTruthy());
});

test('event: choose a ticket and how many, sold-out types cannot be chosen', async () => {
  routes['GET public/events/gospel-night/'] = reply(200, DETAIL);
  const navigation = nav();
  const screen = render(<TicketEvent navigation={navigation} route={{ params: { slug: 'gospel-night', preview: EVENT } }} />);
  // The preview paints before the full event arrives.
  expect(screen.getByText('Gospel Night')).toBeTruthy();
  await waitFor(() => expect(screen.getByText('VIP')).toBeTruthy());
  expect(screen.getByText('tix.left:3')).toBeTruthy();
  expect(screen.getByTestId('ticket-type-3').props.accessibilityState.disabled).toBe(true);

  fireEvent.press(screen.getByTestId('ticket-type-2'));
  fireEvent.press(screen.getByLabelText('tix.increase'));
  fireEvent.press(screen.getByLabelText('tix.increase'));
  fireEvent.press(screen.getByLabelText('tix.increase'));   // only 3 left
  expect(screen.getByText('KES 6,000')).toBeTruthy();

  fireEvent.press(screen.getByTestId('ticket-continue'));
  expect(navigation.push).toHaveBeenCalledWith('TicketCheckout', expect.objectContaining({
    ticketType: { id: 2, name: 'VIP', price: 2000 }, quantity: 3,
    // Checkout needs to know whether the list is public, to word the consent.
    event: expect.objectContaining({ show_supporters: false }),
  }));
});

test('event: sold out says so and offers no way to pay', async () => {
  routes['GET public/events/gospel-night/'] = reply(200, {
    ...DETAIL, on_sale: false, ticket_types: DETAIL.ticket_types.map((tt) => ({ ...tt, remaining: 0 })),
  });
  const screen = render(<TicketEvent navigation={nav()} route={{ params: { slug: 'gospel-night' } }} />);
  await waitFor(() => expect(screen.getAllByText('tix.soldOut').length).toBeGreaterThan(0));
  expect(screen.queryByTestId('ticket-continue')).toBeNull();
});

const checkoutParams = {
  event: { slug: 'gospel-night', title: 'Gospel Night', starts_at: EVENT.starts_at, venue: 'KICC', city: 'Nairobi' },
  ticketType: { id: 2, name: 'VIP', price: 2000 },
  quantity: 2,
};

test('checkout: a bad number is caught before anything is sent', async () => {
  const screen = render(<TicketCheckout navigation={nav()} route={{ params: checkoutParams }} />);
  fireEvent.changeText(screen.getByTestId('checkout-phone'), '0812');
  fireEvent.press(screen.getByTestId('checkout-pay'));
  expect(screen.getByText('tix.phoneInvalid')).toBeTruthy();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('checkout: pay saves the reference first, then waits on the order', async () => {
  routes['POST public/orders/'] = reply(201, ORDER);
  const navigation = nav();
  const screen = render(<TicketCheckout navigation={navigation} route={{ params: checkoutParams }} />);
  expect(screen.getByText('tix.pay:KES 4,000')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('checkout-phone'), '0712 345 678');
  fireEvent.changeText(screen.getByTestId('checkout-name'), 'Amani');
  fireEvent.press(screen.getByTestId('checkout-pay'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('TicketOrder', { reference: 'ref-123', fresh: true }));
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ ticket_type: 2, quantity: 2, phone: '0712 345 678', name: 'Amani', show_name: false });
  expect(JSON.parse(mockSecure.get('tickets_refs_u7'))).toEqual(['ref-123']);
  // And the details are offered next time.
  await waitFor(() => expect(JSON.parse(mockSecure.get('tickets_buyer_u7'))).toEqual({ phone: '0712 345 678', name: 'Amani' }));
});

test("checkout: the server's reason is shown as it comes", async () => {
  routes['POST public/orders/'] = reply(400, { detail: 'Not enough tickets left' });
  const navigation = nav();
  const screen = render(<TicketCheckout navigation={navigation} route={{ params: checkoutParams }} />);
  fireEvent.changeText(screen.getByTestId('checkout-phone'), '0712345678');
  fireEvent.press(screen.getByTestId('checkout-pay'));
  await waitFor(() => expect(screen.getByText('Not enough tickets left')).toBeTruthy());
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('order: waits for M-Pesa, then shows a QR per ticket and keeps them', async () => {
  let asked = 0;
  routes['GET public/orders/ref-123/'] = () => { asked += 1; return reply(200, asked < 8 ? ORDER : PAID); };
  const screen = render(<TicketOrder navigation={nav()} route={{ params: { reference: 'ref-123' } }} />);
  await waitFor(() => {
    expect(screen.getByText('tix.checkPhone')).toBeTruthy();
    expect(screen.getByText('tix.enterPin:KES 4,000')).toBeTruthy();
  });

  await waitFor(() => expect(screen.getByText('tix.youreGoing')).toBeTruthy());
  expect(screen.getByText('TK-AAA111')).toBeTruthy();
  expect(screen.getByText('TK-BBB222')).toBeTruthy();
  expect(screen.getByText('tix.used')).toBeTruthy();
  expect(screen.getByText('SJK3H2L9QX')).toBeTruthy();
  expect(screen.getAllByLabelText('tix.qrLabel')).toHaveLength(2);

  // Stopped asking once paid.
  const settled = asked;
  await act(() => new Promise((r) => setTimeout(r, 120)));
  expect(asked).toBe(settled);
  await waitFor(() => expect(JSON.parse(mockSecure.get('tickets_order_u7_ref-123')).status).toBe('paid'));
});

test('order: kept tickets open with no network', async () => {
  await cacheOrder(PAID);
  global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); });
  const screen = render(<TicketOrder navigation={nav()} route={{ params: { reference: 'ref-123' } }} />);
  await waitFor(() => expect(screen.getByText('TK-AAA111')).toBeTruthy());
});

test('order: a cancelled prompt says why, and Try again goes back to the event', async () => {
  routes['GET public/orders/ref-123/'] = reply(200, { ...ORDER, status: 'failed', message: 'Request cancelled by user' });
  const navigation = nav({ getState: () => ({ routes: [{ name: 'TicketEvent' }, { name: 'TicketOrder' }] }) });
  const screen = render(<TicketOrder navigation={navigation} route={{ params: { reference: 'ref-123' } }} />);
  await waitFor(() => expect(screen.getByText('tix.failedTitle')).toBeTruthy());
  expect(screen.getByText('Request cancelled by user')).toBeTruthy();
  fireEvent.press(screen.getByTestId('order-try-again'));
  expect(navigation.goBack).toHaveBeenCalled();
});

test('order: past two minutes it stops and offers Check again', async () => {
  routes['GET public/orders/ref-123/'] = reply(200, ORDER);
  const screen = render(<TicketOrder navigation={nav()} route={{ params: { reference: 'ref-123' } }} />);
  await waitFor(() => expect(screen.getByText('tix.stillWaiting')).toBeTruthy(), { timeout: 3000 });
  const asked = global.fetch.mock.calls.length;
  fireEvent.press(screen.getByTestId('order-check-again'));
  await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThan(asked));
});

test('my tickets: kept orders, upcoming first, and the way to recover', async () => {
  await cacheOrder(PAID);
  await cacheOrder({ ...ORDER, reference: 'ref-failed', status: 'failed' });
  routes['GET public/orders/ref-123/'] = reply(200, PAID);
  routes['GET public/orders/ref-failed/'] = reply(200, { ...ORDER, reference: 'ref-failed', status: 'failed' });
  const navigation = nav();
  const screen = render(<MyTickets navigation={navigation} />);
  await waitFor(() => expect(screen.getByText('Gospel Night')).toBeTruthy());
  // The failed attempt holds no tickets and is not listed.
  expect(screen.getAllByText('Gospel Night')).toHaveLength(1);
  expect(screen.getByText('tix.upcoming')).toBeTruthy();
  fireEvent.press(screen.getByText('Gospel Night'));
  expect(navigation.push).toHaveBeenCalledWith('TicketOrder', { reference: 'ref-123' });
  fireEvent.press(screen.getByTestId('recover-tickets'));
  expect(navigation.push).toHaveBeenCalledWith('TicketRecover');
});

test('my tickets: none yet', async () => {
  const screen = render(<MyTickets navigation={nav()} />);
  await waitFor(() => expect(screen.getByText('tix.noTicketsTitle')).toBeTruthy());
});

test('recover: a receipt that matches nothing says so; one that matches opens the tickets', async () => {
  routes['POST public/orders/lookup/'] = (init) => (JSON.parse(init.body).mpesa_receipt === 'SJK3H2L9QX'
    ? reply(200, PAID) : reply(404, { detail: 'Not found.' }));
  const navigation = nav();
  const screen = render(<TicketRecover navigation={navigation} />);
  fireEvent.changeText(screen.getByTestId('recover-phone'), '0712345678');
  fireEvent.changeText(screen.getByTestId('recover-receipt'), 'AAAAAAAAAA');
  fireEvent.press(screen.getByTestId('recover-find'));
  await waitFor(() => expect(screen.getByText('tix.notFound')).toBeTruthy());

  fireEvent.changeText(screen.getByTestId('recover-receipt'), 'sjk3h2l9qx');
  fireEvent.press(screen.getByTestId('recover-find'));
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('TicketOrder', { reference: 'ref-123' }));
  expect(JSON.parse(mockSecure.get('tickets_refs_u7'))).toContain('ref-123');
});
