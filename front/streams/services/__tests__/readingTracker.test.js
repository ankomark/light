import AsyncStorage from '@react-native-async-storage/async-storage';

const mockSend = jest.fn();
jest.mock('../api', () => ({ sendReadingActivity: (...a) => mockSend(...a) }));

const tracker = require('../readingTracker');

const DAY = 24 * 60 * 60 * 1000;
const at = new Date(2026, 8, 25, 10, 0).getTime();

beforeEach(async () => {
  await AsyncStorage.clear();
  tracker.__resetReadingTracker();
  mockSend.mockReset();
});

test('reading in the same chapter on the same day adds up into one note', async () => {
  await tracker.noteReading(5, { index: 0, seconds: 30, furthest: 0.2, position: 0.2, at });
  await tracker.noteReading(5, { index: 0, seconds: 25, furthest: 0.1, position: 0.1, at: at + 60000 });
  await tracker.noteReading(5, { index: 1, seconds: 10, furthest: 0.5, at });
  await tracker.noteReading(5, { index: 0, seconds: 5, at: at + DAY });           // tomorrow: its own note
  const q = await tracker.__pendingReading();
  expect(q.map((e) => [e.index, e.seconds, e.furthest])).toEqual([[0, 55, 0.2], [1, 10, 0.5], [0, 5, 0]]);
  expect(q[0].position).toBe(0.1);                                                // where it is now
});

test('sent per book in batches, and gone once the server has them', async () => {
  mockSend.mockResolvedValue({ accepted: 1 });
  await tracker.noteReading(5, { index: 0, seconds: 30, at });
  await tracker.noteReading(8, { index: 2, seconds: 12, at });
  await tracker.flushReading();
  expect(mockSend).toHaveBeenCalledWith(5, [expect.objectContaining({ index: 0, seconds: 30, at })]);
  expect(mockSend).toHaveBeenCalledWith(8, [expect.objectContaining({ index: 2, seconds: 12 })]);
  expect(mockSend.mock.calls[0][1][0].pubId).toBeUndefined();
  expect(await tracker.__pendingReading()).toEqual([]);
});

test('offline: kept (on the phone too) and sent later', async () => {
  mockSend.mockRejectedValueOnce(new Error('Network Error'));
  await tracker.noteReading(5, { index: 0, seconds: 30, at });
  await tracker.flushReading();
  tracker.__resetReadingTracker();                        // the app restarts
  expect((await tracker.__pendingReading()).length).toBe(1);
  mockSend.mockResolvedValue({});
  await tracker.flushReading();
  expect(await tracker.__pendingReading()).toEqual([]);
});

test('a book that is gone: its notes are dropped, not retried for ever', async () => {
  mockSend.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
  await tracker.noteReading(5, { index: 0, seconds: 30, at });
  await tracker.flushReading();
  expect(await tracker.__pendingReading()).toEqual([]);
});

test('reading noted while a batch is on its way is not lost with it', async () => {
  let answer;
  mockSend.mockImplementationOnce(() => new Promise((res) => { answer = res; }));
  await tracker.noteReading(5, { index: 0, seconds: 30, at });
  const sending = tracker.flushReading();
  await new Promise((r) => setTimeout(r, 0));
  await tracker.noteReading(5, { index: 0, seconds: 20, at: at + 1000 });           // same chapter, same day
  answer({});
  await sending;
  // Both reach the server — 30 in the first batch, the 20 on its own after.
  expect(mockSend.mock.calls.map((c) => c[1].map((e) => e.seconds))).toEqual([[30], [20]]);
  expect(await tracker.__pendingReading()).toEqual([]);
});

test('logging out clears what was waiting', async () => {
  await tracker.noteReading(5, { index: 0, seconds: 30, at });
  await tracker.clearReadingQueue();
  expect(await tracker.__pendingReading()).toEqual([]);
  expect(await AsyncStorage.getItem('readq:v1')).toBeNull();
});
