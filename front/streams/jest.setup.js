// Jest setup: register module mocks that every test relies on.
//
// AsyncStorage has no working implementation under Node, so any module that
// imports it (e.g. PreferencesContext -> PlayerContext) throws at import time
// unless we swap in the official in-memory mock the package ships.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
