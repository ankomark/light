/**
 * A token refresh that gets no answer (no signal) keeps the person signed in;
 * one the server turns down signs them out.
 */
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// A store that keeps what is put in it (the shared mock forgets).
jest.mock('expo-secure-store', () => {
  const box = new Map();
  return {
    setItemAsync: jest.fn(async (k, v) => { box.set(k, v); }),
    getItemAsync: jest.fn(async (k) => (box.has(k) ? box.get(k) : null)),
    deleteItemAsync: jest.fn(async (k) => { box.delete(k); }),
  };
});

const { refreshAccessToken } = require('../api');

beforeEach(async () => {
  await SecureStore.setItemAsync('accessToken', 'a');
  await SecureStore.setItemAsync('refreshToken', 'r');
  jest.spyOn(axios, 'post');
});

afterEach(() => jest.restoreAllMocks());

test('no answer at all: still signed in', async () => {
  axios.post.mockRejectedValueOnce(new Error('Network Error'));
  await expect(refreshAccessToken()).rejects.toThrow('Network Error');
  expect(await SecureStore.getItemAsync('refreshToken')).toBe('r');
});

test('turned down by the server: signed out', async () => {
  axios.post.mockRejectedValueOnce(Object.assign(new Error('401'), { response: { status: 401 } }));
  await expect(refreshAccessToken()).rejects.toThrow();
  expect(await SecureStore.getItemAsync('refreshToken')).toBeNull();
});

test('a fresh pair is kept', async () => {
  axios.post.mockResolvedValueOnce({ data: { access: 'a2', refresh: 'r2' } });
  await expect(refreshAccessToken()).resolves.toBe('a2');
  expect(await SecureStore.getItemAsync('refreshToken')).toBe('r2');
});
