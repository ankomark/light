// The verse of the day, pinned to the top of the home feed: the same picture
// the verse page shares (VerseCard), so it reads as a post, with Read (the
// verse page) and Share (the picture or the words) under it. One per day, the
// same for everyone; no author. Not a "visit" for the verse streak — that is
// opening the verse page (the fetch says via=feed).
//
// Nothing shows until the verse is here, and nothing at all if it can't be
// fetched: the feed never waits on it or shows an error for it.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { fetchDailyVerse } from '../services/api';
import VerseShareSheet, { VerseCard } from './VerseShareSheet';
import { useI18n } from '../context/I18nContext';
import { colors, spacing, radius } from '../constants/theme';
import { todayIso } from '../utils/quizCache';

// One fetch per day per app run: the header re-renders with every feed
// update, and a remount (tab switch) shouldn't refetch either.
let kept = null;            // { day, verse }
// The verse day turns over at midnight Nairobi time, like the quiz's.
const today = () => todayIso();

export const _resetFeedVerse = () => { kept = null; };   // tests

const FeedVerseCard = ({ width, refreshSignal }) => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const [verse, setVerse] = useState(() => (kept && kept.day === today() ? kept.verse : null));
  const [sharing, setSharing] = useState(false);

  // Fetched when missing, when the day has turned (midnight Nairobi), and on
  // the feed's pull-to-refresh — so an offline start isn't verse-less all day.
  useEffect(() => {
    if (verse && kept?.day === today()) return undefined;
    let live = true;
    fetchDailyVerse(null, { via: 'feed' })
      .then((v) => {
        if (!v?.text) return;
        kept = { day: today(), verse: v };
        if (live) setVerse(v);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [verse, refreshSignal]);

  const read = useCallback(() => navigation.navigate('DailyVerse'), [navigation]);

  if (!verse) return null;
  const cardW = Math.min(width - spacing.md * 2, 480);
  return (
    <View style={styles.wrap} testID="feed-verse">
      <TouchableOpacity activeOpacity={0.9} onPress={read} accessibilityRole="button"
                        accessibilityLabel={`${t('verse.title')}: ${verse.text} — ${verse.reference}`}>
        <VerseCard verse={verse} width={cardW} title={t('verse.title')} />
      </TouchableOpacity>
      <View style={[styles.actions, { width: cardW }]}>
        <TouchableOpacity style={styles.action} onPress={read} accessibilityRole="button" testID="feed-verse-read">
          <Ionicons name="book-outline" size={17} color={colors.white} />
          <Text style={styles.actionText}>{t('feedVerse.read')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={() => setSharing(true)} accessibilityRole="button"
                          testID="feed-verse-share">
          <Ionicons name="share-social-outline" size={17} color={colors.white} />
          <Text style={styles.actionText}>{t('verse.share')}</Text>
        </TouchableOpacity>
      </View>
      {sharing ? <VerseShareSheet visible onClose={() => setSharing(false)} verse={verse} /> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: radius.full,
    backgroundColor: 'rgba(10,22,40,0.72)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  actionText: { color: colors.white, fontSize: 13.5, fontWeight: '700' },
});

export default FeedVerseCard;
