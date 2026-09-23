// A horizontal rail of track cards — "Recently played" and "Made for you" on
// the music screen,
// "More like this" on the song page. Tapping a card plays the rail as a queue
// from that card, so next/previous stay inside the recommendations.
import React, { memo, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { usePlayer } from '../context/PlayerContext';
import toQueueTrack from '../utils/queueTrack';
import { colors, radius, spacing } from '../constants/theme';

const CARD = 128;

const REASON_ICON = { fans_also_like: 'people', from_artist: 'person', popular: 'trending-up' };

const Card = memo(({ track, index, onPlay, active, reasonLabel }) => (
  <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => onPlay(index)}>
    <View style={styles.cover}>
      {track.cover_image ? (
        <Image source={{ uri: track.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={120} />
      ) : (
        <Ionicons name="musical-notes" size={36} color={colors.textMuted} />
      )}
      <View style={[styles.playDot, active && styles.playDotActive]}>
        <Ionicons name={active ? 'volume-high' : 'play'} size={14} color="#fff" style={!active && { marginLeft: 1 }} />
      </View>
    </View>
    <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
    <Text style={styles.artist} numberOfLines={1}>{track.artist?.username || ''}</Text>
    {track.reason && reasonLabel(track.reason) ? (
      <View style={styles.reason}>
        <Ionicons name={REASON_ICON[track.reason] || 'sparkles'} size={10} color={colors.primary} />
        <Text style={styles.reasonText} numberOfLines={1}>{reasonLabel(track.reason)}</Text>
      </View>
    ) : null}
  </TouchableOpacity>
));
Card.displayName = 'TrackRailCard';

const TrackRail = ({ title, tracks, reasonLabel = () => null, style, source = '' }) => {
  const { playQueue, currentTrack } = usePlayer();
  const onPlay = useCallback((i) => playQueue(tracks.map(toQueueTrack), i, { source }), [playQueue, tracks, source]);
  if (!tracks?.length) return null;
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.heading}>{title}</Text>
      <FlatList
        horizontal
        data={tracks}
        keyExtractor={(tr) => `rail_${tr.id}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <Card track={item} index={index} onPlay={onPlay} active={currentTrack?.id === item.id} reasonLabel={reasonLabel} />
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.sm },
  heading: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', marginHorizontal: spacing.md, marginBottom: spacing.sm },
  list: { paddingHorizontal: spacing.md, gap: spacing.sm },
  card: { width: CARD },
  cover: {
    width: CARD, height: CARD, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  playDot: {
    position: 'absolute', right: 8, bottom: 8, width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  playDotActive: { backgroundColor: colors.primary },
  title: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', marginTop: 6 },
  artist: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  reasonText: { color: colors.primary, fontSize: 10.5, fontWeight: '700', flexShrink: 1 },
});

export default TrackRail;
