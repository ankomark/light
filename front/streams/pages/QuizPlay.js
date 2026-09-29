/**
 * Speed Quiz and Streak — one screen, the mode supplies the rules.
 *
 * These play differently from the daily quiz: you answer one question at a time
 * and are told immediately, because Streak has to end the moment you are wrong
 * and Speed has to time each question on its own.
 *
 * The countdown here drives the UI only. The server decides whether a slow
 * answer counts, so a paused or fiddled clock cannot buy points.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Share, Animated,
} from 'react-native';
import useReducedMotion from '../utils/useReducedMotion';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  startQuizSession, answerQuizSession, finishQuizSession, buyQuizHint,
} from '../services/api';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import { quizLanguage } from '../utils/quizCache';
import WhySheet from '../components/WhySheet';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import {
  setSoundEnabled, setMusicEnabled, tapFeedback, correctFeedback, wrongFeedback, tickFeedback,
  finishFeedback, streakFeedback, playLoop, stopLoop, unload as unloadSound,
} from '../services/quizSound';
import {
  Backdrop, Coin, Coins, quizStyles as q, DISPLAY, DISPLAY_MID, SERIF, SERIF_BOLD,
  GOLD, GOLD_DEEP, PARCHMENT, MUTED, INK, RIGHT, WRONG, DIFFICULTY_TINT, mmss,
} from './quizTheme';

/**
 * A friend's challenge, from the link they sent (streams://quiz/speed?from=
 * mark&score=180): whose it is and what to beat. Only what a link can be
 * trusted with — a short name, a whole number — or nothing.
 */
export const challengeFrom = (params) => {
  const from = String(params?.from || '').trim().slice(0, 30);
  const score = Number(params?.score);
  if (!from || !Number.isInteger(score) || score < 0 || score > 100000) return null;
  return { from, score };
};

/** The link that challenges someone to beat `score` in `mode`. */
export const challengeLink = (mode, username, score) =>
  `streams://quiz/${mode}?from=${encodeURIComponent(username || '')}&score=${score}`;

