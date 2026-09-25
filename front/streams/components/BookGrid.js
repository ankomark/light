// Books as a shelf of covers: a grid of 2 (large) or 3 (compact) on a phone,
// more on a tablet or the web. The cover leads; the title, who it's by
// (the organisation, when it's published under one) and its rating sit under.
import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { categoryLabel } from '../utils/publications';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

export const LAYOUTS = ['large', 'compact', 'list'];
export const GRID_GAP = spacing.sm + 4;

// The widest a shelf gets (tablets, the web): past it the list centres, so
// covers stay book-sized instead of stretching across a monitor.
export const SHELF_MAX = 1100;

/** Columns and tile width for a layout: 2 / 3 on a phone, growing with the
 *  screen. Measured against the list's real width (capped at `maxContent`,
 *  less its padding and any side insets), so tiles always fit their row. */
export const useBookGrid = (layout, { horizontalPadding = spacing.md * 2, maxContent = SHELF_MAX, insets = 0 } = {}) => {
  const { width } = useWindowDimensions();
  if (layout === 'list') return { cols: 1, tileW: null };
  const usable = Math.max(200, Math.min(width - insets, maxContent) - horizontalPadding);
  const [target, min, max] = layout === 'compact' ? [108, 3, 8] : [165, 2, 6];
  const cols = Math.max(min, Math.min(max, Math.floor((usable + GRID_GAP) / (target + GRID_GAP))));
  return { cols, tileW: Math.floor((usable - GRID_GAP * (cols - 1)) / cols) };
};

const Stars = ({ avg, count }) => (avg ? (
  <View style={styles.stars}>
    <Ionicons name="star" size={11} color={colors.accent} />
    <Text style={styles.starsText}>{avg.toFixed(1)}</Text>
    {count ? <Text style={styles.starsCount}>({count})</Text> : null}
  </View>
) : null);

export const BookGridTile = memo(({ item, onOpen, t, width, compact = false }) => {
  const by = item.organization?.name || item.author?.username || '';
  const verified = !!item.organization?.is_verified;
  return (
    <TouchableOpacity style={[styles.tile, { width }]} onPress={() => onOpen(item)} activeOpacity={0.85}
      accessibilityRole="button" accessibilityLabel={item.title} testID={`book-tile-${item.id}`}>
      <View style={[styles.coverWrap, { width, height: Math.round(width * 1.5) }]}>
        {item.cover ? (
          <Image source={{ uri: item.cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150}
            recyclingKey={String(item.id)} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.fallback]}>
            <MaterialIcons name="menu-book" size={compact ? 22 : 28} color={colors.textMuted} />
            <Text style={[styles.fallbackTitle, compact && styles.fallbackTitleSmall]} numberOfLines={4}>{item.title}</Text>
          </View>
        )}
        {item.status === 'draft' ? (
          <View style={styles.draft}><Text style={styles.draftText}>{t('pubDetail.draft')}</Text></View>
        ) : null}
        {item.is_bookmarked ? (
          <View style={styles.saved}><Ionicons name="bookmark" size={12} color={colors.white} /></View>
        ) : null}
        {item.my_percent > 0 && !item.my_finished ? (
          <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(item.my_percent * 100)}%` }]} /></View>
        ) : null}
      </View>
      <Text style={[styles.title, compact && styles.titleSmall]} numberOfLines={2}>{item.title}</Text>
      <View style={styles.byRow}>
        <Text style={styles.by} numberOfLines={1}>{by}</Text>
        {verified ? <Ionicons name="checkmark-circle" size={12} color={colors.primary} /> : null}
      </View>
      {!compact ? (
        <View style={styles.metaRow}>
          <Stars avg={item.rating_avg} count={item.rating_count} />
          <Text style={styles.cat} numberOfLines={1}>{categoryLabel(item.category, t)}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
});

/** Placeholder covers while the first page loads. */
export const BookGridSkeleton = ({ cols, width, rows = 2 }) => (
  <View style={styles.skeleton}>
    {Array.from({ length: cols * rows }, (_, i) => (
      <View key={i} style={{ width }}>
        <View style={[styles.coverWrap, styles.skelCover, { width, height: Math.round(width * 1.5) }]} />
        <View style={[styles.skelLine, { width: width * 0.8 }]} />
        <View style={[styles.skelLine, { width: width * 0.5 }]} />
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  tile: { marginBottom: spacing.md },
  coverWrap: {
    borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...shadows.sm,
  },
  fallback: { alignItems: 'center', justifyContent: 'center', padding: spacing.sm, gap: 6 },
  fallbackTitle: { ...typography.label, color: colors.textSecondary, textAlign: 'center', fontWeight: '700' },
  fallbackTitleSmall: { fontSize: 11 },
  draft: {
    position: 'absolute', top: 6, left: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  draftText: { color: colors.warning, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  saved: {
    position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)',
  },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(0,0,0,0.45)' },
  fill: { height: '100%', backgroundColor: colors.accent },
  title: { ...typography.label, color: colors.textPrimary, fontWeight: '700', marginTop: spacing.xs + 2, lineHeight: 19 },
  titleSmall: { fontSize: 12, lineHeight: 16 },
  byRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  by: { ...typography.caption, color: colors.textMuted, fontSize: 11, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 3 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  starsText: { ...typography.caption, color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  starsCount: { ...typography.caption, color: colors.textMuted, fontSize: 10 },
  cat: { ...typography.caption, color: colors.textMuted, fontSize: 10, flexShrink: 1, marginLeft: 'auto' },
  skeleton: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  skelCover: { borderWidth: 0 },
  skelLine: { height: 10, borderRadius: 5, backgroundColor: colors.surface, marginTop: 6 },
});
