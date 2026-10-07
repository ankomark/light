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
const mockPush = { registerForPushNotifications: jest.fn(), unregisterPushToken: jest.fn() };
jest.mock('../../services/pushNotifications', () => ({
  registerForPushNotifications: (...a) => mockPush.registerForPushNotifications(...a),
  unregisterPushToken: (...a) => mockPush.unregisterPushToken(...a),
}));
const mockFs = { writeAsStringAsync: jest.fn(async () => {}), deleteAsync: jest.fn(async () => {}), cacheDirectory: 'file:///cache/' };
jest.mock('expo-file-system/legacy', () => mockFs);
const mockSharing = { isAvailableAsync: jest.fn(async () => false), shareAsync: jest.fn() };
jest.mock('expo-sharing', () => mockSharing);
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
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), reset: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null, MaterialIcons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, initialWindowMetrics: null, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../../components/GlassView', () => {
  const { View } = require('react-native');
  return ({ children, style }) => <View style={style}>{children}</View>;
});
const mockDownloads = { count: 3, bytes: 12 * 1024 * 1024 };
const mockRemoveAll = jest.fn(async () => 3);
let mockWallOn = true;
jest.mock('../../context/WallpaperContext', () => ({ useWallpapersOn: () => mockWallOn }));
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

test('the language is chosen from a dropdown', () => {
  const screen = render(<Settings />);
  // Shut: the current value in its box, no list.
  expect(screen.getByTestId('language-pick')).toHaveTextContent(/English/);
  expect(screen.queryByTestId('language-pick-sw')).toBeNull();
  fireEvent.press(screen.getByTestId('language-pick'));
  expect(screen.getByTestId('language-pick-en').props.accessibilityState).toEqual({ selected: true });
  fireEvent.press(screen.getByTestId('language-pick-sw'));
  expect(mockSetLanguage).toHaveBeenCalledWith('sw');
  expect(screen.queryByTestId('language-pick-sw')).toBeNull();   // closes once chosen
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
  // Said once, on the devices row (not again under "log out other devices").
  await waitFor(() => expect(screen.getAllByText('settings.devices.count:2').length).toBe(1));
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

test('two switches flipped quickly: a refusal takes back only its own', async () => {
  writeCache('u7:settings:notif', { likes: true, comments: true, quiet_from: null, quiet_to: null });
  let refuse;
  mockApi.updateNotificationPreferences.mockImplementation((fields) => ('likes' in fields
    ? new Promise((_, rej) => { refuse = rej; }) : Promise.resolve({})));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<Settings />);
  fireEvent(screen.getByTestId('notif-likes'), 'valueChange', false);
  await act(async () => { fireEvent(screen.getByTestId('notif-comments'), 'valueChange', false); });
  await act(async () => { refuse(new Error('500')); });
  expect(screen.getByTestId('notif-likes').props.value).toBe(true);
  expect(screen.getByTestId('notif-comments').props.value).toBe(false);
  expect(alert).toHaveBeenCalledWith('common.error', 'settings.notifPrefFailed');
  alert.mockRestore();
  mockApi.updateNotificationPreferences.mockImplementation(async () => ({}));
});

test('turning notifications off that does not reach the server says so and stays on', async () => {
  mockPush.unregisterPushToken.mockRejectedValueOnce(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<Settings />);
  await act(async () => { fireEvent(screen.getByTestId('push-switch'), 'valueChange', false); });
  expect(mockSetPref).toHaveBeenLastCalledWith('pushEnabled', true);
  expect(alert).toHaveBeenCalledWith('common.error', 'settings.notif.offFailed');
  alert.mockRestore();
});

test('an export too big to share as a message says so instead of crashing', async () => {
  mockApi.exportMyData.mockResolvedValue({ posts: 'x'.repeat(300 * 1024) });
  const share = jest.spyOn(require('react-native').Share, 'share').mockImplementation(async () => ({}));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<Settings />);
  await act(async () => { fireEvent.press(screen.getByTestId('export-data')); });
  expect(share).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('common.error', 'settings.exportFailed');
  share.mockRestore();
  alert.mockRestore();
});

