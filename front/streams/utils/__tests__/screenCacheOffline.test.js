/**
 * Offline, a screen paints the last copy it kept even past its usual age limit
 * - an old list beats an empty page. Online the limit holds, as before.
 */
const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
  setItem: jest.fn(async (k, v) => { mockStore.set(k, v); }),
  removeItem: jest.fn(async (k) => { mockStore.delete(k); }),
}));
let mockOnlineNow = true;
jest.mock('../../hooks/useOnline', () => ({ checkOnline: jest.fn(async () => mockOnlineNow) }));

const { readCache } = require('../screenCache');

const DAY = 24 * 60 * 60 * 1000;
const keep = (key, data, ageMs) => mockStore.set(`@cache:v1:${key}`, JSON.stringify({ at: Date.now() - ageMs, data }));

beforeEach(() => { mockStore.clear(); mockOnlineNow = true; });

test('online: a copy past its limit is not painted', async () => {
  keep('inbox', ['hello'], 2 * DAY);
  expect(await readCache('inbox', DAY)).toBeNull();
});

test('offline: the same copy is painted', async () => {
  keep('inbox2', ['hello'], 2 * DAY);
  mockOnlineNow = false;
  expect(await readCache('inbox2', DAY)).toEqual(['hello']);
});

test('offline, but older than a month: not even then', async () => {
  keep('inbox3', ['ancient'], 40 * DAY);
  mockOnlineNow = false;
  expect(await readCache('inbox3', DAY)).toBeNull();
});

test('a fresh copy is painted without asking about the network', async () => {
  const { checkOnline } = require('../../hooks/useOnline');
  checkOnline.mockClear();
  keep('feed', [1], 1000);
  expect(await readCache('feed', DAY)).toEqual([1]);
  expect(checkOnline).not.toHaveBeenCalled();
});
