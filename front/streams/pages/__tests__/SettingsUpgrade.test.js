/**
 * Settings: the saved switches at once, search, choosing from a list, quiet
 * hours, a test notification, the devices signed in, and storage.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { writeCache, dropCache } from '../../utils/screenCache';

jest.setTimeout(20000);

const mockApi = {
  fetchNotificationPreferences: jest.fn(), updateNotificationPreferences: jest.fn(async () => ({})),
  fetchSessions: jest.fn(), revokeSession: jest.fn(async () => ({})), revokeOtherSessions: jest.fn(),
  exportMyData: jest.fn(), sendTestPush: jest.fn(), updateProfileFields: jest.fn(),
  createAdminNote: jest.fn(), changePassword: jest.fn(), deactivateAccount: jest.fn(), deleteAccount: jest.fn(),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../services/pushNotifications', () => ({
  registerForPushNotifications: jest.fn(), unregisterPushToken: jest.fn(),
}));
jest.mock('../../context/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 7, username: 'mark', is_public: true },
    isEmailVerified: true, logout: jest.fn(), updateUser: jest.fn(),
  }),
}));
const mockSetPref = jest.fn();
jest.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { pushEnabled: true, videoQuality: 'auto' }, setPreference: mockSetPref }),
}));
const mockSetMode = jest.fn();
jest.mock('../../context/ThemeContext', () => {
  const { paletteFor } = require('../../constants/theme');
  return { useTheme: () => ({ colors: paletteFor('dark'), mode: 'dark', setMode: mockSetMode }) };
});
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
const mockSetLanguage = jest.fn();
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({
    t: mockT, language: 'en', setLanguage: mockSetLanguage,
    languages: [{ code: 'en', label: 'English' }, { code: 'sw', label: 'Kiswahili' }],
  }),
}));
jest.mock('../../utils/preferences', () => ({
  PREF_KEYS: new Proxy({}, { get: (_, k) => k }), AUDIO_QUALITY_TIERS_AVAILABLE: false,
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), reset: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null, MaterialIcons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, initialWindowMetrics: null };
});
jest.mock('../../components/GlassView', () => {
  const { View } = require('react-native');
  return ({ children, style }) => <View style={style}>{children}</View>;
});
const mockDownloads = { count: 3, bytes: 12 * 1024 * 1024 };
const mockRemoveAll = jest.fn(async () => 3);
jest.mock('../../utils/downloads', () => ({
  useDownloadsSummary: () => mockDownloads, removeAllDownloads: (...a) => mockRemoveAll(...a),
}));

const Settings = require('../Settings').default;

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockSetPref.mockClear();
  mockSetLanguage.mockClear();
  dropCache('u7:settings:notif');
  dropCache('u7:settings:sessions');
  mockApi.fetchNotificationPreferences.mockImplementation(() => new Promise(() => {}));
  mockApi.fetchSessions.mockResolvedValue({ count: 2, sessions: [
    { id: 1, created_at: '2026-09-01T00:00:00Z', current: true },
    { id: 2, created_at: '2026-09-20T00:00:00Z', current: false },
  ] });
});

test('the saved switches work at once, before the server answers', () => {
  writeCache('u7:settings:notif', { likes: false, quiet_from: null, quiet_to: null });
  const screen = render(<Settings />);
  const quiet = screen.getByTestId('quiet-switch');
  expect(quiet.props.disabled).toBeFalsy();
});

test('search keeps only the settings that match', () => {
  const screen = render(<Settings />);
  fireEvent.changeText(screen.getByTestId('settings-search'), 'quiet');
  expect(screen.getByText('settings.quiet.label')).toBeTruthy();
  expect(screen.queryByText('settings.support.about')).toBeNull();
});

test('quiet hours turn on as 22:00 to 07:00 on this phone’s clock', async () => {
  writeCache('u7:settings:notif', { quiet_from: null, quiet_to: null });
  const screen = render(<Settings />);
  await act(async () => { fireEvent(screen.getByTestId('quiet-switch'), 'valueChange', true); });
  expect(mockApi.updateNotificationPreferences).toHaveBeenCalledWith({
    quiet_from: 1320, quiet_to: 420, utc_offset: -new Date().getTimezoneOffset(),
  });
  expect(screen.getByText('settings.quiet.on:22:00,07:00')).toBeTruthy();
});

test('the language is chosen from a list', async () => {
  jest.useFakeTimers();
  const screen = render(<Settings />);
  fireEvent.press(screen.getByText('settings.appearance.language'));
  fireEvent.press(screen.getByText('Kiswahili'));
  act(() => { jest.runAllTimers(); });
  expect(mockSetLanguage).toHaveBeenCalledWith('sw');
  jest.useRealTimers();
});

test('a test notification says where it went', async () => {
  mockApi.sendTestPush.mockResolvedValue({ devices: 2 });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<Settings />);
  await act(async () => { fireEvent.press(screen.getByTestId('test-push')); });
  expect(alert).toHaveBeenCalledWith('settings.testPush.title', 'settings.testPush.sent:2');
  alert.mockRestore();
});

test('the devices signed in, and signing one out', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((t1, b, buttons) => buttons?.[1]?.onPress?.());
  const screen = render(<Settings />);
  await waitFor(() => expect(screen.getByText('settings.devices.count:2')).toBeTruthy());
  fireEvent.press(screen.getByTestId('devices'));
  expect(screen.getByText('settings.devices.this')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('device-out-2')); });
  expect(mockApi.revokeSession).toHaveBeenCalledWith(2);
  alert.mockRestore();
});

test('storage: what downloads take, and removing them all', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((t1, b, buttons) => buttons?.[1]?.onPress?.());
  const screen = render(<Settings />);
  expect(screen.getByText('settings.storage.downloadsSub:3,12.0 MB')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('storage-downloads')); });
  expect(mockRemoveAll).toHaveBeenCalled();
  alert.mockRestore();
});
