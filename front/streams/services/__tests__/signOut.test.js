// Telling the server about a sign-out: one call; any answer counts as done;
// only "never reached it" is kept, in secure storage, and sent again later.
const mockSecure = new Map();
jest.mock('../secureStorage', () => ({
  getItemAsync: jest.fn(async (k) => (mockSecure.has(k) ? mockSecure.get(k) : null)),
  setItemAsync: jest.fn(async (k, v) => { mockSecure.set(k, v); }),
  deleteItemAsync: jest.fn(async (k) => { mockSecure.delete(k); }),
}));
jest.mock('../api', () => ({ API_URL: 'https://api.test/api' }));
jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const { reportSignOut, flushPendingSignOuts } = require('../signOut');

const offline = () => Object.assign(new Error('Network Error'), { response: undefined });
const pending = () => JSON.parse(mockSecure.get('pendingSignOuts') || '[]');

beforeEach(() => { mockSecure.clear(); axios.post.mockReset(); });

test('one call: the session and this phone\'s notifications', async () => {
  axios.post.mockResolvedValue({ status: 205 });
  await reportSignOut({ refresh: 'r1', deviceToken: 'ExponentPushToken[x]' });
  expect(axios.post).toHaveBeenCalledWith('https://api.test/api/auth/logout/',
    { refresh: 'r1', device_token: 'ExponentPushToken[x]' }, { timeout: 10000 });
  expect(pending()).toEqual([]);
});

test('no device token: only the session', async () => {
  axios.post.mockResolvedValue({ status: 205 });
  await reportSignOut({ refresh: 'r1', deviceToken: null });
  expect(axios.post.mock.calls[0][1]).toEqual({ refresh: 'r1' });
});

test('a refusal is as good as done; nothing kept', async () => {
  axios.post.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400 } }));
  await reportSignOut({ refresh: 'r1' });
  expect(pending()).toEqual([]);
});

test('offline: kept, and sent on the next launch', async () => {
  axios.post.mockRejectedValueOnce(offline());
  await reportSignOut({ refresh: 'r1', deviceToken: 'd1' });
  expect(pending()).toEqual([{ refresh: 'r1', deviceToken: 'd1' }]);

  axios.post.mockRejectedValueOnce(offline());                    // still offline at launch
  await flushPendingSignOuts();
  expect(pending()).toHaveLength(1);

  axios.post.mockResolvedValue({ status: 205 });                  // back online
  await flushPendingSignOuts();
  expect(pending()).toEqual([]);
  expect(mockSecure.has('pendingSignOuts')).toBe(false);
});

test('two flushes together send once', async () => {
  mockSecure.set('pendingSignOuts', JSON.stringify([{ refresh: 'r1', deviceToken: null }]));
  axios.post.mockResolvedValue({ status: 205 });
  await Promise.all([flushPendingSignOuts(), flushPendingSignOuts()]);
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test('nothing to send without a refresh token', async () => {
  await reportSignOut({ refresh: null });
  expect(axios.post).not.toHaveBeenCalled();
});
