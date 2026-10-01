/**
 * Admin phase 4: maintenance and the app's switches as members meet them,
 * broadcasts, app control, the priority queue, a user's history, insights.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, waitFor, act, configure } from '@testing-library/react-native';

jest.setTimeout(20000);
configure({ asyncUtilTimeout: 8000 });

const mockApi = new Proxy({ API_URL: 'http://api.test/api' }, { get: (target, k) => (k in target ? target[k] : (target[k] = jest.fn())) });
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (k === 'API_URL' ? 'http://api.test/api' : (...a) => mockApi[k](...a)) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
let mockUser = { id: 1, username: 'member', capabilities: [] };
let mockAuthed = true;
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: mockUser, isAuthenticated: mockAuthed }) }));
jest.mock('@react-navigation/native', () => ({
  // Like the real one: runs again when its callback changes.
  useFocusEffect: (fn) => require('react').useEffect(fn, [fn]),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
const mockConfirm = jest.fn(async () => true);
const mockNotify = jest.fn();
jest.mock('../../../utils/adminConfirm', () => ({ confirmAction: (...a) => mockConfirm(...a), notify: (...a) => mockNotify(...a) }));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///c/', writeAsStringAsync: jest.fn(async () => {}) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => false), shareAsync: jest.fn() }));

const { AppStatusProvider, useFeature, reportMaintenance } = require('../../../context/AppStatusContext');
const MaintenanceGate = require('../../MaintenanceGate').default;
const AdminBroadcast = require('../AdminBroadcast').default;
const AdminAppControl = require('../AdminAppControl').default;
const AdminReports = require('../AdminReports').default;
const AdminUsers = require('../AdminUsers').default;
const AdminAnalytics = require('../AdminAnalytics').default;
const { AdminMe } = require('../AdminKit');

const status = (extra = {}) => ({
  maintenance: { on: false, message: '' }, features: { marketplace: true, quiz: true, puzzle: true, live: true }, ...extra,
});
const serve = (body) => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => body })); };

beforeEach(() => {
  Object.keys(mockApi).forEach((k) => typeof mockApi[k] === 'function' && mockApi[k].mockReset?.());
  mockConfirm.mockClear();
  mockNotify.mockClear();
  mockUser = { id: 1, username: 'member', capabilities: [] };
  mockAuthed = true;
});

describe('as members meet it', () => {
  const app = () => render(<AppStatusProvider><MaintenanceGate><Text>the app</Text></MaintenanceGate></AppStatusProvider>);

  test('in maintenance a member sees the message; an admin goes on in', async () => {
    serve(status({ maintenance: { on: true, message: 'Back by 6' } }));
    let screen = app();
    await waitFor(() => expect(screen.getByTestId('maintenance')).toBeTruthy());
    expect(screen.getByText('Back by 6')).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
    mockUser = { id: 2, username: 'boss', is_super_admin: true };
    screen = app();
    await waitFor(() => expect(screen.getByText('the app')).toBeTruthy());
  });

  test('signed out, the staff sign-in is still reachable', async () => {
    serve(status({ maintenance: { on: true, message: '' } }));
    mockUser = null;
    mockAuthed = false;
    const screen = app();
    await waitFor(() => expect(screen.getByTestId('maintenance-staff')).toBeTruthy());
    fireEvent.press(screen.getByTestId('maintenance-staff'));
    expect(screen.getByText('the app')).toBeTruthy();
  });

  test('a request turned away for maintenance shows it at once', async () => {
    serve(status());
    const screen = app();
    await waitFor(() => expect(screen.getByText('the app')).toBeTruthy());
    act(() => { reportMaintenance('Upgrading the database'); });
    expect(screen.getByText('Upgrading the database')).toBeTruthy();
  });

  test('a part switched off', async () => {
    serve(status({ features: { marketplace: false, quiz: true, puzzle: true, live: true } }));
    const Probe = () => <Text>{useFeature('marketplace') ? 'market on' : 'market off'}</Text>;
    const screen = render(<AppStatusProvider><Probe /></AppStatusProvider>);
    await waitFor(() => expect(screen.getByText('market off')).toBeTruthy());
  });
});

test('broadcast: how many it reaches, confirmed, then sent', async () => {
  mockApi.fetchAdminBroadcasts.mockResolvedValue([]);
  mockApi.previewBroadcast.mockImplementation(async (audience) => ({ recipients: audience === 'sellers' ? 12 : 300 }));
  mockApi.sendBroadcast.mockResolvedValue({ recipients: 12 });
  const screen = render(<AdminBroadcast />);
  await waitFor(() => expect(screen.getByTestId('broadcast-reach')).toHaveTextContent('adminBroadcast.reach:300'));
  fireEvent.press(screen.getByTestId('broadcast-to-sellers'));
  await waitFor(() => expect(screen.getByTestId('broadcast-reach')).toHaveTextContent('adminBroadcast.reach:12'));
  fireEvent.changeText(screen.getByTestId('broadcast-title'), 'Market day');
  fireEvent.changeText(screen.getByTestId('broadcast-message'), 'List your goods today!');
  await act(async () => { fireEvent.press(screen.getByTestId('broadcast-send')); });
  expect(mockConfirm.mock.calls[0][0].title).toBe('adminBroadcast.confirmTitle:12');
  expect(mockApi.sendBroadcast).toHaveBeenCalledWith('Market day', 'List your goods today!', 'sellers');
});

test('app control: maintenance confirmed with its message; a part switched off', async () => {
  mockApi.fetchAppSettings.mockResolvedValue(status());
  mockApi.saveAppSettings.mockImplementation(async (c) => status(c.maintenance ? { maintenance: c.maintenance } : {}));
  serve(status());
  const screen = render(<AppStatusProvider><AdminAppControl /></AppStatusProvider>);
  await waitFor(() => expect(screen.getByTestId('app-maintenance-switch')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('app-maintenance-message'), 'Back by 6');
  await act(async () => { fireEvent(screen.getByTestId('app-maintenance-switch'), 'valueChange', true); });
  expect(mockApi.saveAppSettings).toHaveBeenCalledWith({ maintenance: { on: true, message: 'Back by 6' } });
  await act(async () => { fireEvent(screen.getByTestId('app-feature-quiz'), 'valueChange', false); });
  expect(mockApi.saveAppSettings).toHaveBeenLastCalledWith({ features: { quiz: false } });
});

test('reports: the most reported first, repeat offenders marked', async () => {
  mockApi.fetchAdminReports.mockResolvedValue({ results: [{
    id: 1, reason: 'spam', content_type: 'post', object_id: 5, status: 'pending', duplicate_count: 4,
    target: { id: 5, caption: 'buy now', author: { id: 9, username: 'troll' } }, author_strikes: 2, can_remove: true,
  }] });
  const screen = render(<AdminMe.Provider value={{ is_super_admin: true }}><AdminReports /></AdminMe.Provider>);
  await waitFor(() => expect(screen.getByTestId('report-repeat-1')).toHaveTextContent('adminReports.repeat:2'));
  expect(mockApi.fetchAdminReports).toHaveBeenCalledWith('pending', 'priority');
  await act(async () => { fireEvent.press(screen.getByTestId('reports-priority')); });
  await waitFor(() => expect(mockApi.fetchAdminReports).toHaveBeenLastCalledWith('pending', ''));
});

test('users: an account history', async () => {
  mockApi.fetchAdminUsers.mockResolvedValue({ results: [{ id: 9, username: 'troll', email: 't@x.com', is_active: true, can_act: true }] });
  mockApi.fetchRoles.mockResolvedValue([]);
  mockApi.fetchUserHistory.mockResolvedValue({
    reports_against: { total: 3, pending: 1 }, reports_made: 0, devices_signed_in: 2, posts: 4,
    admin_actions: [{ id: 7, action: 'warn_user', by: 'boss', reason: 'spam', created_at: '2026-10-01T10:00:00Z' }],
  });
  const screen = render(<AdminMe.Provider value={{ is_super_admin: true }}><AdminUsers /></AdminMe.Provider>);
  await waitFor(() => expect(screen.getByText('@troll')).toBeTruthy());
  fireEvent.press(screen.getByText('@troll'));
  await act(async () => { fireEvent.press(screen.getByTestId('users-history-open')); });
  expect(screen.getByTestId('users-history')).toHaveTextContent(/adminUsers\.historyReports:3,1/);
  expect(screen.getByText(/warn user · @boss — spam/)).toBeTruthy();
});

test('insights: who is active and the numbers over time', async () => {
  mockApi.fetchAdminInsights.mockResolvedValue({
    days: 14, dates: ['2026-09-30', '2026-10-01'], active: { today: 5, week: 40, month: 90 },
    series: { signups: [1, 2], posts: [0, 3], orders: [2, 1], quiz_games: [4, 4], puzzles_done: [1, 0], reports: [0, 1] },
  });
  const screen = render(<AdminAnalytics />);
  await waitFor(() => expect(screen.getByTestId('insights-active')).toHaveTextContent(/5.*40.*90/));
  expect(screen.getByText('adminInsights.orders')).toBeTruthy();
});
