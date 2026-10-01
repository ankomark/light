/**
 * Admin phase 2: the screens act on what the server says (capabilities,
 * who may be acted on, what can be taken down), every action on someone asks
 * why, and a list that could not be read says so.
 */
import React from 'react';
import { render, fireEvent, waitFor, act, configure } from '@testing-library/react-native';

jest.setTimeout(20000);
// The first render of these large screens can take a few seconds on a cold run.
configure({ asyncUtilTimeout: 8000 });

const mockApi = new Proxy({}, { get: (target, k) => (target[k] ||= jest.fn()) });
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 1, username: 'boss' } }) }));
const mockNav = { navigate: jest.fn(), replace: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (fn) => require('react').useEffect(fn, []),
  useNavigation: () => mockNav,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
const mockConfirm = jest.fn(async () => true);
const mockNotify = jest.fn();
jest.mock('../../../utils/adminConfirm', () => ({
  confirmAction: (...a) => mockConfirm(...a), notify: (...a) => mockNotify(...a),
}));
jest.mock('../../../services/secureStorage', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}),
}));

const { AdminMe } = require('../AdminKit');
const AdminUsers = require('../AdminUsers').default;
const AdminReports = require('../AdminReports').default;
const AdminContent = require('../AdminContent').default;
const AdminLogs = require('../AdminLogs').default;
const AdminMore = require('../AdminMore').default;

const asAdmin = (ui, me = { is_super_admin: true, capabilities: [] }) => render(<AdminMe.Provider value={me}>{ui}</AdminMe.Provider>);

const pickReason = async (screen, key = 'spam') => {
  await waitFor(() => expect(screen.getByTestId('reason-sheet')).toBeTruthy());
  // Nothing goes until a reason is given.
  expect(screen.getByTestId('reason-confirm').props.accessibilityState?.disabled).toBe(true);
  fireEvent.press(screen.getByTestId(`reason-${key}`));
  await act(async () => { fireEvent.press(screen.getByTestId('reason-confirm')); });
};

const member = (extra) => ({
  id: 9, username: 'mark', email: 'm@x.com', is_active: true, is_suspended: false, strikes: 0,
  can_act: true, two_factor_enabled: null, ...extra,
});

beforeEach(() => {
  Object.keys(mockApi).forEach((k) => mockApi[k].mockReset());
  mockConfirm.mockClear();
  mockNotify.mockClear();
  mockNav.navigate.mockClear();
});

describe('users', () => {
  test('a ban asks why, and the reason goes with it', async () => {
    mockApi.fetchAdminUsers.mockResolvedValue({ results: [member()] });
    mockApi.fetchRoles.mockResolvedValue([]);
    mockApi.banUser.mockResolvedValue(member({ is_active: false }));
    const screen = asAdmin(<AdminUsers />);
    await waitFor(() => expect(screen.getByText('@mark')).toBeTruthy());
    fireEvent.press(screen.getByText('@mark'));
    fireEvent.press(screen.getByTestId('users-ban'));
    await pickReason(screen, 'scam');
    expect(mockApi.banUser).toHaveBeenCalledWith(9, 'adminKit.reason.scam');
  });

  test('no action offered on an admin of the same rank or above', async () => {
    mockApi.fetchAdminUsers.mockResolvedValue({ results: [member({ can_act: false, admin_role: 'moderator' })] });
    mockApi.fetchRoles.mockResolvedValue([]);
    const screen = asAdmin(<AdminUsers />, { capabilities: ['manage_users', 'ban_users'] });
    await waitFor(() => expect(screen.getByText('@mark')).toBeTruthy());
    fireEvent.press(screen.getByText('@mark'));
    expect(screen.getByTestId('users-rank-note')).toBeTruthy();
    expect(screen.queryByTestId('users-ban')).toBeNull();
    expect(screen.queryByTestId('users-warn')).toBeNull();
  });

  test('a role change is confirmed first; filters ask the server', async () => {
    mockApi.fetchAdminUsers.mockResolvedValue({ results: [member()] });
    mockApi.fetchRoles.mockResolvedValue([{ id: 4, name: 'Helpers' }]);
    mockApi.assignUserRole.mockResolvedValue(member({ role: { id: 4, name: 'Helpers' } }));
    const screen = asAdmin(<AdminUsers />);
    await waitFor(() => expect(screen.getByText('@mark')).toBeTruthy());
    fireEvent.press(screen.getByText('@mark'));
    mockConfirm.mockResolvedValueOnce(false);
    await act(async () => { fireEvent.press(screen.getByTestId('users-role-4')); });
    expect(mockApi.assignUserRole).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId('users-role-4')); });
    expect(mockApi.assignUserRole).toHaveBeenCalledWith(9, 4);
    fireEvent.press(screen.getByText('admin.close'));
    await act(async () => { fireEvent.press(screen.getByTestId('users-filter-banned')); });
    expect(mockApi.fetchAdminUsers).toHaveBeenLastCalledWith('', '', 'banned');
  });

  test('a list that could not be read says so', async () => {
    mockApi.fetchAdminUsers.mockRejectedValue(new Error('offline'));
    mockApi.fetchRoles.mockResolvedValue([]);
    const screen = asAdmin(<AdminUsers />);
    await waitFor(() => expect(screen.getByTestId('admin-error')).toBeTruthy());
    expect(screen.queryByText('admin.noUsers')).toBeNull();
  });
});

