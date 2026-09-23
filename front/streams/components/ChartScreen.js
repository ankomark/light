// A whole chart: Top 50 (the last four weeks) or Trending (this week), for
// the world or one country. Numbered rows; tap to play from there with the
// rest of the chart queued, or play the lot. Cache-first like the other
// music screens.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fetchMusicChart } from '../services/api';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/useAuth';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import toQueueTrack from '../utils/queueTrack';
import formatCount from '../utils/formatCount';
import { countryName } from '../utils/region';
import { TrackListSkeleton } from './SkeletonLoader';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const ChartScreen = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const chart = params.chart === 'trending' ? 'trending' : 'top';
  const country = params.country || '';
  const { currentUser } = useAuth();
  const { playQueue, currentTrack, isPlaying } = usePlayer();
  const cacheKey = userKey(currentUser?.id, `music:chart:${chart}:${country || 'world'}`);
  const [rows, setRows] = useState(() => peekCache(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const title = chart === 'trending'
    ? t('music.trending')
    : country ? t('music.topCountry', { country: countryName(country) }) : t('music.topWorld');

  useEffect(() => { navigation.setOptions?.({ title }); }, [navigation, title]);

  const load = useCallback(async () => {
    try {
      const data = await fetchMusicChart(chart, country);
      const list = Array.isArray(data?.tracks) ? data.tracks : [];
      setRows(list);
      setFailed(false);
      writeCache(cacheKey, list);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [chart, country, cacheKey]);

  useEffect(() => {
    if (!rows) readCache(cacheKey).then((c) => { if (Array.isArray(c)) setRows((p) => p ?? c); });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const playFrom = (index) => playQueue((rows || []).map(toQueueTrack), index, { source: 'chart' });

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{t(chart === 'trending' ? 'music.trendingSub' : 'music.topSub')}</Text>
      {rows?.length ? (
        <TouchableOpacity style={styles.playAll} onPress={() => playFrom(0)} activeOpacity={0.85}>
          <Ionicons name="play" size={16} color={colors.white} />
          <Text style={styles.playAllText}>{t('playlist.playAll')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  if (!rows) {
    return <View style={styles.container}><TrackListSkeleton count={8} /></View>;
  }

  return (
    <FlatList
      style={styles.container}
      data={rows}
      keyExtractor={(item) => `chart_${item.id}`}
      ListHeaderComponent={header}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}
      ListEmptyComponent={(
        <View style={styles.empty}>
          <MaterialIcons name={failed ? 'wifi-off' : 'insights'} size={44} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t(failed ? 'music.chartFailed' : 'music.chartEmpty')}</Text>
        </View>
      )}
      renderItem={({ item, index }) => {
        const active = currentTrack?.id === item.id;
        return (
          <TouchableOpacity style={styles.row} onPress={() => playFrom(index)} activeOpacity={0.8}>
            <Text style={[styles.pos, index < 3 && styles.posTop]}>{item.position ?? index + 1}</Text>
            <View style={styles.cover}>
              {(item.cover_small || item.cover_image) ? (
                <Image source={{ uri: item.cover_small || item.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
              ) : <Ionicons name="musical-notes" size={18} color={colors.textMuted} />}
            </View>
            <View style={styles.body}>
              <Text style={[styles.name, active && styles.nameActive]} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {[item.artist?.username, item.plays != null ? t('trackItem.plays', { count: formatCount(item.plays) }) : null].filter(Boolean).join('  ·  ')}
              </Text>
            </View>
            <Ionicons name={active && isPlaying ? 'volume-high' : 'play-circle'} size={28} color={colors.primary} />
          </TouchableOpacity>
        );
      }}
    />
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  list: { paddingBottom: 140, width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  playAll: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: spacing.md,
    backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, minHeight: 40,
  },
  playAllText: { ...typography.label, color: colors.white, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 8 },
  pos: { width: 28, textAlign: 'center', color: colors.textSecondary, fontSize: 16, fontWeight: '800' },
  posTop: { color: '#E8C66B' },
  cover: {
    width: 48, height: 48, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  nameActive: { color: colors.primary },
  meta: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});

export default ChartScreen;
