// Jest setup: register module mocks that every test relies on.
//
// AsyncStorage has no working implementation under Node, so any module that
// imports it (e.g. PreferencesContext -> PlayerContext) throws at import time
// unless we swap in the official in-memory mock the package ships.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Tests have no native side, so utils/optionalNative.js would find none of its
// modules and hide their features; use the packages' Jest mocks instead.
// (pages/__tests__/DailyVerseOldBuild.test.js turns this off to be an old build.)
require('./utils/optionalNative').__assumeNativePresent(true);

// NetInfo has no native side under Jest: its own mock (always connected).
// The music player subscribes app-wide to know when a song can't stream.
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
