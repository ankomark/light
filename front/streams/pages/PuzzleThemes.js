/**
 * The word puzzle's choices: today's Daily Puzzle, carrying on where the
 * server would take you, or a theme of your own — each with how far you have
 * got in it and the stars won there.
 *
 * Reached from the game's own bar; the game itself still opens straight onto
 * a board. Kept on the phone once seen, so it opens at once and refreshes
 * behind itself.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { fetchPuzzleThemes } from '../services/api';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import { peekCache, writeCache, userKey } from '../utils/screenCache';
import { quizLanguage } from '../utils/quizCache';
import { starText } from '../components/PuzzleShareCard';
import {
  quizStyles as q, mmss, DISPLAY, DISPLAY_MID, GOLD, PARCHMENT, MUTED, INK,
} from './quizTheme';

/** Back to the game with new orders — the board already open, if there is one. */
export const playPuzzle = (navigation, params = {}) => {
  const p = { ...params, nonce: Date.now() };
  if (navigation?.popTo) navigation.popTo('PuzzlePlay', p);
  else navigation?.navigate?.('PuzzlePlay', p);
};

/** Where today's Daily Puzzle is kept on this phone. */
export const dailyKey = (userId, lang, day = new Date()) =>
  userKey(userId, `puzzle:daily:${lang}:${format(day, 'yyyy-MM-dd')}`);

const PuzzleThemes = ({ navigation }) => {
  const { t, resolvedLanguage } = useI18n();
  const { currentUser } = useAuth();
  const lang = quizLanguage(resolvedLanguage);
  const key = userKey(currentUser?.id, `puzzle:themes:${lang}`);
  const [themes, setThemes] = useState(() => peekCache(key));
  const [daily, setDaily] = useState(() => peekCache(dailyKey(currentUser?.id, lang)));
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setDaily(peekCache(dailyKey(currentUser?.id, lang)));
    try {
      const data = await fetchPuzzleThemes(lang);
      setThemes(data);
      writeCache(key, data);
    } catch {
      setFailed(true);
    }
  }, [key, lang, currentUser?.id]);

  useEffect(() => {
    load();
    // Back from a level: its stars are on the list.
    return navigation?.addListener?.('focus', load);
  }, [load, navigation]);

  return (
    <ScrollView contentContainerStyle={styles.body} testID="puzzle-themes">
      <Text style={q.pageTitle}>{t('puzzle.themes.title')}</Text>

      {/* The day's board, the same for everyone. */}
      <TouchableOpacity
        style={[styles.card, styles.dailyCard]}
        onPress={() => playPuzzle(navigation, { daily: true })}
        activeOpacity={0.85}
        accessibilityRole="button"
        testID="puzzle-daily"
      >
        <View style={styles.dailyIcon}>
          <Ionicons name="calendar" size={22} color={INK} />
        </View>
        <View style={styles.cardMid}>
          <Text style={styles.cardTitle}>{t('puzzle.daily.title')}</Text>
          <Text style={styles.cardBody}>
            {daily?.is_complete
              ? t('puzzle.daily.solved', { time: mmss(daily.seconds || 0), stars: starText(daily.stars) })
              : t('puzzle.daily.body')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={GOLD} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => playPuzzle(navigation, {})}
        activeOpacity={0.85}
        accessibilityRole="button"
        testID="puzzle-continue"
      >
        <Ionicons name="play-circle" size={30} color={GOLD} />
        <View style={styles.cardMid}>
          <Text style={styles.cardTitle}>{t('puzzle.themes.continue')}</Text>
          <Text style={styles.cardBody}>{t('puzzle.themes.continueBody')}</Text>
        </View>
      </TouchableOpacity>

      <Text style={[q.eyebrow, styles.section]}>{t('puzzle.themes.pick')}</Text>
      {!themes && !failed && <ActivityIndicator color={GOLD} style={styles.loading} />}
      {failed && !themes && (
        <TouchableOpacity onPress={load} style={styles.retry} accessibilityRole="button">
          <Text style={styles.cardBody}>{t('puzzle.themes.failed')}</Text>
          <Text style={q.gold}>{t('common.retry')}</Text>
        </TouchableOpacity>
      )}
      {(themes || []).map((theme) => (
        <TouchableOpacity
          key={theme.slug}
          style={styles.card}
          onPress={() => navigation.navigate('PuzzleLevels', { slug: theme.slug, name: theme.name })}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${theme.name}. ${t('puzzle.themes.progress', {
            level: theme.next_level || 1, stars: theme.stars || 0,
          })}`}
          testID={`puzzle-theme-${theme.slug}`}
        >
          <View style={styles.themeIcon}>
            <Ionicons name={`${theme.icon || 'book'}-outline`} size={20} color={GOLD} />
          </View>
          <View style={styles.cardMid}>
            <Text style={styles.cardTitle}>{theme.name}</Text>
            {!!theme.description && <Text style={styles.cardBody} numberOfLines={1}>{theme.description}</Text>}
            <View style={styles.meta}>
              <Text style={styles.metaText}>{t('puzzle.level', { level: theme.next_level || 1 })}</Text>
              {!!theme.stars && (
                <Text style={styles.metaStars}>★ {theme.stars}</Text>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={MUTED} />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40, gap: 10 },
  section: { marginTop: 14, marginBottom: 2 },
  loading: { marginTop: 20 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 14, borderRadius: 16,
    backgroundColor: 'rgba(5,8,14,0.72)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.28)',
  },
  dailyCard: { borderColor: GOLD, backgroundColor: 'rgba(244,162,97,0.12)' },
  dailyIcon: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
  },
  themeIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.45)',
  },
  cardMid: { flex: 1, gap: 3 },
  cardTitle: { fontFamily: DISPLAY, fontSize: 15, letterSpacing: 0.4, color: PARCHMENT },
  cardBody: { fontSize: 13, color: '#A9BCD0' },
  meta: { flexDirection: 'row', gap: 12, marginTop: 2 },
  metaText: { fontFamily: DISPLAY_MID, fontSize: 10, letterSpacing: 1, color: GOLD },
  metaStars: { fontSize: 12, color: GOLD },
  retry: { alignItems: 'center', gap: 6, padding: 16 },
});

export default PuzzleThemes;
