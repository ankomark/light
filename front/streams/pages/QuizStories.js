/**
 * The story journey: the Bible's stories one at a time — Creation, Noah,
 * Joseph … the Passion week, Pentecost — each a run of ten questions drawn
 * only from its own chapters. A star on one opens the next; three stars is
 * all ten right. This week's study (featured by an admin) is open to all.
 *
 * Read from /quiz/stories/ (songs/views/quiz.py), painted from the kept copy.
 */
import React, { useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchQuizStories } from '../services/api';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import useCachedData from '../utils/useCachedData';
import { userKey } from '../utils/screenCache';
import { quizLanguage } from '../utils/quizCache';
import { quizStyles as q, DISPLAY, DISPLAY_MID, SERIF_BOLD, GOLD, PARCHMENT, MUTED } from './quizTheme';

const Stars = ({ count, size = 14 }) => (
  <View style={styles.stars}>
    {[1, 2, 3].map((n) => (
      <Ionicons key={n} name={count >= n ? 'star' : 'star-outline'} size={size} color={count >= n ? GOLD : MUTED} />
    ))}
  </View>
);

export default function QuizStories({ navigation }) {
  const { t, resolvedLanguage } = useI18n();
  const { currentUser } = useAuth();
  const lang = quizLanguage(resolvedLanguage);
  const insets = useSafeAreaInsets();
  const { data, failed, reload } = useCachedData(userKey(currentUser?.id, `quiz:stories:${lang}`),
    () => fetchQuizStories(lang));

  // Back from a story: its stars (and what they opened) have moved.
  const focusedBefore = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!focusedBefore.current) { focusedBefore.current = true; return; }
    reload();
  }, [reload]));

  const play = (s) => navigation.navigate('QuizPlay', { mode: 'story', story: s.slug, title: s.title });

  if (!data) {
    return (
      <View style={q.rootClear}>
        <View style={q.centered}>
          {failed ? (
            <>
              <Text style={styles.empty}>{t('quiz.story.failed')}</Text>
              <TouchableOpacity onPress={reload} accessibilityRole="button">
                <Text style={styles.retry}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </>
          ) : <ActivityIndicator size="large" color={GOLD} />}
        </View>
      </View>
    );
  }

  const journey = data.journey || [];
  return (
    <View style={q.rootClear}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 40 + insets.bottom }]}
                  showsVerticalScrollIndicator={false} testID="story-list">
        <Text style={q.pageTitle}>{t('quiz.story.title')}</Text>
        <Text style={styles.intro}>{t('quiz.story.intro')}</Text>

        {(data.featured || []).map((s) => (
          <TouchableOpacity key={s.slug} style={[styles.card, styles.featured]} onPress={() => play(s)}
                            accessibilityRole="button" testID={`story-${s.slug}`}>
            <Ionicons name={s.icon || 'book-outline'} size={24} color={GOLD} />
            <View style={styles.body}>
              <Text style={q.eyebrow}>{t('quiz.story.featured')}</Text>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.passage}>{s.passage}</Text>
              {!!s.summary && <Text style={styles.summary}>{s.summary}</Text>}
            </View>
            <Stars count={s.stars} />
          </TouchableOpacity>
        ))}

        {journey.map((s, i) => (
          <View key={s.slug} style={styles.step}>
            {/* The path from one story to the next. */}
            <View style={styles.rail}>
              <View style={[styles.dot, s.stars > 0 && styles.dotDone, !s.unlocked && styles.dotLocked]}>
                {s.unlocked
                  ? <Text style={styles.dotNum}>{i + 1}</Text>
                  : <Ionicons name="lock-closed" size={12} color={MUTED} />}
              </View>
              {i < journey.length - 1 && <View style={[styles.line, s.stars > 0 && styles.lineDone]} />}
            </View>
            <TouchableOpacity
              style={[styles.card, styles.grow, !s.unlocked && styles.locked]}
              onPress={() => s.unlocked && play(s)}
              disabled={!s.unlocked}
              accessibilityRole="button"
              accessibilityState={{ disabled: !s.unlocked }}
              accessibilityLabel={`${s.title}. ${s.unlocked ? t('quiz.story.stars', { count: s.stars }) : t('quiz.story.lockedShort')}`}
              testID={`story-${s.slug}`}
            >
              <Ionicons name={s.icon || 'book-outline'} size={22} color={s.unlocked ? GOLD : MUTED} />
              <View style={styles.body}>
                <Text style={styles.title} numberOfLines={2}>{s.title}</Text>
                <Text style={styles.passage}>{s.passage}</Text>
                {!!s.summary && s.unlocked && <Text style={styles.summary} numberOfLines={2}>{s.summary}</Text>}
              </View>
              {s.unlocked ? <Stars count={s.stars} /> : null}
            </TouchableOpacity>
          </View>
        ))}

        <Text style={styles.note}>{t('quiz.story.note')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, gap: 10 },
  intro: { fontSize: 13.5, lineHeight: 20, color: '#A9BCD0', marginBottom: 6 },
  step: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  rail: { width: 28, alignItems: 'center' },
  dot: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 18,
    borderWidth: 1, borderColor: GOLD, backgroundColor: '#05080E',
  },
  dotDone: { backgroundColor: GOLD },
  dotLocked: { borderColor: 'rgba(255,255,255,0.2)' },
  dotNum: { fontFamily: DISPLAY, fontSize: 11, color: PARCHMENT },
  line: { flex: 1, width: 2, backgroundColor: 'rgba(255,255,255,0.12)', marginTop: 2 },
  lineDone: { backgroundColor: 'rgba(244,162,97,0.6)' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14,
    backgroundColor: '#05080E', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  featured: { borderWidth: 1, borderColor: GOLD, backgroundColor: 'rgba(244,162,97,0.10)', marginBottom: 6 },
  grow: { flex: 1 },
  locked: { opacity: 0.55 },
  body: { flex: 1, gap: 2 },
  title: { fontFamily: SERIF_BOLD, fontSize: 16, color: PARCHMENT },
  passage: { fontFamily: DISPLAY_MID, fontSize: 10.5, letterSpacing: 0.8, color: GOLD },
  summary: { fontSize: 12.5, lineHeight: 18, color: '#A9BCD0', marginTop: 2 },
  stars: { flexDirection: 'row', gap: 2 },
  empty: { color: '#A9BCD0', fontSize: 14 },
  retry: { color: GOLD, fontWeight: '700', marginTop: 10 },
  note: { marginTop: 10, fontSize: 11.5, lineHeight: 18, color: MUTED, textAlign: 'center' },
});
