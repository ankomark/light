/**
 * Keep an unfinished daily quiz on the device.
 *
 * The daily quiz is one attempt per day, and until it is submitted the answers
 * exist only in component state. A phone call twenty questions in, or the OS
 * reclaiming memory, and the run is gone — with the day's single attempt
 * already spent. That is the worst failure this feature can have, so the
 * answers are written down as they are given.
 *
 * Only the daily quiz needs this. A practice session is already durable: the
 * server records each answer as it happens, so an interrupted run resumes from
 * the server's own state.
 *
 * The draft is keyed by quiz date, so yesterday's cannot be restored into
 * today's questions.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'quiz:draft';

/** Save the run in progress. Failures are swallowed: a draft that cannot be
 *  written must never interrupt the quiz it is protecting. */
export const saveDraft = async (date, draft) => {
  if (!date) return;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ date, ...draft }));
  } catch {
    // Storage full or unavailable — play on.
  }
};

/** The draft for `date`, or null. A draft from another day is discarded rather
 *  than returned, so stale answers can never attach to new questions. */
export const loadDraft = async (date) => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || draft.date !== date) {
      await clearDraft();
      return null;
    }
    return draft;
  } catch {
    return null;
  }
};

export const clearDraft = async () => {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
};
