// The play queue, opened from Now Playing: the song playing now, then what's
// up next in play order. Tap a song to jump to it; move it up one place or
// take it out. Songs already played aren't listed (they can't be edited, and
// Previous still reaches them).
import React, { useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { usePlayer } from '../context/PlayerContext';
import { useI18n } from '../context/I18nContext';
import FullSheet from './FullSheet';
import formatDuration from '../utils/formatDuration';
import { colors, radius, spacing } from '../constants/theme';

const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

const Cover = ({ uri }) => (
  <View style={styles.cover}>
    {uri ? (
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
    ) : (
      <Ionicons name="musical-notes" size={18} color={colors.textMuted} />
    )}
  </View>
);

const QueueSheet = ({ visible, onClose }) => {
  const { t } = useI18n();
  const {
    currentTrack, queueVersion, getUpNext, playFromQueue, moveInQueue, removeFromQueue,
  } = usePlayer();

  // Re-read whenever the queue changes (or the sheet opens).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const upNext = useMemo(() => (visible ? getUpNext() : []), [visible, queueVersion, getUpNext]);
  const first = upNext[0]?.at;

  if (!currentTrack) return null;

  const meta = (tr) => [tr.artist?.username, formatDuration(tr.duration_ms)].filter(Boolean).join('  ·  ');

  return (
    <FullSheet visible={visible} title={t('player.queue')} onClose={onClose}>
      <FlatList
        data={upNext}
        keyExtractor={(it) => `q_${it.at}_${it.track?.id}`}
        contentContainerStyle={styles.list}
        ListHeaderComponent={(
          <View>
            <Text style={styles.heading}>{t('player.nowPlaying')}</Text>
            <View style={styles.row}>
              <Cover uri={currentTrack.cover_small || currentTrack.cover_image} />
              <View style={styles.body}>
                <Text style={[styles.title, styles.titleNow]} numberOfLines={1}>{currentTrack.title}</Text>
                <Text style={styles.meta} numberOfLines={1}>{meta(currentTrack)}</Text>
              </View>
              <Ionicons name="volume-high" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.heading, styles.headingNext]}>{t('player.upNext')}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t('player.queueEmpty')}</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.tapArea}
              activeOpacity={0.8}
              onPress={() => playFromQueue(item.at)}
              accessibilityRole="button"
              accessibilityLabel={`${item.track?.title}, ${t('player.playNow')}`}
            >
              <Cover uri={item.track?.cover_small || item.track?.cover_image} />
              <View style={styles.body}>
                <Text style={styles.title} numberOfLines={1}>{item.track?.title}</Text>
                <Text style={styles.meta} numberOfLines={1}>{meta(item.track || {})}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => moveInQueue(item.at, item.at - 1)}
              disabled={item.at === first}
              hitSlop={HIT}
              accessibilityLabel={t('player.moveUp')}
            >
              <MaterialIcons name="keyboard-arrow-up" size={24} color={item.at === first ? colors.textMuted : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => removeFromQueue(item.at)}
              hitSlop={HIT}
              accessibilityLabel={t('player.removeFromQueue')}
            >
              <MaterialIcons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
      />
    </FullSheet>
  );
};

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  heading: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: spacing.sm, marginBottom: 4 },
  headingNext: { marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7 },
  tapArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cover: {
    width: 46, height: 46, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  titleNow: { color: colors.primary },
  meta: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  iconBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
});

export default QueueSheet;
