// What the quiz hub and the daily quiz share: one kept copy of today's quiz,
// so the quiz opens on the questions the hub already loaded instead of
// fetching them again behind a spinner.
//
// Per user (userKey): the kept quiz carries `my_attempt` and, once played,
// the review — one person's answers, never to be shown to the next account.
import { format, parseISO } from 'date-fns';
import { userKey } from './screenCache';

/** The languages the quiz is played in; anything else plays in English. */
export const quizLanguage = (appLanguage) => (appLanguage === 'sw' ? 'sw' : 'en');

export const quizKeys = (userId, lang = 'en') => ({
  // Per language: a Swahili quiz and an English one are different questions.
  daily: userKey(userId, `quiz:daily:${lang}`),
  stats: userKey(userId, 'quiz:stats'),
  bests: userKey(userId, 'quiz:bests'),
});

// The quiz day turns over at midnight where the players are (East Africa,
// UTC+3, no daylight saving) — the server counts days there too (songs/
// days.py). Reading the phone's own date instead made a quiz kept from
// before midnight look stale on a phone set to another zone, and the reverse.
export const GAME_UTC_OFFSET_MINUTES = 180;

/** Now, as a Date whose local fields read the players' clock — for date-fns
 *  formatting of "which day is it there". */
export const gameNow = (now = Date.now()) => {
  const phoneOffset = new Date(now).getTimezoneOffset();          // minutes behind UTC
  return new Date(now + (GAME_UTC_OFFSET_MINUTES + phoneOffset) * 60000);
};

/** Today where the players are, as the server writes dates. */
export const todayIso = () => format(gameNow(), 'yyyy-MM-dd');

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
