/**
 * What your play adds up to: twelve weeks of days, your daily scores, the
 * badges on the way, and which parts of the Bible you know best.
 *
 * All of it is read from what the server already records (songs/
 * quiz_progress.py) — one request, painted from the kept copy first.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addDays, format, parseISO, startOfWeek, subWeeks } from 'date-fns';
import { fetchQuizProgress } from '../services/api';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import useCachedData from '../utils/useCachedData';
import { userKey } from '../utils/screenCache';
import { gameNow } from '../utils/quizCache';
import {
  quizStyles as q, DISPLAY, DISPLAY_MID, SERIF_BOLD, GOLD, GOLD_DEEP, PARCHMENT, MUTED,
} from './quizTheme';

const ICE = '#8EC5FF';
const WEEKS = 12;
const BADGE_ICONS = {
  first_quiz: 'footsteps', perfect: 'star', week_streak: 'flame', month_streak: 'bonfire',
  run_10: 'shield-checkmark', run_25: 'medal', coins_1000: 'diamond', scholar: 'school',
};

/** Twelve weeks, Monday first, ending with this week: [[{date, …}×7]×12]. */
export const calendarWeeks = (days, today = gameNow()) => {
  const byDate = new Map((days || []).map((d) => [String(d.date), d]));
  const first = startOfWeek(subWeeks(today, WEEKS - 1), { weekStartsOn: 1 });
  const todayIso = format(today, 'yyyy-MM-dd');
  const weeks = [];
  for (let w = 0; w < WEEKS; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) {
      const date = format(addDays(first, w * 7 + d), 'yyyy-MM-dd');
      const day = byDate.get(date);
      week.push({
        date,
        state: date > todayIso ? 'future'
          : day?.frozen ? 'frozen'
          : day?.quiz ? 'quiz'
          : day ? 'played'
          : 'none',
        today: date === todayIso,
      });
    }
    weeks.push(week);
  }
  return weeks;
};

const Card = ({ title, children, testID }) => (
  <View style={styles.card} testID={testID}>
    <Text style={q.eyebrow}>{title}</Text>
    {children}
  </View>
);

