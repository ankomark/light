// Artist Studio: how your music is doing, for the last 7 / 28 / 90 days.
//
//   Streams · Listeners · Likes · Followers   (with change on the period before)
//   Completion · Skip rate · Average listen · All-time plays
//   Daily streams chart · Top songs · Countries · Where listens start
//   Your albums (open, or make a new one)
//   Removed songs, at the top when there are any (with Dispute)
//
// Your own listens never count here. Cache-first per period.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Modal, Pressable,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { fetchStudio, fetchAlbums, createAlbum } from '../services/api';
import { useAuth } from '../context/useAuth';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import formatCount from '../utils/formatCount';
import formatDuration from '../utils/formatDuration';
import { countryName } from '../utils/region';
import PlaylistCover from './PlaylistCover';
import RemovedSongs from './RemovedSongs';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const PERIODS = [7, 28, 90];
const GOLD = '#E8C66B';

const Change = ({ value }) => {
  if (value == null) return <Text style={styles.changeNone}>—</Text>;
  const up = value >= 0;
  return (
    <Text style={[styles.change, { color: up ? '#43A047' : '#E57373' }]}>
      {`${up ? '▲' : '▼'} ${Math.abs(value)}%`}
    </Text>
  );
};

const Tile = ({ label, value, change }) => (
  <View style={styles.tile}>
    <Text style={styles.tileValue}>{value}</Text>
    <Text style={styles.tileLabel}>{label}</Text>
    {change !== undefined ? <Change value={change} /> : null}
  </View>
);

const ShareBar = ({ label, share, streams, t }) => (
  <View style={styles.shareRow}>
    <View style={styles.shareHead}>
      <Text style={styles.shareLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.shareValue}>{`${share}%  ·  ${t('trackItem.plays', { count: formatCount(streams) })}`}</Text>
    </View>
    <View style={styles.shareTrack}><View style={[styles.shareFill, { width: `${Math.max(2, share)}%` }]} /></View>
  </View>
);

const DailyChart = ({ daily }) => {
  const max = Math.max(1, ...daily.map((d) => d.streams));
  return (
    <View>
      <View style={styles.chart}>
        {daily.map((d) => (
          <View key={d.date} style={styles.barSlot}>
            <View style={[styles.bar, { height: `${Math.max(2, (d.streams / max) * 100)}%`, opacity: d.streams ? 1 : 0.25 }]} />
          </View>
        ))}
      </View>
      <View style={styles.chartAxis}>
        <Text style={styles.axisText}>{daily[0]?.date?.slice(5)}</Text>
        <Text style={styles.axisText}>{`${formatCount(max)} / day`}</Text>
        <Text style={styles.axisText}>{daily[daily.length - 1]?.date?.slice(5)}</Text>
      </View>
    </View>
  );
};

