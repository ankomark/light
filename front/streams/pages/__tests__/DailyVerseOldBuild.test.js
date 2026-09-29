/**
 * The verse screen on a build made before its native modules were added —
 * a dev client or store build older than the JS it is running. Loading any of
 * them throws ("TurboModuleRegistry: 'RNViewShot' could not be found"); the
 * screen must still open, with those features hidden or falling back.
 */
import React from 'react';
import { Share } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.setTimeout(20000);

// Loading one of these on an old build throws — and, worse, Metro reports the
// error before any catch sees it. So they must not be loaded at all: each
// records that it was, and the test checks nothing was.
const mockLoaded = [];
const missing = (name) => () => {
  mockLoaded.push(name);
  throw new Error(`Invariant Violation: TurboModuleRegistry.getEnforcing(...): '${name}' could not be found.`);
};
jest.mock('react-native-view-shot', () => missing('RNViewShot')());
jest.mock('expo-clipboard', () => missing('ExpoClipboard')());
jest.mock('expo-speech', () => missing('ExpoSpeech')());
jest.mock('react-native-android-widget', () => missing('RNWidget')());

const mockApi = { fetchDailyVerse: jest.fn() };
jest.mock('../../services/api', () => ({ fetchDailyVerse: (...a) => mockApi.fetchDailyVerse(...a) }));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k, resolvedLanguage: 'en' }) }));
jest.mock('../../context/PreferencesContext', () => ({ usePreferences: () => ({ preferences: {} }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('expo-haptics', () => ({
  selectionAsync: async () => {}, impactAsync: async () => {}, ImpactFeedbackStyle: { Light: 'l', Medium: 'm' },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-media-library', () => ({}));

// An old build: nothing assumed, and none of these native modules registered.
// (jest-expo's setup pre-registers RNViewShot and ExpoSpeech; take them away.)
const ABSENT = ['RNViewShot', 'AndroidWidget', 'ExpoClipboard', 'ExpoSpeech'];
jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core');
  return {
    ...actual,
    requireOptionalNativeModule: (n) => (['ExpoClipboard', 'ExpoSpeech'].includes(n) ? null : actual.requireOptionalNativeModule(n)),
  };
});
{
  const { NativeModules, TurboModuleRegistry } = require('react-native');
  const get = TurboModuleRegistry.get.bind(TurboModuleRegistry);
  jest.spyOn(TurboModuleRegistry, 'get').mockImplementation((n) => (ABSENT.includes(n) ? null : get(n)));
  ABSENT.forEach((n) => { delete NativeModules[n]; });
}
require('../../utils/optionalNative').__assumeNativePresent(false);

afterAll(() => require('../../utils/optionalNative').__assumeNativePresent(true));

const verse = {
  date: '2026-09-29', reference: 'Psalms 23:1', book: 'Psalms', chapter: 23, verse: 1,
  text: 'The LORD is my shepherd; I shall not want.', is_today: true,
};

test('the modules really are missing in this test', () => {
  const native = require('../../utils/optionalNative');
  expect(native.viewShot()).toBeNull();
  expect(native.clipboard()).toBeNull();
  expect(native.speech()).toBeNull();
  expect(native.androidWidget()).toBeNull();
});

afterEach(() => {
  // The heart of it: absent modules are never required, so no error is
  // reported — not a red box in development, not a Sentry event in release.
  expect(mockLoaded).toEqual([]);
});

test('the screen opens, without Listen, and long-press does nothing', async () => {
  mockApi.fetchDailyVerse.mockResolvedValue(verse);
  const DailyVerse = require('../DailyVerse').default;
  const screen = render(<DailyVerse />);
  await waitFor(() => expect(screen.getByText(verse.text)).toBeTruthy());
  expect(screen.queryByLabelText('verse.listen')).toBeNull();
  expect(screen.getByLabelText('verse.readChapter')).toBeTruthy();
  fireEvent(screen.getByText(verse.text), 'longPress');
  expect(screen.queryByText('verse.copied')).toBeNull();
});

test('Share still works: no Save or Copy, and the picture falls back to text', async () => {
  const spy = jest.spyOn(Share, 'share').mockResolvedValue({});
  mockApi.fetchDailyVerse.mockResolvedValue(verse);
  const DailyVerse = require('../DailyVerse').default;
  const screen = render(<DailyVerse />);
  await waitFor(() => expect(screen.getByText(verse.text)).toBeTruthy());

  fireEvent.press(screen.getByLabelText('verse.share'));
  await waitFor(() => expect(screen.getByTestId('verse-share-sheet')).toBeTruthy());
  expect(screen.queryByTestId('verse-save')).toBeNull();
  expect(screen.queryByTestId('verse-copy')).toBeNull();

  fireEvent.press(screen.getByTestId('verse-share-image'));
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ message: `“${verse.text}”\n— Psalms 23:1` }));
  spy.mockRestore();
});

test('starting the app does not reach for the widget module', () => {
  const { Platform } = require('react-native');
  const was = Platform.OS;
  Platform.OS = 'android';
  jest.isolateModules(() => {
    jest.doMock('expo', () => ({ registerRootComponent: jest.fn() }));
    jest.doMock('../../polyfills', () => ({}));
    jest.doMock('../../App', () => () => null);
    expect(() => require('../../index')).not.toThrow();
  });
  Platform.OS = was;
});
