/**
 * Pulse, the admin dashboard: the charts for an admin with analytics, the
 * counts and the queue for one without, and the admin tabs that show only
 * what an admin's powers cover.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, waitFor, act, configure } from '@testing-library/react-native';

jest.setTimeout(20000);
configure({ asyncUtilTimeout: 8000 });

const mockApi = new Proxy({}, { get: (target, k) => (target[k] ||= jest.fn()) });
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 1, username: 'boss' } }) }));
const mockNav = { navigate: jest.fn(), replace: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (fn) => require('react').useEffect(fn, [fn]),
  useNavigation: () => mockNav,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));

const { AdminMe } = require('../AdminKit');
const AdminDashboard = require('../AdminDashboard').default;
const AdminTabs = require('../AdminTabs').default;

const asAdmin = (ui, me) => render(<AdminMe.Provider value={me}>{ui}</AdminMe.Provider>);

const DASH = {
  totals: { users: 120 }, signups: { last_24h: 4 }, reports: { pending: 1 }, appeals: { pending: 2 },
  recent_reports: [{ id: 5, status: 'pending', reason: 'spam', dup_count: 3, content_type: 'post', object_id: 9, target: { caption: 'buy now' } }],
};
const PULSE_DATA = {
  days: 14, dates: ['2026-09-18', '2026-10-01'], online_now: 12,
  rings: {
    active: { pct: 40, value: 48, of: 120 }, reports: { pct: 80, value: 10, fast: 8, open: 1 },
    appeals: { pct: 50, value: 2, waiting: 2 }, two_factor: { pct: 100, value: 3, of: 3 },
  },
  trend: { signups: [2, 5], reports: [1, 0] },
  reasons: [{ reason: 'spam', label: 'Spam', count: 6 }],
  hours: Array.from({ length: 24 }, (_, i) => i),
  mix: { posts: 6, tracks: 2, products: 1, stories: 1 },
  top: [{ id: 3, username: 'choir', name: 'Joyful Voices', followers: 88 }],
};

beforeEach(() => {
  Object.keys(mockApi).forEach((k) => mockApi[k].mockReset());
  mockNav.replace.mockClear();
});

test('with analytics: rings, charts, most followed and the queue', async () => {
  mockApi.fetchAdminDashboard.mockResolvedValue(DASH);
  mockApi.fetchAdminPulse.mockResolvedValue(PULSE_DATA);
  const screen = asAdmin(<AdminDashboard navigation={mockNav} />, { is_super_admin: true, capabilities: [] });
  await waitFor(() => expect(screen.getByTestId('pulse-rings')).toBeTruthy());
  expect(mockApi.fetchAdminPulse).toHaveBeenCalledWith(14);
  expect(screen.getByTestId('pulse-online')).toHaveTextContent('adminPulse.online:12');
  expect(screen.getByText('adminPulse.allProtected')).toBeTruthy();
  expect(screen.getByText('report.reason.spam')).toBeTruthy();
  expect(screen.getByText('Joyful Voices')).toBeTruthy();
  expect(screen.getByText('60%')).toBeTruthy();                 // posts: 6 of 10 shared items
  expect(screen.getByText('buy now')).toBeTruthy();
  expect(screen.getByText('adminPulse.reportsN:3')).toBeTruthy();

  // Another period asks again.
  await act(async () => { fireEvent.press(screen.getByTestId('pulse-days-30')); });
  await waitFor(() => expect(mockApi.fetchAdminPulse).toHaveBeenLastCalledWith(30));
});

test('without analytics: counts only, the charts never asked for', async () => {
  mockApi.fetchAdminDashboard.mockResolvedValue(DASH);
  const screen = asAdmin(<AdminDashboard navigation={mockNav} />, { capabilities: ['handle_reports'] });
  await waitFor(() => expect(screen.getByText('adminPulse.members')).toBeTruthy());
  expect(screen.getByText('120')).toBeTruthy();
  expect(mockApi.fetchAdminPulse).not.toHaveBeenCalled();
  expect(screen.queryByTestId('pulse-rings')).toBeNull();
  expect(screen.getByTestId('pulse-needs')).toBeTruthy();
});

test('tabs: only what the powers cover; a tab swaps the screen', () => {
  const screen = asAdmin(
    <AdminTabs navigation={mockNav} current="AdminDashboard"><Text>body</Text></AdminTabs>,
    { capabilities: ['handle_reports'] },
  );
  expect(screen.getByText('body')).toBeTruthy();
  expect(screen.getByTestId('admin-tab-AdminReports')).toBeTruthy();
  expect(screen.queryByTestId('admin-tab-AdminUsers')).toBeNull();
  expect(screen.queryByTestId('admin-tab-AdminAppeals')).toBeNull();
  fireEvent.press(screen.getByTestId('admin-tab-AdminReports'));
  expect(mockNav.replace).toHaveBeenCalledWith('AdminReports');
  fireEvent.press(screen.getByTestId('admin-tab-AdminDashboard'));
  expect(mockNav.replace).toHaveBeenCalledTimes(1);           // already there
});

test('a tool reached from More keeps More lit', () => {
  const screen = asAdmin(
    <AdminTabs navigation={mockNav} current="AdminQuizBank"><Text>quiz</Text></AdminTabs>,
    { is_super_admin: true, capabilities: [] },
  );
  expect(screen.getByTestId('admin-tab-AdminMore').props.accessibilityState).toEqual({ selected: true });
});
