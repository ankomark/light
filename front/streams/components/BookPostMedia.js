// A book shared to the social feed, drawn as the book itself: its cover over
// a soft wash of the cover's colours, the title and who it's by — and, when
// a passage was shared, the passage in the book's own voice. Tap: the book
// (or the chapter, at that passage). Double-tap likes, like any post.
import React, { useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { categoryLabel } from '../utils/publications';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DOUBLE_TAP_MS = 280;

const BookPostMedia = ({ item, width, onDoubleTapLike }) => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const book = item.book || {};
  const quote = (book.quote || '').trim();
  const tap = useRef({ at: 0, timer: null });

  const open = useCallback(() => {
    if (quote && book.chapter_id) {
      navigation.navigate('ChapterReader', { id: book.id, chapterId: book.chapter_id, block: book.block ?? 0 });
    } else {
      navigation.navigate('PublicationDetail', {
        id: book.id, preview: { id: book.id, title: book.title, cover: book.cover, author: book.author },
      });
    }
  }, [navigation, book.id, book.chapter_id, book.block, book.title, book.cover, book.author, quote]);

  const onPress = () => {
    const s = tap.current;
    const now = Date.now();
    if (now - s.at < DOUBLE_TAP_MS) {
      clearTimeout(s.timer);
      s.at = 0;
      onDoubleTapLike?.(item);
      return;
    }
    s.at = now;
    s.timer = setTimeout(open, DOUBLE_TAP_MS);
  };

  const coverW = Math.round(Math.min(width * (quote ? 0.3 : 0.4), 220));
  const by = book.organization?.name || book.author?.username || '';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={book.title} testID={`book-post-${item.id}`}
      style={[styles.card, { width, minHeight: Math.round(width * (quote ? 1.1 : 0.95)) }]}>
      {book.cover ? (
        <Image source={{ uri: book.cover }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.wash]} />

      <View style={styles.inner}>
        <View style={[styles.cover, { width: coverW, height: Math.round(coverW * 1.5) }]}>
          {book.cover ? (
            <Image source={{ uri: book.cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.fallback]}>
              <MaterialIcons name="menu-book" size={30} color={colors.textMuted} />
            </View>
          )}
        </View>
        <Text style={styles.title} numberOfLines={2}>{book.title}</Text>
        <View style={styles.byRow}>
          <Text style={styles.by} numberOfLines={1}>{by}</Text>
          {book.organization?.is_verified ? <Ionicons name="checkmark-circle" size={14} color={colors.primary} /> : null}
          {book.category ? <Text style={styles.cat}>{`· ${categoryLabel(book.category, t)}`}</Text> : null}
        </View>

        {quote ? (
          <View style={styles.quoteBox} testID="book-post-quote">
            <Text style={styles.quoteMark}>“</Text>
            <Text style={styles.quote} numberOfLines={7}>{quote}</Text>
            {book.chapter_title ? <Text style={styles.where} numberOfLines={1}>{`— ${book.chapter_title}`}</Text> : null}
          </View>
        ) : book.summary ? (
          <Text style={styles.summary} numberOfLines={3}>{book.summary}</Text>
        ) : null}

        <View style={styles.cta}>
          <Ionicons name="book-outline" size={15} color={colors.white} />
          <Text style={styles.ctaText}>{quote && book.chapter_id ? t('bookPost.readInContext') : t('bookPost.read')}</Text>
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: { overflow: 'hidden', backgroundColor: '#0A1628', justifyContent: 'center' },
  wash: { backgroundColor: 'rgba(6,14,28,0.72)' },
  inner: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, gap: spacing.xs },
  cover: {
    borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface, marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', ...shadows.lg,
  },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h2, color: colors.white, textAlign: 'center' },
  byRow: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  by: { ...typography.label, color: 'rgba(255,255,255,0.85)', fontWeight: '700', flexShrink: 1 },
  cat: { ...typography.caption, color: 'rgba(255,255,255,0.6)' },
  quoteBox: {
    alignSelf: 'stretch', marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: radius.sm,
  },
  quoteMark: { color: colors.accent, fontSize: 30, lineHeight: 30, fontWeight: '800', marginBottom: -8 },
  quote: { color: colors.white, fontSize: 16, lineHeight: 24, fontStyle: 'italic' },
  where: { ...typography.caption, color: 'rgba(255,255,255,0.65)', marginTop: spacing.xs, textAlign: 'right' },
  summary: { ...typography.body, color: 'rgba(255,255,255,0.78)', textAlign: 'center', marginTop: spacing.xs },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.primary,
  },
  ctaText: { ...typography.label, color: colors.white, fontWeight: '800' },
});

export default BookPostMedia;
