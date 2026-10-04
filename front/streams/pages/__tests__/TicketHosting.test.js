/**
 * Opening an event: the account check, signing up or in, and the five-step
 * event wizard through to an event on sale — including a save that fails
 * halfway and is retried without making the event twice.
 */
import React from 'react';
import { render, fireEvent, waitFor, configure } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.setTimeout(20000);
// The wizard is seven steps now: walking them under a loaded test run can
// take longer than the default one-second wait.
configure({ asyncUtilTimeout: 5000 });

const mockT = (k, p) => {
  if (k === 'tix.months') return 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec';
  if (k === 'tix.weekdays') return 'Sun,Mon,Tue,Wed,Thu,Fri,Sat';
  if (k.startsWith('tix.host.preset.')) return { regular: 'Regular', vip: 'VIP', vvip: 'VVIP' }[k.slice(16)] || k;
  return p ? `${k}:${Object.values(p).join(',')}` : k;
};
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT, resolvedLanguage: 'en' }) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { username: 'amani', email: 'amani@example.com' } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }) => children || null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('../../services/imageProcessing', () => ({ compressImage: jest.fn() }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0' } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
const mockSecure = new Map();
jest.mock('../../services/secureStorage', () => ({
  getItemAsync: async (k) => (mockSecure.has(k) ? mockSecure.get(k) : null),
  setItemAsync: async (k, v) => { mockSecure.set(k, v); },
  deleteItemAsync: async (k) => { mockSecure.delete(k); },
}));

const { __resetOrganiser } = require('../../services/ticketsOrganiser');
const { default: TicketHost } = require('../tickets/TicketHost');
const { default: TicketCreateEvent } = require('../tickets/TicketCreateEvent');
const { default: TicketPasswordReset, isResetCode } = require('../tickets/TicketPasswordReset');

const API = 'https://tickets.smartbillsolution.com/api/v1/';
const reply = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });
const nav = () => ({ push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), goBack: jest.fn() });
const signIn = () => mockSecure.set('tickets_org_tokens_u7', JSON.stringify({ access: 'a1', refresh: 'r1' }));

