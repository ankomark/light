/**
 * Where the quiz starts: pick a mode.
 *
 * The daily quiz is the headline — it is shared, ranked, and gone once played.
 * Speed and Streak sit below it as practice you can return to, each showing
 * your own best so there is something to beat.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fetchDailyQuiz, fetchQuizBests, fetchQuizStats, buyStreakFreeze, fetchQuizProgress } from '../services/api';
import { peekCache, writeCache, userKey } from '../utils/screenCache';
import { confirmAction, notify } from '../utils/adminConfirm';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import useCachedData from '../utils/useCachedData';
import { quizKeys, quizLanguage, isToday, formatQuizDay } from '../utils/quizCache';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Coin, Coins, quizStyles as q, DISPLAY, DISPLAY_MID, SERIF, SERIF_BOLD,
  GOLD, GOLD_DEEP, PARCHMENT, MUTED, INK,
} from './quizTheme';

const QuizHome = ({ navigation }) => {
  const { t, resolvedLanguage } = useI18n();
  const { currentUser } = useAuth();
  const lang = quizLanguage(resolvedLanguage);
  const keys = quizKeys(currentUser?.id, lang);

  // Each painted from the last copy at once, then refreshed behind it — the
  // pattern Home and Music use. Each on its own: one failing must not blank
  // the screen. The daily one is also what the quiz itself opens on.
  const dailyData = useCachedData(keys.daily, () => fetchDailyQuiz(undefined, lang));
  const bestsData = useCachedData(keys.bests, fetchQuizBests);
  const statsData = useCachedData(keys.stats, fetchQuizStats);
  const bests = bestsData.data;
  const stats = statsData.data;
  // Yesterday's kept quiz, with yesterday's "played" mark, is not today's.
  const daily = isToday(dailyData.data) ? dailyData.data : null;

  // Back from a quiz or a run: the coins and the "played" mark have moved, so
  // refresh quietly — the kept copy stays on screen meanwhile. The first
  // focus is the mount, which loads already.
  const focusedBefore = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!focusedBefore.current) { focusedBefore.current = true; return; }
    dailyData.reload();
    bestsData.reload();
    statsData.reload();
  }, [dailyData.reload, bestsData.reload, statsData.reload])); // eslint-disable-line react-hooks/exhaustive-deps

  // A day streak that broke yesterday can be bought back with coins, once a
  // week — offered here, where the streak is shown.
  const freeze = stats?.freeze;
  const [freezing, setFreezing] = useState(false);
  const restore = async () => {
    const go = await confirmAction({
      title: t('quiz.freeze.confirmTitle', { count: freeze.run }),
      message: t('quiz.freeze.confirmBody', { cost: freeze.cost }),
      confirmLabel: t('quiz.freeze.restore'),
      cancelLabel: t('common.cancel'),
    });
    if (!go) return;
    setFreezing(true);
    try {
      await buyStreakFreeze();
      notify(t('quiz.freeze.doneTitle'), t('quiz.freeze.doneBody', { count: freeze.run + 1 }));
    } catch (e) {
      const code = e?.response?.data?.code || e?.data?.code;
      notify(t('common.error'), t(code === 'not_enough_coins' ? 'quiz.freeze.noCoins' : 'quiz.freeze.gone'));
    } finally {
      setFreezing(false);
      statsData.reload();
    }
  };

  // "Your progress" should open on its data, not a spinner: load it quietly
  // while the hub is up, once a session.
  useEffect(() => {
    const key = userKey(currentUser?.id, 'quiz:progress');
    if (peekCache(key)) return;
    // Inside the chain, so even a failure to start is only a missed head start.
    Promise.resolve().then(fetchQuizProgress).then((data) => writeCache(key, data)).catch(() => {});
  }, [currentUser?.id]);

  // The section to recommend: the weakest where there is enough to judge,
  // from the progress already loaded (none until then).
  const progress = peekCache(userKey(currentUser?.id, 'quiz:progress'));
  const weakest = weakestSection(progress?.strengths);

  const played = !!daily?.my_attempt;
  const nothingYet = !dailyData.data && !bests && !stats;
  const allFailed = dailyData.failed && bestsData.failed && statsData.failed;

  if (nothingYet && !allFailed) {
    return (
      <View style={q.rootClear}>
        <View style={q.centered}><ActivityIndicator size="large" color={GOLD} /></View>
      </View>
    );
  }

  return (
    <View style={q.rootClear}>
      <View style={q.flex}>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          <Text style={q.pageTitle}>{t('quiz.homeTitle')}</Text>

          {/* Everything earned so far, and how far it has carried you */}
          {!!stats && (
            <View style={styles.walletCard}>
              <View style={styles.walletTop}>
                <View>
                  <Text style={q.eyebrow}>{t('quiz.stats.totalCoins')}</Text>
                  <Coins value={stats.total_coins} size={46} textSize={30} style={styles.walletCoins} />
                </View>
                <View style={styles.walletTopRight}>
                  {stats.day_streak > 0 && (
                    <View style={[styles.dayStreak, !stats.played_today && styles.dayStreakPending]}>
                      <Ionicons
                        name="flame"
                        size={14}
                        color={stats.played_today ? GOLD : MUTED}
                      />
                      <Text style={[
                        styles.dayStreakValue,
                        !stats.played_today && styles.dayStreakValuePending,
                      ]}>
                        {stats.day_streak}
                      </Text>
                    </View>
                  )}
                  <View style={styles.levelBadge}>
                    <Text style={styles.levelNumber}>{stats.level}</Text>
                    <Text style={styles.levelWord}>{t('quiz.stats.level')}</Text>
                  </View>
                </View>
              </View>

              {stats.day_streak > 0 && (
                <Text style={styles.streakNote}>
                  {stats.played_today
                    ? t('quiz.stats.streakDays', { count: stats.day_streak })
                    : t('quiz.stats.streakAtRisk', { count: stats.day_streak })}
                </Text>
              )}

              <View style={styles.progressTrack}>
                <LinearGradient
                  colors={[GOLD_DEEP, GOLD]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.progressFill, { width: `${(stats.level_progress || 0) * 100}%` }]}
                />
              </View>
              <Text style={styles.progressNote}>
                {t('quiz.stats.toNext', { coins: stats.coins_to_next, level: stats.level + 1 })}
              </Text>

              <View style={styles.walletStats}>
                <View style={styles.walletStat}>
                  <Text style={styles.walletStatValue}>{stats.days_played}</Text>
                  <Text style={q.eyebrow}>{t('quiz.stats.days')}</Text>
                </View>
                <View style={styles.walletDivider} />
                <View style={styles.walletStat}>
                  <Text style={styles.walletStatValue}>{stats.best_day}</Text>
                  <Text style={q.eyebrow}>{t('quiz.stats.bestDay')}</Text>
                </View>
                <View style={styles.walletDivider} />
                <View style={styles.walletStat}>
                  <Text style={styles.walletStatValue}>{stats.best_run}</Text>
                  <Text style={q.eyebrow}>{t('quiz.stats.bestRun')}</Text>
                </View>
              </View>
            </View>
          )}

          {!!stats && (
            <TouchableOpacity
              style={styles.progressLink}
              onPress={() => navigation.navigate('QuizProgress')}
              accessibilityRole="button"
            >
              <Ionicons name="stats-chart" size={15} color={GOLD} />
              <Text style={styles.progressLinkText}>{t('quiz.progress.title')}</Text>
              <Ionicons name="chevron-forward" size={16} color={MUTED} />
            </TouchableOpacity>
          )}

          {!!freeze?.available && (
            <View style={styles.freezeCard} testID="freeze-offer">
              <View style={styles.freezeTop}>
                <Ionicons name="snow" size={18} color={ICE} />
                <Text style={styles.freezeTitle}>{t('quiz.freeze.title', { count: freeze.run })}</Text>
              </View>
              <Text style={styles.freezeBody}>{t('quiz.freeze.body', { cost: freeze.cost })}</Text>
              <TouchableOpacity
                style={[styles.freezeBtn, (!freeze.affordable || freezing) && styles.freezeBtnOff]}
                onPress={restore}
                disabled={!freeze.affordable || freezing}
                accessibilityRole="button"
                accessibilityState={{ disabled: !freeze.affordable || freezing }}
              >
                {freezing ? <ActivityIndicator size="small" color={INK} /> : (
                  <>
                    <Coin size={16} />
                    <Text style={styles.freezeBtnText}>
                      {freeze.affordable
                        ? t('quiz.freeze.restoreFor', { cost: freeze.cost })
                        : t('quiz.freeze.short', { count: freeze.cost - freeze.balance })}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Questions once missed, due to come back. */}
          {stats?.review_due > 0 && (
            <TouchableOpacity
              style={styles.reviewCard}
              onPress={() => navigation.navigate('QuizPlay', { mode: 'review' })}
              accessibilityRole="button"
              testID="review-card"
            >
              <Ionicons name="refresh-circle" size={30} color={GOLD} />
              <View style={styles.modeBody}>
                <Text style={styles.modeTitle}>{t('quiz.reviewTitle')}</Text>
                <Text style={styles.modeText}>{t('quiz.reviewBody', { count: stats.review_due })}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={MUTED} />
            </TouchableOpacity>
          )}

          {/* Daily — the headline */}
          <TouchableOpacity
            style={styles.dailyCard}
            onPress={() => navigation.navigate('BibleQuiz')}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel={`${t('quiz.title')}. ${played ? t('quiz.home.seeResult') : t('quiz.home.play')}`}
          >
            <View style={styles.dailyTop}>
              <Text style={q.eyebrow}>{formatQuizDay(daily?.date)}</Text>
              {played && (
                <View style={styles.doneChip}>
                  <Ionicons name="checkmark" size={11} color={GOLD} />
                  <Text style={styles.doneChipText}>
                    {daily.my_attempt.score}/{daily.my_attempt.total}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.dailyTitle}>{t('quiz.title')}</Text>
            <Text style={styles.dailyBody}>
              {played ? t('quiz.home.dailyDone') : t('quiz.home.dailyBody')}
            </Text>
            <View style={styles.dailyCta}>
              <Text style={styles.dailyCtaText}>
                {played ? t('quiz.home.seeResult') : t('quiz.home.play')}
              </Text>
              <Ionicons name="arrow-forward" size={15} color={GOLD} />
            </View>
          </TouchableOpacity>

          <Text style={[q.eyebrow, styles.sectionLabel]}>{t('quiz.home.practice')}</Text>

          <ModeCard
            icon="flash"
            title={t('quiz.home.speedTitle')}
            body={t('quiz.home.speedBody')}
            best={bests?.speed}
            bestLabel={t('quiz.home.bestCoins')}
            bestValue={bests?.speed?.best_points}
            coins
            onPress={() => navigation.navigate('QuizPlay', { mode: 'speed' })}
            t={t}
          />

          <ModeCard
            icon="flame"
            title={t('quiz.home.streakTitle')}
            body={t('quiz.home.streakBody')}
            best={bests?.streak}
            bestLabel={t('quiz.home.bestRun')}
            bestValue={bests?.streak?.best_streak}
            onPress={() => navigation.navigate('QuizPlay', { mode: 'streak' })}
            t={t}
          />

          {/* One part of the Bible at a time; the weakest, from your progress, marked. */}
          <Text style={[q.eyebrow, styles.sectionLabel]}>{t('quiz.sections')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.chips} testID="section-chips">
            {SECTIONS.map((sec) => {
              const recommended = sec === weakest;
              return (
                <TouchableOpacity
                  key={sec}
                  style={[styles.chip, recommended && styles.chipRecommended]}
                  onPress={() => navigation.navigate('QuizPlay', { mode: 'section', category: sec })}
                  accessibilityRole="button"
                  accessibilityLabel={recommended ? `${t(`quiz.section.${sec}`)}, ${t('quiz.recommended')}` : t(`quiz.section.${sec}`)}
                >
                  {recommended && <Ionicons name="star" size={12} color={GOLD} />}
                  <Text style={[styles.chipText, recommended && styles.chipTextRecommended]}>
                    {t(`quiz.section.${sec}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.note}>{t('quiz.home.note')}</Text>
        </ScrollView>
      </View>
    </View>
  );
};

export const SECTIONS = [
  'law', 'history', 'wisdom', 'major_prophets', 'minor_prophets',
  'gospels', 'acts', 'epistles', 'revelation',
];

/** The section most worth practising: lowest accuracy among those with at
 *  least five answers, when there are two or more to compare. */
export const weakestSection = (strengths) => {
  const judged = (strengths || []).filter((s) => s.answered >= 5);
  if (judged.length < 2) return null;
  return [...judged].sort((a, b) => a.accuracy - b.accuracy)[0].category;
};

const ModeCard = ({ icon, title, body, best, bestLabel, bestValue, coins, onPress, t }) => (
  <TouchableOpacity style={styles.modeCard} onPress={onPress} activeOpacity={0.88}
                    accessibilityRole="button" accessibilityLabel={`${title}. ${body}`}>
    <View style={styles.modeIcon}>
      <Ionicons name={icon} size={20} color={GOLD} />
    </View>
    <View style={styles.modeBody}>
      <Text style={styles.modeTitle}>{title}</Text>
      <Text style={styles.modeText}>{body}</Text>
      {!bestLabel ? null : best?.played > 0 ? (
        <View style={styles.bestRow}>
          <Text style={styles.modeBest}>{bestLabel}</Text>
          {coins
            ? <Coins value={bestValue} size={18} textSize={13} />
            : <Text style={styles.modeBestValue}>{bestValue}</Text>}
          <Text style={styles.modePlayed}>
            {t('quiz.home.played', { count: best.played })}
          </Text>
        </View>
      ) : (
        <Text style={styles.modeBest}>{t('quiz.home.notPlayed')}</Text>
      )}
    </View>
    <Ionicons name="chevron-forward" size={18} color={MUTED} />
  </TouchableOpacity>
);

const ICE = '#8EC5FF';

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40, gap: 12 },

  reviewCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14,
    backgroundColor: '#05080E',
    borderWidth: 1, borderColor: 'rgba(244,162,97,0.45)',
  },
  chips: { gap: 8, paddingVertical: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 38, paddingHorizontal: 14,
    borderRadius: 19, backgroundColor: '#05080E',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)',
  },
  chipRecommended: { borderColor: GOLD, backgroundColor: 'rgba(244,162,97,0.12)' },
  chipText: { fontFamily: DISPLAY_MID, fontSize: 11.5, letterSpacing: 0.5, color: PARCHMENT },
  chipTextRecommended: { color: GOLD },

  progressLink: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16,
    borderRadius: 14, backgroundColor: '#05080E',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  progressLinkText: { flex: 1, fontFamily: DISPLAY_MID, fontSize: 12.5, letterSpacing: 0.6, color: PARCHMENT },

  freezeCard: {
    padding: 16, gap: 8, borderRadius: 16, backgroundColor: '#05080E',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(142,197,255,0.45)',
  },
  freezeTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  freezeTitle: { flex: 1, fontFamily: SERIF_BOLD, fontSize: 16, color: PARCHMENT },
  freezeBody: { fontSize: 13, lineHeight: 19, color: '#A9BCD0' },
  freezeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 46, borderRadius: 23, backgroundColor: ICE, marginTop: 4,
  },
  freezeBtnOff: { opacity: 0.5 },
  freezeBtnText: { fontFamily: DISPLAY, fontSize: 12.5, letterSpacing: 0.8, color: INK },

  // Near-black rather than the translucent white the other cards use: the two
  // headline cards sit forward of the navy wash instead of floating on it.
  // Not pure #000 — a hair of blue keeps it from reading as a hole in the page.
  walletCard: {
    padding: 18, borderRadius: 16,
    backgroundColor: '#05080E',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  walletTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  walletTopRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dayStreak: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(244,162,97,0.14)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.32)',
  },
  // Played-yesterday-but-not-today: still alive, but greyed as a nudge.
  dayStreakPending: {
    backgroundColor: 'rgba(255,255,255,0.09)', borderColor: 'rgba(255,255,255,0.18)',
  },
  dayStreakValue: { fontFamily: DISPLAY, fontSize: 15, color: GOLD },
  dayStreakValuePending: { color: MUTED },
  streakNote: { fontSize: 11.5, color: MUTED, marginTop: 10 },
  walletCoins: { marginTop: 4 },
  levelBadge: {
    alignItems: 'center', justifyContent: 'center', width: 54, height: 54, borderRadius: 27,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.45)',
    backgroundColor: 'rgba(244,162,97,0.10)',
  },
  levelNumber: { fontFamily: DISPLAY, fontSize: 20, color: GOLD, lineHeight: 23 },
  levelWord: { fontFamily: DISPLAY_MID, fontSize: 8, letterSpacing: 1, color: MUTED },

  progressTrack: {
    height: 5, borderRadius: 3, marginTop: 16,
    backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden',
  },
  progressFill: { height: 5, borderRadius: 3 },
  progressNote: { fontSize: 11.5, color: MUTED, marginTop: 8 },

  walletStats: {
    flexDirection: 'row', marginTop: 16, paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.13)',
  },
  walletStat: { flex: 1, alignItems: 'center', gap: 3 },
  walletDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.13)' },
  walletStatValue: { fontFamily: DISPLAY, fontSize: 18, color: PARCHMENT },

  dailyCard: {
    padding: 20, borderRadius: 16,
    backgroundColor: '#05080E',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.38)',
  },
  dailyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  doneChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(244,162,97,0.14)',
  },
  doneChipText: { fontFamily: DISPLAY_MID, fontSize: 12, color: GOLD },
  dailyTitle: { fontFamily: SERIF_BOLD, fontSize: 24, color: PARCHMENT, marginTop: 8 },
  dailyBody: { fontFamily: SERIF, fontSize: 14.5, lineHeight: 23, color: '#A9BCD0', marginTop: 6 },
  dailyCta: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16 },
  dailyCtaText: {
    fontFamily: DISPLAY, fontSize: 12, letterSpacing: 1, color: GOLD, textTransform: 'uppercase',
  },

  sectionLabel: { marginTop: 14, marginLeft: 2 },

  // Same near-black as the two cards above, so the page reads as one surface.
  modeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14,
    backgroundColor: '#05080E',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  modeIcon: {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(244,162,97,0.12)',
  },
  modeBody: { flex: 1, gap: 3 },
  modeTitle: { fontFamily: DISPLAY, fontSize: 14, letterSpacing: 0.5, color: PARCHMENT },
  modeText: { fontSize: 13, lineHeight: 19, color: '#A9BCD0' },
  bestRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  modeBest: { fontSize: 11.5, color: MUTED },
  modeBestValue: { fontFamily: DISPLAY_MID, fontSize: 13, color: GOLD },
  modePlayed: { color: MUTED },

  note: {
    marginTop: 10, fontSize: 11.5, lineHeight: 18, color: MUTED, textAlign: 'center',
  },
});

export default QuizHome;
