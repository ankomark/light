/**
 * One theme's levels, as a map: every level reached, with the stars it was
 * won with, the next one open to play, and a few still locked beyond it.
 * Any finished level can be played again; nothing past the next can.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchPuzzleLevels } from '../services/api';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import { peekCache, writeCache, userKey } from '../utils/screenCache';
import { quizLanguage } from '../utils/quizCache';
import { starText } from '../components/PuzzleShareCard';
import { playPuzzle } from './PuzzleThemes';
import {
  quizStyles as q, DISPLAY, DISPLAY_MID, GOLD, PARCHMENT, MUTED, INK,
} from './quizTheme';

// Locked levels drawn past the next one, so the map reads as a road ahead.
const LOCKED_SHOWN = 3;
// One row: the dot, its stars line and the gap below.
const ROW_H = 84;

const PuzzleLevels = ({ navigation, route }) => {
  const { t, resolvedLanguage } = useI18n();
  const { currentUser } = useAuth();
  const lang = quizLanguage(resolvedLanguage);
  const slug = route?.params?.slug;
  const key = userKey(currentUser?.id, `puzzle:levels:${lang}:${slug}`);
  const [data, setData] = useState(() => peekCache(key));
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetchPuzzleLevels(slug, lang);
      setData(res);
      writeCache(key, res);
    } catch {
      setFailed(true);
    }
  }, [slug, lang, key]);

  const opened = useRef(false);
  useEffect(() => {
    load();
    // Back from a level: its stars are on the list. The first focus is the
    // opening, already loaded.
    return navigation?.addListener?.('focus', () => {
      if (opened.current) load();
      opened.current = true;
    });
  }, [load, navigation]);

  const levels = data?.levels || [];
  const next = data?.next_level || 1;
  const locked = data ? Array.from({ length: LOCKED_SHOWN }, (_, i) => ({ level: next + 1 + i, locked: true })) : [];
  // A long-time player has hundreds of levels: drawn as they scroll into
  // view (all at once made the map slow to open), five a row on a phone and
  // eight on a tablet.
  const { width } = useWindowDimensions();
  const cols = width >= 700 ? 8 : 5;
  const cells = [...levels, ...locked];

  // Open at the level to play next, not at level 1 four hundred levels back.
  const listRef = useRef(null);
  const scrolledFor = useRef(null);
  useEffect(() => {
    if (!data || scrolledFor.current === next || next <= cols * 3) return;
    scrolledFor.current = next;
    const row = Math.floor((next - 1) / cols);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset?.({ offset: Math.max(0, (row - 2) * ROW_H), animated: false });
    });
  }, [data, next, cols]);

  const header = (
    <View>
      <Text style={q.pageTitle}>{data?.theme?.name || route?.params?.name}</Text>
      {!!data?.theme && (
        <Text style={styles.sub}>
          {t('puzzle.levels.summary', { done: data.theme.levels_completed || 0, stars: data.theme.stars || 0 })}
        </Text>
      )}
      {!data && !failed && <ActivityIndicator color={GOLD} style={styles.loading} />}
      {failed && !data && (
        <TouchableOpacity onPress={load} style={styles.retry} accessibilityRole="button">
          <Text style={styles.sub}>{t('puzzle.themes.failed')}</Text>
          <Text style={q.gold}>{t('common.retry')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderCell = ({ item: lv }) => {
    if (lv.locked) {
      return (
        <View style={[styles.cell, { width: `${100 / cols}%` }]} accessibilityLabel={t('puzzle.levels.locked', { level: lv.level })}>
          <View style={[styles.dot, styles.dotLocked]}>
            <Ionicons name="lock-closed" size={14} color={MUTED} />
          </View>
          <Text style={styles.stars} />
        </View>
      );
    }
    const isNext = lv.level === next && !lv.is_complete;
    return (
            <TouchableOpacity
              style={[styles.cell, { width: `${100 / cols}%` }]}
              onPress={() => playPuzzle(navigation, { theme: slug, level: lv.level })}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={lv.is_complete
                ? t('puzzle.levels.done', { level: lv.level, stars: lv.stars })
                : t('puzzle.levels.play', { level: lv.level })}
              testID={`puzzle-level-${lv.level}`}
            >
              <View style={[styles.dot, lv.is_complete && styles.dotDone, isNext && styles.dotNext]}>
                <Text style={[styles.num, lv.is_complete && styles.numDone]}>{lv.level}</Text>
              </View>
              <Text style={styles.stars}>
                {lv.is_complete ? starText(lv.stars) : isNext ? t('puzzle.levels.next') : ''}
              </Text>
            </TouchableOpacity>
    );
  };

  return (
    <FlatList
      ref={listRef}
      key={cols}                       // a column count change needs a new list
      data={cells}
      numColumns={cols}
      keyExtractor={(lv) => String(lv.level)}
      renderItem={renderCell}
      ListHeaderComponent={header}
      contentContainerStyle={styles.body}
      initialNumToRender={cols * 8}
      windowSize={7}
      removeClippedSubviews
      testID="puzzle-levels"
    />
  );
};

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  sub: { fontSize: 13, color: '#A9BCD0', marginTop: 4, marginBottom: 16 },
  loading: { marginTop: 24 },
  retry: { alignItems: 'center', gap: 6, padding: 16 },
  cell: { alignItems: 'center', height: ROW_H, paddingBottom: 16 },
  dot: {
    width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(5,8,14,0.72)',
    borderWidth: 1, borderColor: 'rgba(244,162,97,0.35)',
  },
  dotDone: { backgroundColor: GOLD, borderColor: GOLD },
  dotNext: { borderColor: GOLD, borderWidth: 2.5 },
  dotLocked: { borderColor: 'rgba(255,255,255,0.12)', opacity: 0.7 },
  num: { fontFamily: DISPLAY, fontSize: 16, color: PARCHMENT },
  numDone: { color: INK },
  stars: { marginTop: 4, fontSize: 11, color: GOLD, fontFamily: DISPLAY_MID, minHeight: 14 },
});

export default PuzzleLevels;
