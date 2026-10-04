/**
 * Fundraisers, the public supporters list, and the gate scanner — against a
 * stand-in ticketing server.
 */
import React from 'react';
import { render, fireEvent, waitFor, act, configure } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.setTimeout(30000);
configure({ asyncUtilTimeout: 5000 });

const mockT = (k, p) => {
  if (k === 'tix.months') return 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec';
  if (k === 'tix.weekdays') return 'Sun,Mon,Tue,Wed,Thu,Fri,Sat';
  return p ? `${k}:${Object.values(p).join(',')}` : k;
};
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT, resolvedLanguage: 'en' }) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { username: 'amani', email: 'a@x.co' } }) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (fn) => require('react').useEffect(fn, [fn]) }));
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
const mockDoc = { getDocumentAsync: jest.fn() };
jest.mock('expo-document-picker', () => mockDoc);
let mockScan = null;
jest.mock('expo-camera', () => {
  const { View } = require('react-native');
  return {
    CameraView: (props) => { mockScan = props.onBarcodeScanned; return <View testID={props.testID} />; },
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
  };
});
const mockSecure = new Map();
jest.mock('../../services/secureStorage', () => ({
  getItemAsync: async (k) => (mockSecure.has(k) ? mockSecure.get(k) : null),
  setItemAsync: async (k, v) => { mockSecure.set(k, v); },
  deleteItemAsync: async (k) => { mockSecure.delete(k); },
}));
jest.mock('../../utils/adminConfirm', () => ({ confirmAction: jest.fn(async () => true), notify: jest.fn() }));

const { __resetOrganiser } = require('../../services/ticketsOrganiser');
const { __resetTickets } = require('../../services/tickets');
const { clearAllCaches } = require('../../utils/screenCache');
const gate = require('../tickets/gate');
const { default: TicketFundraiser } = require('../tickets/TicketFundraiser');
const { default: TicketCheckout } = require('../tickets/TicketCheckout');
const { default: TicketOrder } = require('../tickets/TicketOrder');
const { default: TicketsHome } = require('../tickets/TicketsHome');
const { default: TicketCreateEvent } = require('../tickets/TicketCreateEvent');
const { default: TicketManageEvent } = require('../tickets/TicketManageEvent');
const { default: TicketScanner } = require('../tickets/TicketScanner');

const API = 'https://tickets.smartbillsolution.com/api/v1/';
const reply = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });
const nav = () => ({ push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), goBack: jest.fn() });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

