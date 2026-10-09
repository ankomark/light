/**
 * Opening the app without a network keeps the person signed in (it used to
 * sign them out); only the server refusing the session does that.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, act, waitFor } from '@testing-library/react-native';

const mockSecure = new Map();
jest.mock('../../services/secureStorage', () => ({
  getItemAsync: jest.fn(async (k) => (mockSecure.has(k) ? mockSecure.get(k) : null)),
  setItemAsync: jest.fn(async (k, v) => { mockSecure.set(k, v); }),
  deleteItemAsync: jest.fn(async (k) => { mockSecure.delete(k); }),
}));
const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  setItem: jest.fn(async (k, v) => { mockStore.set(k, v); }),
  removeItem: jest.fn(async (k) => { mockStore.delete(k); }),
}));
const mockAxios = { get: jest.fn(), post: jest.fn() };
jest.mock('axios', () => mockAxios);
jest.mock('../../services/api', () => ({
  API_URL: 'https://api.test/api',
  storeTokens: jest.fn(async (a, r) => { mockSecure.set('accessToken', a); mockSecure.set('refreshToken', r); }),
  clearTokens: jest.fn(async () => { mockSecure.delete('accessToken'); mockSecure.delete('refreshToken'); }),
}));
jest.mock('../../utils/screenCache', () => ({ clearAllCaches: jest.fn(async () => {}) }));
jest.mock('../../services/publicationStore', () => ({ forgetKeptChapters: jest.fn(async () => {}) }));
jest.mock('../../services/readingTracker', () => ({ clearReadingQueue: jest.fn(async () => {}) }));
jest.mock('../../services/bookHighlights', () => ({ clearBookHighlights: jest.fn(async () => {}) }));
jest.mock('../../services/pushNotifications', () => ({
  registerForPushNotifications: jest.fn(async () => {}),
  forgetPushToken: jest.fn(async () => null),
  ensurePushRegistered: jest.fn(async () => true),
}));
jest.mock('../../services/signOut', () => ({ reportSignOut: jest.fn(async () => {}), flushPendingSignOuts: jest.fn(async () => {}) }));
jest.mock('../../services/tickets', () => ({ setTicketOwner: jest.fn() }));
jest.mock('../../services/ticketsOrganiser', () => ({ setOrganiserOwner: jest.fn() }));
const mockOnlineFns = new Set();
const mockOnline = (v) => [...mockOnlineFns].forEach((fn) => fn(v));
jest.mock('../../hooks/useOnline', () => ({
  onOnlineChange: (fn) => { mockOnlineFns.add(fn); return () => mockOnlineFns.delete(fn); },
}));

const { AuthProvider, useAuth } = require('../useAuth');
const { emit } = require('../../utils/appEvents');

let auth;
const Probe = () => {
  auth = useAuth();
  return <Text>{auth.isLoading ? 'loading' : auth.isAuthenticated ? `in:${auth.currentUser?.username || '-'}` : 'out'}</Text>;
};
const networkDown = Object.assign(new Error('Network Error'), {});
const status = { id: 7, username: 'mark', is_email_verified: true, has_profile: true };
const profile = { user_id: 7, username: 'mark' };

beforeEach(() => {
  mockSecure.clear();
  mockStore.clear();
  mockSecure.set('accessToken', 'a1');
  mockSecure.set('refreshToken', 'r1');
  mockAxios.get.mockReset();
  mockAxios.post.mockReset();
});

const online = () => {
  mockAxios.get.mockImplementation(async (url) => ({ data: url.endsWith('/auth/status/') ? status : profile }));
};

test('opened offline after a visit online: still signed in, as the same person', async () => {
  online();
  let screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('in:mark')).toBeTruthy());
  screen.unmount();

  mockAxios.get.mockRejectedValue(networkDown);       // no network now
  screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('in:mark')).toBeTruthy());
  expect(mockSecure.get('refreshToken')).toBe('r1');   // nothing forgotten
});

test('the server down (503) is not a sign-out either', async () => {
  mockAxios.get.mockRejectedValue(Object.assign(new Error('503'), { response: { status: 503 } }));
  const screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText(/^in:/)).toBeTruthy());
});

test('expired token and no network to refresh it: still signed in', async () => {
  mockAxios.get.mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }));
  mockAxios.post.mockRejectedValue(networkDown);
  const screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText(/^in:/)).toBeTruthy());
});

test('the server refusing the refresh token signs out', async () => {
  mockAxios.get.mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }));
  mockAxios.post.mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }));
  const screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('out')).toBeTruthy());
  expect(mockSecure.has('refreshToken')).toBe(false);
});

test('back online after an offline start: checked for real', async () => {
  mockAxios.get.mockRejectedValue(networkDown);
  const screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText(/^in:/)).toBeTruthy());
  online();
  await act(async () => { mockOnline(true); });
  await waitFor(() => expect(screen.getByText('in:mark')).toBeTruthy());
});

test('the session ended by the server mid-use: signed out here too', async () => {
  online();
  const screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('in:mark')).toBeTruthy());
  await act(async () => { emit('auth:session-ended'); });
  expect(screen.getByText('out')).toBeTruthy();
});

test('a status blip right after login is asked again, not taken as "unverified"', async () => {
  mockSecure.clear();
  mockAxios.get.mockImplementation(async () => { throw networkDown; });
  const screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('out')).toBeTruthy());
  mockAxios.post.mockResolvedValue({ data: { access: 'a2', refresh: 'r2' } });
  let calls = 0;
  mockAxios.get.mockImplementation(async (url) => {
    if (url.endsWith('/auth/status/') && (calls += 1) === 1) throw networkDown;
    return { data: url.endsWith('/auth/status/') ? status : profile };
  });
  let result;
  await act(async () => { result = await auth.login('mark', 'pw'); });
  expect(result).toEqual({ isVerified: true, hasProfile: true });
});

test('signed in before: the app opens at once, without waiting for the server', async () => {
  online();
  let screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('in:mark')).toBeTruthy());
  screen.unmount();

  // A network that is "connected" but answers nothing: the check never returns.
  mockAxios.get.mockImplementation(() => new Promise(() => {}));
  screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('in:mark')).toBeTruthy());
});

test('opened at once, then the server refuses the session: signed out', async () => {
  online();
  let screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('in:mark')).toBeTruthy());
  screen.unmount();

  mockAxios.get.mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }));
  mockAxios.post.mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }));
  screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('out')).toBeTruthy());
});

test('the startup checks have a time limit', async () => {
  online();
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(mockAxios.get).toHaveBeenCalled());
  for (const [, config] of mockAxios.get.mock.calls) expect(config.timeout).toBeLessThanOrEqual(10000);
});