test('an account with orders under way is not deleted; the orders are one tap away', async () => {
  mockApi.deleteAccount.mockRejectedValue({ response: { status: 409, data: { code: 'open_orders', open_orders: 2 } } });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((title, body, buttons) => {
    if (title === 'settings.deleteTitle') buttons?.[1]?.onPress?.();
  });
  const screen = render(<Settings />);
  fireEvent.press(screen.getByTestId('delete-account'));
  fireEvent.changeText(screen.getByTestId('delete-password'), 'secret');
  await act(async () => { fireEvent.press(screen.getByTestId('delete-confirm')); });
  const call = alert.mock.calls.find((c) => c[0] === 'settings.openOrders.title');
  expect(call[1]).toBe('settings.openOrders.body:2');
  call[2][1].onPress();
  expect(mockNav.navigate).toHaveBeenCalledWith('OrderHistory');
  expect(mockNav.reset).not.toHaveBeenCalled();
  alert.mockRestore();
});

describe('blocked accounts', () => {
  const mockBlocked = { fetchBlockedUsers: jest.fn(), unblockUser: jest.fn() };
  beforeEach(() => {
    mockApi.fetchBlockedUsers = mockBlocked.fetchBlockedUsers;
    mockApi.unblockUser = mockBlocked.unblockUser;
    mockBlocked.fetchBlockedUsers.mockReset();
    mockBlocked.unblockUser.mockReset();
  });
  const BlockedUsers = require('../BlockedUsers').default;

  test('a list that could not be read says so, not "no one blocked"', async () => {
    mockBlocked.fetchBlockedUsers.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ id: 4, username: 'troll' }]);
    const screen = render(<BlockedUsers />);
    await waitFor(() => expect(screen.getByTestId('blocked-failed')).toBeTruthy());
    expect(screen.queryByText('blocked.empty')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('blocked-retry')); });
    await waitFor(() => expect(screen.getByText('@troll')).toBeTruthy());
  });

  test('a refused unblock puts the account back where it was', async () => {
    mockBlocked.fetchBlockedUsers.mockResolvedValue([{ id: 4, username: 'a' }, { id: 5, username: 'b' }]);
    mockBlocked.unblockUser.mockRejectedValue(new Error('500'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((t1, b, buttons) => buttons?.[1]?.onPress?.());
    const screen = render(<BlockedUsers />);
    await waitFor(() => expect(screen.getByTestId('unblock-4')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('unblock-4')); });
    expect(screen.getByText('@a')).toBeTruthy();
    expect(alert).toHaveBeenCalledWith('common.error', 'blocked.unblockFailed');
    alert.mockRestore();
  });
});

describe('the black look (design A)', () => {
  test('the profile card on top: initials, name, Verified', () => {
    const screen = render(<Settings />);
    const card = screen.getByTestId('settings-profile');
    expect(card).toHaveTextContent(/^MA/);
    expect(card).toHaveTextContent(/mark/);
    expect(card).toHaveTextContent(/settings\.verified$/);
    fireEvent.press(card);
    expect(mockNav.navigate).toHaveBeenCalledWith('Profile');
  });

  test('log out is its own button, and asks first', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<Settings />);
    fireEvent.press(screen.getByTestId('settings-logout'));
    expect(alert).toHaveBeenCalledWith('settings.logoutTitle', 'settings.logoutConfirm', expect.any(Array));
    alert.mockRestore();
  });

  test('while searching, the card steps aside and the profile is a row to find', () => {
    const screen = render(<Settings />);
    fireEvent.changeText(screen.getByTestId('settings-search'), 'mark');
    expect(screen.queryByTestId('settings-profile')).toBeNull();
    expect(screen.getByText('mark')).toBeTruthy();
  });
});

