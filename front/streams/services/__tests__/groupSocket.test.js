/**
 * The realtime socket (DMs, groups): turned away for good is not retried,
 * a refused sign-in gets a fresh token first, nothing is opened after it was
 * closed, and coming back from a while away (or back online) reconnects at once.
 */
import { AppState } from 'react-native';

const mockRefresh = jest.fn(async () => 'fresh-token');
jest.mock('../api', () => ({
  API_BASE: 'https://api.example',
  getAccessToken: jest.fn(async () => 'old-token'),
  refreshAccessToken: (...a) => mockRefresh(...a),
}));

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    FakeSocket.made.push(this);
  }

  close() { this.readyState = 3; }

  send() {}
}
FakeSocket.made = [];

let appListener = null;
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  FakeSocket.made = [];
  global.WebSocket = FakeSocket;
  mockRefresh.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, fn) => { appListener = fn; return { remove: () => {} }; });
});

afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

const { createSocket } = require('../groupSocket');

test('turned away for good (4403): not asked again', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  const s = createSocket('ws/dm/', {});
  await flush();
  FakeSocket.made[0].onclose({ code: 4403 });
  jest.advanceTimersByTime(60000);
  await flush();
  expect(FakeSocket.made).toHaveLength(1);
  s.close();
});

test('a refused sign-in (4401) comes back with a fresh token', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  const s = createSocket('ws/dm/', {});
  await flush();
  expect(FakeSocket.made[0].url).toContain('token=old-token');
  FakeSocket.made[0].onclose({ code: 4401 });
  jest.advanceTimersByTime(1500);
  await flush(); await flush();
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(FakeSocket.made[1].url).toContain('token=fresh-token');
  s.close();
});

test('closed while the token was being read: nothing is opened', async () => {
  const s = createSocket('ws/dm/', {});
  s.close();
  await flush();
  expect(FakeSocket.made).toHaveLength(0);
});

test('back from a while in the background: a fresh connection at once', async () => {
  const now = jest.spyOn(Date, 'now');
  now.mockReturnValue(1000);
  const s = createSocket('ws/dm/', {});
  await flush();
  FakeSocket.made[0].readyState = 1;
  FakeSocket.made[0].onopen();
  appListener('background');
  now.mockReturnValue(1000 + 60000);
  appListener('active');
  await flush();
  expect(FakeSocket.made).toHaveLength(2);
  expect(FakeSocket.made[0].readyState).toBe(3);    // the old one let go
  s.close();
});

test('back online with the socket down: reconnects at once', async () => {
  const { __setOnline } = require('../../hooks/useOnline');
  const s = createSocket('ws/dm/', {});
  await flush();
  __setOnline(false);
  __setOnline(true);
  await flush();
  expect(FakeSocket.made.length).toBeGreaterThanOrEqual(2);
  s.close();
});
