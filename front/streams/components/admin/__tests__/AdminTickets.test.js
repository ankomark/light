/**
 * Events & Tickets in the admin area: the review queue and the tills queue,
 * approving or rejecting an event, and walking a till through submit → KES 1
 * test → activate.
 */
import React from 'react';
import { render, fireEvent, waitFor, act, configure } from '@testing-library/react-native';

jest.setTimeout(20000);
configure({ asyncUtilTimeout: 8000 });

const mockApi = new Proxy({}, { get: (target, k) => (target[k] ||= jest.fn()) });
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
const mockT = (k, p) => {
  if (k === 'tix.months') return 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec';
  if (k === 'tix.weekdays') return 'Sun,Mon,Tue,Wed,Thu,Fri,Sat';
  return p ? `${k}:${Object.values(p).join(',')}` : k;
};
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 1 } }) }));
// As the real one: run again whenever the callback changes.
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (fn) => require('react').useEffect(fn, [fn]) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0' } }));
jest.mock('../../../services/secureStorage', () => ({ getItemAsync: async () => null, setItemAsync: async () => {} }));
const mockConfirm = jest.fn(async () => true);
const mockNotify = jest.fn();
jest.mock('../../../utils/adminConfirm', () => ({
  confirmAction: (...a) => mockConfirm(...a), notify: (...a) => mockNotify(...a),
}));

const AdminTickets = require('../AdminTickets').default;
const AdminTicketEvent = require('../AdminTicketEvent').default;
const AdminTicketTill = require('../AdminTicketTill').default;
const AdminTicketOrganiser = require('../AdminTicketOrganiser').default;

const future = new Date(Date.now() + 10 * 86400000).toISOString();
const EVENT = {
  id: 5, title: 'Gospel Night', poster: null, venue: 'KICC', city: 'Nairobi', starts_at: future, description: 'Worship.',
  status: 'draft', publish_requested: true, review_status: 'pending', review_note: '', reviewed_by: '',
  organiser: { id: 2, email: 'org@example.com', display_name: 'Amani Choir', phone: '0712345678' },
  till: { id: 3, till_number: '5123456', business_name: 'AMANI CHOIR', status: 'active' },
  ticket_types: [{ id: 1, name: 'Regular', price: 500, quantity: 200, sold: 0 }], collected: 0,
};
const TILL = {
  id: 3, till_number: '5123456', business_name: 'AMANI CHOIR', status: 'pending', note: '', events: 1,
  activated_at: null, organiser: EVENT.organiser, last_test: null, can_activate: false,
};

beforeEach(() => {
  Object.keys(mockApi).forEach((k) => mockApi[k].mockReset());
  mockConfirm.mockClear();
  mockNotify.mockClear();
  mockApi.fetchAdminTicketStats.mockResolvedValue({ tills: { pending: 1, submitted: 0 }, events_to_review: 1, events_on_sale: 4, collected: 152000, tickets_sold: 300 });
});

describe('the queues', () => {
  test('events waiting for review first; tills a tab away', async () => {
    mockApi.fetchAdminTicketEvents.mockResolvedValue({ results: [EVENT], next: null });
    mockApi.fetchAdminTills.mockResolvedValue({ results: [TILL], next: null });
    const navigation = { navigate: jest.fn() };
    const screen = render(<AdminTickets navigation={navigation} />);
    await waitFor(() => expect(screen.getByText('Gospel Night')).toBeTruthy());
    expect(mockApi.fetchAdminTicketEvents).toHaveBeenCalledWith({ view: 'review' });
    expect(screen.getByText('KES 152,000')).toBeTruthy();

    fireEvent.press(screen.getByTestId('admin-tix-event-5'));
    expect(navigation.navigate).toHaveBeenCalledWith('AdminTicketEvent', { id: 5 });

    fireEvent.press(screen.getByTestId('admin-tix-tab-tills'));
    await waitFor(() => expect(screen.getByText('AMANI CHOIR')).toBeTruthy());
    expect(mockApi.fetchAdminTills).toHaveBeenLastCalledWith({ status: 'pending' });
    fireEvent.press(screen.getByTestId('admin-tix-filter-active'));
    await waitFor(() => expect(mockApi.fetchAdminTills).toHaveBeenLastCalledWith({ status: 'active' }));
  });

  test('not connected: says why, with Try again', async () => {
    mockApi.fetchAdminTicketEvents.mockRejectedValue(new Error('Events & Tickets is not connected on this server (TICKETING_SERVICE_KEY).'));
    const screen = render(<AdminTickets navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(screen.getByText(/not connected/)).toBeTruthy());
    expect(screen.getByTestId('admin-error-retry')).toBeTruthy();
  });
});

