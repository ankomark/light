/**
 * Practice for when there is no connection.
 *
 * Once a day, while online, the hub fetches a pack of forty practice
 * questions with their answers (the same for everyone that day, never the
 * daily quiz's, see /quiz/offline-pack/ on the server) and keeps it. With no
 * signal — a bus, a village, a church hall — a run of ten is drawn from it and
 * played entirely on the phone. It pays no coins: nothing is checked there.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { todayIso } from './quizCache';

const keyFor = (lang) => `quiz:offlinePack:${lang === 'sw' ? 'sw' : 'en'}`;
export const OFFLINE_RUN = 10;

export const loadOfflinePack = async (lang) => {
  try {
    const pack = JSON.parse((await AsyncStorage.getItem(keyFor(lang))) || 'null');
    return pack?.questions?.length ? pack : null;
  } catch {
    return null;
  }
};

/** Fetch today's pack unless it is already kept. `fetchPack(lang)` is the
 *  API call; failures leave yesterday's pack in place (better than none). */
export const refreshOfflinePack = async (lang, fetchPack) => {
  const kept = await loadOfflinePack(lang);
  if (kept?.date === todayIso()) return kept;
  try {
    const fresh = await fetchPack(lang);
    if (fresh?.questions?.length) {
      await AsyncStorage.setItem(keyFor(lang), JSON.stringify(fresh));
      return fresh;
    }
  } catch { /* offline now: keep what there is */ }
  return kept;
};

/** A run drawn from the pack: `count` questions, simple ones first, in the
 *  shape QuizPlay plays (`random` is injectable for tests). */
export const offlineRun = (pack, label, count = OFFLINE_RUN, random = Math.random) => {
  const pool = [...(pack?.questions || [])];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const rank = { simple: 0, moderate: 1, hard: 2 };
  const questions = pool.slice(0, count).sort((a, b) => (rank[a.difficulty] ?? 1) - (rank[b.difficulty] ?? 1));
  return {
    id: 'offline',
    mode: 'offline',
    language: pack?.language || 'en',
    mode_config: { label, time_limit: null, ends_on_wrong: false, questions: questions.length },
    questions,
    total_questions: questions.length,
    score: 0, answered: 0, points: 0, streak: 0, longest_streak: 0, is_finished: false,
  };
};
