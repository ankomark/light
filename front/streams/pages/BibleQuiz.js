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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchDailyQuiz, submitDailyQuiz, fetchQuizLeaderboard,
} from '../services/api';
import { useAuth } from '../context/useAuth';
import { colors, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import {
  setSoundEnabled, setMusicEnabled, tapFeedback, finishFeedback, playLoop, stopLoop,
  unload as unloadSound,
} from '../services/quizSound';
import { loadDraft, saveDraft, clearDraft } from '../utils/quizDraft';
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

const mmss = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const BibleQuiz = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
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
  const startedAt = useRef(Date.now());
  // When the current question first appeared, and how long each one took.
  // The server uses these for the speed bonus (clamped there, so a wrong
  // clock cannot mint points).
  const questionShownAt = useRef(Date.now());
  const spent = useRef({});

  const loadBoard = useCallback(async () => {
    try { setBoard(await fetchQuizLeaderboard()); } catch { /* a nicety, not the quiz */ }
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await fetchDailyQuiz();
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
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || t('quiz.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, loadBoard]);

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

  const resultsById = useMemo(() => {
    const map = {};
    (outcome?.results || []).forEach((r) => { map[r.question_id] = r; });
    return map;
  }, [outcome]);

  const myRank = useMemo(() => {
    const rows = board?.results || [];
    const i = rows.findIndex((r) => r.user?.username === currentUser?.username);
    return i === -1 ? null : i + 1;
  }, [board, currentUser]);

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
    try {
      setSubmitting(true);
      bankTime();
      const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
      // {id: {choice, seconds}} — the shape the scoring engine reads.
      const payload = {};
      Object.entries(answers).forEach(([id, choice]) => {
        payload[id] = { choice, seconds: Number((spent.current[id] || 0).toFixed(1)) };
      });
      const res = await submitDailyQuiz(payload, seconds);
      setOutcome(res);
      clearDraft();
      finishFeedback();
      loadBoard();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || t('quiz.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

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
    const band = accuracy >= 80 ? 'high' : accuracy >= 50 ? 'mid' : 'low';

    return (
      <View style={styles.root}>
        <Backdrop />
        <SafeAreaView style={styles.flex} edges={['top']}>
          <ScrollView contentContainerStyle={styles.resultScroll} showsVerticalScrollIndicator={false}>

            <View style={styles.resultHead}>
              <Text style={styles.eyebrow}>{quiz?.date}</Text>
              <Text style={styles.resultTitle}>{t('quiz.title')}</Text>
            </View>

            <View style={styles.medallionOuter}>
              <View style={styles.medallionInner}>
                <View style={styles.scoreRow}>
                  <Text style={styles.scoreValue}>{score}</Text>
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
              </View>
            </View>
            <Text style={styles.timeNote}>{t('quiz.tookTime', { time: mmss(seconds) })}</Text>

            {!!board?.results?.length && (
              <View style={styles.boardCard}>
                <Text style={styles.eyebrow}>{t('quiz.leaderboard')}</Text>
                {board.results.slice(0, 8).map((row, i) => {
                  const isMe = row.user?.username === currentUser?.username;
                  return (
                    <View style={[styles.boardRow, isMe && styles.boardRowMe]} key={row.id}>
                      <Text style={[styles.boardRank, isMe && styles.goldText]}>{i + 1}</Text>
                      <Text style={[styles.boardName, isMe && styles.boardNameMe]} numberOfLines={1}>
                        {row.user?.username}
                      </Text>
                      <Text style={styles.boardCorrect}>{row.score}/{row.total}</Text>
                      <Coins value={row.points} size={19} textSize={15} />
                    </View>
                  );
                })}
              </View>
            )}

            {!!outcome && (
              <View style={styles.reviewBlock}>
                <Text style={styles.eyebrow}>{t('quiz.review')}</Text>
                {questions.map((q, i) => {
                  const r = resultsById[q.id];
                  const chosen = r?.chosen_index;
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
                      {!!q.passage && <Text style={styles.reviewPassage}>{q.passage}</Text>}
                      <Text style={styles.reviewAnswer}>
                        {t('quiz.answerWas')}{' '}
                        <Text style={styles.reviewAnswerBold}>{q.choices[r?.answer_index]}</Text>
                        {chosen != null && !r?.correct
                          ? ` · ${t('quiz.youSaid')} ${q.choices[chosen]}`
                          : ''}
                      </Text>
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
              onPress={() => navigation.goBack()}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>{t('common.done')}</Text>
            </TouchableOpacity>
            <Text style={styles.footNote}>{t('quiz.comeBackTomorrow')}</Text>

          </ScrollView>
        </SafeAreaView>
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
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}>
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
          <Text style={styles.progressText}>
            {String(index + 1).padStart(2, '0')} / {questions.length}
          </Text>
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

        <View style={styles.footer}>
          {index > 0 && (
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => { bankTime(); setIndex((i) => Math.max(0, i - 1)); }}
              activeOpacity={0.85}
            >
              <Ionicons name="chevron-back" size={18} color="#A9BCD0" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.primaryBtn, styles.grow, submitting && styles.disabled]}
            onPress={onLast ? submit : () => { bankTime(); setIndex((i) => Math.min(questions.length - 1, i + 1)); }}
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
