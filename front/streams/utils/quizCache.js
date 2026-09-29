// What the quiz hub and the daily quiz share: one kept copy of today's quiz,
// so the quiz opens on the questions the hub already loaded instead of
// fetching them again behind a spinner.
//
// Per user (userKey): the kept quiz carries `my_attempt` and, once played,
// the review — one person's answers, never to be shown to the next account.
import { format, parseISO } from 'date-fns';
import { userKey } from './screenCache';

export const quizKeys = (userId) => ({
  daily: userKey(userId, 'quiz:daily'),
  stats: userKey(userId, 'quiz:stats'),
  bests: userKey(userId, 'quiz:bests'),
});

/** Today on this phone, as the server writes dates. */
export const todayIso = () => format(new Date(), 'yyyy-MM-dd');

/** A kept daily quiz is only today's quiz if it is dated today: yesterday's,
 *  with yesterday's "played" mark, must not be shown as today's. */
export const isToday = (quiz) => !!quiz?.date && quiz.date === todayIso();

/** "Tuesday 29 September", not "2026-09-29". */
export const formatQuizDay = (iso) => {
  if (!iso) return '';
  try {
    return format(parseISO(String(iso)), 'EEEE d MMMM');
  } catch {
    return String(iso);
  }
};

/** The kept quiz once it has been played: the attempt and its review folded
 *  in, so reopening shows the result straight away, not the questions. */
export const withAttempt = (quiz, outcome, durationSeconds) => (quiz ? {
  ...quiz,
  my_attempt: {
    ...(outcome.attempt || {}),
    score: outcome.score,
    total: outcome.total,
    points: outcome.points,
    longest_streak: outcome.longest_streak,
    duration_seconds: outcome.attempt?.duration_seconds ?? durationSeconds,
    results: outcome.results,
  },
} : quiz);
