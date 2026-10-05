// Music, run from the app: how much people listen (plays and listeners a day,
// the most listened songs), whether the charts and song processing are keeping
// up, the genres (names and order) and the Editor's picks rail that opens the
// Music home.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import {
  fetchAdminMusic, saveMusicGenre, saveMusicPicks, searchSongs,
} from '../../services/api';
import { notify } from '../../utils/adminConfirm';
import { ADMIN, ErrorState, useAdminMe } from './AdminKit';

const Stat = ({ label, value, testID }) => (
  <View style={styles.stat} testID={testID}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

/** Plays a day as plain bars (the same scale for every day). */
const Bars = ({ series }) => {
  const max = Math.max(1, ...series.map((d) => d.plays));
  return (
    <View style={styles.bars} accessibilityRole="image">
      {series.map((d) => (
        <View key={d.date} style={styles.barSlot}>
          <View style={[styles.bar, { height: `${Math.round((d.plays / max) * 100)}%` }]} />
        </View>
      ))}
    </View>
  );
};

export default function AdminMusic() {
  const { t } = useI18n();
  const { can } = useAdminMe();
  const canEdit = can('manage_app');
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [newGenre, setNewGenre] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try { setData(await fetchAdminMusic(14)); } catch { setFailed(true); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) {
      const body = e?.response?.data;
      const first = body && typeof body === 'object' ? Object.values(body).flat()[0] : null;
      notify(t('common.error'), typeof first === 'string' ? first : t('adminMusic.saveFailed'));
    } finally { setBusy(false); }
  };

  const genres = data?.genres || [];
  // One step up or down: the whole order goes up in one request (stored
  // positions can repeat on older data, so a swap of two isn't enough).
  const moveGenre = (i, dir) => run(async () => {
    if (!genres[i] || !genres[i + dir]) return;
    const next = [...genres];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    const res = await saveMusicGenre(null, { order: next.map((g) => g.id) });
    setData((d) => ({ ...d, genres: res.genres }));
  });
  const renameGenre = (g, name) => run(async () => {
    const res = await saveMusicGenre(g.id, { name });
    setData((d) => ({ ...d, genres: res.genres }));
  });
  const addGenre = () => run(async () => {
    if (!newGenre.trim()) return;
    const res = await saveMusicGenre(null, { name: newGenre.trim() });
    setNewGenre('');
    setData((d) => ({ ...d, genres: res.genres }));
  });

  const picks = data?.picks || [];
  const setPicks = (next) => run(async () => {
    await saveMusicPicks(next.map((p) => p.id));
    setData((d) => ({ ...d, picks: next }));
  });
  const search = () => run(async () => {
    const res = await searchSongs(query.trim());
    setFound((res?.results || []).slice(0, 8));
  });

  const series = useMemo(() => data?.series || [], [data]);

  if (failed && !data) return <ErrorState message={t('adminMusic.loadFailed')} onRetry={load} />;
  if (!data) return <View style={styles.center}><ActivityIndicator color={ADMIN.gold} /></View>;

  const chartAge = data.charts?.computed_at
    ? Math.round((Date.now() - new Date(data.charts.computed_at)) / 60000) : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('adminMusic.title')}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('adminMusic.listening', { days: data.days })}</Text>
        <View style={styles.statsRow}>
          <Stat label={t('adminMusic.plays')} value={data.totals?.plays ?? 0} testID="admin-music-plays" />
          <Stat label={t('adminMusic.listeners')} value={data.totals?.listeners ?? 0} />
        </View>
        <Bars series={series} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('adminMusic.top')}</Text>
        {(data.top || []).length ? data.top.map((s, i) => (
          <View key={s.id} style={styles.row}>
            <Text style={styles.rank}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{s.title}</Text>
              <Text style={styles.sub} numberOfLines={1}>{s.artist}</Text>
            </View>
            <Text style={styles.sub}>{t('adminMusic.listenersN', { n: s.listeners })}</Text>
          </View>
        )) : <Text style={styles.sub}>{t('adminMusic.noPlays')}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('adminMusic.health')}</Text>
        <Text style={[styles.sub, chartAge == null || chartAge > 120 ? styles.warn : null]}>
          {chartAge == null ? t('adminMusic.chartsNever') : t('adminMusic.chartsAge', { n: chartAge })}
        </Text>
        <Text style={styles.sub}>
          {t('adminMusic.processing', { pending: data.processing?.pending ?? 0, ready: data.processing?.ready ?? 0 })}
        </Text>
        {data.processing?.failed ? (
          <Text style={[styles.sub, styles.warn]}>{t('adminMusic.processingFailed', { n: data.processing.failed })}</Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('adminMusic.genres')}</Text>
        {genres.map((g, i) => (
          <View key={g.id} style={styles.row} testID={`admin-genre-${g.slug}`}>
            {canEdit ? (
              <TextInput
                style={[styles.input, { flex: 1 }]}
                defaultValue={g.name}
                onEndEditing={(e) => { const v = e.nativeEvent.text.trim(); if (v && v !== g.name) renameGenre(g, v); }}
                accessibilityLabel={g.name}
              />
            ) : <Text style={[styles.name, { flex: 1 }]}>{g.name}</Text>}
            <Text style={styles.sub}>{t('adminMusic.songsN', { n: g.track_count })}</Text>
            {canEdit ? (
              <>
                <TouchableOpacity onPress={() => moveGenre(i, -1)} disabled={busy || i === 0} hitSlop={8}>
                  <Ionicons name="arrow-up" size={18} color={i === 0 ? ADMIN.border : ADMIN.text} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => moveGenre(i, 1)} disabled={busy || i === genres.length - 1} hitSlop={8}>
                  <Ionicons name="arrow-down" size={18} color={i === genres.length - 1 ? ADMIN.border : ADMIN.text} />
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        ))}
        {canEdit ? (
          <View style={styles.row}>
            <TextInput style={[styles.input, { flex: 1 }]} value={newGenre} onChangeText={setNewGenre}
                       placeholder={t('adminMusic.newGenre')} placeholderTextColor={ADMIN.muted} />
            <TouchableOpacity style={styles.btn} onPress={addGenre} disabled={busy || !newGenre.trim()}
                              testID="admin-genre-add">
              <Text style={styles.btnText}>{t('adminMusic.add')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('adminMusic.picks')}</Text>
        <Text style={styles.sub}>{t('adminMusic.picksSub')}</Text>
        {picks.map((p, i) => (
          <View key={p.id} style={styles.row} testID={`admin-pick-${p.id}`}>
            <Text style={styles.rank}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{p.title}</Text>
              <Text style={styles.sub} numberOfLines={1}>{p.artist}</Text>
            </View>
            {canEdit ? (
              <TouchableOpacity onPress={() => setPicks(picks.filter((x) => x.id !== p.id))} disabled={busy} hitSlop={8}
                                accessibilityLabel={t('adminMusic.remove')}>
                <Ionicons name="close" size={18} color={ADMIN.danger} />
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {canEdit ? (
          <>
            <View style={styles.row}>
              <TextInput style={[styles.input, { flex: 1 }]} value={query} onChangeText={setQuery}
                         placeholder={t('adminMusic.findSong')} placeholderTextColor={ADMIN.muted}
                         onSubmitEditing={search} returnKeyType="search" />
              <TouchableOpacity style={styles.btn} onPress={search} disabled={busy || query.trim().length < 2}>
                <Ionicons name="search" size={16} color={ADMIN.onGold} />
              </TouchableOpacity>
            </View>
            {found.map((s) => (
              <TouchableOpacity key={s.id} style={styles.row} disabled={busy || picks.some((p) => p.id === s.id)}
                                onPress={() => setPicks([...picks, { id: s.id, title: s.title, artist: s.artist?.username }])}
                                testID={`admin-pick-add-${s.id}`}>
                <Ionicons name="add-circle-outline" size={18} color={ADMIN.gold} />
                <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{s.title}</Text>
                <Text style={styles.sub} numberOfLines={1}>{s.artist?.username}</Text>
              </TouchableOpacity>
            ))}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 48, gap: 12, width: '100%', maxWidth: 760, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: ADMIN.text, fontSize: 24, fontWeight: '700' },
  card: { backgroundColor: ADMIN.card, borderColor: ADMIN.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  cardTitle: { color: ADMIN.text, fontSize: 16, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1 },
  statValue: { color: ADMIN.gold, fontSize: 22, fontWeight: '800' },
  statLabel: { color: ADMIN.muted, fontSize: 12 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 70, gap: 3, marginTop: 6 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { backgroundColor: ADMIN.gold, borderRadius: 2, minHeight: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  rank: { color: ADMIN.muted, width: 20, textAlign: 'right', fontWeight: '700' },
  name: { color: ADMIN.text, fontWeight: '600' },
  sub: { color: ADMIN.muted, fontSize: 12.5 },
  warn: { color: ADMIN.danger },
  input: {
    color: ADMIN.text, backgroundColor: ADMIN.field, borderRadius: 10, paddingHorizontal: 10, minHeight: 40,
    borderWidth: 1, borderColor: ADMIN.border,
  },
  btn: { backgroundColor: ADMIN.gold, borderRadius: 10, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center' },
  btnText: { color: ADMIN.onGold, fontWeight: '700' },
});