const ArtistStudio = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  const [days, setDays] = useState(28);
  const key = userKey(currentUser?.id, `studio:${days}`);
  const albumsKey = userKey(currentUser?.id, 'studio:albums');
  const [data, setData] = useState(() => peekCache(key));
  const [albums, setAlbums] = useState(() => peekCache(albumsKey) || []);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [stats, mine] = await Promise.all([fetchStudio(days), fetchAlbums()]);
      setData(stats);
      writeCache(key, stats);
      const list = Array.isArray(mine) ? mine : [];
      setAlbums(list);
      writeCache(albumsKey, list);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [days, key, albumsKey]);

  useEffect(() => {
    setData(peekCache(key));
    readCache(key).then((c) => { if (c) setData((d) => d ?? c); });
  }, [key]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const newAlbum = async () => {
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const album = await createAlbum({ title });
      setCreating(false);
      setNewTitle('');
      navigation.navigate('Album', { albumId: album.id, title: album.title });
    } catch {
      Alert.alert(t('common.error'), t('album.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const tot = data?.totals;
  const sourceName = (key) => {
    const label = t(`studio.source.${key}`);
    return label === `studio.source.${key}` ? key : label;
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} colors={[colors.primary]} />}
    >
      <Text style={styles.title}>{t('artist.studio')}</Text>
      <View style={styles.periods}>
        {PERIODS.map((d) => (
          <TouchableOpacity
            key={d}
            style={[styles.period, days === d && styles.periodOn]}
            onPress={() => setDays(d)}
            accessibilityRole="radio"
            accessibilityState={{ checked: days === d }}
          >
            <Text style={[styles.periodText, days === d && styles.periodTextOn]}>{t('studio.lastDays', { n: d })}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Songs a moderator took down, first: that's what a takedown notice
          opens this screen for (only shows when there are some). */}
      <RemovedSongs />

      {!tot ? (
        failed ? (
          <View style={styles.empty}>
            <MaterialIcons name="wifi-off" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('studio.loadFailed')}</Text>
          </View>
        ) : <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : (
        <>
          <View style={styles.tiles}>
            <Tile label={t('studio.streams')} value={formatCount(tot.streams)} change={data.change.streams} />
            <Tile label={t('studio.listeners')} value={formatCount(tot.listeners)} change={data.change.listeners} />
            <Tile label={t('profile.likes')} value={formatCount(tot.likes)} change={data.change.likes} />
            <Tile label={t('profile.followers')} value={formatCount(tot.followers)} />
          </View>
          <View style={styles.tiles}>
            <Tile label={t('studio.completion')} value={`${tot.completion}%`} />
            <Tile label={t('studio.skipRate')} value={`${tot.skip_rate}%`} />
            <Tile label={t('studio.avgListen')} value={formatDuration(tot.avg_listen_ms) || '0:00'} />
            <Tile label={t('studio.allTime')} value={formatCount(data.lifetime_streams)} />
          </View>

          <Text style={styles.section}>{t('studio.daily')}</Text>
          <DailyChart daily={data.daily} />

          <Text style={styles.section}>{t('studio.topSongs')}</Text>
          {data.top_tracks.length ? data.top_tracks.map((s, i) => (
            <View key={s.id} style={styles.songRow}>
              <Text style={styles.pos}>{i + 1}</Text>
              <View style={styles.songCover}>
                {s.cover ? <Image source={{ uri: s.cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="musical-notes" size={16} color={colors.textMuted} />}
              </View>
              <View style={styles.songBody}>
                <Text style={styles.songTitle} numberOfLines={1}>{s.title}</Text>
                <Text style={styles.songMeta} numberOfLines={1}>
                  {[t('trackItem.plays', { count: formatCount(s.streams) }),
                    t('studio.listenersCount', { n: formatCount(s.listeners) }),
                    t('studio.completedPct', { n: s.completion })].join('  ·  ')}
                </Text>
              </View>
            </View>
          )) : <Text style={styles.hint}>{t('studio.noStreams')}</Text>}

          {data.countries.length ? (
            <>
              <Text style={styles.section}>{t('studio.countries')}</Text>
              {data.countries.map((c) => <ShareBar key={c.key} label={countryName(c.key)} share={c.share} streams={c.streams} t={t} />)}
            </>
          ) : null}

          {data.sources.length ? (
            <>
              <Text style={styles.section}>{t('studio.sources')}</Text>
              {data.sources.map((c) => <ShareBar key={c.key} label={sourceName(c.key)} share={c.share} streams={c.streams} t={t} />)}
            </>
          ) : null}
        </>
      )}

      <View style={styles.albumHead}>
        <Text style={[styles.section, styles.noMargin]}>{t('artist.albums')}</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => setCreating(true)} accessibilityRole="button">
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.newBtnText}>{t('album.new')}</Text>
        </TouchableOpacity>
      </View>
      {albums.length ? albums.map((a) => (
        <TouchableOpacity key={a.id} style={styles.albumRow} onPress={() => navigation.navigate('Album', { albumId: a.id, title: a.title })}>
          <PlaylistCover cover={a.cover} images={[]} size={52} radius={6} />
          <View style={styles.songBody}>
            <Text style={styles.songTitle} numberOfLines={1}>{a.title}</Text>
            <Text style={styles.songMeta}>{t('library.songCount', { n: a.track_count })}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )) : <Text style={styles.hint}>{t('album.none')}</Text>}

      <Modal visible={creating} transparent animationType="fade" onRequestClose={() => setCreating(false)}>
        <Pressable style={styles.overlay} onPress={() => setCreating(false)}>
          <Pressable style={styles.modal}>
            <Text style={styles.modalTitle}>{t('album.new')}</Text>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder={t('album.titleLabel')}
              placeholderTextColor={colors.placeholder}
              autoFocus
              maxLength={100}
              onSubmitEditing={newAlbum}
            />
            <TouchableOpacity style={[styles.create, (!newTitle.trim() || busy) && styles.disabled]} onPress={newAlbum} disabled={!newTitle.trim() || busy}>
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.newBtnText}>{t('common.create')}</Text>}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: spacing.md, paddingBottom: 140, width: '100%', maxWidth: 760, alignSelf: 'center' },
  title: { ...typography.h1, color: colors.textPrimary },
  periods: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  period: {
    minHeight: 36, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
  },
  periodOn: { backgroundColor: GOLD, borderColor: GOLD },
  periodText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  periodTextOn: { color: '#1A1406' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  tile: {
    flexGrow: 1, flexBasis: '45%', minWidth: 140, backgroundColor: colors.card, borderRadius: radius.md,
    padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  tileValue: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  tileLabel: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  change: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  changeNone: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  noMargin: { marginTop: 0, marginBottom: 0 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: GOLD, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  chartAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  axisText: { fontSize: 11, color: colors.textMuted },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  pos: { width: 20, textAlign: 'center', color: colors.textMuted, fontWeight: '700' },
  songCover: {
    width: 44, height: 44, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  songBody: { flex: 1 },
  songTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  songMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  shareRow: { marginBottom: spacing.sm },
  shareHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  shareLabel: { ...typography.label, color: colors.textPrimary, flex: 1 },
  shareValue: { ...typography.caption, color: colors.textSecondary },
  shareTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  shareFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  albumHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.sm },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: spacing.md,
    borderRadius: radius.full, backgroundColor: colors.primary,
  },
  newBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  albumRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  hint: { ...typography.caption, color: colors.textMuted, marginVertical: spacing.sm },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  spinner: { marginVertical: spacing.xl },
  overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', maxWidth: 480, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg },
  modalTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  input: {
    minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 16,
  },
  create: {
    marginTop: spacing.md, minHeight: 44, borderRadius: radius.full, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
});

export default ArtistStudio;
