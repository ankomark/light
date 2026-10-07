/**
 * Practice answers that could not reach the server, kept until they can.
 *
 * A practice run is judged on the phone at once and recorded behind the play.
 * On a weak connection a record can fail twice; before, it was dropped, and
 * the run's coins on the server quietly came up short of what the screen had
 * shown. Now it is written down here and sent again the next time a run
 * starts or ends, or the app comes back to the front.
 *
 * Per account, so a shared phone never sends one person's answers as another's.
 * Sending again is safe: the server refuses a second answer to the same
 * question (it says "answered"), and that settles it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const keyFor = (userId) => `quiz:answerQueue:${userId || 'anon'}`;
// A day's worth at most; older entries are for runs long closed.
const MAX = 200;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const read = async (userId) => {
  try {
    const list = JSON.parse((await AsyncStorage.getItem(keyFor(userId))) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const write = async (userId, list) => {
  try {
    if (list.length) await AsyncStorage.setItem(keyFor(userId), JSON.stringify(list.slice(-MAX)));
    else await AsyncStorage.removeItem(keyFor(userId));
  } catch { /* storage unavailable: the answer is lost, as it was before */ }
};

/** Keep an answer to send later: {runId, questionId, choice, seconds}. */
export const enqueueAnswer = async (userId, item) => {
  const list = await read(userId);
  if (list.some((a) => a.runId === item.runId && a.questionId === item.questionId)) return;
  list.push({ ...item, at: Date.now() });
  await write(userId, list);
};

/** A refusal that means the answer is settled (already there, run closed,
 *  not a question of that run) rather than not delivered. */
const settled = (e) => {
  const code = e?.response?.status ?? e?.status;
  return code === 400 || code === 404 || code === 403;
};

/** Send what is waiting, oldest first; keep only what still could not go.
 *  `send(item)` posts one answer. Resolves to how many are still waiting. */
export const flushAnswers = async (userId, send) => {
  const list = await read(userId);
  if (!list.length) return 0;
  const keep = [];
  for (const item of list) {
    if (Date.now() - (item.at || 0) > MAX_AGE_MS) continue;
    try {
      await send(item);
    } catch (e) {
      if (!settled(e)) keep.push(item);
    }
  }
  await write(userId, keep);
  return keep.length;
};

export const pendingAnswers = async (userId) => (await read(userId)).length;
