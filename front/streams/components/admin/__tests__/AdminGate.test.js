/**
 * The admin area's door: asks the server every time; a member (or a removed
 * admin) is sent Home; two-step sign-in is set up or asked for; and while
 * inside, a code asked for by the server opens over the screen.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockApi = {
  fetchAdminSecurity: jest.fn(), startAdminTwoFactor: jest.fn(),
  confirmAdminTwoFactor: jest.fn(), verifyAdminCode: jest.fn(),
};
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
const mockStore = {};
jest.mock('../../../services/secureStorage', () => ({
  getItemAsync: jest.fn(async (k) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k, v) => { mockStore[k] = v; }),
  deleteItemAsync: jest.fn(async (k) => { delete mockStore[k]; }),
}));
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../utils/optionalNative', () => ({ clipboard: () => null }));

const session = require('../../../utils/adminSession');
const AdminGate = require('../AdminGate').default;

const nav = { replace: jest.fn() };
const gate = () => render(<AdminGate navigation={nav}><Text>inside</Text></AdminGate>);
const me = (extra) => ({ is_admin: true, two_factor_required: true, two_factor_enabled: true, session_valid: false, ...extra });

beforeEach(async () => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  nav.replace.mockClear();
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
  await session.clearAdminSession();
});

test('not an admin (or no longer one): sent Home, nothing shown', async () => {
  mockApi.fetchAdminSecurity.mockRejectedValue({ status: 403 });
  const screen = gate();
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('Home'));
  expect(screen.queryByText('inside')).toBeNull();
});

test('a live admin session: straight in', async () => {
  mockApi.fetchAdminSecurity.mockResolvedValue(me({ session_valid: true }));
  const screen = gate();
  await waitFor(() => expect(screen.getByText('inside')).toBeTruthy());
});

test('a code opens the admin session; a wrong one does not', async () => {
  mockApi.fetchAdminSecurity.mockResolvedValue(me());
  mockApi.verifyAdminCode
    .mockRejectedValueOnce({ status: 400, data: { error: 'That code is not right.' } })
    .mockResolvedValueOnce({ admin_session: 'tok-1', expires_at: '2099-01-01T00:00:00Z' });
  const screen = gate();
  await waitFor(() => expect(screen.getByTestId('admin-code')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('admin-code'), '111111');
  await act(async () => { fireEvent.press(screen.getByTestId('admin-code-submit')); });
  expect(screen.getByText('That code is not right.')).toBeTruthy();
  expect(screen.queryByText('inside')).toBeNull();
  fireEvent.changeText(screen.getByTestId('admin-code'), '123456');
  await act(async () => { fireEvent.press(screen.getByTestId('admin-code-submit')); });
  expect(mockApi.verifyAdminCode).toHaveBeenLastCalledWith({ code: '123456' });
  expect(screen.getByText('inside')).toBeTruthy();
  expect(session.adminToken()).toBe('tok-1');
});

test('a backup code instead', async () => {
  mockApi.fetchAdminSecurity.mockResolvedValue(me());
  mockApi.verifyAdminCode.mockResolvedValue({ admin_session: 'tok-2', expires_at: '2099-01-01T00:00:00Z' });
  const screen = gate();
  await waitFor(() => expect(screen.getByTestId('admin-code')).toBeTruthy());
  fireEvent.press(screen.getByTestId('admin-code-switch'));
  fireEvent.changeText(screen.getByTestId('admin-code'), 'ab12-cd34');
  await act(async () => { fireEvent.press(screen.getByTestId('admin-code-submit')); });
  expect(mockApi.verifyAdminCode).toHaveBeenCalledWith({ backupCode: 'ab12-cd34' });
});

test('first time: set up the authenticator, then the backup codes, then in', async () => {
  mockApi.fetchAdminSecurity.mockResolvedValue(me({ two_factor_enabled: false }));
  mockApi.startAdminTwoFactor.mockResolvedValue({ secret: 'ABCDEFGHIJKLMNOP', otpauth_url: 'otpauth://totp/x' });
  mockApi.confirmAdminTwoFactor.mockResolvedValue({
    admin_session: 'tok-3', expires_at: '2099-01-01T00:00:00Z', backup_codes: ['aaaa-bbbb', 'cccc-dddd'],
  });
  const screen = gate();
  await waitFor(() => expect(screen.getByTestId('admin-setup-start')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('admin-setup-start')); });
  expect(screen.getByText('ABCD EFGH IJKL MNOP')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('admin-setup-code'), '654321');
  await act(async () => { fireEvent.press(screen.getByTestId('admin-setup-code-submit')); });
  expect(mockApi.confirmAdminTwoFactor).toHaveBeenCalledWith('654321');
  expect(screen.getByText('aaaa-bbbb')).toBeTruthy();
  fireEvent.press(screen.getByTestId('admin-backup-done'));
  expect(screen.getByText('inside')).toBeTruthy();
});

test('a code asked for by the server opens over any screen (AdminCodeHost)', async () => {
  const AdminCodeHost = require('../AdminCodeHost').default;
  mockApi.verifyAdminCode.mockResolvedValue({ admin_session: 'tok-9', expires_at: '2099-01-01T00:00:00Z' });
  const screen = render(<><Text>notice board</Text><AdminCodeHost /></>);
  let answer;
  await act(async () => { answer = session.askForCode('reauth_required'); });
  expect(screen.getByTestId('admin-reauth')).toBeTruthy();
  expect(screen.getByText('admin.gate.confirmTitle')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('admin-reauth-code'), '222222');
  await act(async () => { fireEvent.press(screen.getByTestId('admin-reauth-code-submit')); });
  await expect(answer).resolves.toBe(true);
  expect(session.adminToken()).toBe('tok-9');
  expect(screen.queryByTestId('admin-reauth')).toBeNull();
});

test('cancelled, the action is not sent again', async () => {
  const AdminCodeHost = require('../AdminCodeHost').default;
  const screen = render(<AdminCodeHost />);
  let answer;
  await act(async () => { answer = session.askForCode('admin_session_required'); });
  await act(async () => { fireEvent.press(screen.getByTestId('admin-reauth-cancel')); });
  await expect(answer).resolves.toBe(false);
});

test('the session kept on the phone ends when it expires', async () => {
  await session.setAdminSession('old', '2000-01-01T00:00:00Z');
  expect(session.adminToken()).toBeNull();
});