let routes;
let calls;
beforeEach(async () => {
  mockSecure.clear();
  __resetOrganiser(7);
  await AsyncStorage.clear();
  routes = {};
  calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url.replace(API, '')}`;
    calls.push(key);
    const r = routes[key];
    if (Array.isArray(r)) return r.length > 1 ? r.shift() : r[0];
    if (typeof r === 'function') return r(init);
    return r || reply(404, { detail: 'Not found.' });
  });
});

describe('the account check', () => {
  test('a live session goes straight to making the event', async () => {
    signIn();
    routes['GET auth/me/'] = reply(200, { id: 1, email: 'amani@example.com' });
    const navigation = nav();
    render(<TicketHost navigation={navigation} />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('TicketCreateEvent'));
  });

  test('no account: sign up, prefilled from Streams', async () => {
    routes['POST auth/register/'] = reply(201, { user: { id: 1 }, access: 'a1', refresh: 'r1' });
    const navigation = nav();
    const screen = render(<TicketHost navigation={navigation} />);
    await waitFor(() => expect(screen.getByTestId('host-email')).toBeTruthy());
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('host-mode-signup'));
    expect(screen.getByTestId('host-email').props.value).toBe('amani@example.com');
    expect(screen.getByTestId('host-name').props.value).toBe('amani');

    fireEvent.changeText(screen.getByTestId('host-password'), 'short');
    fireEvent.press(screen.getByTestId('host-submit'));
    expect(screen.getByText('tix.host.err.passwordShort:8')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('host-password'), 'long enough');
    fireEvent.press(screen.getByTestId('host-submit'));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('TicketCreateEvent'));
    expect(JSON.parse(mockSecure.get('tickets_org_tokens_u7'))).toEqual({ access: 'a1', refresh: 'r1' });
  });

  test('an email that already has an account turns the form into a log in', async () => {
    routes['POST auth/register/'] = reply(400, { detail: 'Invalid input.', errors: { email: ['A user with that email already exists.'] } });
    routes['POST auth/login/'] = reply(200, { access: 'a1', refresh: 'r1' });
    routes['GET auth/me/'] = reply(200, { id: 1 });
    const navigation = nav();
    const screen = render(<TicketHost navigation={navigation} />);
    await waitFor(() => expect(screen.getByTestId('host-password')).toBeTruthy());
    fireEvent.press(screen.getByTestId('host-mode-signup'));
    fireEvent.changeText(screen.getByTestId('host-password'), 'long enough');
    fireEvent.press(screen.getByTestId('host-submit'));
    await waitFor(() => expect(screen.getByText('tix.host.emailTaken')).toBeTruthy());
    expect(screen.queryByTestId('host-name')).toBeNull();     // log in asks only email + password

    fireEvent.press(screen.getByTestId('host-submit'));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('TicketCreateEvent'));
  });

  test('log in comes first, with the email this Streams account used before, and no sign-up fields', async () => {
    mockSecure.set('tickets_org_email_u7', 'choir@example.com');
    routes['POST auth/login/'] = reply(200, { access: 'a1', refresh: 'r1' });
    routes['GET auth/me/'] = reply(200, { id: 1 });
    const navigation = nav();
    const screen = render(<TicketHost navigation={navigation} route={{ params: { next: 'TicketMyEvents' } }} />);
    await waitFor(() => expect(screen.getByTestId('host-email').props.value).toBe('choir@example.com'));
    expect(screen.getByTestId('host-mode-login').props.accessibilityState).toEqual({ selected: true });
    expect(screen.queryByTestId('host-name')).toBeNull();
    fireEvent.changeText(screen.getByTestId('host-password'), 'pw');
    fireEvent.press(screen.getByTestId('host-submit'));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('TicketMyEvents'));
  });

  test('forgot password leads to the reset, carrying the email and where to go next', async () => {
    const navigation = nav();
    const screen = render(<TicketHost navigation={navigation} route={{ params: { next: 'TicketMyEvents' } }} />);
    await waitFor(() => expect(screen.getByTestId('host-forgot')).toBeTruthy());
    fireEvent.press(screen.getByTestId('host-forgot'));
    expect(navigation.push).toHaveBeenCalledWith('TicketPasswordReset', { email: 'amani@example.com', next: 'TicketMyEvents' });
  });

  test('a wrong password says so', async () => {
    routes['POST auth/login/'] = reply(401, { detail: 'No active account found with the given credentials' });
    const screen = render(<TicketHost navigation={nav()} />);
    await waitFor(() => expect(screen.getByTestId('host-mode-login')).toBeTruthy());
    fireEvent.press(screen.getByTestId('host-mode-login'));
    fireEvent.changeText(screen.getByTestId('host-password'), 'nope');
    fireEvent.press(screen.getByTestId('host-submit'));
    await waitFor(() => expect(screen.getByText('tix.host.wrongPassword')).toBeTruthy());
  });
});

describe('forgot password', () => {
  test('a code is six digits', () => {
    expect(isResetCode('123456')).toBe(true);
    expect(isResetCode('12345')).toBe(false);
    expect(isResetCode('12a456')).toBe(false);
  });

  test('email, then the code and a new password: signed in and on to My events', async () => {
    routes['POST auth/password/reset/'] = reply(200, { detail: 'If that email has an account, a code is on its way.' });
    routes['POST auth/password/reset/confirm/'] = reply(200, { access: 'a2', refresh: 'r2' });
    routes['GET auth/me/'] = reply(200, { id: 1 });
    const navigation = nav();
    const screen = render(<TicketPasswordReset navigation={navigation} route={{ params: { email: 'amani@example.com', next: 'TicketMyEvents' } }} />);
    fireEvent.press(screen.getByTestId('reset-submit'));
    await waitFor(() => expect(screen.getByTestId('reset-code')).toBeTruthy());
    expect(screen.getByText('tix.reset.sent')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('reset-code'), '12 34');
    fireEvent.changeText(screen.getByTestId('reset-password'), 'short');
    fireEvent.press(screen.getByTestId('reset-submit'));
    expect(screen.getByText('tix.reset.codeInvalid')).toBeTruthy();
    expect(screen.getByText('tix.host.err.passwordShort:8')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('reset-code'), '123456');
    fireEvent.changeText(screen.getByTestId('reset-password'), 'a new long one');
    fireEvent.press(screen.getByTestId('reset-submit'));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('TicketMyEvents'));
    const sent = global.fetch.mock.calls.find((c) => c[0].endsWith('password/reset/confirm/'));
    expect(JSON.parse(sent[1].body)).toEqual({ email: 'amani@example.com', code: '123456', new_password: 'a new long one' });
    expect(JSON.parse(mockSecure.get('tickets_org_tokens_u7'))).toEqual({ access: 'a2', refresh: 'r2' });
    expect(mockSecure.get('tickets_org_email_u7')).toBe('amani@example.com');
  });

  test('a wrong code says so, and keeps them on the form', async () => {
    routes['POST auth/password/reset/confirm/'] = reply(400, { detail: 'That code is wrong or has expired.' });
    const navigation = nav();
    const screen = render(<TicketPasswordReset navigation={navigation} route={{ params: { email: 'amani@example.com' } }} />);
    fireEvent.press(screen.getByTestId('reset-have-code'));
    fireEvent.changeText(screen.getByTestId('reset-code'), '000000');
    fireEvent.changeText(screen.getByTestId('reset-password'), 'a new long one');
    fireEvent.press(screen.getByTestId('reset-submit'));
    await waitFor(() => expect(screen.getByText('That code is wrong or has expired.')).toBeTruthy());
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

const future = (days, hour = 18) => {
  const d = new Date(Date.now() + days * 86400000);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const TILL = { id: 4, till_number: '5123456', business_name: 'Amani Choir', status: 'active', status_label: 'Active', note: '' };
const READY = {
  poster: null, title: 'Gospel Night', description: 'Worship.', venue: 'KICC', city: 'Nairobi',
  startsAt: future(30), endsAt: null, salesEndAt: null, till: 4,
  levels: [
    { key: 'l1', name: 'Regular', price: '500', quantity: '200' },
    { key: 'l2', name: 'VIP', price: '2000', quantity: '50' },
  ],
};
const EVENT = { id: 9, slug: 'gospel-night', title: 'Gospel Night', share_url: 'https://t/e/gospel-night', status: 'draft' };

describe('making the event', () => {
  beforeEach(() => {
    signIn();
    routes['GET organiser/tills/?page_size=100'] = reply(200, { count: 1, results: [TILL] });
  });

  test('each step asks for what it needs before Next', async () => {
    const screen = render(<TicketCreateEvent navigation={nav()} />);
    await waitFor(() => expect(screen.getByTestId('host-next')).toBeTruthy());
    // First: an event or a fundraiser.
    fireEvent.press(screen.getByTestId('host-next'));
    expect(screen.getByText('tix.host.err.kind')).toBeTruthy();
    fireEvent.press(screen.getByTestId('host-kind-event'));
    fireEvent.press(screen.getByTestId('host-next'));
    fireEvent.press(screen.getByTestId('host-next'));
    expect(screen.getByText('tix.host.err.title')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('host-title'), 'Gospel Night');
    fireEvent.press(screen.getByTestId('host-next'));
    expect(screen.getByText('tix.host.whenTitle')).toBeTruthy();
    fireEvent.press(screen.getByTestId('host-next'));
    expect(screen.getByText('tix.host.err.venue')).toBeTruthy();
    expect(screen.getByText('tix.host.err.start')).toBeTruthy();
  });

  test('ticket levels: presets add a named level once; each needs a price and quantity', async () => {
    await AsyncStorage.setItem('tix:hostDraft', JSON.stringify({ ...READY, levels: [{ key: 'l1', name: 'Regular', price: '', quantity: '' }] }));
    const screen = render(<TicketCreateEvent navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('tix.host.resumed')).toBeTruthy());
    for (let i = 0; i < 3; i += 1) fireEvent.press(screen.getByTestId('host-next'));
    expect(screen.getByText('tix.host.ticketsTitle')).toBeTruthy();

    fireEvent.press(screen.getByTestId('host-preset-vip'));
    expect(screen.getByTestId('host-level-name-1').props.value).toBe('VIP');
    expect(screen.getByTestId('host-preset-vip').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(screen.getByTestId('host-next'));
    expect(screen.getAllByText('tix.host.err.price')).toHaveLength(2);
    fireEvent.changeText(screen.getByTestId('host-level-price-0'), '5O0');   // a letter O, typed by mistake
    expect(screen.getByTestId('host-level-price-0').props.value).toBe('50');
  });

  test('create: the event, then each level, then it goes to review', async () => {
    await AsyncStorage.setItem('tix:hostDraft', JSON.stringify(READY));
    routes['POST organiser/events/'] = reply(201, EVENT);
    routes['POST organiser/events/9/ticket-types/'] = reply(201, { id: 31 });
    routes['POST organiser/events/9/publish/'] = reply(200, { ...EVENT, status: 'draft', review_status: 'pending' });
    const navigation = nav();
    const screen = render(<TicketCreateEvent navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('tix.host.resumed')).toBeTruthy());
    for (let i = 0; i < 6; i += 1) fireEvent.press(screen.getByTestId('host-next'));
    await waitFor(() => expect(screen.getByText('tix.host.willReview')).toBeTruthy());
    expect(screen.getByText('tix.host.createSubmit')).toBeTruthy();

    fireEvent.press(screen.getByTestId('host-create'));
    await waitFor(() => expect(screen.getByText('tix.host.sentTitle')).toBeTruthy());
    expect(screen.getByText('tix.host.sentBody')).toBeTruthy();
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([
      'POST organiser/events/', 'POST organiser/events/9/ticket-types/', 'POST organiser/events/9/ticket-types/',
      'POST organiser/events/9/publish/',
    ]);
    const levelBodies = global.fetch.mock.calls.filter(([u]) => u.endsWith('ticket-types/')).map(([, i]) => JSON.parse(i.body));
    expect(levelBodies).toEqual([
      { name: 'Regular', price: 500, quantity: 200, position: 0 },
      { name: 'VIP', price: 2000, quantity: 50, position: 1 },
    ]);
    await waitFor(async () => expect(await AsyncStorage.getItem('tix:hostDraft')).toBeNull());
    // Not on sale yet, so nothing to view: manage it, or go to My events.
    expect(screen.queryByTestId('host-view-event')).toBeNull();
    fireEvent.press(screen.getByTestId('host-manage'));
    expect(navigation.replace).toHaveBeenCalledWith('TicketManageEvent', { id: 9 });
    fireEvent.press(screen.getByTestId('host-done'));
    expect(navigation.replace).toHaveBeenCalledWith('TicketMyEvents');
  });

  test('a pending till: sent for review, and told it also waits for the till', async () => {
    routes['GET organiser/tills/?page_size=100'] = reply(200, { count: 1, results: [{ ...TILL, status: 'pending', status_label: 'Pending' }] });
    await AsyncStorage.setItem('tix:hostDraft', JSON.stringify(READY));
    routes['POST organiser/events/'] = reply(201, EVENT);
    routes['POST organiser/events/9/ticket-types/'] = reply(201, { id: 31 });
    routes['POST organiser/events/9/publish/'] = reply(200, { ...EVENT, status: 'draft', review_status: 'pending' });
    const screen = render(<TicketCreateEvent navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('tix.host.resumed')).toBeTruthy());
    for (let i = 0; i < 4; i += 1) fireEvent.press(screen.getByTestId('host-next'));
    await waitFor(() => expect(screen.getByText('tix.host.tillNotActive')).toBeTruthy());
    fireEvent.press(screen.getByTestId('host-next'));      // visibility
    fireEvent.press(screen.getByTestId('host-next'));      // review
    expect(screen.getByText('tix.host.willReviewTill')).toBeTruthy();
    fireEvent.press(screen.getByTestId('host-create'));
    await waitFor(() => expect(screen.getByText('tix.host.sentTitle')).toBeTruthy());
    expect(screen.getByText('tix.host.sentBodyTill:5123456')).toBeTruthy();
  });

  test('an event already approved goes straight on sale', async () => {
    await AsyncStorage.setItem('tix:hostDraft', JSON.stringify(READY));
    routes['POST organiser/events/'] = reply(201, EVENT);
    routes['POST organiser/events/9/ticket-types/'] = reply(201, { id: 31 });
    routes['POST organiser/events/9/publish/'] = reply(200, { ...EVENT, status: 'published', review_status: 'approved' });
    const navigation = nav();
    const screen = render(<TicketCreateEvent navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('tix.host.resumed')).toBeTruthy());
    for (let i = 0; i < 6; i += 1) fireEvent.press(screen.getByTestId('host-next'));
    await waitFor(() => expect(screen.getByTestId('host-create')).toBeTruthy());
    fireEvent.press(screen.getByTestId('host-create'));
    await waitFor(() => expect(screen.getByText('tix.host.liveTitle')).toBeTruthy());
    fireEvent.press(screen.getByTestId('host-view-event'));
    expect(navigation.replace).toHaveBeenCalledWith('TicketEvent', { slug: 'gospel-night' });
  });

  test('a till number the server would refuse is caught here', async () => {
    routes['GET organiser/tills/?page_size=100'] = reply(200, { count: 0, results: [] });
    await AsyncStorage.setItem('tix:hostDraft', JSON.stringify({ ...READY, till: null }));
    const screen = render(<TicketCreateEvent navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('tix.host.resumed')).toBeTruthy());
    for (let i = 0; i < 4; i += 1) fireEvent.press(screen.getByTestId('host-next'));
    await waitFor(() => expect(screen.getByTestId('host-till-number')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('host-till-number'), '512345678');     // 9 digits
    fireEvent.changeText(screen.getByTestId('host-business'), 'Amani Choir');
    fireEvent.press(screen.getByTestId('host-save-till'));
    expect(screen.getByText('tix.host.err.tillNumber')).toBeTruthy();
    expect(calls).not.toContain('POST organiser/tills/');
  });

  test('a save that fails halfway carries on from there, never making the event twice', async () => {
    await AsyncStorage.setItem('tix:hostDraft', JSON.stringify(READY));
    routes['POST organiser/events/'] = reply(201, EVENT);
    routes['POST organiser/events/9/ticket-types/'] = [
      reply(201, { id: 31 }), reply(500, { detail: 'Server error' }), reply(201, { id: 32 }),
    ];
    routes['POST organiser/events/9/publish/'] = reply(200, { ...EVENT, status: 'published' });
    const screen = render(<TicketCreateEvent navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('tix.host.resumed')).toBeTruthy());
    for (let i = 0; i < 6; i += 1) fireEvent.press(screen.getByTestId('host-next'));
    await waitFor(() => expect(screen.getByTestId('host-create')).toBeTruthy());

    fireEvent.press(screen.getByTestId('host-create'));
    await waitFor(() => expect(screen.getByText('Server error')).toBeTruthy());
    // What reached the server is on the phone already, for a retry after a restart.
    const kept = JSON.parse(await AsyncStorage.getItem('tix:hostDraft'));
    expect(kept.saved.event.id).toBe(9);
    expect(kept.saved.levels).toEqual({ l1: 31 });

    fireEvent.press(screen.getByTestId('host-create'));
    await waitFor(() => expect(screen.getByText('tix.host.liveTitle')).toBeTruthy());
    expect(calls.filter((c) => c === 'POST organiser/events/')).toHaveLength(1);
    expect(calls.filter((c) => c.endsWith('ticket-types/'))).toHaveLength(3);   // 1 ok, 1 failed, 1 retried
  });

  test('a session that has ended sends them to sign in, the draft kept', async () => {
    mockSecure.clear();
    __resetOrganiser(7);
    await AsyncStorage.setItem('tix:hostDraft', JSON.stringify(READY));
    const navigation = nav();
    render(<TicketCreateEvent navigation={navigation} />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('TicketHost'));
    expect(JSON.parse(await AsyncStorage.getItem('tix:hostDraft')).title).toBe('Gospel Night');
  });
});