const QuizPlay = ({ navigation, route }) => {
  const { t, resolvedLanguage } = useI18n();
  const { preferences, setPreference } = usePreferences();
  const MODES_PLAYED = ['speed', 'streak', 'review', 'section'];
  const mode = MODES_PLAYED.includes(route?.params?.mode) ? route.params.mode : 'speed';
  const category = mode === 'section' ? route?.params?.category : undefined;
  // What the run is called on screen: the section's own name, else the mode's.
  const title = (label) => (category ? t(`quiz.section.${category}`) : t(`quiz.mode.${mode}`) || label);
  const { currentUser } = useAuth();
  const lang = quizLanguage(resolvedLanguage);
  const challenge = challengeFrom(route?.params);
  const soundOn = preferences?.[PREF_KEYS.quizSound] !== false;
  const musicOn = preferences?.[PREF_KEYS.quizMusic] !== false;

  // The run as the server started it: its id, rules and every question —
  // with their answers, so a tap is judged here and now (see
  // PracticeQuestionSerializer on the server). What changes as you play lives
  // beside it: which question you are on, and the running totals.
  const [run, setRun] = useState(null);
  const [qi, setQi] = useState(0);
  const [totals, setTotals] = useState(null);
  const [points, setPoints] = useState(0);          // coins, as the server confirms them
  const [over, setOver] = useState(false);          // the last answer is in
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState(null);
  const [feedback, setFeedback] = useState(null);   // the verdict on the question shown
  const [remaining, setRemaining] = useState(null); // speed mode only
  const [whyOpen, setWhyOpen] = useState(false);
  // 50/50 on the question shown: the choices taken away, and how the buying went.
  const [hint, setHint] = useState({ qid: null, removed: [], busy: false, error: '' });
  const reduceMotion = useReducedMotion();
  const comboPop = useRef(new Animated.Value(1)).current;
  const shownAt = useRef(Date.now());
  // Answers go to the server one after another, behind the play: the chain is
  // what results wait on, so the totals shown at the end are the server's.
  const chain = useRef(Promise.resolve());
  const question = run?.questions?.[qi] || null;
  const config = run?.mode_config || {};
  const limit = config.time_limit;
  const finished = showResults;
  // What the rest of the screen reads: the run, with the totals as they stand.
  const session = run && totals ? {
    ...run, ...totals, points, is_finished: showResults,
  } : null;

  const begin = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setFeedback(null);
      setChosen(null);
      setOver(false);
      setShowResults(false);
      chain.current = Promise.resolve();
      const started = await startQuizSession(mode, lang, { category });
      setRun(started);
      setQi(0);
      setTotals({
        score: started.score || 0, answered: started.answered || 0,
        streak: started.streak || 0, longest_streak: started.longest_streak || 0,
        total_questions: started.total_questions,
      });
      setPoints(started.points || 0);
      // A run already over (nothing left to ask): straight to its results.
      if (started.is_finished || !started.questions?.length) setShowResults(true);
      shownAt.current = Date.now();
    } catch (e) {
      const code = e?.response?.data?.code || e?.data?.code;
      setError(code === 'nothing_due' ? t('quiz.reviewNothingDue') : t('quiz.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [mode, t, lang, category]);

  useEffect(() => { begin(); }, [begin]);

  // The service holds the switch so it need not be threaded through every call.
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

  // Each question gets its own clock.
  useEffect(() => {
    shownAt.current = Date.now();
    setRemaining(limit ?? null);
  }, [question?.id, limit]);

  // Record an answer on the server, in order, behind the play. The server's
  // coins (and, if it ever disagrees, its verdict) replace the app's when
  // they arrive; a failed send is tried once more, then left — the run goes on.
  const record = useCallback((qid, choice, seconds) => {
    const post = () => answerQuizSession(run.id, qid, choice, seconds, { brief: true });
    chain.current = chain.current
      .then(() => post().catch(() => post()))
      .then((res) => {
        if (!res) return;
        setPoints(res.session?.points ?? 0);
        setTotals((cur) => (cur ? {
          ...cur,
          score: res.session?.score ?? cur.score,
          longest_streak: res.session?.longest_streak ?? cur.longest_streak,
        } : cur));
        setFeedback((f) => (f && f.qid === qid
          ? { ...f, points_earned: res.points_earned, correct: res.correct, timed_out: res.timed_out }
          : f));
      })
      .catch(() => { /* offline: the run carries on; results show what the server has */ });
  }, [run]);

  const send = useCallback(async (choice) => {
    if (feedback || !question || !run) return;
    const seconds = Number(((Date.now() - shownAt.current) / 1000).toFixed(1));
    setChosen(choice);
    tapFeedback();

    // A server from before instant answers sends no answer: wait for its word.
    if (typeof question.answer_index !== 'number') {
      try {
        const res = await answerQuizSession(run.id, question.id, choice, seconds);
        setFeedback({ ...res, qid: question.id });
        if (res.correct) correctFeedback(); else wrongFeedback();
        setPoints(res.session?.points ?? 0);
        setTotals((cur) => ({ ...cur, ...res.session }));
        if (res.session?.is_finished) { finishFeedback(); setOver(true); }
      } catch (e) {
        setError(e?.response?.data?.error || e?.message || t('quiz.submitFailed'));
        setChosen(null);
      }
      return;
    }

    // Judged here, at once. The rules are the server's: out of time is wrong.
    const timedOut = !!limit && (choice === null || seconds > limit);
    const correct = !timedOut && choice !== null && choice === question.answer_index;
    setFeedback({
      qid: question.id, correct, timed_out: timedOut,
      answer_index: question.answer_index,
      reference: question.reference, explanation: question.explanation,
      points_earned: null,                              // the server's to say
    });
    const streak = correct ? (totals?.streak || 0) + 1 : 0;
    const answered = (totals?.answered || 0) + 1;
    const ends = (config.ends_on_wrong && !correct) || answered >= (run.questions?.length || 0);
    setTotals((cur) => ({
      ...cur,
      answered,
      streak,
      score: (cur?.score || 0) + (correct ? 1 : 0),
      longest_streak: Math.max(cur?.longest_streak || 0, streak),
    }));
    if (correct) {
      correctFeedback();
      if (streak % 5 === 0) streakFeedback();
    } else {
      wrongFeedback();
    }
    if (ends) { finishFeedback(); setOver(true); }
    record(question.id, choice, seconds);
  }, [feedback, question, run, limit, totals, config.ends_on_wrong, record, t]);

  // Speed mode: running out of time is an answer — sent as a non-choice so the
  // server records the timeout rather than the app silently skipping ahead.
  useEffect(() => {
    if (!limit || finished || feedback || !question) return undefined;
    let lastTick = null;
    const id = setInterval(() => {
      const left = limit - (Date.now() - shownAt.current) / 1000;
      setRemaining(Math.max(0, left));
      // One tick per second over the closing five — a countdown you can hear.
      const whole = Math.ceil(left);
      if (whole <= 5 && whole > 0 && whole !== lastTick) {
        lastTick = whole;
        tickFeedback();
      }
      if (left <= 0) {
        clearInterval(id);
        send(null);
      }
    }, 100);
    return () => clearInterval(id);
  }, [limit, finished, feedback, question, send]);

  const combo = totals?.streak || 0;
  useEffect(() => {
    if (combo < 3 || reduceMotion) return;
    comboPop.setValue(combo % 5 === 0 ? 1.5 : 1.25);
    Animated.spring(comboPop, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }).start();
  }, [combo, reduceMotion, comboPop]);

  // Two wrong answers taken away, for coins — the server charges and chooses.
  const buyHint = async () => {
    if (!question || !run || hint.busy) return;
    setHint({ qid: question.id, removed: [], busy: true, error: '' });
    try {
      const res = await buyQuizHint(run.id, question.id);
      tapFeedback();
      setHint({ qid: question.id, removed: res.removed || [], busy: false, error: '' });
    } catch (e) {
      const code = e?.response?.data?.code || e?.data?.code;
      setHint({
        qid: question.id, removed: [], busy: false,
        error: t(code === 'not_enough_coins' ? 'quiz.hint.noCoins' : 'quiz.hint.failed'),
      });
    }
  };
  const removed = hint.qid === question?.id ? hint.removed : [];

  const next = async () => {
    if (over) {
      // The results are the server's: let the last answers land first.
      await chain.current;
      setShowResults(true);
      return;
    }
    setFeedback(null);
    setChosen(null);
    setQi((i) => i + 1);
    shownAt.current = Date.now();
    setRemaining(limit ?? null);
  };

  const quit = () => {
    if (finished || !run) { navigation.goBack(); return; }
    Alert.alert(t('quiz.quitTitle'), t('quiz.quitBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('quiz.quitConfirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            await chain.current;
            await finishQuizSession(run.id);
          } catch { /* leaving anyway */ }
          navigation.goBack();
        },
      },
    ]);
  };

  // ── loading / error ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={q.root}>
        <Backdrop />
        <View style={q.centered}><ActivityIndicator size="large" color={GOLD} /></View>
      </View>
    );
  }

  if (error && !run) {
    return (
      <View style={q.root}>
        <Backdrop />
        <SafeAreaView style={q.flex} edges={['top', 'bottom']}>
          <View style={q.centered}>
            <Ionicons name="cloud-offline-outline" size={42} color={MUTED} />
            <Text style={q.emptyTitle}>{t('quiz.unavailable')}</Text>
            <Text style={q.emptyBody}>{error}</Text>
            <TouchableOpacity style={q.primaryBtn} onPress={begin} activeOpacity={0.85}>
              <Text style={q.primaryBtnText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── the run is over ───────────────────────────────────────────────────────
  if (finished) {
    const isStreak = mode === 'streak';
    // What a challenge measures: coins in Speed, the run itself in Streak.
    const mine = isStreak ? session.longest_streak : session.points;
    const unit = t(isStreak ? 'quiz.challenge.inARow' : 'quiz.challenge.coins');
    const sendChallenge = () => {
      Share.share({
        message: `${t('quiz.challenge.message', { score: mine, unit, mode: config.label })}\n${
          challengeLink(mode, currentUser?.username, mine)}`,
      }).catch(() => {});
    };
    return (
      <View style={q.root}>
        <Backdrop />
        <SafeAreaView style={q.flex} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.overScroll} showsVerticalScrollIndicator={false}>
            <Text style={q.eyebrow}>{title(config.label)}</Text>
            <Text style={styles.overTitle}>
              {isStreak ? t('quiz.runEnded')
                : mode === 'review' ? t('quiz.reviewDone')
                : mode === 'section' ? t('quiz.sectionDone')
                : t('quiz.timeUp')}
            </Text>

            <View style={styles.hero}>
              <Text style={styles.heroValue}>
                {isStreak ? session.longest_streak : session.score}
              </Text>
              <Text style={q.eyebrow}>
                {isStreak ? t('quiz.inARow') : t('quiz.outOf', { total: session.total_questions })}
              </Text>
            </View>

            <View style={styles.overStats}>
              <View style={styles.overStat}>
                <Coins value={session.points} size={28} textSize={21} />
                <Text style={q.eyebrow}>{t('quiz.stat.coins')}</Text>
              </View>
              <View style={styles.overDivider} />
              <View style={styles.overStat}>
                <Text style={styles.overStatValue}>{session.score}</Text>
                <Text style={q.eyebrow}>{t('quiz.stat.correct')}</Text>
              </View>
              <View style={styles.overDivider} />
              <View style={styles.overStat}>
                <Text style={styles.overStatValue}>{session.longest_streak}</Text>
                <Text style={q.eyebrow}>{t('quiz.stat.streak')}</Text>
              </View>
            </View>

            {!!challenge && (
              <View style={[styles.verdict, mine > challenge.score && styles.verdictWon]}
                    accessibilityLiveRegion="polite">
                <Ionicons name={mine > challenge.score ? 'trophy' : 'flag-outline'} size={16} color={GOLD} />
                <Text style={styles.verdictText}>
                  {mine > challenge.score
                    ? t('quiz.challenge.won', { name: challenge.from })
                    : t('quiz.challenge.lost', { name: challenge.from, gap: challenge.score - mine + 1 })}
                </Text>
              </View>
            )}

            <TouchableOpacity style={[q.primaryBtn, styles.wide]} onPress={begin} activeOpacity={0.85}>
              <Text style={q.primaryBtnText}>{t('quiz.playAgain')}</Text>
            </TouchableOpacity>
            {mine > 0 && (mode === 'speed' || mode === 'streak') && (
              <TouchableOpacity style={[q.ghostBtn, styles.wide]} onPress={sendChallenge}
                                activeOpacity={0.85} accessibilityRole="button">
                <Text style={q.ghostBtnText}>{t('quiz.challenge.send')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[q.ghostBtn, styles.wide]}
              onPress={() => navigation.goBack()}
              activeOpacity={0.85}
            >
              <Text style={q.ghostBtnText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  if (!question) {
    return (
      <View style={q.root}>
        <Backdrop />
        <View style={q.centered}><ActivityIndicator color={GOLD} /></View>
      </View>
    );
  }

  const tint = DIFFICULTY_TINT[question.difficulty] || DIFFICULTY_TINT.moderate;
  const answered = !!feedback;
  const timeFraction = limit ? Math.max(0, Math.min(1, (remaining ?? limit) / limit)) : 0;
  const urgent = limit && (remaining ?? limit) <= 5;

  return (
    <View style={q.root}>
      <Backdrop />
      <SafeAreaView style={q.flex} edges={['top', 'bottom']}>

        {!!challenge && (
          <View style={styles.challengeBar}>
            <Ionicons name="flag" size={13} color={GOLD} />
            <Text style={styles.challengeText} numberOfLines={1}>
              {t('quiz.challenge.beat', {
                name: challenge.from, score: challenge.score,
                unit: t(mode === 'streak' ? 'quiz.challenge.inARow' : 'quiz.challenge.coins'),
              })}
            </Text>
          </View>
        )}
        <View style={q.header}>
          <TouchableOpacity onPress={quit} style={q.iconBtn} hitSlop={10}>
            <Ionicons name="close" size={22} color="#7E8DA3" />
          </TouchableOpacity>
          <Text style={q.headerTitle}>{title(config.label)}</Text>
          <TouchableOpacity
            onPress={() => setPreference(PREF_KEYS.quizMusic, !musicOn)}
            style={q.iconBtn}
            hitSlop={10}
            accessibilityLabel={t(musicOn ? 'quiz.musicOff' : 'quiz.musicOn')}
          >
            <Ionicons
              name={musicOn ? 'musical-notes' : 'musical-notes-outline'}
              size={19}
              color={musicOn ? GOLD : MUTED}
            />
          </TouchableOpacity>
          <View style={q.iconBtn}>
            {mode === 'streak' ? (
              <View style={styles.streakChip}>
                <Ionicons name="flame" size={12} color={GOLD} />
                <Text style={styles.streakChipText}>{session.streak}</Text>
              </View>
            ) : (
              <Text style={styles.countText}>
                {session.answered + 1}/{session.total_questions}
              </Text>
            )}
          </View>
        </View>

        {/* Speed: a bar that drains. Streak: points so far. */}
        {limit ? (
          <View style={styles.timerWrap}>
            <View style={styles.timerTrack}>
              <LinearGradient
                colors={urgent ? [WRONG, '#ff8a86'] : [GOLD_DEEP, GOLD]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.timerFill, { width: `${timeFraction * 100}%` }]}
              />
            </View>
            <Text style={[styles.timerText, urgent && { color: WRONG }]}>
              {Math.ceil(remaining ?? limit)}
            </Text>
          </View>
        ) : (
          <View style={styles.pointsRow}>
            <Text style={q.eyebrow}>{t('quiz.stat.coins')}</Text>
            <Coins value={session.points} size={24} textSize={18} />
          </View>
        )}

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.difficultyChip, { backgroundColor: tint.bg }]}>
            <Text style={[styles.difficultyText, { color: tint.fg }]}>
              {t(`quiz.difficulty.${question.difficulty}`)}
            </Text>
          </View>

          {!!question.passage && (
            <View style={[q.verseCard, styles.gap]}>
              <Text style={q.quoteMark}>“</Text>
              <Text style={q.verseText}>{question.passage}</Text>
            </View>
          )}

          <Text style={q.prompt}>{question.prompt}</Text>

          {/* A run of right answers, counted where it is being made. */}
          {combo >= 3 && (
            <Animated.View style={[styles.combo, combo >= 5 && styles.comboBig, { transform: [{ scale: comboPop }] }]}
                           accessible accessibilityLiveRegion="polite"
                           accessibilityLabel={t('quiz.combo', { count: combo })}>
              <Ionicons name="flame" size={combo >= 5 ? 16 : 13} color={GOLD} />
              <Text style={[styles.comboText, combo >= 5 && styles.comboTextBig]}>
                {t('quiz.combo', { count: combo })}
              </Text>
            </Animated.View>
          )}

          {!answered && question.choices.length >= 3 && (
            <View style={styles.hintRow}>
              <TouchableOpacity
                style={[styles.hintBtn, (removed.length > 0 || hint.busy) && styles.hintBtnOff]}
                onPress={buyHint}
                disabled={removed.length > 0 || hint.busy}
                accessibilityRole="button"
                accessibilityLabel={t('quiz.hint.label', { cost: 15 })}
              >
                {hint.busy ? <ActivityIndicator size="small" color={GOLD} /> : (
                  <>
                    <Text style={styles.hintText}>50/50</Text>
                    <Coin size={14} />
                    <Text style={styles.hintCost}>15</Text>
                  </>
                )}
              </TouchableOpacity>
              {!!hint.error && hint.qid === question.id && (
                <Text style={styles.hintError}>{hint.error}</Text>
              )}
            </View>
          )}

          <View style={styles.choices}>
            {question.choices.map((choice, i) => {
              // Once answered the truth is shown: the right one green, and the
              // one that was picked red if it was wrong.
              const isRight = answered && i === feedback.answer_index;
              const isMyWrong = answered && i === chosen && !feedback.correct;
              const selected = !answered && chosen === i;
              const gone = removed.includes(i) && !answered;
              return (
                <TouchableOpacity
                  key={`${question.id}-${i}`}
                  style={[
                    q.choice,
                    selected && q.choiceActive,
                    isRight && q.choiceRight,
                    isMyWrong && q.choiceWrong,
                    gone && styles.choiceGone,
                  ]}
                  onPress={() => send(i)}
                  disabled={answered || gone}
                  accessibilityState={{ disabled: answered || gone }}
                  activeOpacity={0.85}
                >
                  <Text style={[q.choiceLetter, (selected || isRight) && q.gold]}>
                    {String.fromCharCode(65 + i)}
                  </Text>
                  <View style={q.choiceRule} />
                  <Text style={[q.choiceText, (selected || isRight) && q.choiceTextStrong]}>
                    {choice}
                  </Text>
                  {isRight && <Ionicons name="checkmark-circle" size={19} color={RIGHT} />}
                  {isMyWrong && <Ionicons name="close-circle" size={19} color={WRONG} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {answered && (
            <View style={styles.feedback}>
              <View style={styles.feedbackTop}>
                <Text style={[
                  styles.verdict,
                  { color: feedback.correct ? RIGHT : WRONG },
                ]}>
                  {feedback.timed_out
                    ? t('quiz.outOfTime')
                    : feedback.correct ? t('quiz.correct') : t('quiz.notQuite')}
                </Text>
                {feedback.points_earned > 0 && (
                  <View style={styles.earnedRow}>
                    <Coin size={19} />
                    <Text style={styles.earned}>+{feedback.points_earned}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.reference}>{feedback.reference}</Text>
              <Text style={styles.explanation}>{feedback.explanation}</Text>
              <TouchableOpacity
                style={styles.whyBtn}
                onPress={() => setWhyOpen(true)}
                accessibilityRole="button"
              >
                <Ionicons name="bulb-outline" size={15} color={GOLD} />
                <Text style={styles.whyText}>{t('quiz.why.button')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {answered && !finished && (
          <View style={styles.footer}>
            <TouchableOpacity style={[q.primaryBtn, styles.wide]} onPress={next} activeOpacity={0.85}>
              <Text style={q.primaryBtnText}>{over ? t('quiz.seeResults') : t('quiz.next')}</Text>
              <Ionicons name="arrow-forward" size={16} color={INK} />
            </TouchableOpacity>
          </View>
        )}

      </SafeAreaView>

      {/* The answer has to be on the server before it can be explained: the
          sheet waits for the answers being recorded behind the play. */}
      <WhySheet
        visible={whyOpen}
        onClose={() => setWhyOpen(false)}
        questionId={feedback?.qid}
        lang={run?.language || lang}
        ready={() => chain.current}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  gap: { marginTop: 14 },

  countText: { fontFamily: DISPLAY_MID, fontSize: 12, color: MUTED },
  streakChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(244,162,97,0.14)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.32)',
  },
  streakChipText: { fontFamily: DISPLAY, fontSize: 13, color: GOLD },

  timerWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 12,
  },
  timerTrack: {
    flex: 1, height: 6, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.09)', overflow: 'hidden',
  },
  timerFill: { height: 6, borderRadius: 3 },
  timerText: { fontFamily: DISPLAY, fontSize: 17, color: GOLD, minWidth: 26, textAlign: 'right' },

  pointsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12,
  },
  pointsValue: { fontFamily: DISPLAY, fontSize: 18, color: PARCHMENT },

  difficultyChip: {
    alignSelf: 'flex-start', height: 26, justifyContent: 'center',
    paddingHorizontal: 12, borderRadius: 13,
  },
  difficultyText: {
    fontFamily: DISPLAY_MID, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase',
  },

  choices: { marginTop: 16, gap: 10 },

  feedback: {
    marginTop: 18, padding: 16, borderRadius: 14, gap: 6,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.09)',
  },
  feedbackTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verdict: { fontFamily: DISPLAY, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' },
  earnedRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  earned: { fontFamily: DISPLAY, fontSize: 15, color: GOLD },
  reference: { fontFamily: DISPLAY_MID, fontSize: 12, color: MUTED, letterSpacing: 0.6 },
  explanation: { fontFamily: SERIF, fontSize: 14.5, lineHeight: 24, color: '#C6CBD2' },

  footer: {
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  wide: { alignSelf: 'stretch' },
  combo: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    marginTop: 10, paddingHorizontal: 10, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(244,162,97,0.14)',
  },
  comboBig: { height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: 'rgba(244,162,97,0.24)' },
  comboText: { fontFamily: DISPLAY_MID, fontSize: 11.5, letterSpacing: 0.6, color: GOLD },
  comboTextBig: { fontFamily: DISPLAY, fontSize: 14 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  hintBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 14,
    borderRadius: 18, borderWidth: 1, borderColor: 'rgba(244,162,97,0.45)',
  },
  hintBtnOff: { opacity: 0.45 },
  hintText: { fontFamily: DISPLAY, fontSize: 12, letterSpacing: 0.8, color: GOLD },
  hintCost: { fontFamily: DISPLAY_MID, fontSize: 12, color: GOLD },
  hintError: { flex: 1, fontSize: 12, color: '#A9BCD0' },
  choiceGone: { opacity: 0.25 },
  whyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    minHeight: 36, paddingHorizontal: 12, marginTop: 8, borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.45)',
  },
  whyText: { fontFamily: DISPLAY_MID, fontSize: 11.5, letterSpacing: 0.6, color: GOLD },
  challengeBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 20, marginTop: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: 'rgba(244,162,97,0.12)',
  },
  challengeText: { fontFamily: DISPLAY_MID, fontSize: 11.5, letterSpacing: 0.4, color: GOLD },
  verdict: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch',
    padding: 12, borderRadius: 14, marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  verdictWon: { backgroundColor: 'rgba(244,162,97,0.14)', borderColor: GOLD_DEEP },
  verdictText: { flex: 1, fontSize: 14, color: PARCHMENT },

  overScroll: { padding: 24, paddingTop: 48, alignItems: 'center', gap: 10 },
  overTitle: { fontFamily: SERIF_BOLD, fontSize: 25, color: PARCHMENT, textAlign: 'center' },
  hero: { alignItems: 'center', marginTop: 22, marginBottom: 8 },
  heroValue: { fontFamily: DISPLAY, fontSize: 66, color: GOLD, lineHeight: 74 },
  overStats: {
    flexDirection: 'row', alignSelf: 'stretch', marginTop: 12, marginBottom: 20,
    paddingVertical: 16, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.09)',
  },
  overStat: { flex: 1, alignItems: 'center', gap: 4 },
  overDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.09)' },
  overStatValue: { fontFamily: DISPLAY, fontSize: 21, color: PARCHMENT },
});

export default QuizPlay;