describe('reports', () => {
  const report = (extra) => ({
    id: 3, reason: 'spam', content_type: 'message', object_id: 77, status: 'pending',
    target: { id: 77, content: 'buy now' }, reporter: { username: 'ann' }, can_remove: true, ...extra,
  });

  test('what the server says can be taken down, with a reason', async () => {
    mockApi.fetchAdminReports.mockResolvedValue({ results: [report()] });
    mockApi.removeReportTarget.mockResolvedValue({});
    const screen = asAdmin(<AdminReports />);
    await waitFor(() => expect(screen.getByText('common.remove')).toBeTruthy());
    fireEvent.press(screen.getByText('common.remove'));
    await pickReason(screen, 'scam');
    expect(mockApi.removeReportTarget).toHaveBeenCalledWith(3, 'adminKit.reason.scam');
  });

  test('nothing to take down when the server says so', async () => {
    mockApi.fetchAdminReports.mockResolvedValue({ results: [report({ can_remove: false })] });
    const screen = asAdmin(<AdminReports />);
    await waitFor(() => expect(screen.getByText('admin.resolve')).toBeTruthy());
    expect(screen.queryByText('common.remove')).toBeNull();
  });

  test('a queue that could not be read is not shown as empty', async () => {
    mockApi.fetchAdminReports.mockRejectedValue(new Error('offline'));
    const screen = asAdmin(<AdminReports />);
    await waitFor(() => expect(screen.getByTestId('admin-error')).toBeTruthy());
  });
});

test('content: a song taken down for copyright says so', async () => {
  mockApi.fetchAdminContent.mockResolvedValue({ results: [{ id: 5, title: 'Song', is_removed: false }] });
  mockApi.removeContent.mockResolvedValue({});
  const screen = asAdmin(<AdminContent />);
  await waitFor(() => expect(screen.getByText('Song')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByText('adminContent.type.track')); });
  await waitFor(() => expect(mockApi.fetchAdminContent).toHaveBeenLastCalledWith('track', '', ''));
  await waitFor(() => expect(screen.getByText('common.remove')).toBeTruthy());
  fireEvent.press(screen.getByText('common.remove'));
  await waitFor(() => expect(screen.getByTestId('reason-extra-copyright')).toBeTruthy());
  fireEvent.press(screen.getByTestId('reason-extra-copyright'));
  await pickReason(screen, 'copyright');
  expect(mockApi.removeContent).toHaveBeenCalledWith('track', 5, 'adminKit.reason.copyright', 'copyright');
});

test('audit log: who acted and from where, and the trail checked', async () => {
  mockApi.fetchAdminLogs.mockResolvedValue({ results: [{
    id: 1, action: 'ban_user', actor: null, actor_name: 'boss', target_type: 'user', target_id: 9,
    reason: 'scam', ip: '10.0.0.7', user_agent: 'AdventistLife/1.0', created_at: new Date().toISOString(),
  }] });
  mockApi.verifyAdminLog.mockResolvedValue({ ok: false, first_broken_id: 42, checked: 10 });
  const screen = asAdmin(<AdminLogs />);
  await waitFor(() => expect(screen.getByText('10.0.0.7  ·  AdventistLife/1.0')).toBeTruthy());
  expect(screen.getByText(/@boss/)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('logs-verify')); });
  expect(screen.getByTestId('logs-verdict')).toHaveTextContent('adminLogs.broken:42');
});

test('more: only the tools the server allows, and a way out of admin', async () => {
  mockApi.endAdminSession.mockResolvedValue({});
  const screen = asAdmin(<AdminMore navigation={mockNav} />, { capabilities: ['manage_wallpapers'] });
  await waitFor(() => expect(screen.getByText('adminDash.link.wallpapers')).toBeTruthy());
  expect(screen.queryByText('adminDash.link.reports')).toBeNull();
  expect(screen.queryByText('adminDash.link.roles')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('admin-sign-out')); });
  expect(mockApi.endAdminSession).toHaveBeenCalled();
  expect(mockNav.navigate).toHaveBeenCalledWith('Home');
});