describe('an event', () => {
  test('approve, after a word on what it will do', async () => {
    mockApi.fetchAdminTicketEvent.mockResolvedValue(EVENT);
    mockApi.adminTicketEventAction.mockResolvedValue({ ...EVENT, review_status: 'approved', status: 'published' });
    const screen = render(<AdminTicketEvent navigation={{ navigate: jest.fn() }} route={{ params: { id: 5 } }} />);
    await waitFor(() => expect(screen.getByText('Gospel Night')).toBeTruthy());
    expect(screen.getByText('org@example.com · 0712345678')).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByTestId('admin-tix-approve')); });
    expect(mockConfirm.mock.calls[0][0].message).toBe('adminTix.approveLive');
    expect(mockApi.adminTicketEventAction).toHaveBeenCalledWith(5, 'approve', undefined);
    await waitFor(() => expect(screen.getByText('adminTix.status.published')).toBeTruthy());
    // Decided: no second Approve, and Reject is now Take down.
    expect(screen.queryByTestId('admin-tix-approve')).toBeNull();
    expect(screen.getByText('adminTix.takeDown')).toBeTruthy();
  });

  test('approving with the till not active says it will wait for it', async () => {
    const waiting = { ...EVENT, till: { ...EVENT.till, status: 'submitted' } };
    mockApi.fetchAdminTicketEvent.mockResolvedValue(waiting);
    mockApi.adminTicketEventAction.mockResolvedValue({ ...waiting, review_status: 'approved' });
    const navigation = { navigate: jest.fn() };
    const screen = render(<AdminTicketEvent navigation={navigation} route={{ params: { id: 5 } }} />);
    await waitFor(() => expect(screen.getByTestId('admin-tix-open-till')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('admin-tix-approve')); });
    expect(mockConfirm.mock.calls[0][0].message).toBe('adminTix.approveWaits');
    fireEvent.press(screen.getByTestId('admin-tix-open-till'));
    expect(navigation.navigate).toHaveBeenCalledWith('AdminTicketTill', { id: 3 });
  });

  test('reject asks why, and the organiser gets the reason', async () => {
    mockApi.fetchAdminTicketEvent.mockResolvedValue(EVENT);
    mockApi.adminTicketEventAction.mockResolvedValue({ ...EVENT, review_status: 'rejected', review_note: 'Poster uses a copyrighted logo', reviewed_by: 'streams:1 mark' });
    const screen = render(<AdminTicketEvent navigation={{ navigate: jest.fn() }} route={{ params: { id: 5 } }} />);
    await waitFor(() => expect(screen.getByTestId('admin-tix-reject')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-tix-reject'));
    await waitFor(() => expect(screen.getByTestId('reason-sheet')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('reason-text'), 'Poster uses a copyrighted logo');
    await act(async () => { fireEvent.press(screen.getByTestId('reason-confirm')); });
    expect(mockApi.adminTicketEventAction).toHaveBeenCalledWith(5, 'reject', { note: 'Poster uses a copyrighted logo' });
    await waitFor(() => expect(screen.getByText('Poster uses a copyrighted logo')).toBeTruthy());
  });
});

describe('a till', () => {
  test('submit, test with KES 1 until it is paid, then activate', async () => {
    mockApi.fetchAdminTill
      .mockResolvedValueOnce(TILL)
      .mockResolvedValueOnce({ ...TILL, status: 'submitted', last_test: { result: 'ok', result_desc: 'Paid', created_at: future, requested_by: 'streams:1 mark' }, can_activate: true });
    mockApi.adminTillAction
      .mockResolvedValueOnce({ ...TILL, status: 'submitted' })
      .mockResolvedValueOnce({ ...TILL, status: 'submitted', last_test: { result: 'pending', result_desc: '', created_at: future, requested_by: 'streams:1 mark' } })
      .mockResolvedValueOnce({ ...TILL, status: 'active', activated_at: future, last_test: { result: 'ok', created_at: future }, can_activate: false });
    const screen = render(<AdminTicketTill route={{ params: { id: 3 } }} />);
    await waitFor(() => expect(screen.getByTestId('admin-till-submit')).toBeTruthy());
    expect(screen.getByTestId('admin-till-activate').props.accessibilityState?.disabled ?? true).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByTestId('admin-till-submit')); });
    expect(mockApi.adminTillAction).toHaveBeenCalledWith(3, 'submit', undefined);
    await waitFor(() => expect(screen.queryByTestId('admin-till-submit')).toBeNull());

    fireEvent.changeText(screen.getByTestId('admin-till-phone'), '0722 000 111');
    await act(async () => { fireEvent.press(screen.getByTestId('admin-till-test')); });
    expect(mockApi.adminTillAction).toHaveBeenCalledWith(3, 'test', { phone: '0722 000 111' });
    expect(screen.getByText('adminTix.test.pending')).toBeTruthy();
    // Asked about again while pending, until M-Pesa answers.
    await waitFor(() => expect(screen.getByText('adminTix.test.ok')).toBeTruthy(), { timeout: 6000 });

    await act(async () => { fireEvent.press(screen.getByTestId('admin-till-activate')); });
    expect(mockConfirm.mock.calls[0][0].message).toBe('adminTix.activateMessage:1');
    expect(mockApi.adminTillAction).toHaveBeenLastCalledWith(3, 'activate', undefined);
    await waitFor(() => expect(screen.getByText(/adminTix.activeSince/)).toBeTruthy());
  });

  test("the ticket server's refusal is shown as it said it", async () => {
    mockApi.fetchAdminTill.mockResolvedValue({ ...TILL, status: 'submitted', can_activate: true });
    mockApi.adminTillAction.mockRejectedValue(new Error('Send a KES 1 test first.'));
    const screen = render(<AdminTicketTill route={{ params: { id: 3 } }} />);
    await waitFor(() => expect(screen.getByTestId('admin-till-activate')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('admin-till-activate')); });
    expect(mockNotify).toHaveBeenCalledWith('adminTix.actionFailed', 'Send a KES 1 test first.');
  });

  test('the test button waits for a real Safaricom number', async () => {
    mockApi.fetchAdminTill.mockResolvedValue({ ...TILL, status: 'submitted' });
    const screen = render(<AdminTicketTill route={{ params: { id: 3 } }} />);
    await waitFor(() => expect(screen.getByTestId('admin-till-phone')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('admin-till-phone'), '0812');
    await act(async () => { fireEvent.press(screen.getByTestId('admin-till-test')); });
    expect(mockApi.adminTillAction).not.toHaveBeenCalled();
  });
});