let routes;
let calls;
beforeEach(async () => {
  mockSecure.clear();
  mockSecure.set('tickets_org_tokens', JSON.stringify({ access: 'a1', refresh: 'r1' }));
  __resetOrganiser();
  __resetTickets();
  await clearAllCaches();
  await AsyncStorage.clear();
  mockScan = null;
  routes = {};
  calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url.replace(API, '')}`;
    calls.push({ key, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    const r = routes[key];
    if (r instanceof Error) throw r;
    if (Array.isArray(r)) return r.length > 1 ? r.shift() : r[0];
    if (typeof r === 'function') return r(init);
    return r || reply(404, { detail: 'Not found.' });
  });
});

const FUND = {
  slug: 'help-amani', kind: 'fundraiser', category: 'medical', title: 'Help Amani walk again', organiser: 'Amani Family',
  poster: null, starts_at: ago(600), ends_at: null, goal_amount: 500000, raised: 125000, supporters: 42,
  show_supporters: true, on_sale: true, status: 'published', description: 'Surgery at Kijabe.',
  suggested_amounts: [500, 1000, 5000], min_amount: 10, max_amount: 250000,
};
const SUPPORTERS = { count: 2, next: null, results: [
  { name: 'Wanjiru', phone: '071****678', ticket_type: null, quantity: 1, amount: 2500, paid_at: ago(2) },
  { name: null, phone: null, ticket_type: null, quantity: 1, amount: 5000, paid_at: ago(90) },
] };

describe('a fundraiser', () => {
  test('progress toward the goal, supporters (named only by consent), and Give', async () => {
    routes['GET public/events/help-amani/'] = reply(200, FUND);
    routes['GET public/events/help-amani/supporters/'] = reply(200, SUPPORTERS);
    const navigation = nav();
    const screen = render(<TicketFundraiser navigation={navigation} route={{ params: { slug: 'help-amani' } }} />);
    await waitFor(() => expect(screen.getByText('KES 125,000')).toBeTruthy());
    expect(screen.getByText('tix.sup.pct:25')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Wanjiru')).toBeTruthy());
    expect(screen.getByText(/071\*\*\*\*678/)).toBeTruthy();
    expect(screen.getByText('tix.sup.anonymous')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('give-amount'), '5');
    expect(screen.getByText('tix.fund.range:KES 10,KES 250,000')).toBeTruthy();
    fireEvent.press(screen.getByTestId('give-1000'));
    fireEvent.press(screen.getByTestId('give-continue'));
    expect(navigation.push).toHaveBeenCalledWith('TicketCheckout', expect.objectContaining({
      donation: { amount: 1000 }, event: expect.objectContaining({ slug: 'help-amani', show_supporters: true }),
    }));
  });

  test('a private total shows the goal only, and no list', async () => {
    routes['GET public/events/help-amani/'] = reply(200, { ...FUND, raised: null, supporters: null, show_supporters: false });
    routes['GET public/events/help-amani/supporters/'] = reply(404, { detail: 'This list is private.' });
    const screen = render(<TicketFundraiser navigation={nav()} route={{ params: { slug: 'help-amani' } }} />);
    await waitFor(() => expect(screen.getByText('KES 500,000')).toBeTruthy());
    expect(screen.queryByText('KES 125,000')).toBeNull();
    expect(screen.queryByTestId('supporters')).toBeNull();
  });

  test('checkout asks before naming the giver, and gives', async () => {
    routes['POST public/orders/'] = reply(201, { reference: 'ref-d', kind: 'donation', status: 'pending', amount: 1000 });
    const navigation = nav();
    const screen = render(<TicketCheckout navigation={navigation} route={{ params: {
      event: { slug: 'help-amani', title: 'Help Amani', kind: 'fundraiser', show_supporters: true }, donation: { amount: 1000 },
    } }} />);
    expect(screen.getByText('tix.fund.contribution')).toBeTruthy();
    expect(screen.getByTestId('checkout-show-name').props.value).toBe(false);    // off until they say so
    fireEvent(screen.getByTestId('checkout-show-name'), 'valueChange', true);
    fireEvent.changeText(screen.getByTestId('checkout-phone'), '0712345678');
    fireEvent.changeText(screen.getByTestId('checkout-name'), 'Wanjiru');
    fireEvent.press(screen.getByTestId('checkout-pay'));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('TicketOrder', { reference: 'ref-d', fresh: true }));
    expect(calls[0].body).toEqual({ fundraiser: 'help-amani', amount: 1000, phone: '0712345678', name: 'Wanjiru', show_name: true });
  });

  test('no consent switch when the list is private', () => {
    const screen = render(<TicketCheckout navigation={nav()} route={{ params: {
      event: { slug: 'x', title: 'X', show_supporters: false }, ticketType: { id: 1, name: 'Regular', price: 500 }, quantity: 1,
    } }} />);
    expect(screen.queryByTestId('checkout-show-name')).toBeNull();
  });

  test('a paid gift: thank you and a receipt, no ticket', async () => {
    routes['GET public/orders/ref-d/'] = reply(200, {
      reference: 'ref-d', kind: 'donation', code: 'TK1', status: 'paid', event: 'Help Amani', event_slug: 'help-amani',
      amount: 1000, mpesa_receipt: 'SJK9ZZZ1AA', tickets: [], ticket_type: '', quantity: 1, message: '',
    });
    const screen = render(<TicketOrder navigation={nav()} route={{ params: { reference: 'ref-d' } }} />);
    await waitFor(() => expect(screen.getByText('tix.fund.thanks')).toBeTruthy());
    expect(screen.getByText('SJK9ZZZ1AA')).toBeTruthy();
    expect(screen.queryByLabelText('tix.qrLabel')).toBeNull();
  });

  test('the Fundraisers tab lists them and opens one', async () => {
    routes['GET public/events/?kind=event'] = reply(200, { count: 0, next: null, results: [] });
    routes['GET public/events/?kind=fundraiser'] = reply(200, { count: 1, next: null, results: [FUND] });
    const navigation = nav();
    const screen = render(<TicketsHome navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('tix.emptyTitle')).toBeTruthy());
    fireEvent.press(screen.getByTestId('kind-fundraiser'));
    await waitFor(() => expect(screen.getByText('Help Amani walk again')).toBeTruthy());
    expect(screen.getByText('tix.fund.raisedOf:KES 125,000,KES 500,000')).toBeTruthy();
    expect(screen.getByText('tix.cta.give')).toBeTruthy();
    fireEvent.press(screen.getByText('Help Amani walk again'));
    expect(navigation.push).toHaveBeenCalledWith('TicketFundraiser', { slug: 'help-amani', preview: FUND });
  });
});

describe('opening a fundraiser', () => {
  test('cause, goal, document, payout, who sees what — then JSON, the files, and review', async () => {
    routes['GET organiser/tills/?page_size=100'] = reply(200, { count: 1, results: [
      { id: 4, till_number: '5123456', business_name: 'AMANI', status: 'active', status_label: 'Active', note: '' }] });
    routes['POST organiser/events/'] = reply(201, { id: 12, slug: 'help-amani', title: 'Help Amani', status: 'draft' });
    routes['PATCH organiser/events/12/'] = reply(200, { id: 12, slug: 'help-amani', title: 'Help Amani', status: 'draft', has_document: true });
    routes['POST organiser/events/12/publish/'] = reply(200, { id: 12, slug: 'help-amani', title: 'Help Amani', status: 'draft', review_status: 'pending' });
    mockDoc.getDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///letter.pdf', name: 'letter.pdf', mimeType: 'application/pdf', size: 2048 }] });

    const screen = render(<TicketCreateEvent navigation={nav()} />);
    await waitFor(() => expect(screen.getByTestId('host-kind-fundraiser')).toBeTruthy());
    fireEvent.press(screen.getByTestId('host-kind-fundraiser'));
    fireEvent.press(screen.getByTestId('host-next'));

    fireEvent.changeText(screen.getByTestId('host-title'), 'Help Amani walk again');
    fireEvent.press(screen.getByTestId('host-next'));
    expect(screen.getByText('tix.host.err.category')).toBeTruthy();
    fireEvent.press(screen.getByTestId('host-cat-medical'));
    fireEvent.press(screen.getByTestId('host-next'));

    fireEvent.changeText(screen.getByTestId('host-goal'), '500000');
    fireEvent.changeText(screen.getByTestId('host-suggested-3'), '');
    fireEvent.press(screen.getByTestId('host-next'));

    fireEvent.press(screen.getByTestId('host-next'));
    expect(screen.getByText('tix.host.err.document')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('host-document')); });
    expect(screen.getByText('letter.pdf')).toBeTruthy();
    fireEvent.press(screen.getByTestId('host-next'));

    await waitFor(() => expect(screen.getByText('AMANI')).toBeTruthy());
    fireEvent.press(screen.getByTestId('host-next'));
    // A fundraiser starts with both public; the organiser can turn them off.
    expect(screen.getByTestId('vis-supporters').props.value).toBe(true);
    fireEvent(screen.getByTestId('vis-total'), 'valueChange', false);
    fireEvent.press(screen.getByTestId('host-next'));

    await act(async () => { fireEvent.press(screen.getByTestId('host-create')); });
    await waitFor(() => expect(screen.getByText('tix.host.sentTitle')).toBeTruthy());
    expect(calls.map((c) => c.key)).toEqual([
      'GET organiser/tills/?page_size=100',
      'POST organiser/events/', 'PATCH organiser/events/12/', 'POST organiser/events/12/publish/',
    ]);
    expect(calls[1].body).toMatchObject({
      kind: 'fundraiser', category: 'medical', goal_amount: 500000, suggested_amounts: [500, 1000, 2000],
      show_supporters: true, show_total: false, till: 4,
    });
    expect(calls[1].body.venue).toBeUndefined();
    expect(calls[2].body).toBeInstanceOf(FormData);
  });
});

describe('the organiser decides who sees what', () => {
  test('switches on the event page; and the gate for an event', async () => {
    routes['GET organiser/events/9/'] = reply(200, {
      id: 9, slug: 'gospel-night', kind: 'event', title: 'Gospel Night', venue: 'KICC', starts_at: new Date(Date.now() + 864e6).toISOString(),
      status: 'published', review_status: 'approved', show_supporters: false, show_total: false, ticket_types: [],
    });
    routes['GET organiser/events/9/summary/'] = reply(200, { collected: 0, orders: 0, tickets_sold: 0, tickets_available: 0, checked_in: 0, failed_attempts: 0, by_day: [] });
    routes['PATCH organiser/events/9/'] = reply(200, { id: 9, kind: 'event', title: 'Gospel Night', status: 'published', show_supporters: true, show_total: false, ticket_types: [] });
    const navigation = nav();
    const screen = render(<TicketManageEvent navigation={navigation} route={{ params: { id: 9 } }} />);
    await waitFor(() => expect(screen.getByTestId('vis-supporters')).toBeTruthy());
    await act(async () => { fireEvent(screen.getByTestId('vis-supporters'), 'valueChange', true); });
    expect(calls.find((c) => c.key === 'PATCH organiser/events/9/').body).toEqual({ show_supporters: true, show_total: false });
    fireEvent.press(screen.getByTestId('mine-scan'));
    expect(navigation.push).toHaveBeenCalledWith('TicketScanner', { id: 9, title: 'Gospel Night' });
  });
});

describe('the gate, offline', () => {
  const page = (results, next = null) => reply(200, { count: results.length, next, results });
  const T1 = { code: 'AAA', ticket_type: 'VIP', buyer_name: 'Wanjiru', checked_in_at: null };
  const T2 = { code: 'BBB', ticket_type: 'Regular', buyer_name: 'Kamau', checked_in_at: ago(5) };

  test('sync keeps every ticket, then only what changed', async () => {
    routes['GET organiser/events/9/tickets/?page_size=500'] = page([T1], 'https://x/api/v1/organiser/events/9/tickets/?page=2&page_size=500');
    routes['GET organiser/events/9/tickets/?page_size=500&page=2'] = page([T2]);
    let g = await gate.syncGate(9, gate.emptyGate(), Date.parse('2026-11-14T15:00:00Z'));
    expect(Object.keys(g.tickets)).toEqual(['AAA', 'BBB']);
    expect(gate.gateCounts(g)).toEqual({ admitted: 1, total: 2 });
    routes['GET organiser/events/9/tickets/?page_size=500&since=2026-11-14T14%3A58%3A00.000Z'] = page([{ ...T1, checked_in_at: ago(1) }]);
    g = await gate.syncGate(9, g);
    expect(g.tickets.AAA.c).toBeTruthy();
  });

  test('offline: in from the list, queued; used and unknown refused', () => {
    const g0 = { ...gate.emptyGate(), tickets: { AAA: { t: 'VIP', n: 'Wanjiru', c: null }, BBB: { t: 'Regular', n: 'Kamau', c: ago(5) } } };
    const first = gate.scanOffline(g0, 'AAA');
    expect(first.outcome.result).toBe('admitted_offline');
    expect(first.gate.queue.map((q) => q.code)).toEqual(['AAA']);
    expect(gate.scanOffline(first.gate, 'AAA').outcome.result).toBe('already_used');
    expect(gate.scanOffline(g0, 'BBB').outcome.result).toBe('already_used');
    expect(gate.scanOffline(g0, 'ZZZ').outcome.result).toBe('invalid');
  });

  test('the queue goes up; one another gate already let in is flagged; a dropped network stops it', async () => {
    const g0 = { ...gate.emptyGate(), tickets: { AAA: { t: 'VIP', n: 'Wanjiru', c: ago(1) }, BBB: { t: 'Regular', n: 'Kamau', c: ago(1) }, CCC: { t: 'VIP', n: 'Otieno', c: ago(1) } },
      queue: [{ code: 'AAA', at: ago(1) }, { code: 'BBB', at: ago(1) }, { code: 'CCC', at: ago(1) }] };
    routes['POST organiser/events/9/checkin/'] = [
      reply(200, { result: 'admitted' }),
      reply(409, { result: 'already_used', detail: 'Already checked in.', checked_in_at: ago(20) }),
      new TypeError('Network request failed'),
    ];
    const g = await gate.flushQueue(9, g0);
    expect(g.queue.map((q) => q.code)).toEqual(['CCC']);
    expect(g.flags).toEqual([expect.objectContaining({ code: 'BBB', reason: 'already_used', name: 'Kamau' })]);
  });

  test('the scanner: online verdicts, the offline fallback, a typed code', async () => {
    routes['GET organiser/events/9/tickets/?page_size=500'] = page([T1, T2, { code: 'CCC', ticket_type: 'VIP', buyer_name: 'Otieno', checked_in_at: null }]);
    routes['POST organiser/events/9/checkin/'] = [
      reply(200, { result: 'admitted', ticket_type: 'VIP', buyer_name: 'Wanjiru' }),
      reply(409, { result: 'already_used', detail: 'Already checked in.', checked_in_at: '2026-11-14T15:42:00Z' }),
      new TypeError('Network request failed'),
    ];
    const screen = render(<TicketScanner navigation={nav()} route={{ params: { id: 9, title: 'Gospel Night' } }} />);
    await waitFor(() => expect(screen.getByTestId('gate-sync').props.children).toMatch(/tix.gate.synced/));
    expect(screen.getByTestId('gate-admitted').props.children).toBe(1);

    await act(async () => { mockScan({ data: 'AAA' }); });
    expect(screen.getByTestId('gate-verdict-admitted')).toBeTruthy();
    expect(screen.getByText('Wanjiru')).toBeTruthy();
    expect(screen.getByTestId('gate-admitted').props.children).toBe(2);
    fireEvent.press(screen.getByText('tix.gate.v.admitted'));

    fireEvent.changeText(screen.getByTestId('gate-code'), 'BBB');
    await act(async () => { fireEvent.press(screen.getByTestId('gate-check')); });
    expect(screen.getByTestId('gate-verdict-already_used')).toBeTruthy();
    fireEvent.press(screen.getByText('tix.gate.v.used'));

    // The network goes: the list on the phone decides, and the check-in waits.
    fireEvent.changeText(screen.getByTestId('gate-code'), 'CCC');
    await act(async () => { fireEvent.press(screen.getByTestId('gate-check')); });
    expect(screen.getByTestId('gate-verdict-admitted_offline')).toBeTruthy();
    expect(screen.getByTestId('gate-sync').props.children).toBe('tix.gate.offline:1');
  });
});
