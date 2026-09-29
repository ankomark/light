/**
 * The daily Bible quiz — twenty questions, three difficulties, one attempt.
 *
 * Built to the approved design: scripture set in Lora as the hero of the
 * screen, Cinzel for numerals and eyebrow labels, gold hairlines over a dark
 * navy wash with an ambient gradient for depth.
 *
 * Everything shown here is real: points, streak, accuracy and rank all come
 * from the server. Per-question time is measured here and sent with the
 * attempt, but the speed bonus is computed and clamped server-side — the clock
 * on this screen shapes the score, it does not decide it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Animated, PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchDailyQuiz, submitDailyQuiz, fetchQuizLeaderboard, fetchGroups,
} from '../services/api';
import { useAuth } from '../context/useAuth';
import { colors, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import {
  setSoundEnabled, setMusicEnabled, tapFeedback, finishFeedback, playLoop, stopLoop,
  pageFeedback, streakFeedback, unload as unloadSound,
} from '../services/quizSound';
import BottomSheet from '../components/BottomSheet';
import ShareCardSheet from '../components/ShareCardSheet';
import QuizResultCard, { resultMessage } from '../components/QuizResultCard';
import useReducedMotion from '../utils/useReducedMotion';
import { parseReference } from '../utils/dailyVerseText';
import { loadDraft, saveDraft, clearDraft } from '../utils/quizDraft';
import { peekCache, writeCache, userKey } from '../utils/screenCache';
import { quizKeys, quizLanguage, isToday, formatQuizDay, withAttempt } from '../utils/quizCache';
import { fetchBibleBooks } from '../services/bible';
import { confirmAction } from '../utils/adminConfirm';
// One backdrop and one coin for every quiz screen, so a change lands everywhere.
import { Backdrop, Coin, Coins } from './quizTheme';

// Already loaded app-wide in App.js — no new dependency for this screen.
const DISPLAY = 'Cinzel_700Bold';
const DISPLAY_MID = 'Cinzel_600SemiBold';
const SERIF = 'Lora_400Regular';
const SERIF_BOLD = 'Lora_700Bold';

const GOLD = '#F4A261';
const GOLD_DEEP = '#C9963F';
const PARCHMENT = '#E8E3DA';
const MUTED = '#5F708A';

const DIFFICULTY_TINT = {
  simple: { fg: '#7FD1A0', bg: 'rgba(67,160,71,0.16)' },
  moderate: { fg: '#F0B972', bg: 'rgba(251,140,0,0.16)' },
  hard: { fg: '#FF8A86', bg: 'rgba(229,57,53,0.16)' },
};

// A swipe, not a wobble: far enough, and clearly more across than down, so
// a long verse can still be scrolled without the question changing.
const SWIPE_MIN = 60;
const isAcross = (g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 2;

const mmss = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const BibleQuiz = ({ navigation }) => {
  const { t, resolvedLanguage } = useI18n();
  const { currentUser } = useAuth();
  const lang = quizLanguage(resolvedLanguage);
  const { preferences, setPreference } = usePreferences();
  const soundOn = preferences?.[PREF_KEYS.quizSound] !== false;
  const musicOn = preferences?.[PREF_KEYS.quizMusic] !== false;

  const [quiz, setQuiz] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [board, setBoard] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  // Which way the new question came from, so it slides in from that side.
  const slide = useRef(new Animated.Value(0)).current;
  const cameFrom = useRef(0);
  const startedAt = useRef(Date.now());
  // When the current question first appeared, and how long each one took.
  // The server uses these for the speed bonus (clamped there, so a wrong
  // clock cannot mint points).
  const questionShownAt = useRef(Date.now());
  const spent = useRef({});

  // Which board: today, this week or all time; everyone or the people you
  // follow. Read through refs so a tab change reloads the board only.
  const [boardPeriod, setBoardPeriod] = useState('today');
  const [boardScope, setBoardScope] = useState('everyone');
  const boardWanted = useRef({ period: 'today', scope: 'everyone' });
  boardWanted.current = { period: boardPeriod, scope: boardScope };
  // Each board is kept once seen: back to a tab, it is there at once, then
  // refreshed behind it.
  const boardKey = (w) => userKey(currentUser?.id, `quiz:board:${w.period}:${w.scope}`);
  const loadBoard = useCallback(async () => {
    const wanted = { ...boardWanted.current };
    const kept = peekCache(boardKey(wanted));
    if (kept) setBoard(kept);
    try {
      const data = await fetchQuizLeaderboard(undefined, wanted);
      writeCache(boardKey(wanted), data, { persist: false });
      // A slower answer for a tab since left must not overwrite the one shown.
      const now = boardWanted.current;
      if (now.period === wanted.period && now.scope === wanted.scope) setBoard(data);
    } catch { /* a nicety, not the quiz */ }
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The groups you belong to — a church, a youth group — each a board of its
  // own beside everyone and the people you follow. Kept once read.
  const groupsKey = userKey(currentUser?.id, 'quiz:myGroups');
  const [myGroups, setMyGroups] = useState(() => peekCache(groupsKey) || []);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => fetchGroups({ scope: 'mine' }))
      .then((res) => {
        const list = (res?.results || res || []).filter((g) => g?.slug).slice(0, 8)
          .map((g) => ({ slug: g.slug, name: g.name }));
        writeCache(groupsKey, list, { persist: false });
        if (live) setMyGroups(list);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [groupsKey]);

  // Sharing the result, and a word when something happened (copied, saved).
  const [sharing, setSharing] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const showToast = useCallback((text) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 1900);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const dailyKey = quizKeys(currentUser?.id, lang).daily;

  // Start on a quiz: the clock, and either the board (played) or an
  // interrupted run picked back up (not yet played).
  const adopt = useCallback(async (data) => {
    setQuiz(data);
    startedAt.current = Date.now();
    if (data?.my_attempt) {
      // Already played: nothing to restore, and any draft is spent.
      clearDraft();
      loadBoard();
    } else {
      // Pick up an interrupted run rather than losing the day's one attempt.
      const draft = await loadDraft(data?.date);
      if (draft) {
        setAnswers(draft.answers || {});
        setIndex(Math.min(draft.index || 0, (data.questions?.length || 1) - 1));
        spent.current = draft.spent || {};
        if (draft.elapsed) startedAt.current = Date.now() - draft.elapsed * 1000;
      }
    }
  }, [loadBoard]);

  const load = useCallback(async () => {
    setError('');
    // The hub has usually just loaded today's quiz: open on that at once
    // rather than fetching the same twenty questions again behind a spinner.
    const kept = peekCache(dailyKey);
    const usable = isToday(kept) && !!kept.questions?.length;
    if (usable) {
      await adopt(kept);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const fresh = await fetchDailyQuiz(undefined, lang);
      writeCache(dailyKey, fresh);
      if (!usable || fresh.date !== kept.date) {
        await adopt(fresh);
      } else if (fresh.my_attempt && !kept.my_attempt) {
        // Played meanwhile (another phone): the result, not the questions.
        await adopt(fresh);
      } else {
        setQuiz(fresh);
      }
    } catch {
      // With the kept copy on screen, a failed refresh changes nothing.
      if (!usable) setError(t('quiz.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, adopt, dailyKey, lang]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setSoundEnabled(soundOn);
  }, [soundOn]);

  // The music is muted on its own — the button in the header is a music
  // button, and silencing it never silences the answers.
  useEffect(() => {
    setMusicEnabled(musicOn);
    if (musicOn) playLoop(); else stopLoop();
  }, [musicOn]);
  // Leaving the screen must never leave music playing behind it.
  useEffect(() => () => { stopLoop(); unloadSound(); }, []);

  const questions = quiz?.questions || [];
  const alreadyPlayed = !!quiz?.my_attempt && !outcome;
  const playing = !!quiz && !alreadyPlayed && !outcome;

  // A real clock — this is the duration submitted with the attempt.
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [playing]);

  const current = questions[index];
  const answeredCount = Object.keys(answers).length;

  // Bank the time spent whenever the question changes.
  useEffect(() => {
    questionShownAt.current = Date.now();
  }, [index]);

  const bankTime = useCallback(() => {
    const q = questions[index];
    if (!q) return;
    const seconds = (Date.now() - questionShownAt.current) / 1000;
    spent.current[q.id] = (spent.current[q.id] || 0) + seconds;
    questionShownAt.current = Date.now();
  }, [questions, index]);

  // One way to change question — the arrows, a swipe and the map all use it:
  // the time on the one being left is banked, and the next slides in.
  const indexRef = useRef(index);
  indexRef.current = index;
  const questionCount = questions.length;
  const goTo = useCallback((next) => {
    const to = Math.max(0, Math.min(questionCount - 1, next));
    if (to === indexRef.current) return;
    bankTime();
    cameFrom.current = to > indexRef.current ? 1 : -1;
    pageFeedback();
    setIndex(to);
  }, [questionCount, bankTime]);

  useEffect(() => {
    if (!cameFrom.current || reduceMotion) { slide.setValue(0); return; }
    slide.setValue(cameFrom.current * 36);
    cameFrom.current = 0;
    Animated.spring(slide, { toValue: 0, friction: 9, tension: 70, useNativeDriver: true }).start();
  }, [index, reduceMotion, slide]);

  // Swipe left for the next question, right for the one before — the arrows
  // stay: a swipe is a shortcut, not the only way.
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => isAcross(g),
    onPanResponderRelease: (_, g) => {
      if (g.dx < -SWIPE_MIN) goToRef.current(indexRef.current + 1);
      else if (g.dx > SWIPE_MIN) goToRef.current(indexRef.current - 1);
    },
    onPanResponderTerminationRequest: () => true,
  })).current;

  const myRank = useMemo(() => {
    if (board?.me?.rank) return board.me.rank;
    const rows = board?.results || [];
    const i = rows.findIndex((r) => r.user?.username === currentUser?.username);
    return i === -1 ? null : i + 1;
  }, [board, currentUser]);

  // The review: straight after submitting, or any time later today from the
  // attempt the server keeps.
  // A Swahili quiz names its books in Swahili ("Zaburi 23:1"): the reader's
  // own list of NENO's book names places them for "Read in Bible".
  const [bookNames, setBookNames] = useState(null);
  useEffect(() => {
    if (quiz?.language !== 'sw') return undefined;
    let live = true;
    fetchBibleBooks('swh_bib')
      .then((books) => { if (live) setBookNames(new Map(books.map((b) => [b.name, b.id]))); })
      .catch(() => {});
    return () => { live = false; };
  }, [quiz?.language]);
  const place = useCallback((reference) => parseReference(reference, bookNames), [bookNames]);

  const review = useMemo(
    () => outcome?.results || quiz?.my_attempt?.results || [],
    [outcome, quiz],
  );
  const reviewById = useMemo(() => {
    const map = {};
    review.forEach((r) => { map[r.question_id] = r; });
    return map;
  }, [review]);

  const choose = (questionId, choiceIndex) => {
    if (!playing) return;
    tapFeedback();
    setAnswers((prev) => {
      const updated = { ...prev, [questionId]: choiceIndex };
      // Persisted on every answer: the run must survive the app being killed.
      bankTime();
      saveDraft(quiz?.date, {
        answers: updated,
        index,
        spent: spent.current,
        elapsed: Math.round((Date.now() - startedAt.current) / 1000),
      });
      return updated;
    });
  };

  const submit = async () => {
    // Twenty questions, one attempt: a gap should be a choice, not a slip.
    const missing = questions.length - answeredCount;
    if (missing > 0) {
      const go = await confirmAction({
        title: t('quiz.unansweredTitle'),
        message: t('quiz.unansweredBody', { count: missing }),
        confirmLabel: t('quiz.submitAnyway'),
        cancelLabel: t('quiz.keepGoing'),
      });
      if (!go) {
        const first = questions.findIndex((qq) => answers[qq.id] == null);
        if (first !== -1) { bankTime(); setIndex(first); }
        return;
      }
    }
    try {
      setSubmitting(true);
      bankTime();
      const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
      // {id: {choice, seconds}} — the shape the scoring engine reads.
      const payload = {};
      Object.entries(answers).forEach(([id, choice]) => {
        payload[id] = { choice, seconds: Number((spent.current[id] || 0).toFixed(1)) };
      });
      const res = await submitDailyQuiz(payload, seconds, quiz?.language || lang);
      setOutcome(res);
      // The kept copy now says "played", with the review, so reopening the
      // quiz — or the hub — shows the result rather than the questions.
      writeCache(dailyKey, withAttempt(quiz, res, seconds));
      clearDraft();
      finishFeedback();
      loadBoard();
    } catch (e) {
      const code = e?.response?.data?.code || e?.data?.code;
      if (code === 'already_played') {
        // Played on another phone: show that result instead of an error.
        setError('');
        clearDraft();
        load();
        return;
      }
      setError(t('quiz.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // The score counts up to itself once, straight after submitting — not on a
  // later visit, where it is a record to read, not a moment. A perfect score
  // gets its own word and its own feel.
  const [shownScore, setShownScore] = useState(null);
  const counted = useRef(false);
  useEffect(() => {
    if (!outcome || counted.current) return undefined;
    counted.current = true;
    const target = outcome.score;
    if (outcome.total && target === outcome.total) streakFeedback();
    if (reduceMotion || !target) { setShownScore(target); return undefined; }
    const value = new Animated.Value(0);
    const id = value.addListener(({ value: v }) => setShownScore(Math.round(v)));
    Animated.timing(value, { toValue: target, duration: 900, useNativeDriver: false }).start();
    return () => value.removeListener(id);
  }, [outcome, reduceMotion]);

  // A tab changed: that board, and only it.
  const showingResult = !!outcome || !!quiz?.my_attempt;
  const tabsTouched = useRef(false);
  useEffect(() => {
    // The first run is the mount: the board is already being fetched then.
    if (!tabsTouched.current) { tabsTouched.current = true; return; }
    if (!showingResult) return;
    setBoard(peekCache(boardKey(boardWanted.current)) || null);
    loadBoard();
  }, [boardPeriod, boardScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── loading / error ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.root}>
        <Backdrop />
        <View style={styles.centered}><ActivityIndicator size="large" color={GOLD} /></View>
      </View>
    );
  }

  if (error && !quiz) {
    return (
      <View style={styles.root}>
        <Backdrop />
        <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
          <View style={styles.centered}>
            <Ionicons name="cloud-offline-outline" size={42} color={MUTED} />
            <Text style={styles.emptyTitle}>{t('quiz.unavailable')}</Text>
            <Text style={styles.emptyBody}>{error}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={load} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── results ───────────────────────────────────────────────────────────────
  if (alreadyPlayed || outcome) {
    const score = outcome ? outcome.score : quiz.my_attempt.score;
    const total = outcome ? outcome.total : quiz.my_attempt.total;
    const seconds = outcome ? elapsed : (quiz.my_attempt.duration_seconds || 0);
    const accuracy = total ? Math.round((score / total) * 100) : 0;
    const points = outcome ? outcome.points : quiz.my_attempt.points;
    const streak = outcome ? outcome.longest_streak : quiz.my_attempt.longest_streak;
    const perfect = total > 0 && score === total;
    const band = perfect ? 'perfect' : accuracy >= 80 ? 'high' : accuracy >= 50 ? 'mid' : 'low';

    return (
      <View style={styles.root}>
        <Backdrop />
        <SafeAreaView style={styles.flex} edges={['top']}>
          <ScrollView contentContainerStyle={styles.resultScroll} showsVerticalScrollIndicator={false}>

            <View style={styles.resultHead}>
              <Text style={styles.eyebrow}>{formatQuizDay(quiz?.date)}</Text>
              <Text style={styles.resultTitle}>{t('quiz.title')}</Text>
            </View>

            <View style={[styles.medallionOuter, perfect && styles.medallionPerfect]}>
              <View style={[styles.medallionInner, perfect && styles.medallionInnerPerfect]}
                    accessible accessibilityLabel={`${score} / ${total}. ${t(`quiz.band.${band}`)}`}>
                <View style={styles.scoreRow}>
                  <Text style={styles.scoreValue}>{outcome && shownScore != null ? shownScore : score}</Text>
                  <Text style={styles.scoreOf}>/{total}</Text>
                </View>
                <Text style={[styles.eyebrow, styles.bandLabel]}>{t(`quiz.band.${band}`)}</Text>
              </View>
            </View>

            <View style={styles.statsCard}>
              <View style={styles.stat}>
                <Coins value={points} size={26} textSize={19} />
                <Text style={styles.eyebrow}>{t('quiz.stat.coins')}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{streak ?? 0}</Text>
                <Text style={styles.eyebrow}>{t('quiz.stat.streak')}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{accuracy}<Text style={styles.statUnit}>%</Text></Text>
                <Text style={styles.eyebrow}>{t('quiz.stat.accuracy')}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{myRank ? myRank : '—'}</Text>
                <Text style={styles.eyebrow}>{t('quiz.stat.rank')}</Text>
                {!!board?.me?.of && (
                  <Text style={styles.rankOf}>{t('quiz.rankOf', { count: board.me.of })}</Text>
                )}
              </View>
            </View>
            <Text style={styles.timeNote}>{t('quiz.tookTime', { time: mmss(seconds) })}</Text>

            <View style={styles.boardCard}>
              <Text style={styles.eyebrow}>{t('quiz.leaderboard')}</Text>
              <View style={styles.tabs} accessibilityRole="tablist">
                {['today', 'week', 'all'].map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.tab, boardPeriod === p && styles.tabOn]}
                    onPress={() => setBoardPeriod(p)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: boardPeriod === p }}
                  >
                    <Text style={[styles.tabText, boardPeriod === p && styles.tabTextOn]}>
                      {t(`quiz.board.${p}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.scopes} testID="board-scopes">
                {[
                  { key: 'everyone', label: t('quiz.board.everyone') },
                  { key: 'following', label: t('quiz.board.following') },
                  ...myGroups.map((g) => ({ key: `group:${g.slug}`, label: g.name, group: true })),
                ].map((sc) => (
                  <TouchableOpacity
                    key={sc.key}
                    style={[styles.scope, boardScope === sc.key && styles.scopeOn]}
                    onPress={() => setBoardScope(sc.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: boardScope === sc.key }}
                  >
                    {sc.group && <Ionicons name="people" size={12} color={boardScope === sc.key ? GOLD : '#A9BCD0'} />}
                    <Text style={[styles.scopeText, boardScope === sc.key && styles.tabTextOn]} numberOfLines={1}>
                      {sc.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {!board ? (
                <ActivityIndicator color={GOLD} style={styles.boardLoading} />
              ) : !board.results?.length ? (
                <Text style={styles.boardEmpty}>
                  {t(boardScope === 'following' ? 'quiz.board.emptyFollowing'
                    : boardScope.startsWith('group:') ? 'quiz.board.emptyGroup'
                    : 'quiz.board.empty')}
                </Text>
              ) : (
                <>
                  {board.results.slice(0, 8).map((row, i) => {
                    const isMe = row.user?.username === currentUser?.username;
                    return (
                      <View style={[styles.boardRow, isMe && styles.boardRowMe]} key={row.id}>
                        <Text style={[styles.boardRank, isMe && styles.goldText]}>{i + 1}</Text>
                        <Text style={[styles.boardName, isMe && styles.boardNameMe]} numberOfLines={1}>
                          {row.user?.username}
                        </Text>
                        <Text style={styles.boardCorrect}>
                          {boardPeriod === 'today'
                            ? `${row.score}/${row.total}`
                            : t('quiz.board.days', { count: row.days })}
                        </Text>
                        <Coins value={row.points} size={19} textSize={15} />
                      </View>
                    );
                  })}
                  {/* Below the eight shown: your own place, pinned. */}
                  {!!board.me && board.me.rank > Math.min(8, board.results.length) && (
                    <View style={[styles.boardRow, styles.boardRowMe, styles.boardRowPinned]}>
                      <Text style={[styles.boardRank, styles.goldText]}>{board.me.rank}</Text>
                      <Text style={[styles.boardName, styles.boardNameMe]} numberOfLines={1}>
                        {currentUser?.username}
                      </Text>
                      <Text style={styles.boardCorrect}>{t('quiz.rankOf', { count: board.me.of })}</Text>
                    </View>
                  )}
                </>
              )}
            </View>

            {review.length > 0 && (
              <View style={styles.reviewBlock}>
                <Text style={styles.eyebrow}>{t('quiz.review')}</Text>
                {questions.map((q, i) => {
                  const r = reviewById[q.id];
                  const chosen = r?.chosen_index;
                  // The whole verse, restored (a blanked word filled back in),
                  // without the reference the card already shows above it.
                  const verseText = r?.explanation
                    ? r.explanation.replace(` — ${r.reference}`, '')
                    : q.passage;
                  return (
                    <View style={styles.reviewCard} key={q.id}>
                      <View style={styles.reviewTop}>
                        <Text style={styles.reviewNum}>{i + 1}</Text>
                        <Ionicons
                          name={r?.correct ? 'checkmark-circle' : 'close-circle'}
                          size={17}
                          color={r?.correct ? colors.success : colors.error}
                        />
                        <Text style={styles.reviewRef} numberOfLines={1}>{r?.reference}</Text>
                      </View>
                      {!!verseText && <Text style={styles.reviewPassage}>{verseText}</Text>}
                      <Text style={styles.reviewAnswer}>
                        {t('quiz.answerWas')}{' '}
                        <Text style={styles.reviewAnswerBold}>{q.choices[r?.answer_index]}</Text>
                        {chosen != null && !r?.correct
                          ? ` · ${t('quiz.youSaid')} ${q.choices[chosen]}`
                          : ''}
                      </Text>
                      {!!place(r?.reference) && (
                        <TouchableOpacity
                          style={styles.readLink}
                          onPress={() => navigation.push?.('bible', place(r.reference))}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`${t('quiz.readInBible')}: ${r.reference}`}
                        >
                          <Ionicons name="book-outline" size={13} color={GOLD} />
                          <Text style={styles.readLinkText}>{t('quiz.readInBible')}</Text>
                        </TouchableOpacity>
                      )}
                      {r?.correct && r?.points_earned > 0 && (
                        <View style={styles.reviewPointsRow}>
                          <Coin size={17} />
                          <Text style={styles.reviewPoints}>+{r.points_earned}</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, styles.fullBtn]}
              onPress={() => setSharing(true)}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Ionicons name="share-social" size={16} color="#0A1628" />
              <Text style={styles.primaryBtnText}>{t('quiz.share.button')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ghostBtn, styles.fullBtn]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={styles.ghostBtnText}>{t('common.done')}</Text>
            </TouchableOpacity>
            <Text style={styles.footNote}>{t('quiz.comeBackTomorrow')}</Text>

          </ScrollView>
        </SafeAreaView>

        {!!toast && (
          <View style={styles.toast} pointerEvents="none" accessibilityLiveRegion="polite">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}

        {(() => {
          // The shape of the day, one mark a question, with no answers in it.
          const marks = questions.map((qq) => !!reviewById[qq.id]?.correct);
          const shared = {
            title: t('quiz.title'),
            day: formatQuizDay(quiz?.date),
            score, total, points, marks,
            coinsLabel: t('quiz.share.coins', { count: points }),
            beatMe: t('quiz.share.beatMe'),
          };
          return (
            <ShareCardSheet
              visible={sharing}
              onClose={() => setSharing(false)}
              title={t('quiz.share.title')}
              message={resultMessage(shared)}
              onToast={showToast}
              renderCard={(ref, width) => (
                <QuizResultCard
                  ref={ref}
                  width={width}
                  {...shared}
                  band={t(`quiz.band.${band}`)}
                  streak={streak}
                  streakLabel={t('quiz.share.run', { count: streak })}
                />
              )}
            />
          );
        })()}
      </View>
    );
  }

  // ── playing ───────────────────────────────────────────────────────────────
  const chosen = answers[current?.id];
  const onLast = index === questions.length - 1;
  const tint = DIFFICULTY_TINT[current?.difficulty] || DIFFICULTY_TINT.moderate;

  return (
    <View style={styles.root}>
      <Backdrop />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
                            accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={22} color="#7E8DA3" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('quiz.title')}</Text>
          <TouchableOpacity
            onPress={() => setPreference(PREF_KEYS.quizMusic, !musicOn)}
            style={styles.iconBtn}
            hitSlop={10}
            accessibilityLabel={t(musicOn ? 'quiz.musicOff' : 'quiz.musicOn')}
          >
            <Ionicons
              name={musicOn ? 'musical-notes' : 'musical-notes-outline'}
              size={19}
              color={musicOn ? GOLD : MUTED}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <LinearGradient
              colors={[GOLD_DEEP, GOLD]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${((index + 1) / questions.length) * 100}%` }]}
            />
          </View>
          {/* Tap the count for every question at once: which are answered,
              and a way straight to any of them. */}
          <TouchableOpacity
            onPress={() => setMapOpen(true)}
            style={styles.mapBtn}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('quiz.map.open')}
          >
            <Text style={styles.progressText}>
              {String(index + 1).padStart(2, '0')} / {questions.length}
            </Text>
            <Ionicons name="grid-outline" size={12} color={MUTED} />
          </TouchableOpacity>
        </View>

        <View style={styles.metaRow}>
          <View style={[styles.difficultyChip, { backgroundColor: tint.bg }]}>
            <Text style={[styles.difficultyText, { color: tint.fg }]}>
              {t(`quiz.difficulty.${current?.difficulty}`)}
            </Text>
          </View>
          <View style={styles.timerBox}>
            <Ionicons name="time-outline" size={14} color={GOLD} />
            <Text style={styles.timerText}>{mmss(elapsed)}</Text>
          </View>
        </View>

        <Animated.View style={[styles.flex, { transform: [{ translateX: slide }] }]} {...swipe.panHandlers}>
        <ScrollView
          contentContainerStyle={styles.playScroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {!!current?.passage && (
            <View style={styles.verseCard}>
              <Text style={styles.quoteMark}>“</Text>
              <Text style={styles.verseText}>{current.passage}</Text>
            </View>
          )}

          <Text style={styles.prompt}>{current?.prompt}</Text>

          <View style={styles.choices}>
            {(current?.choices || []).map((choice, i) => {
              const active = chosen === i;
              return (
                <TouchableOpacity
                  key={`${current.id}-${i}`}
                  style={[styles.choice, active && styles.choiceActive]}
                  onPress={() => choose(current.id, i)}
                  activeOpacity={0.85}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${String.fromCharCode(65 + i)}. ${choice}`}
                >
                  <Text style={[styles.choiceLetter, active && styles.goldText]}>
                    {String.fromCharCode(65 + i)}
                  </Text>
                  <View style={[styles.choiceRule, active && styles.choiceRuleActive]} />
                  <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{choice}</Text>
                  {active && (
                    <View style={styles.choiceTick}>
                      <Ionicons name="checkmark" size={13} color="#0A1628" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
        </Animated.View>

        <View style={styles.footer}>
          {index > 0 && (
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => goTo(index - 1)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('quiz.previous')}
            >
              <Ionicons name="chevron-back" size={18} color="#A9BCD0" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.primaryBtn, styles.grow, submitting && styles.disabled]}
            onPress={onLast ? submit : () => goTo(index + 1)}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color="#0A1628" size="small" />
            ) : (
              <>
                <Text style={styles.primaryBtnText}>
                  {onLast
                    ? t('quiz.submit', { answered: answeredCount, total: questions.length })
                    : t('quiz.next')}
                </Text>
                <Ionicons name="arrow-forward" size={16} color="#0A1628" />
              </>
            )}
          </TouchableOpacity>
        </View>

      </SafeAreaView>

      <BottomSheet
        visible={mapOpen}
        onClose={() => setMapOpen(false)}
        heightRatio={0.55}
        header={(
          <View style={styles.mapHead}>
            <Text style={styles.mapTitle}>{t('quiz.map.title')}</Text>
            <Text style={styles.mapCount}>
              {t('quiz.map.answered', { answered: answeredCount, total: questions.length })}
            </Text>
          </View>
        )}
      >
        <ScrollView contentContainerStyle={styles.mapGrid} testID="quiz-map">
          {questions.map((qq, i) => {
            const done = answers[qq.id] != null;
            const here = i === index;
            return (
              <TouchableOpacity
                key={qq.id}
                style={[styles.mapCell, done && styles.mapCellDone, here && styles.mapCellHere]}
                onPress={() => { setMapOpen(false); goTo(i); }}
                accessibilityRole="button"
                accessibilityState={{ selected: here }}
                accessibilityLabel={t(done ? 'quiz.map.itemDone' : 'quiz.map.item', { n: i + 1 })}
              >
                <Text style={[styles.mapNum, done && styles.mapNumDone]}>{i + 1}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628' },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  grow: { flex: 1 },

  eyebrow: {
    fontFamily: DISPLAY_MID, fontSize: 10, letterSpacing: 1.4,
    textTransform: 'uppercase', color: MUTED,
  },
  goldText: { color: GOLD },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingTop: spacing.sm,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1, textAlign: 'center', fontFamily: DISPLAY, fontSize: 15,
    letterSpacing: 0.6, color: PARCHMENT,
  },

  progressRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4,
    paddingHorizontal: spacing.lg - 4, paddingTop: spacing.sm,
  },
  progressTrack: {
    flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.09)',
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: 2 },
  progressText: { fontFamily: DISPLAY_MID, fontSize: 10, letterSpacing: 1.2, color: MUTED },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  mapHead: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12, gap: 3 },
  mapTitle: { fontFamily: DISPLAY, fontSize: 15, letterSpacing: 0.6, color: PARCHMENT },
  mapCount: { fontSize: 12, color: MUTED },
  mapGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center',
    paddingHorizontal: 20, paddingBottom: 24,
  },
  mapCell: {
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  mapCellDone: { backgroundColor: 'rgba(244,162,97,0.85)', borderColor: GOLD },
  mapCellHere: { borderWidth: 2, borderColor: PARCHMENT },
  mapNum: { fontFamily: DISPLAY_MID, fontSize: 14, color: '#A9BCD0' },
  mapNumDone: { color: '#0A1628' },

  metaRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg - 4, paddingTop: spacing.md,
  },
  difficultyChip: { height: 26, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 13 },
  difficultyText: { fontFamily: DISPLAY_MID, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
  timerBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timerText: { fontFamily: DISPLAY, fontSize: 15, color: GOLD },

  playScroll: { paddingHorizontal: spacing.lg - 4, paddingTop: spacing.md, paddingBottom: spacing.lg },

  verseCard: {
    padding: spacing.md + 6, paddingTop: spacing.lg,
    borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.26)',
  },
  quoteMark: {
    position: 'absolute', top: 4, left: 16,
    fontFamily: SERIF_BOLD, fontSize: 46, color: 'rgba(244,162,97,0.20)',
  },
  verseText: {
    fontFamily: SERIF, fontSize: 19, lineHeight: 31, color: PARCHMENT, paddingLeft: 14,
  },

  prompt: {
    marginTop: spacing.md + 4, fontSize: 15, fontWeight: '700', color: '#E0E1DD', lineHeight: 21,
  },

  choices: { marginTop: spacing.md, gap: 10 },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 58,
    paddingHorizontal: spacing.md, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.09)',
  },
  choiceActive: { backgroundColor: 'rgba(244,162,97,0.15)', borderColor: GOLD_DEEP },
  choiceLetter: { fontFamily: DISPLAY_MID, fontSize: 14, color: '#7E8DA3', width: 16, textAlign: 'center' },
  choiceRule: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.10)' },
  choiceRuleActive: { backgroundColor: 'rgba(244,162,97,0.40)' },
  choiceText: { flex: 1, fontSize: 15, color: '#C6CBD2' },
  choiceTextActive: { color: '#F6E9D8', fontWeight: '700' },
  choiceTick: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
  },

  footer: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg - 4, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  backBtn: {
    width: 52, height: 56, alignItems: 'center', justifyContent: 'center',
    borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.15)',
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 56, paddingHorizontal: spacing.lg, borderRadius: 28, backgroundColor: GOLD,
  },
  primaryBtnText: {
    fontFamily: DISPLAY, fontSize: 13, letterSpacing: 1, color: '#0A1628',
    textTransform: 'uppercase',
  },
  fullBtn: { alignSelf: 'stretch', marginTop: spacing.md },
  disabled: { opacity: 0.6 },

  resultScroll: { paddingHorizontal: spacing.lg - 4, paddingBottom: spacing.xl },
  resultHead: { alignItems: 'center', paddingTop: spacing.lg },
  resultTitle: { fontFamily: SERIF_BOLD, fontSize: 24, color: PARCHMENT, marginTop: 5 },

  medallionOuter: {
    alignSelf: 'center', marginTop: spacing.lg, width: 182, height: 182, borderRadius: 91,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.24)',
  },
  medallionInner: {
    width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.48)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline' },
  scoreValue: { fontFamily: DISPLAY, fontSize: 54, color: GOLD, lineHeight: 60 },
  scoreOf: { fontFamily: DISPLAY_MID, fontSize: 24, color: MUTED },
  bandLabel: { marginTop: 6, color: '#A9BCD0' },
  medallionPerfect: { borderColor: GOLD, borderWidth: 1.5 },
  medallionInnerPerfect: { borderColor: GOLD, backgroundColor: 'rgba(244,162,97,0.12)' },
  readLink: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 2 },
  readLinkText: { fontFamily: DISPLAY_MID, fontSize: 10.5, letterSpacing: 0.8, color: GOLD },
  rankOf: { fontSize: 10, color: MUTED },

  statsCard: {
    flexDirection: 'row', marginTop: spacing.lg, paddingVertical: spacing.md,
    borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.09)',
  },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.09)' },
  statValue: { fontFamily: DISPLAY, fontSize: 19, color: PARCHMENT },
  timeNote: { marginTop: spacing.sm, fontSize: 11.5, color: MUTED, textAlign: 'center' },
  statUnit: { fontSize: 12, color: MUTED },

  boardCard: {
    marginTop: spacing.md, padding: spacing.md, gap: 8, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.09)',
  },
  boardRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 34,
    paddingHorizontal: 10, borderRadius: 10,
  },
  boardRowMe: { backgroundColor: 'rgba(244,162,97,0.13)' },
  boardRowPinned: { marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(244,162,97,0.3)' },
  boardLoading: { marginVertical: 18 },
  boardEmpty: { fontSize: 13, color: MUTED, textAlign: 'center', marginVertical: 14 },
  tabs: {
    flexDirection: 'row', padding: 3, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  tab: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  tabOn: { backgroundColor: 'rgba(244,162,97,0.18)' },
  tabText: { fontFamily: DISPLAY_MID, fontSize: 11, letterSpacing: 0.6, color: MUTED },
  tabTextOn: { color: GOLD },
  scopes: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  scope: {
    flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 180,
    minHeight: 30, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  scopeOn: { borderColor: GOLD_DEEP, backgroundColor: 'rgba(244,162,97,0.10)' },
  scopeText: { fontSize: 12, color: '#A9BCD0' },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 52, paddingHorizontal: spacing.lg, borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)',
  },
  ghostBtnText: { fontFamily: DISPLAY, fontSize: 12, letterSpacing: 1, color: PARCHMENT, textTransform: 'uppercase' },
  toast: {
    position: 'absolute', bottom: 40, alignSelf: 'center',
    paddingVertical: 9, paddingHorizontal: 16, borderRadius: 16,
    backgroundColor: 'rgba(5,8,14,0.95)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.35)',
  },
  toastText: { fontSize: 13, color: PARCHMENT },
  boardRank: { fontFamily: DISPLAY_MID, fontSize: 14, color: MUTED, width: 18 },
  boardName: { flex: 1, fontSize: 14, color: '#C6CBD2' },
  boardNameMe: { color: '#F6E9D8', fontWeight: '800' },
  boardCorrect: { fontSize: 12, color: MUTED },
  boardScore: { fontFamily: DISPLAY_MID, fontSize: 15, color: PARCHMENT, minWidth: 34, textAlign: 'right' },

  reviewBlock: { marginTop: spacing.lg, gap: spacing.sm },
  reviewCard: {
    position: 'relative', padding: spacing.sm + 4, gap: 5, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)',
  },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  reviewNum: { fontFamily: DISPLAY_MID, fontSize: 12, color: MUTED, width: 18 },
  reviewRef: { flex: 1, fontFamily: SERIF, fontSize: 12.5, color: '#A9BCD0' },
  reviewPassage: { fontFamily: SERIF, fontSize: 12.5, lineHeight: 19, color: MUTED },
  reviewAnswer: { fontSize: 12, color: '#A9BCD0' },
  reviewAnswerBold: { color: colors.success, fontWeight: '800' },
  reviewPointsRow: {
    position: 'absolute', top: 10, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  reviewPoints: { fontFamily: DISPLAY_MID, fontSize: 12, color: GOLD },

  emptyTitle: { fontFamily: SERIF_BOLD, fontSize: 19, color: PARCHMENT, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: '#A9BCD0', textAlign: 'center', maxWidth: 320, lineHeight: 20 },
  footNote: { marginTop: spacing.md, fontSize: 11.5, color: MUTED, textAlign: 'center' },
});

export default BibleQuiz;