const QuizProgress = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const { data, failed, reload } = useCachedData(
    userKey(currentUser?.id, 'quiz:progress'), fetchQuizProgress,
  );

  const weeks = useMemo(() => calendarWeeks(data?.days), [data]);
  const history = data?.history || [];
  const average = history.length
    ? (history.reduce((n, h) => n + h.score, 0) / history.length).toFixed(1)
    : null;
  const strengths = data?.strengths || [];
  const ranked = [...strengths].filter((s) => s.answered >= 5).sort((a, b) => b.accuracy - a.accuracy);
  const strongest = ranked.length >= 2 ? ranked[0] : null;
  const weakest = ranked.length >= 2 ? ranked[ranked.length - 1] : null;

  if (!data) {
    return (
      <View style={q.rootClear}>
        <View style={q.centered}>
          {failed ? (
            <>
              <Text style={styles.empty}>{t('quiz.progress.failed')}</Text>
              <TouchableOpacity onPress={reload} accessibilityRole="button">
                <Text style={styles.retry}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </>
          ) : <ActivityIndicator size="large" color={GOLD} />}
        </View>
      </View>
    );
  }

  return (
    <View style={q.rootClear}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={q.pageTitle}>{t('quiz.progress.title')}</Text>

        <Card title={t('quiz.progress.calendar')} testID="progress-calendar">
          <View style={styles.weekHead}>
            {t('quiz.progress.weekdays').split(',').map((d, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Text key={i} style={styles.weekDay}>{d}</Text>
            ))}
          </View>
          {weeks.map((week) => (
            <View key={week[0].date} style={styles.weekRow}>
              {week.map((day) => (
                <View
                  key={day.date}
                  testID={`day-${day.date}`}
                  accessible
                  accessibilityLabel={`${format(parseISO(day.date), 'EEEE d MMMM')}: ${t(`quiz.progress.day.${day.state}`)}`}
                  style={[styles.day, styles[`day_${day.state}`], day.today && styles.dayToday]}
                />
              ))}
            </View>
          ))}
          <View style={styles.legend}>
            {['quiz', 'played', 'frozen'].map((s) => (
              <View key={s} style={styles.legendItem}>
                <View style={[styles.legendDot, styles[`day_${s}`]]} />
                <Text style={styles.legendText}>{t(`quiz.progress.day.${s}`)}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card title={t('quiz.progress.scores')} testID="progress-scores">
          {history.length ? (
            <>
              <View style={styles.bars}>
                {history.map((h) => (
                  <View
                    key={String(h.date)}
                    style={[styles.bar, { height: Math.max(3, (h.score / (h.total || 20)) * 84) }]}
                    accessible
                    accessibilityLabel={`${format(parseISO(String(h.date)), 'd MMMM')}: ${h.score}/${h.total}`}
                  />
                ))}
              </View>
              <Text style={styles.note}>{t('quiz.progress.average', { score: average, total: history[0].total || 20 })}</Text>
            </>
          ) : (
            <Text style={styles.empty}>{t('quiz.progress.noScores')}</Text>
          )}
        </Card>

        <Card title={t('quiz.progress.badges')} testID="progress-badges">
          <View style={styles.badges}>
            {(data.badges || []).map((b) => (
              <View key={b.key} style={styles.badge} accessible
                    accessibilityLabel={`${t(`quiz.badge.${b.key}`)}. ${t(`quiz.badge.${b.key}.how`)}. ${
                      b.earned ? t('quiz.progress.earned') : `${b.progress} / ${b.target}`}`}>
                <View style={[styles.badgeIcon, b.earned && styles.badgeIconEarned]}>
                  <Ionicons name={BADGE_ICONS[b.key] || 'ribbon'} size={20} color={b.earned ? '#0A1628' : MUTED} />
                </View>
                <Text style={[styles.badgeName, !b.earned && styles.badgeNameLocked]}>{t(`quiz.badge.${b.key}`)}</Text>
                <Text style={styles.badgeHow}>{t(`quiz.badge.${b.key}.how`)}</Text>
                {!b.earned && (
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${(b.progress / b.target) * 100}%` }]} />
                  </View>
                )}
              </View>
            ))}
          </View>
        </Card>

        <Card title={t('quiz.progress.strengths')} testID="progress-strengths">
          {strengths.length ? (
            <>
              {strengths.map((s) => (
                <TouchableOpacity
                  key={s.category}
                  style={styles.strength}
                  onPress={() => navigation?.navigate?.('QuizPlay', { mode: 'section', category: s.category })}
                  accessibilityRole="button"
                  accessibilityHint={t('quiz.practiseSection')}
                >
                  <View style={styles.strengthTop}>
                    <Text style={styles.strengthName}>{t(`quiz.section.${s.category}`)}</Text>
                    <Text style={styles.strengthPct}>{Math.round(s.accuracy * 100)}%</Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${s.accuracy * 100}%` }]} />
                  </View>
                  <Text style={styles.strengthCount}>{t('quiz.progress.correctOf', { correct: s.correct, answered: s.answered })}</Text>
                </TouchableOpacity>
              ))}
              {!!strongest && !!weakest && strongest.category !== weakest.category && (
                <>
                  <Text style={styles.note}>
                    {t('quiz.progress.bestAndWorst', {
                      best: t(`quiz.section.${strongest.category}`),
                      worst: t(`quiz.section.${weakest.category}`),
                    })}
                  </Text>
                  <TouchableOpacity
                    style={styles.practise}
                    onPress={() => navigation?.navigate?.('QuizPlay', { mode: 'section', category: weakest.category })}
                    accessibilityRole="button"
                  >
                    <Text style={styles.practiseText}>
                      {t('quiz.practiseNow', { section: t(`quiz.section.${weakest.category}`) })}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : (
            <Text style={styles.empty}>{t('quiz.progress.noStrengths')}</Text>
          )}
        </Card>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40, gap: 12 },
  card: {
    padding: 18, borderRadius: 16, gap: 10, backgroundColor: '#05080E',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  empty: { fontSize: 13.5, lineHeight: 20, color: '#A9BCD0', textAlign: 'center' },
  retry: { fontFamily: DISPLAY_MID, fontSize: 13, color: GOLD, marginTop: 10 },
  note: { fontSize: 12, lineHeight: 18, color: MUTED },

  weekHead: { flexDirection: 'row', gap: 6 },
  weekDay: { flex: 1, textAlign: 'center', fontFamily: DISPLAY_MID, fontSize: 9, color: MUTED },
  weekRow: { flexDirection: 'row', gap: 6 },
  day: { flex: 1, aspectRatio: 1, borderRadius: 6 },
  day_none: { backgroundColor: 'rgba(255,255,255,0.06)' },
  day_future: { backgroundColor: 'transparent' },
  day_quiz: { backgroundColor: GOLD },
  day_played: { backgroundColor: 'rgba(244,162,97,0.40)' },
  day_frozen: { backgroundColor: ICE },
  dayToday: { borderWidth: 1.5, borderColor: PARCHMENT },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 11.5, color: MUTED },

  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 88 },
  bar: { flex: 1, maxWidth: 14, borderRadius: 2, backgroundColor: GOLD },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: {
    width: '47%', flexGrow: 1, padding: 12, gap: 5, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  badgeIcon: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  badgeIconEarned: { backgroundColor: GOLD, borderColor: GOLD },
  badgeName: { fontFamily: SERIF_BOLD, fontSize: 14, color: PARCHMENT },
  badgeNameLocked: { color: '#A9BCD0' },
  badgeHow: { fontSize: 11.5, lineHeight: 16, color: MUTED },

  track: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3, backgroundColor: GOLD_DEEP },

  strength: { gap: 5, marginBottom: 4, paddingVertical: 2 },
  practise: {
    alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 16,
    borderRadius: 20, backgroundColor: GOLD, marginTop: 4,
  },
  practiseText: { fontFamily: DISPLAY, fontSize: 12, letterSpacing: 0.6, color: '#0A1628' },
  strengthTop: { flexDirection: 'row', justifyContent: 'space-between' },
  strengthName: { fontSize: 14, color: PARCHMENT },
  strengthPct: { fontFamily: DISPLAY, fontSize: 13, color: GOLD },
  strengthCount: { fontSize: 11, color: MUTED },
});

export default QuizProgress;
