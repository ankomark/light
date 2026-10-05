// Your year in music: how long you listened, your most played songs and
// artists, the style you played most and your busiest month - from your own
// listening (GET /music/recap/). Opens from your Library. Last year too,
// from the year switcher.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchMusicRecap } from '../services/api';
import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/useAuth';
import { peekCache, writeCache, userKey } from '../utils/screenCache';
import toQueueTrack from '../utils/queueTrack';
import { genreName } from '../utils/genres';
import useBottomSpace from '../hooks/useBottomSpace';
import { colors, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

// The first year the server keeps a recap for (it answers earlier ones with this).
const FIRST_YEAR = 2020;

const Big = ({ value, label }) => (
  <View style={styles.big}>
    <Text style={styles.bigValue}>{value}</Text>
    <Text style={styles.bigLabel}>{label}</Text>
  </View>
);

export default function MusicRecap() {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const { playQueue } = usePlayer();
  const bottomSpace = useBottomSpace(40);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const key = userKey(currentUser?.id, `music:recap:${year}`);
  const [data, setData] = useState(() => peekCache(key));
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetchMusicRecap(year);
      setData(res);
      writeCache(key, res);
    } catch {
      setFailed(true);
    }
  }, [year, key]);
  useEffect(() => { setData(peekCache(key)); load(); }, [key, load]);

  const months = t('tix.months').split(',');
  const top = data?.top_songs || [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: bottomSpace }]}>
      <View style={styles.yearRow}>
        <TouchableOpacity onPress={() => setYear((y) => Math.max(FIRST_YEAR, y - 1))} hitSlop={10}
                          disabled={year <= FIRST_YEAR} accessibilityLabel={String(year - 1)}>
          <Ionicons name="chevron-back" size={22} color={year <= FIRST_YEAR ? colors.textMuted : colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('recap.title', { year })}</Text>
        <TouchableOpacity onPress={() => setYear((y) => Math.min(thisYear, y + 1))} hitSlop={10}
                          disabled={year >= thisYear} accessibilityLabel={String(year + 1)}>
          <Ionicons name="chevron-forward" size={22} color={year >= thisYear ? colors.textMuted : colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {!data ? (
        failed
          ? <Text style={styles.muted}>{t('recap.loadFailed')}</Text>
          : <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : !data.minutes ? (
        <Text style={styles.muted}>{t('recap.empty')}</Text>
      ) : (
        <>
          <View style={styles.bigRow}>
            <Big value={data.minutes} label={t('recap.minutes')} />
            <Big value={data.songs} label={t('recap.songs')} />
          </View>
          <View style={styles.bigRow}>
            {data.top_genre ? <Big value={genreName(t, data.top_genre)} label={t('recap.topGenre')} /> : null}
            {data.busiest ? <Big value={months[data.busiest - 1] || data.busiest} label={t('recap.busiest')} /> : null}
          </View>

          {top.length ? (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{t('recap.topSongs')}</Text>
                <TouchableOpacity onPress={() => playQueue(top.map(toQueueTrack), 0, { source: 'recap' })}
                                  accessibilityRole="button" testID="recap-play">
                  <Ionicons name="play-circle" size={30} color={colors.primary} />
                </TouchableOpacity>
              </View>
              {top.map((s, i) => (
                <TouchableOpacity key={s.id} style={styles.row} testID={`recap-song-${s.id}`}
                                  onPress={() => playQueue(top.map(toQueueTrack), i, { source: 'recap' })}>
                  <Text style={styles.rank}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{s.title}</Text>
                    <Text style={styles.muted} numberOfLines={1}>{s.artist?.username}</Text>
                  </View>
                  <Text style={styles.muted}>{t('recap.plays', { n: s.plays })}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {data.top_artists?.length ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('recap.topArtists')}</Text>
              {data.top_artists.map((a, i) => (
                <View key={a.id} style={styles.row}>
                  <Text style={styles.rank}>{i + 1}</Text>
                  <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{a.username}</Text>
                  <Text style={styles.muted}>{t('recap.plays', { n: a.plays })}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: spacing.md, gap: spacing.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', flex: 1, textAlign: 'center' },
  bigRow: { flexDirection: 'row', gap: spacing.sm },
  big: {
    flex: 1, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  bigValue: { color: colors.primary, fontSize: 26, fontWeight: '800' },
  bigLabel: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  card: {
    padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1,
    borderColor: colors.border, gap: spacing.xs,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  rank: { color: colors.textMuted, width: 20, textAlign: 'right', fontWeight: '700' },
  name: { color: colors.textPrimary, fontWeight: '600' },
  muted: { color: colors.textSecondary, fontSize: 13 },
});
