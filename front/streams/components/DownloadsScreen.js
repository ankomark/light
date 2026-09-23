// Songs saved for offline listening. Plays straight from the phone — no
// connection needed — with Play all, and swipe-free removal from each row.
import React, { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import RotatingBackground from './RotatingBackground';
import DownloadButton from './DownloadButton';
import { usePlayer } from '../context/PlayerContext';
import { useDownloadedTracks } from '../utils/downloads';
import { useI18n } from '../context/I18nContext';
import { colors, radius, spacing } from '../constants/theme';

const DownloadsScreen = ({ navigation }) => {
  const { t } = useI18n();
  const tracks = useDownloadedTracks();
  const { playQueue, currentTrack, isPlaying } = usePlayer();

  const renderItem = useCallback(({ item, index }) => {
    const active = currentTrack?.id === item.id;
    return (
      <TouchableOpacity style={[styles.row, active && styles.rowActive]} activeOpacity={0.85} onPress={() => playQueue(tracks, index, { source: 'downloads' })}>
        <View style={styles.cover}>
          {item.cover_image ? (
            <Image source={{ uri: item.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Ionicons name="musical-notes" size={22} color={colors.textMuted} />
          )}
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, active && styles.titleActive]} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{item.artist?.username || ''}</Text>
        </View>
        {active && isPlaying && <Ionicons name="volume-high" size={18} color={colors.primary} style={styles.eq} />}
        <DownloadButton track={item} />
      </TouchableOpacity>
    );
  }, [tracks, playQueue, currentTrack?.id, isPlaying]);

  return (
    <View style={styles.root}>
      <RotatingBackground scope="music" intervalMs={60000} scrimColor="rgba(8,18,34,0.78)" />
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Feather name="arrow-left" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.flex}>
            <Text style={styles.heading}>{t('downloads.title')}</Text>
            <Text style={styles.sub}>{t('downloads.count', { count: tracks.length })}</Text>
          </View>
          {tracks.length > 0 && (
            <TouchableOpacity style={styles.playAll} onPress={() => playQueue(tracks, 0, { source: 'downloads' })} activeOpacity={0.85}>
              <Ionicons name="play" size={16} color="#fff" />
              <Text style={styles.playAllText}>{t('music.playAll')}</Text>
            </TouchableOpacity>
          )}
        </View>
        <FlatList
          data={tracks}
          keyExtractor={(tr) => `dl_${tr.id}`}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="download-cloud" size={44} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>{t('downloads.emptyTitle')}</Text>
              <Text style={styles.emptyText}>{t('downloads.emptyBody')}</Text>
            </View>
          }
        />
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  heading: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  sub: { color: colors.textSecondary, fontSize: 13 },
  playAll: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: radius.full, backgroundColor: colors.primary,
  },
  playAllText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, marginBottom: spacing.xs,
    borderRadius: radius.lg, backgroundColor: 'rgba(14,30,52,0.75)',
  },
  rowActive: { backgroundColor: 'rgba(29,161,242,0.16)' },
  cover: {
    width: 52, height: 52, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  titleActive: { color: colors.primary },
  artist: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  eq: { marginRight: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.xxl * 2 },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
});

export default DownloadsScreen;
