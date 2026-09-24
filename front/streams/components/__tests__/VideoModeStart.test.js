import React from 'react';
import { render, act } from '@testing-library/react-native';

let mockPrefs = { preferences: { videoMode: true }, loaded: true };
let mockAuth = { isAuthenticated: true, isEmailVerified: true, isLoading: false };
let mockState = { index: 0, routes: [{ key: 'Home-1', name: 'Home' }] };
const mockReset = jest.fn();

jest.mock('../../context/PreferencesContext', () => ({ usePreferences: () => mockPrefs }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => mockAuth }));
jest.mock('../../services/navigationRef', () => ({
  navigationRef: {
    isReady: () => true,
    getRootState: () => mockState,
    reset: (s) => mockReset(s),
  },
}));

const { default: VideoModeStart, __resetVideoModeStart } = require('../VideoModeStart');

beforeEach(() => {
  __resetVideoModeStart();
  mockReset.mockClear();
  mockPrefs = { preferences: { videoMode: true }, loaded: true };
  mockAuth = { isAuthenticated: true, isEmailVerified: true, isLoading: false };
  mockState = { index: 0, routes: [{ key: 'Home-1', name: 'Home' }] };
});

test('video mode on: the app opens in Videos, with Home (the same one) underneath', () => {
  render(<VideoModeStart />);
  expect(mockReset).toHaveBeenCalledWith({
    index: 1, routes: [{ key: 'Home-1', name: 'Home' }, { name: 'Videos' }],
  });
});

test('video mode off: Home as always', () => {
  mockPrefs = { preferences: { videoMode: false }, loaded: true };
  render(<VideoModeStart />);
  expect(mockReset).not.toHaveBeenCalled();
});

test('a notification or link already opened something: left alone', () => {
  mockState = { index: 1, routes: [{ key: 'Home-1', name: 'Home' }, { key: 'P', name: 'PostDetail' }] };
  render(<VideoModeStart />);
  expect(mockReset).not.toHaveBeenCalled();
});

test('not signed in (or not verified): the usual start, the login', () => {
  mockAuth = { isAuthenticated: false, isEmailVerified: false, isLoading: false };
  render(<VideoModeStart />);
  mockAuth = { isAuthenticated: true, isEmailVerified: false, isLoading: false };
  __resetVideoModeStart();
  render(<VideoModeStart />);
  expect(mockReset).not.toHaveBeenCalled();
});

test('waits for the saved preferences and sign-in check, then decides once per launch', () => {
  mockPrefs = { preferences: { videoMode: false }, loaded: false };     // still reading storage
  mockAuth = { ...mockAuth, isLoading: true };
  const r = render(<VideoModeStart />);
  expect(mockReset).not.toHaveBeenCalled();
  mockPrefs = { preferences: { videoMode: true }, loaded: true };
  mockAuth = { ...mockAuth, isLoading: false };
  r.rerender(<VideoModeStart />);
  expect(mockReset).toHaveBeenCalledTimes(1);
  // Signing out and in again later doesn't throw the user into Videos.
  r.rerender(<VideoModeStart key="again" />);
  act(() => {});
  expect(mockReset).toHaveBeenCalledTimes(1);
});
