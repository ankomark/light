/**
 * An organiser's own events: where each stands and what to do next, running
 * one (send for review, stop sales, fix a rejection, change ticket levels),
 * editing its details with the review rule spelt out, and who paid.
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
const mockSecure = new Map();
jest.mock('../../services/secureStorage', () => ({
  getItemAsync: async (k) => (mockSecure.has(k) ? mockSecure.get(k) : null),
  setItemAsync: async (k, v) => { mockSecure.set(k, v); },
  deleteItemAsync: async (k) => { mockSecure.delete(k); },
}));
const mockConfirm = jest.fn(async () => true);
jest.mock('../../utils/adminConfirm', () => ({ confirmAction: (...a) => mockConfirm(...a), notify: jest.fn() }));
const mockFs = { cacheDirectory: 'file:///cache/', writeAsStringAsync: jest.fn(async () => {}) };
jest.mock('expo-file-system/legacy', () => mockFs);
const mockShare = { isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) };
jest.mock('expo-sharing', () => mockShare);

const { __resetOrganiser } = require('../../services/ticketsOrganiser');
const { eventState, groupEvents, soldOf } = require('../tickets/eventState');
const { default: TicketMyEvents } = require('../tickets/TicketMyEvents');
const { default: TicketManageEvent } = require('../tickets/TicketManageEvent');
const { default: TicketEditEvent } = require('../tickets/TicketEditEvent');
const { default: TicketBuyers } = require('../tickets/TicketBuyers');

const API = 'https://tickets.smartbillsolution.com/api/v1/';
const reply = (status, body, text) => ({
  ok: status < 300, status, headers: { get: () => null },
  json: async () => body, text: async () => text ?? JSON.stringify(body),
});
const nav = () => ({ push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), goBack: jest.fn() });

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
const past = (days) => new Date(Date.now() - days * 86400000).toISOString();
const ev = (extra) => ({
  id: 9, slug: 'gospel-night', share_url: 'gospel-night', title: 'Gospel Night', description: 'Worship.',
  venue: 'KICC', city: 'Nairobi', poster: null, starts_at: future(20), ends_at: null, sales_end_at: null,
  status: 'draft', till: 4, till_status: 'active', publish_requested: false, review_status: 'unsubmitted', review_note: '',
  ticket_types: [
    { id: 31, name: 'Regular', price: 500, quantity: 200, position: 0, sold: 120 },
    { id: 32, name: 'VIP', price: 2000, quantity: 50, position: 1, sold: 0 },
  ],
  ...extra,
});
const SUMMARY = {
  collected: 60000, orders: 80, tickets_sold: 120, tickets_available: 130, checked_in: 12, failed_attempts: 3,
  by_ticket_type: [{ id: 31, name: 'Regular', price: 500, quantity: 200, sold: 120, collected: 60000 }], by_day: [{ date: '2026-10-01', collected: 20000 }, { date: '2026-10-02', collected: 40000 }],
};

let routes;
let calls;
beforeEach(() => {
  mockSecure.clear();
  mockSecure.set('tickets_org_tokens_u7', JSON.stringify({ access: 'a1', refresh: 'r1' }));
  __resetOrganiser(7);
  mockConfirm.mockClear();
  mockConfirm.mockImplementation(async () => true);
  mockFs.writeAsStringAsync.mockClear();
  mockShare.shareAsync.mockClear();
  routes = {};
  calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url.replace(API, '')}`;
    calls.push({ key, body: init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    const r = routes[key];
    if (typeof r === 'function') return r(init);
    return r || reply(404, { detail: 'Not found.' });
  });
});

describe('where an event stands', () => {
  test('one state, and the one thing to do, from status, review and till', () => {
    const s = (extra) => eventState(ev(extra));
    expect(s({})).toMatchObject({ key: 'draft', action: 'publish' });
    expect(s({ review_status: 'pending', publish_requested: true })).toMatchObject({ key: 'inReview', action: null });
    expect(s({ review_status: 'rejected', review_note: 'x' })).toMatchObject({ key: 'rejected', tone: 'failed', action: 'edit' });
    expect(s({ review_status: 'approved' })).toMatchObject({ key: 'approved', action: 'publish' });
    expect(s({ review_status: 'approved', publish_requested: true, till_status: 'submitted' })).toMatchObject({ key: 'waitingTill' });
    expect(s({ review_status: 'approved', publish_requested: true, till_status: 'rejected' })).toMatchObject({ key: 'tillRejected', tone: 'failed' });
    expect(s({ status: 'published', review_status: 'approved' })).toMatchObject({ key: 'onSale', action: 'unpublish' });
    expect(s({ status: 'published', starts_at: past(2) })).toMatchObject({ key: 'ended', action: null });
    expect(s({ status: 'cancelled' })).toMatchObject({ key: 'cancelled', action: null });
    // Skylink's pause and removal outrank everything else.
    expect(s({ status: 'draft', review_status: 'approved', publish_requested: true, paused_by_staff: true }))
      .toMatchObject({ key: 'paused', tone: 'failed', action: null });
    expect(s({ status: 'cancelled', removed_at: past(1), paused_by_staff: true })).toMatchObject({ key: 'removed', action: null });
  });

  test('grouped: what needs them first, what is over last', () => {
    const groups = groupEvents([
      ev({ id: 1, status: 'cancelled' }),
      ev({ id: 2, status: 'published', review_status: 'approved' }),
      ev({ id: 3, review_status: 'rejected' }),
      ev({ id: 4, review_status: 'pending', starts_at: future(30) }),
      ev({ id: 5, review_status: 'approved', publish_requested: true, till_status: 'pending', starts_at: future(5) }),
      ev({ id: 6 }),
    ]);
    expect(groups.map((g) => [g.key, g.data.map((e) => e.id)])).toEqual([
      ['attention', [3]], ['live', [2]], ['waiting', [5, 4]], ['drafts', [6]], ['past', [1]],
    ]);
    expect(soldOf(ev())).toEqual({ sold: 120, quantity: 250 });
  });
});

describe('My events', () => {
  test('grouped cards with the reviewer\'s note, totals on top, tills at the foot', async () => {
    routes['GET organiser/events/?page_size=100'] = reply(200, { results: [
      ev({ id: 1, title: 'Youth Camp', review_status: 'rejected', review_note: 'Poster uses a copyrighted logo' }),
      ev({ id: 2, status: 'published', review_status: 'approved', publish_requested: true }),
    ] });
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    routes['GET organiser/overview/'] = reply(200, { collected: 152000, tickets_sold: 300, upcoming_live_events: 1,
      by_day: [{ date: key, collected: 7500, tickets: 3 }] });
    routes['GET organiser/tills/?page_size=100'] = reply(200, { results: [
      { id: 4, till_number: '5123456', business_name: 'AMANI CHOIR', status: 'rejected', status_label: 'Rejected', note: "Name doesn't match Safaricom" },
    ] });
    const navigation = nav();
    const screen = render(<TicketMyEvents navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('Youth Camp')).toBeTruthy());
    expect(screen.getByText('tix.mine.group.attention')).toBeTruthy();
    expect(screen.getByText('Poster uses a copyrighted logo')).toBeTruthy();
    expect(screen.getByText('tix.mine.sold:120,250')).toBeTruthy();
    expect(screen.getByText('KES 152,000')).toBeTruthy();
    expect(screen.getByText('KES 7,500')).toBeTruthy();               // the two-week trend
    expect(screen.getByTestId('chart-spark', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText("Name doesn't match Safaricom")).toBeTruthy();

    fireEvent.press(screen.getByTestId('mine-event-1'));
    expect(navigation.push).toHaveBeenCalledWith('TicketManageEvent', { id: 1 });
  });

  test('a session that has ended goes to sign in and comes back here', async () => {
    mockSecure.clear();
    __resetOrganiser(7);
    const navigation = nav();
    render(<TicketMyEvents navigation={navigation} />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('TicketHost', { next: 'TicketMyEvents' }));
  });

  test('none yet: a way to open one', async () => {
    routes['GET organiser/events/?page_size=100'] = reply(200, { results: [] });
    const navigation = nav();
    const screen = render(<TicketMyEvents navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('tix.mine.emptyTitle')).toBeTruthy());
    fireEvent.press(screen.getByTestId('mine-new'));
    expect(navigation.push).toHaveBeenCalledWith('TicketCreateEvent');
  });
});

describe('running one event', () => {
  const open = (event) => {
    routes['GET organiser/events/9/'] = reply(200, event);
    routes['GET organiser/events/9/summary/'] = reply(200, SUMMARY);
    const navigation = nav();
    return { navigation, screen: render(<TicketManageEvent navigation={navigation} route={{ params: { id: 9 } }} />) };
  };

  test('a draft: Send for review, and it says it is in review', async () => {
    routes['POST organiser/events/9/publish/'] = reply(200, ev({ review_status: 'pending', publish_requested: true }));
    const { screen } = open(ev());
    await waitFor(() => expect(screen.getByText('tix.mine.state.draftBody')).toBeTruthy());
    expect(screen.getAllByText('KES 60,000').length).toBeGreaterThan(0);
    expect(screen.getByText('120/250')).toBeTruthy();
    // The charts: how full, how many in, money by day, the split by level.
    expect(screen.getByTestId('ring-sold')).toBeTruthy();
    expect(screen.getByTestId('ring-admitted')).toBeTruthy();
    expect(screen.getByTestId('chart-days')).toBeTruthy();
    expect(screen.getByTestId('chart-levels')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('mine-publish')); });
    await waitFor(() => expect(screen.getByText('tix.mine.state.inReviewBody')).toBeTruthy());
    expect(screen.queryByTestId('mine-publish')).toBeNull();
  });

  test("rejected: the reviewer's note, Edit, and Send again", async () => {
    routes['POST organiser/events/9/publish/'] = reply(200, ev({ review_status: 'pending', publish_requested: true }));
    const { screen, navigation } = open(ev({ review_status: 'rejected', review_note: 'Poster uses a copyrighted logo' }));
    await waitFor(() => expect(screen.getByText('Poster uses a copyrighted logo')).toBeTruthy());
    fireEvent.press(screen.getByTestId('mine-fix'));
    expect(navigation.push).toHaveBeenCalledWith('TicketEditEvent', { id: 9 });
    await act(async () => { fireEvent.press(screen.getByTestId('mine-resend')); });
    expect(calls.map((c) => c.key)).toContain('POST organiser/events/9/publish/');
  });

  test('on sale: Stop sales asks first; buyers and share are a tap away', async () => {
    routes['POST organiser/events/9/unpublish/'] = reply(200, ev({ review_status: 'approved' }));
    const { screen, navigation } = open(ev({ status: 'published', review_status: 'approved', publish_requested: true }));
    await waitFor(() => expect(screen.getByTestId('mine-stop')).toBeTruthy());
    mockConfirm.mockImplementationOnce(async () => false);
    await act(async () => { fireEvent.press(screen.getByTestId('mine-stop')); });
    expect(calls.map((c) => c.key)).not.toContain('POST organiser/events/9/unpublish/');
    await act(async () => { fireEvent.press(screen.getByTestId('mine-stop')); });
    await waitFor(() => expect(screen.getByText('tix.mine.state.approvedBody')).toBeTruthy());

    fireEvent.press(screen.getByTestId('mine-buyers'));
    expect(navigation.push).toHaveBeenCalledWith('TicketBuyers', { id: 9, title: 'Gospel Night' });
  });

  test('ticket levels: a sold level keeps its price and can\'t drop below sold; an unsold one can go', async () => {
    routes['PATCH organiser/events/9/ticket-types/31/'] = reply(200, {});
    routes['DELETE organiser/events/9/ticket-types/32/'] = reply(204, null);
    routes['POST organiser/events/9/ticket-types/'] = reply(201, { id: 33 });
    const { screen } = open(ev());
    await waitFor(() => expect(screen.getByTestId('mine-level-31')).toBeTruthy());

    fireEvent.press(screen.getByTestId('mine-level-31'));
    expect(screen.getByText('tix.mine.priceLocked')).toBeTruthy();
    expect(screen.getByTestId('mine-level-price').props.editable).toBe(false);
    fireEvent.changeText(screen.getByTestId('mine-level-quantity'), '100');
    await act(async () => { fireEvent.press(screen.getByTestId('mine-level-save')); });
    expect(screen.getByText('tix.mine.belowSold:120')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('mine-level-quantity'), '300');
    await act(async () => { fireEvent.press(screen.getByTestId('mine-level-save')); });
    // The price of a sold level is not sent at all.
    expect(calls.find((c) => c.key.startsWith('PATCH')).body).toEqual({ name: 'Regular', quantity: 300 });

    fireEvent.press(screen.getByTestId('mine-level-32'));
    await act(async () => { fireEvent.press(screen.getByText('tix.host.removeLevel')); });
    expect(calls.map((c) => c.key)).toContain('DELETE organiser/events/9/ticket-types/32/');

    fireEvent.press(screen.getByTestId('mine-add-level'));
    fireEvent.changeText(screen.getByTestId('mine-level-name'), 'VVIP');
    fireEvent.changeText(screen.getByTestId('mine-level-price'), '5000');
    fireEvent.changeText(screen.getByTestId('mine-level-quantity'), '20');
    await act(async () => { fireEvent.press(screen.getByTestId('mine-level-save')); });
    expect(calls.find((c) => c.key === 'POST organiser/events/9/ticket-types/').body)
      .toEqual({ name: 'VVIP', price: 5000, quantity: 20, position: 2 });
  });

  test('cancel asks first, and says refunds are theirs to arrange', async () => {
    routes['POST organiser/events/9/cancel/'] = reply(200, ev({ status: 'cancelled' }));
    const { screen } = open(ev({ status: 'published', review_status: 'approved' }));
    await waitFor(() => expect(screen.getByTestId('mine-cancel')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('mine-cancel')); });
    expect(mockConfirm.mock.calls[0][0].message).toBe('tix.mine.cancelBody');
    await waitFor(() => expect(screen.getByText('tix.mine.state.cancelledBody')).toBeTruthy());
    expect(screen.queryByTestId('mine-cancel')).toBeNull();
  });
});

describe('editing details', () => {
  test('on an approved event on sale: says it goes back to review, asks, then saves', async () => {
    routes['GET organiser/events/9/'] = reply(200, ev({ status: 'published', review_status: 'approved', publish_requested: true }));
    routes['PATCH organiser/events/9/'] = reply(200, ev());
    const navigation = nav();
    const screen = render(<TicketEditEvent navigation={navigation} route={{ params: { id: 9 } }} />);
    await waitFor(() => expect(screen.getByTestId('edit-title')).toBeTruthy());

    // Venue alone: no review, no question.
    fireEvent.changeText(screen.getByTestId('edit-venue'), 'KICC Hall 2');
    expect(screen.queryByTestId('edit-review-warning')).toBeNull();

    fireEvent.changeText(screen.getByTestId('edit-title'), 'Gospel Night 2026');
    expect(screen.getByText('tix.edit.reviewAndPause')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('edit-save')); });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const patch = calls.find((c) => c.key === 'PATCH organiser/events/9/').body;
    expect(patch).toMatchObject({ title: 'Gospel Night 2026', venue: 'KICC Hall 2', till: 4 });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('a draft saves without asking', async () => {
    routes['GET organiser/events/9/'] = reply(200, ev());
    routes['PATCH organiser/events/9/'] = reply(200, ev());
    const navigation = nav();
    const screen = render(<TicketEditEvent navigation={navigation} route={{ params: { id: 9 } }} />);
    await waitFor(() => expect(screen.getByTestId('edit-title')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('edit-title'), '');
    await act(async () => { fireEvent.press(screen.getByTestId('edit-save')); });
    expect(screen.getByText('tix.host.err.title')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('edit-title'), 'Gospel Night 2026');
    await act(async () => { fireEvent.press(screen.getByTestId('edit-save')); });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });
});

describe('buyers', () => {
  const ROW = { code: 'TK1', buyer_name: 'Amani', phone: '0712***678', ticket_type: 'VIP', quantity: 2, amount: 4000,
    mpesa_receipt: 'SJK3H2L9QX', paid_at: past(1) };

  test('who paid, searchable, and exported to the share sheet', async () => {
    routes['GET organiser/events/9/payments/'] = reply(200, { count: 1, next: null, results: [ROW] });
    routes['GET organiser/events/9/payments/?search=SJK3'] = reply(200, { count: 1, next: null, results: [ROW] });
    routes['GET organiser/events/9/payments/export/'] = reply(200, null, 'paid_at,code\n2026-10-03 10:00:00,TK1\n');
    const screen = render(<TicketBuyers navigation={nav()} route={{ params: { id: 9, title: 'Gospel Night' } }} />);
    await waitFor(() => expect(screen.getByText('Amani')).toBeTruthy());
    expect(screen.getByText(/0712\*\*\*678/)).toBeTruthy();
    expect(screen.getByText('KES 4,000')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('buyers-search'), 'SJK3');
    await waitFor(() => expect(calls.map((c) => c.key)).toContain('GET organiser/events/9/payments/?search=SJK3'));

    await act(async () => { fireEvent.press(screen.getByTestId('buyers-export')); });
    expect(mockFs.writeAsStringAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/\/cache\/buyers-9-.*\.csv$/), 'paid_at,code\n2026-10-03 10:00:00,TK1\n',
    );
    expect(mockShare.shareAsync).toHaveBeenCalled();
  });
});

describe("Skylink's actions, as the organiser sees them", () => {
  test('paused: under Needs you with the reason; a warning shows too', async () => {
    routes['GET organiser/events/?page_size=100'] = reply(200, { results: [
      ev({ id: 1, review_status: 'approved', publish_requested: true, paused_by_staff: true, pause_note: 'Checking a complaint',
        warning_note: 'Your poster lists the wrong date' }),
    ] });
    const screen = render(<TicketMyEvents navigation={nav()} />);
    await waitFor(() => expect(screen.getByText('Checking a complaint')).toBeTruthy());
    expect(screen.getByText('tix.mine.group.attention')).toBeTruthy();
    expect(screen.getByText('tix.mine.warning: Your poster lists the wrong date')).toBeTruthy();
  });

  test("removed: locked, with Skylink's reason, and no way to change it", async () => {
    routes['GET organiser/events/9/'] = reply(200, ev({ status: 'cancelled', removed_at: past(1), removed_note: 'Fraudulent event' }));
    routes['GET organiser/events/9/summary/'] = reply(200, SUMMARY);
    const screen = render(<TicketManageEvent navigation={nav()} route={{ params: { id: 9 } }} />);
    await waitFor(() => expect(screen.getByText('Fraudulent event')).toBeTruthy());
    expect(screen.getByText('tix.mine.state.removedBody')).toBeTruthy();
    for (const id of ['mine-publish', 'mine-stop', 'mine-edit', 'mine-cancel', 'mine-add-level']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  test('warned while on sale: the warning sits under the state, sales carry on', async () => {
    routes['GET organiser/events/9/'] = reply(200, ev({ status: 'published', review_status: 'approved', warning_note: 'Wrong date' }));
    routes['GET organiser/events/9/summary/'] = reply(200, SUMMARY);
    const screen = render(<TicketManageEvent navigation={nav()} route={{ params: { id: 9 } }} />);
    await waitFor(() => expect(screen.getByTestId('mine-warning')).toBeTruthy());
    expect(screen.getByText('tix.mine.state.onSaleBody')).toBeTruthy();
    expect(screen.getByTestId('mine-stop')).toBeTruthy();
  });
});
