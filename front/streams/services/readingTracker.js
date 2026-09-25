// Reading, recorded as it happens and sent in small batches.
//
// The reader notes time spent in a chapter and how far it got; notes for
// the same chapter on the same day merge, so the queue stays small. They're
// kept on the phone until the server has them — reading done offline is
// sent when the signal comes back, with the time it really happened (the
// server won't let a late report pull the reader's place backwards).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendReadingActivity } from './api';

const KEY = 'readq:v1';
const MAX_QUEUED = 500;
const BATCH = 50;

let queue = null;
let loading = null;
let flushing = null;
// Notes on their way to the server: new reading never merges into these (it
// would vanish with them once sent), it starts a note of its own.
const sending = new Set();

const dayOf = (ms) => new Date(ms).toDateString();

const load = () => {
  if (!loading) {
    loading = AsyncStorage.getItem(KEY)
      .then((raw) => { const v = raw ? JSON.parse(raw) : []; queue = Array.isArray(v) ? v : []; })
      .catch(() => { queue = []; });
  }
  return loading;
};
const save = () => AsyncStorage.setItem(KEY, JSON.stringify(queue)).catch(() => {});

/** Note reading in a chapter: { index, seconds, furthest, position }. */
export const noteReading = async (pubId, { index, seconds = 0, furthest = 0, position = 0, at = Date.now() }) => {
  if (pubId == null || index == null) return;
  await load();
  const same = queue.find((e) => !sending.has(e) && e.pubId === pubId && e.index === index && dayOf(e.at) === dayOf(at));
  if (same) {
    same.seconds += Math.max(0, Math.round(seconds));
    same.furthest = Math.max(same.furthest, furthest);
    same.position = position;
    same.at = Math.max(same.at, at);
  } else {
    queue.push({ pubId, index, seconds: Math.max(0, Math.round(seconds)), furthest, position, at });
    if (queue.length > MAX_QUEUED) queue = queue.slice(-MAX_QUEUED);
  }
  save();
};

/** Send what's waiting. Stops at the first network failure (it keeps). */
export const flushReading = () => {
  if (flushing) return flushing;
  flushing = (async () => {
    await load();
    while (queue.length) {
      const pubId = queue[0].pubId;
      const batch = queue.filter((e) => e.pubId === pubId).slice(0, BATCH);
      batch.forEach((e) => sending.add(e));
      try {
        await sendReadingActivity(pubId, batch.map(({ pubId: _p, ...ev }) => ev));
      } catch (err) {
        batch.forEach((e) => sending.delete(e));
        // The book is gone or the notes are refused: drop them, don't retry
        // forever. No answer at all (offline): keep them for later.
        if (!(err?.status >= 400 && err?.status < 500 && err.status !== 401 && err.status !== 429)) break;
      }
      batch.forEach((e) => sending.delete(e));
      queue = queue.filter((e) => !batch.includes(e));
      save();
    }
  })().finally(() => { flushing = null; });
  return flushing;
};

/** On logout: what's waiting belonged to the account leaving. */
export const clearReadingQueue = async () => {
  queue = [];
  loading = Promise.resolve();
  await AsyncStorage.removeItem(KEY).catch(() => {});
};

export const __pendingReading = async () => { await load(); return queue.map((e) => ({ ...e })); };
export const __resetReadingTracker = () => { queue = null; loading = null; flushing = null; };
