import AsyncStorage from '@react-native-async-storage/async-storage';

import { queuePref, flushPrefs, pullPrefs, forgetPendingPrefs } from '../prefsSync';

jest.mock('../../services/api', () => ({
  fetchNotificationPreferences: jest.fn(),
  updateNotificationPreferences: jest.fn(),
}));
const mockApi = require('../../services/api');

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  mockApi.fetchNotificationPreferences.mockReset();
  mockApi.updateNotificationPreferences.mockReset();
});
afterEach(() => { jest.useRealTimers(); });

test('choices made together go up together, a moment later', async () => {
  mockApi.updateNotificationPreferences.mockResolvedValue({});
  await queuePref('wallpaperOn', false);
  await queuePref('bibleTextSize', 22);
  expect(mockApi.updateNotificationPreferences).not.toHaveBeenCalled();
  await flushPrefs();
  expect(mockApi.updateNotificationPreferences).toHaveBeenCalledWith({
    app_prefs: { wallpaperOn: false, bibleTextSize: 22 },
  });
});

test('this phone’s own choices are never sent', async () => {
  await queuePref('pushEnabled', false);
  await flushPrefs();
  expect(mockApi.updateNotificationPreferences).not.toHaveBeenCalled();
});

test('offline, a change waits on the phone and goes up before anything comes down', async () => {
  mockApi.updateNotificationPreferences.mockRejectedValueOnce(new Error('offline'));
  await queuePref('videoQuality', 'hd');
  expect(await flushPrefs()).toBe(false);
  // Back online: the waiting change is sent first, then the account read.
  mockApi.updateNotificationPreferences.mockResolvedValue({});
  mockApi.fetchNotificationPreferences.mockResolvedValue({
    app_prefs: { videoQuality: 'hd', wallpaperOn: false, unknownKey: 1 },
  });
  const server = await pullPrefs();
  expect(mockApi.updateNotificationPreferences).toHaveBeenLastCalledWith({ app_prefs: { videoQuality: 'hd' } });
  expect(server).toEqual({ videoQuality: 'hd', wallpaperOn: false });
});

test('unreachable: nothing comes down, so the phone’s choices stand', async () => {
  mockApi.fetchNotificationPreferences.mockRejectedValue(new Error('offline'));
  expect(await pullPrefs()).toBeNull();
});

test('signing out drops what the account had waiting', async () => {
  await queuePref('dataSaver', true);
  await forgetPendingPrefs();
  await flushPrefs();
  expect(mockApi.updateNotificationPreferences).not.toHaveBeenCalled();
});
