/**
 * The notice calls, with axios mocked: what actually goes over the wire.
 * (The board's own tests mock these calls, so a field dropped here slips past them.)
 */
jest.mock('axios', () => {
  const axios = jest.fn(async () => ({ data: { id: 1 } }));
  axios.create = jest.fn(() => axios);
  axios.interceptors = { request: { use: jest.fn() }, response: { use: jest.fn() } };
  axios.defaults = { headers: { common: {} } };
  return axios;
});

import axios from 'axios';
import { createNotice } from '../api';

beforeEach(() => axios.mockClear());

it('a new notice keeps its picture and its kind', async () => {
  await createNotice({
    title: 'T', body: 'B', is_pinned: false, category: 'event',
    cover_image: 'https://media.example/notice.jpg', cover_width: 1080, cover_height: 1350,
  });
  const req = axios.mock.calls.find(([c]) => c?.method === 'post' && c.url.endsWith('/notices/'))[0];
  expect(req.data).toMatchObject({
    category: 'event', cover_image: 'https://media.example/notice.jpg', cover_width: 1080, cover_height: 1350,
  });
});

it('a plain notice is general, with no picture', async () => {
  await createNotice({ title: 'T', body: 'B' });
  const req = axios.mock.calls.find(([c]) => c?.method === 'post')[0];
  expect(req.data).toMatchObject({ category: 'general', cover_image: '' });
});
