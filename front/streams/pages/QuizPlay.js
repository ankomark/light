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
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  startQuizSession, answerQuizSession, finishQuizSession,
} from '../services/api';
import { useI18n } from '../context/I18nContext';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import {
  setSoundEnabled, tapFeedback, correctFeedback, wrongFeedback, tickFeedback,
  finishFeedback, streakFeedback, playLoop, stopLoop, unload as unloadSound,
} from '../services/quizSound';
import {
  Backdrop, Coin, Coins, quizStyles as q, DISPLAY, DISPLAY_MID, SERIF, SERIF_BOLD,
  GOLD, GOLD_DEEP, PARCHMENT, MUTED, INK, RIGHT, WRONG, DIFFICULTY_TINT, mmss,
} from './quizTheme';

const QuizPlay = ({ navigation, route }) => {
  const { t } = useI18n();
  const { preferences, setPreference } = usePreferences();
  const mode = route?.params?.mode === 'streak' ? 'streak' : 'speed';
  const soundOn = preferences?.[PREF_KEYS.quizSound] !== false;

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState(null);
  const [feedback, setFeedback] = useState(null);   // the server's verdict
  const [sending, setSending] = useState(false);
  const [remaining, setRemaining] = useState(null); // speed mode only
  // The question on screen is pinned here rather than read from the session:
  // answering removes it from the session's list, and the feedback view still
  // needs to show the choices it was asked about.
  const [question, setQuestion] = useState(null);
  const shownAt = useRef(Date.now());
  const config = session?.mode_config || {};
  const limit = config.time_limit;
  const finished = !!session?.is_finished;

  const begin = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setFeedback(null);
      setChosen(null);
      const started = await startQuizSession(mode);
      setSession(started);
      setQuestion(started.questions?.[0] || null);
      shownAt.current = Date.now();
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || t('quiz.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [mode, t]);

  useEffect(() => { begin(); }, [begin]);

  // The service holds the switch so it need not be threaded through every call.
  useEffect(() => {
    setSoundEnabled(soundOn);
    // The music follows the same switch as everything else.
    if (soundOn) playLoop(); else stopLoop();
  }, [soundOn]);
  // Leaving the screen must never leave music playing behind it.
  useEffect(() => () => { stopLoop(); unloadSound(); }, []);

  // Each question gets its own clock.
  useEffect(() => {
    shownAt.current = Date.now();
    setRemaining(limit ?? null);
  }, [question?.id, limit]);

  const send = useCallback(async (choice) => {
    if (sending || !question || !session) return;
    const seconds = Number(((Date.now() - shownAt.current) / 1000).toFixed(1));
    try {
      setSending(true);
      setChosen(choice);
      tapFeedback();
      const res = await answerQuizSession(session.id, question.id, choice, seconds);
      setFeedback(res);
      // Driven by the server's verdict, so the sound can never contradict the
      // score. A milestone run gets a firmer tap on top.
      if (res.correct) {
        correctFeedback();
        if (res.session?.streak && res.session.streak % 5 === 0) streakFeedback();
      } else {
        wrongFeedback();
      }
      if (res.session?.is_finished) finishFeedback();
      // Session updates (points, streak, remaining questions) but `question`
      // deliberately does not — it stays put until Next.
      setSession(res.session);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || t('quiz.submitFailed'));
      setChosen(null);
    } finally {
      setSending(false);
    }
  }, [sending, question, session, t]);

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

  const next = () => {
    setFeedback(null);
    setChosen(null);
    setQuestion(session?.questions?.[0] || null);
    shownAt.current = Date.now();
    setRemaining(limit ?? null);
  };

  const quit = () => {
    if (finished || !session) { navigation.goBack(); return; }
    Alert.alert(t('quiz.quitTitle'), t('quiz.quitBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('quiz.quitConfirm'),
        style: 'destructive',
        onPress: async () => {
          try { await finishQuizSession(session.id); } catch { /* leaving anyway */ }
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

  if (error && !session) {
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
    return (
      <View style={q.root}>
        <Backdrop />
        <SafeAreaView style={q.flex} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.overScroll} showsVerticalScrollIndicator={false}>
            <Text style={q.eyebrow}>{config.label}</Text>
            <Text style={styles.overTitle}>
              {isStreak ? t('quiz.runEnded') : t('quiz.timeUp')}
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

            <TouchableOpacity style={[q.primaryBtn, styles.wide]} onPress={begin} activeOpacity={0.85}>
              <Text style={q.primaryBtnText}>{t('quiz.playAgain')}</Text>
            </TouchableOpacity>
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

        <View style={q.header}>
          <TouchableOpacity onPress={quit} style={q.iconBtn} hitSlop={10}>
            <Ionicons name="close" size={22} color="#7E8DA3" />
          </TouchableOpacity>
          <Text style={q.headerTitle}>{config.label}</Text>
          <TouchableOpacity
            onPress={() => setPreference(PREF_KEYS.quizSound, !soundOn)}
            style={q.iconBtn}
            hitSlop={10}
            accessibilityLabel={t(soundOn ? 'quiz.soundOff' : 'quiz.soundOn')}
          >
            <Ionicons
              name={soundOn ? 'volume-medium' : 'volume-mute'}
              size={19}
              color={soundOn ? GOLD : MUTED}
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

          <View style={styles.choices}>
            {question.choices.map((choice, i) => {
              // Once answered the truth is shown: the right one green, and the
              // one that was picked red if it was wrong.
              const isRight = answered && i === feedback.answer_index;
              const isMyWrong = answered && i === chosen && !feedback.correct;
              const selected = !answered && chosen === i;
              return (
                <TouchableOpacity
                  key={`${question.id}-${i}`}
                  style={[
                    q.choice,
                    selected && q.choiceActive,
                    isRight && q.choiceRight,
                    isMyWrong && q.choiceWrong,
                  ]}
                  onPress={() => send(i)}
                  disabled={answered || sending}
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
            </View>
          )}
        </ScrollView>

        {answered && !finished && (
          <View style={styles.footer}>
            <TouchableOpacity style={[q.primaryBtn, styles.wide]} onPress={next} activeOpacity={0.85}>
              <Text style={q.primaryBtnText}>{t('quiz.next')}</Text>
              <Ionicons name="arrow-forward" size={16} color={INK} />
            </TouchableOpacity>
          </View>
        )}

      </SafeAreaView>
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