describe('deep scan', () => {
  test('a section found by its name shows its rows, not an empty card', () => {
    const screen = render(<Settings />);
    fireEvent.changeText(screen.getByTestId('settings-search'), 'settings.section.storage');
    expect(screen.getByTestId('storage-downloads')).toBeTruthy();
    expect(screen.getByTestId('storage-clear')).toBeTruthy();
  });

  test('a dropdown is found by its choices too', () => {
    const screen = render(<Settings />);
    fireEvent.changeText(screen.getByTestId('settings-search'), 'kiswa');
    expect(screen.getByTestId('language-pick')).toBeTruthy();
    expect(screen.queryByText('settings.appearance.theme')).toBeNull();   // light/dark is gone
  });

  test('two quick taps change the password once', async () => {
    let answer;
    mockApi.changePassword.mockImplementation(() => new Promise((res) => { answer = res; }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<Settings />);
    fireEvent.press(screen.getByText('settings.account.changePassword'));
    fireEvent.changeText(screen.getByPlaceholderText('settings.pw.currentPlaceholder'), 'old-pass-1');
    fireEvent.changeText(screen.getByTestId('pw-new'), 'new-pass-123');
    fireEvent.changeText(screen.getByPlaceholderText('settings.pw.confirmPlaceholder'), 'new-pass-123');
    fireEvent.press(screen.getByTestId('pw-update'));
    fireEvent.press(screen.getByTestId('pw-update'));
    await act(async () => { answer({ sessions_revoked: 1 }); });
    expect(mockApi.changePassword).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('common.done', 'settings.pw.changedSignedOut:1');
    alert.mockRestore();
  });
});

describe('wallpapers', () => {
  afterEach(() => { mockWallOn = true; });

  test('only on or off: no wallpaper to pick', () => {
    const screen = render(<Settings />);
    expect(screen.getByText('settings.wallpaper.onSub')).toBeTruthy();
    expect(screen.queryByTestId('wallpaper-pick')).toBeNull();
    fireEvent(screen.getByTestId('wallpaper-switch'), 'valueChange', false);
    expect(mockSetPref).toHaveBeenCalledWith('wallpaperOn', false);
  });

  test('off says the plain background is used', () => {
    mockWallOn = false;
    const screen = render(<Settings />);
    expect(screen.getByText('settings.wallpaper.offSub')).toBeTruthy();
    expect(screen.getByTestId('wallpaper-switch').props.value).toBe(false);
  });
});

test('the exported file does not stay behind on the phone', async () => {
  mockApi.exportMyData.mockResolvedValue({ account: { username: 'mark' } });
  mockSharing.isAvailableAsync.mockResolvedValueOnce(true);
  mockSharing.shareAsync.mockResolvedValueOnce(undefined);
  const screen = render(<Settings />);
  await act(async () => { fireEvent.press(screen.getByTestId('export-data')); });
  expect(mockSharing.shareAsync).toHaveBeenCalled();
  const written = mockFs.writeAsStringAsync.mock.calls.at(-1)[0];
  expect(mockFs.deleteAsync).toHaveBeenCalledWith(written, { idempotent: true });
});

test('opened from the Privacy Centre, it is already searched for the part asked for', () => {
  const screen = render(<Settings route={{ params: { search: 'settings.section.privacy' } }} />);
  expect(screen.getByTestId('settings-search').props.value).toBe('settings.section.privacy');
  expect(screen.queryByText('settings.support.about')).toBeNull();
});

test('every switch is named for a screen reader', () => {
  const screen = render(<Settings />);
  expect(screen.getByTestId('push-switch').props.accessibilityLabel).toBe('settings.notif.push');
  expect(screen.getByTestId('wallpaper-switch').props.accessibilityLabel).toBe('settings.wallpaper.label');
});
