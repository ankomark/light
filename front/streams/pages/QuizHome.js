/**
 * Where the quiz starts: pick a mode.
 *
 * The daily quiz is the headline — it is shared, ranked, and gone once played.
 * Speed and Streak sit below it as practice you can return to, each showing
 * your own best so there is something to beat.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fetchDailyQuiz, fetchQuizBests, fetchQuizStats } from '../services/api';
import { useI18n } from '../context/I18nContext';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Coin, Coins, quizStyles as q, DISPLAY, DISPLAY_MID, SERIF, SERIF_BOLD,
  GOLD, GOLD_DEEP, PARCHMENT, MUTED, INK,
} from './quizTheme';

const QuizHome = ({ navigation }) => {
  const { t } = useI18n();
  const [daily, setDaily] = useState(null);
  const [bests, setBests] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        // Both are useful on their own — one failing must not blank the screen.
        const [d, b, st] = await Promise.allSettled([
          fetchDailyQuiz(), fetchQuizBests(), fetchQuizStats(),
        ]);
        if (!alive) return;
        if (d.status === 'fulfilled') setDaily(d.value);
        if (b.status === 'fulfilled') setBests(b.value);
        if (st.status === 'fulfilled') setStats(st.value);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []));

  const played = !!daily?.my_attempt;

  if (loading && !daily && !bests && !stats) {
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

          {/* Daily — the headline */}
          <TouchableOpacity
            style={styles.dailyCard}
            onPress={() => navigation.navigate('BibleQuiz')}
            activeOpacity={0.88}
          >
            <View style={styles.dailyTop}>
              <Text style={q.eyebrow}>{daily?.date}</Text>
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

          <Text style={styles.note}>{t('quiz.home.note')}</Text>
        </ScrollView>
      </View>
    </View>
  );
};

const ModeCard = ({ icon, title, body, best, bestLabel, bestValue, coins, onPress, t }) => (
  <TouchableOpacity style={styles.modeCard} onPress={onPress} activeOpacity={0.88}>
    <View style={styles.modeIcon}>
      <Ionicons name={icon} size={20} color={GOLD} />
    </View>
    <View style={styles.modeBody}>
      <Text style={styles.modeTitle}>{title}</Text>
      <Text style={styles.modeText}>{body}</Text>
      {best?.played > 0 ? (
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

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40, gap: 12 },

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