describe('every event has a tab', () => {
  test("an event never sent for review is under Not sent, marked as such", async () => {
    const draft = { ...EVENT, review_status: 'unsubmitted', publish_requested: false };
    mockApi.fetchAdminTicketEvents.mockImplementation(async (p) => ({ results: p.view === 'drafts' ? [draft] : [], next: null }));
    const screen = render(<AdminTickets navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(screen.getByText('adminTix.empty.events')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-tix-filter-drafts'));
    await waitFor(() => expect(screen.getByText('Gospel Night')).toBeTruthy());
    expect(screen.getByText('adminTix.review.unsubmitted')).toBeTruthy();
  });

  test('a live event that was warned and paused says so on its row', async () => {
    mockApi.fetchAdminTicketEvents.mockResolvedValue({ results: [{ ...EVENT, status: 'draft', review_status: 'approved',
      paused_by_staff: true, warning_note: 'Wrong date' }], next: null });
    const screen = render(<AdminTickets navigation={{ navigate: jest.fn() }} />);
    await waitFor(() => expect(screen.getByText('adminTix.state.paused')).toBeTruthy());
    expect(screen.getByText('adminTix.warned')).toBeTruthy();
  });
});

describe('managing an approved event', () => {
  const LIVE = { ...EVENT, status: 'published', review_status: 'approved', warning_note: '', paused_by_staff: false, removed_at: null };
  const openEvent = (event) => {
    mockApi.fetchAdminTicketEvent.mockResolvedValue(event);
    return render(<AdminTicketEvent navigation={{ navigate: jest.fn() }} route={{ params: { id: 5 } }} />);
  };
  const giveReason = async (screen, text) => {
    await waitFor(() => expect(screen.getByTestId('reason-sheet')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('reason-text'), text);
    await act(async () => { fireEvent.press(screen.getByTestId('reason-confirm')); });
  };

  test('warn: the note goes with it, and shows on the event', async () => {
    mockApi.adminTicketEventAction.mockResolvedValue({ ...LIVE, warning_note: 'Your poster lists the wrong date' });
    const screen = openEvent(LIVE);
    await waitFor(() => expect(screen.getByTestId('admin-tix-warn')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-tix-warn'));
    await giveReason(screen, 'Your poster lists the wrong date');
    expect(mockApi.adminTicketEventAction).toHaveBeenCalledWith(5, 'warn', { note: 'Your poster lists the wrong date' });
    await waitFor(() => expect(screen.getByText('Your poster lists the wrong date')).toBeTruthy());
  });

  test('pause, then resume', async () => {
    mockApi.adminTicketEventAction
      .mockResolvedValueOnce({ ...LIVE, status: 'draft', paused_by_staff: true, pause_note: 'Checking a complaint' })
      .mockResolvedValueOnce(LIVE);
    const screen = openEvent(LIVE);
    await waitFor(() => expect(screen.getByTestId('admin-tix-pause')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-tix-pause'));
    await giveReason(screen, 'Checking a complaint');
    expect(mockApi.adminTicketEventAction).toHaveBeenCalledWith(5, 'pause', { note: 'Checking a complaint' });
    await waitFor(() => expect(screen.getByTestId('admin-tix-resume')).toBeTruthy());
    expect(screen.queryByTestId('admin-tix-pause')).toBeNull();

    await act(async () => { fireEvent.press(screen.getByTestId('admin-tix-resume')); });
    expect(mockApi.adminTicketEventAction).toHaveBeenLastCalledWith(5, 'resume', undefined);
    await waitFor(() => expect(screen.getByTestId('admin-tix-pause')).toBeTruthy());
  });

  test('burn: removed for good, and nothing more can be done to it', async () => {
    mockApi.adminTicketEventAction.mockResolvedValue({ ...LIVE, status: 'cancelled', removed_at: future, removed_note: 'Fraudulent event' });
    const screen = openEvent(LIVE);
    await waitFor(() => expect(screen.getByTestId('admin-tix-remove')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-tix-remove'));
    await giveReason(screen, 'Fraudulent event');
    expect(mockApi.adminTicketEventAction).toHaveBeenCalledWith(5, 'remove', { note: 'Fraudulent event' });
    await waitFor(() => expect(screen.getByText('Fraudulent event')).toBeTruthy());
    expect(screen.getByText('adminTix.state.removed')).toBeTruthy();
    for (const id of ['admin-tix-warn', 'admin-tix-pause', 'admin-tix-remove', 'admin-tix-reject', 'admin-tix-approve']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  test('a draft never sent says so, and can still be approved', async () => {
    mockApi.adminTicketEventAction.mockResolvedValue({ ...EVENT, review_status: 'approved' });
    const screen = openEvent({ ...EVENT, review_status: 'unsubmitted', publish_requested: false });
    await waitFor(() => expect(screen.getByText('adminTix.notSent')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('admin-tix-approve')); });
    expect(mockApi.adminTicketEventAction).toHaveBeenCalledWith(5, 'approve', undefined);
  });
});

describe('organisers locked out', () => {
  const ORG = { id: 2, email: 'org@example.com', display_name: 'Amani Choir', phone: '0712345678', events: 3, tills: 1,
    date_joined: '2026-09-01T10:00:00Z', last_login: null };

  test('searched by email, name or phone, once typing pauses', async () => {
    mockApi.fetchAdminTicketEvents.mockResolvedValue({ results: [], next: null });
    mockApi.fetchAdminTicketOrganisers.mockResolvedValue({ results: [ORG], next: null });
    const navigation = { navigate: jest.fn() };
    const screen = render(<AdminTickets navigation={navigation} route={{}} />);
    fireEvent.press(screen.getByTestId('admin-tix-tab-organisers'));
    fireEvent.changeText(screen.getByTestId('admin-tix-org-search'), '0712');
    fireEvent.changeText(screen.getByTestId('admin-tix-org-search'), '0712345678');
    await waitFor(() => expect(mockApi.fetchAdminTicketOrganisers).toHaveBeenLastCalledWith({ search: '0712345678' }));
    expect(mockApi.fetchAdminTicketOrganisers).not.toHaveBeenCalledWith({ search: '0712' });
    fireEvent.press(await screen.findByTestId('admin-tix-org-2'));
    expect(navigation.navigate).toHaveBeenCalledWith('AdminTicketOrganiser', { id: 2 });
  });

  test('a code to read out is shown once it is confirmed; emailing never shows one', async () => {
    mockApi.fetchAdminTicketOrganiser.mockResolvedValue(ORG);
    mockApi.adminTicketOrganiserAction.mockImplementation(async (id, action) => (action === 'reset-code'
      ? { code: '482913', expires_at: '2026-10-04T12:15:00Z' } : { detail: 'A code is on its way to org@example.com.', sent: true }));
    const screen = render(<AdminTicketOrganiser route={{ params: { id: 2 } }} />);
    fireEvent.press(await screen.findByTestId('admin-org-send-reset'));
    await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('adminTix.org.done', 'A code is on its way to org@example.com.'));
    expect(screen.queryByTestId('admin-org-code')).toBeNull();

    mockConfirm.mockResolvedValueOnce(false);
    fireEvent.press(screen.getByTestId('admin-org-reset-code'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(2));
    expect(mockApi.adminTicketOrganiserAction).not.toHaveBeenCalledWith(2, 'reset-code');

    fireEvent.press(screen.getByTestId('admin-org-reset-code'));
    await waitFor(() => expect(screen.getByText('482913')).toBeTruthy());
    expect(mockConfirm.mock.calls[2][0].destructive).toBe(true);
  });

  test('sign out everywhere, and a refusal is said plainly', async () => {
    mockApi.fetchAdminTicketOrganiser.mockResolvedValue(ORG);
    mockApi.adminTicketOrganiserAction.mockRejectedValue(new Error('Email is not set up on the ticket server.'));
    const screen = render(<AdminTicketOrganiser route={{ params: { id: 2 } }} />);
    fireEvent.press(await screen.findByTestId('admin-org-sign-out'));
    await waitFor(() => expect(mockApi.adminTicketOrganiserAction).toHaveBeenCalledWith(2, 'sign-out'));
    await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('adminTix.actionFailed', 'Email is not set up on the ticket server.'));
  });
});
