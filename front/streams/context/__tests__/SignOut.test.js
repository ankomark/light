/**
 * Signing out is instant: the account is gone from the phone before the
 * server hears about it, a slow or dead network never holds the screen, and
 * a second tap doesn't sign out twice.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, act, waitFor } from '@testing-library/react-native';

const mockSecure = new Map([['accessToken', 'a1'], ['refreshToken', 'r1']]);
jest.mock('../../services/secureStorage', () => ({
  getItemAsync: jest.fn(async (k) => (mockSecure.has(k) ? mockSecure.get(k) : null)),
  setItemAsync: jest.fn(async (k, v) => { mockSecure.set(k, v); }),
  deleteItemAsync: jest.fn(async (k) => { mockSecure.delete(k); }),
}));
jest.mock('axios', () => ({
  get: jest.fn(async (url) => ({ data: url.endsWith('/auth/status/')
    ? { id: 7, username: 'mark', is_email_verified: true, has_profile: false } : {} })),
  post: jest.fn(),
}));
jest.mock('../../services/api', () => ({
  API_URL: 'https://api.test/api',
  storeTokens: jest.fn(async () => {}),
  clearTokens: jest.fn(async () => { mockSecure.delete('accessToken'); mockSecure.delete('refreshToken'); }),
}));
jest.mock('../../utils/screenCache', () => ({ clearAllCaches: jest.fn(async () => {}) }));
jest.mock('../../services/publicationStore', () => ({ forgetKeptChapters: jest.fn(async () => {}) }));
jest.mock('../../services/readingTracker', () => ({ clearReadingQueue: jest.fn(async () => {}) }));
jest.mock('../../services/bookHighlights', () => ({ clearBookHighlights: jest.fn(async () => {}) }));
jest.mock('../../services/pushNotifications', () => ({
  registerForPushNotifications: jest.fn(async () => {}),
  forgetPushToken: jest.fn(async () => 'ExponentPushToken[phone]'),
  ensurePushRegistered: jest.fn(async () => true),
}));
const mockReport = jest.fn();
jest.mock('../../services/signOut', () => ({
  reportSignOut: (...a) => mockReport(...a),
  flushPendingSignOuts: jest.fn(async () => {}),
}));
jest.mock('../../services/tickets', () => ({ setTicketOwner: jest.fn() }));
jest.mock('../../services/ticketsOrganiser', () => ({ setOrganiserOwner: jest.fn() }));
jest.mock('../../hooks/useOnline', () => ({ onOnlineChange: () => () => {} }));

const { AuthProvider, useAuth } = require('../useAuth');
const tickets = require('../../services/tickets');

let auth;
const Probe = () => { auth = useAuth(); return <Text>{auth.isAuthenticated ? 'in' : 'out'}</Text>; };

test('the phone forgets the account at once; the server is told after, not waited on', async () => {
  mockReport.mockImplementation(() => new Promise(() => {}));    // a network that never answers
  const screen = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText('in')).toBeTruthy());

  let first;
  let second;
  await act(async () => {
    first = auth.logout();
    second = auth.logout();                                     // a second tap
    await first;
  });
  expect(screen.getByText('out')).toBeTruthy();
  expect(mockSecure.has('refreshToken')).toBe(false);
  expect(tickets.setTicketOwner).toHaveBeenLastCalledWith(null);
  expect(mockReport).toHaveBeenCalledTimes(1);
  expect(mockReport).toHaveBeenCalledWith({ refresh: 'r1', deviceToken: 'ExponentPushToken[phone]' });
  await second;
});
