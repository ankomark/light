/* Group chats kept warm in the background: a live message is fetched (only
 * what's new) into that chat's cache; an open chat is left to itself; the lists
 * catch up chats that are behind; a lost place takes the newest page. */
const mockApi = {
  fetchGroups: jest.fn(async () => ({ results: [] })),
  fetchCommunities: jest.fn(async () => ({ results: [] })),
  fetchGroupPosts: jest.fn(),
  fetchGroupPostsAfter: jest.fn(),
};
jest.mock('../api', () => mockApi);

let mockListener = null;
jest.mock('../dmSocket', () => ({
  subscribeDM: (fn) => { mockListener = fn; return () => { mockListener = null; }; },
}));

const {
  startGroupChatSync, catchUpChat, warmChats, setOpenGroupChat, _resetGroupChatSync,
} = require('../groupChatSync');
const { peekCache, writeCache, dropCache } = require('../../utils/screenCache');
const { groupChatKey } = require('../../utils/groupChat');
const { __setOnline } = require('../../hooks/useOnline');

const ME = 7;
const at = (s) => new Date(Date.UTC(2026, 9, 6, 9, 0, s)).toISOString();
const msg = (id) => ({ id, created_at: at(id), content: `m${id}`, message_type: 'text', user: { id: 2 } });
const key = (slug) => groupChatKey(ME, slug);
const ids = (slug) => (peekCache(key(slug))?.messages ?? []).map((m) => m.id);

beforeEach(() => {
  jest.useRealTimers();
  _resetGroupChatSync();
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.fetchGroups.mockResolvedValue({ results: [] });
  mockApi.fetchCommunities.mockResolvedValue({ results: [] });
  ['a', 'b', 'c', 'd'].forEach((s) => dropCache(key(s)));
  __setOnline(true);
});

it('only what is new is fetched, and saved after what was kept', async () => {
  writeCache(key('a'), { group: { slug: 'a' }, messages: [msg(1), msg(2)] });
  mockApi.fetchGroupPostsAfter.mockResolvedValue({ results: [msg(3)], has_more: false });
  await catchUpChat(ME, 'a');
  expect(mockApi.fetchGroupPostsAfter).toHaveBeenCalledWith('a', 2);
  expect(mockApi.fetchGroupPosts).not.toHaveBeenCalled();
  expect(ids('a')).toEqual([1, 2, 3]);
});

it('nothing kept, or the place is lost: the newest page', async () => {
  mockApi.fetchGroupPosts.mockResolvedValue({ results: [msg(5), msg(4)] });   // newest-first
  await catchUpChat(ME, 'b');
  expect(ids('b')).toEqual([4, 5]);
  mockApi.fetchGroupPostsAfter.mockResolvedValue({ results: [], has_more: true });
  mockApi.fetchGroupPosts.mockResolvedValue({ results: [msg(40), msg(39)] });
  await catchUpChat(ME, 'b');
  expect(ids('b')).toEqual([39, 40]);          // no gap kept between 5 and 39
});

it('an open chat is left to its screen', async () => {
  const close = setOpenGroupChat('c');
  await catchUpChat(ME, 'c');
  expect(mockApi.fetchGroupPosts).not.toHaveBeenCalled();
  close();
});

it('offline: nothing asked', async () => {
  __setOnline(false);
  await catchUpChat(ME, 'a');
  expect(mockApi.fetchGroupPosts).not.toHaveBeenCalled();
});

it('a live message is fetched into its chat a moment later (a burst is one fetch)', async () => {
  jest.useFakeTimers();
  writeCache(key('a'), { messages: [msg(1)] });
  mockApi.fetchGroupPostsAfter.mockResolvedValue({ results: [msg(2), msg(3)], has_more: false });
  const stop = startGroupChatSync(ME);
  mockListener({ type: 'group_message', group_slug: 'a' });
  mockListener({ type: 'group_message', group_slug: 'a' });
  await jest.advanceTimersByTimeAsync(2000);
  expect(mockApi.fetchGroupPostsAfter).toHaveBeenCalledTimes(1);
  expect(ids('a')).toEqual([1, 2, 3]);
  stop();
});

it('the lists catch up only chats that are behind', async () => {
  writeCache(key('a'), { messages: [msg(9)] });   // up to date
  writeCache(key('d'), { messages: [msg(3)] });   // behind
  mockApi.fetchGroupPostsAfter.mockResolvedValue({ results: [msg(4)], has_more: false });
  await warmChats([
    { slug: 'a', is_member: true, last_message: { id: 9 } },
    { slug: 'd', is_member: true, last_message: { id: 4 } },
    { slug: 'x', is_member: false, last_message: null },
  ], ME);
  expect(mockApi.fetchGroupPostsAfter).toHaveBeenCalledTimes(1);
  expect(mockApi.fetchGroupPostsAfter).toHaveBeenCalledWith('d', 3);
  expect(ids('d')).toEqual([3, 4]);
});
