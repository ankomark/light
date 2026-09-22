import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Modal, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import GlassView from './GlassView';
import Likes from './LikeButton';
import CommentAction from './CommentAction';
import DownloadButton from './DownloadButton';
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { saveToPhone } from '../utils/saveToPhone';
import axios from 'axios';
import { API_URL, getAccessToken, fetchTrackLyrics, apiRequest } from '../services/api';
import { useNavigation } from '@react-navigation/native';
import { usePlayer } from '../context/PlayerContext';
import AddToPlaylistModal from './AddToPlaylistModal';
import ReportModal from './ReportModal';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { FONT_SCALE } from '../utils/layout';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

// React.memo so a list re-render (a search keystroke, a page append, another
// row's like) doesn't re-render every visible row. It only holds because the
// list passes stable callbacks — see TrackList's renderItem.
const TrackItem = React.memo(function TrackItem({
  track, index, onDelete, onRefresh, onPlay, onRemoveFromPlaylist,
}) {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentTrack, isPlaying, isLoading, isBuffering, playTrack, togglePlay } = usePlayer();
  const isOwner = track.is_owner;

  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [, setDownloadError] = useState(null);
  const [lyricsVisible, setLyricsVisible] = useState(false);
  const [playlistModalVisible, setPlaylistModalVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);

  // The list payload carries `has_lyrics` rather than the lyrics themselves.
  // The `track.lyrics` fallback keeps this working wherever a full track object
  // is still passed in (the detail/edit paths, and any cached older payload).
  const hasLyrics = typeof track.has_lyrics === 'boolean'
    ? track.has_lyrics
    : (typeof track.lyrics === 'string' && track.lyrics.trim().length > 0);

  // Fetched when the sheet opens, then cached per track for the session.
  const [lyricsText, setLyricsText] = useState(
    typeof track.lyrics === 'string' ? track.lyrics : null
  );
  const [lyricsLoading, setLyricsLoading] = useState(false);

  const openLyrics = useCallback(() => {
    setLyricsVisible(true);           // sheet opens on this frame, always
    if (lyricsText !== null) return;  // already have them
    setLyricsLoading(true);
    fetchTrackLyrics(track.id)
      .then((text) => setLyricsText(text))
      .catch(() => setLyricsText(''))
      .finally(() => setLyricsLoading(false));
  }, [track.id, lyricsText]);

  // Media are R2 URLs now (served as-is); the old Cloudinary delivery
  // transforms were a no-op on them, so we use the stored URL directly.
  const optimizedCover = track.cover_image;
  const optimizedAudio = track.audio_file;
  // The artist avatar already ships with the track payload
  // (DetailedUserSerializer.profile_picture) — no per-row request needed.
  const artistAvatar = track.artist?.profile_picture || null;

  const isActive = currentTrack?.id === track.id;
  const showPause = isActive && isPlaying;
  const showSpinner = isActive && (isLoading || isBuffering);

  const handlePlay = () => {
    // Already the active track -> just toggle play/pause.
    if (isActive) {
      togglePlay();
      return;
    }
    // A list screen can supply onPlay to start the whole list as a queue
    // (so next/previous traverse it). Otherwise play this track on its own.
    // The index is passed for lists that share ONE stable handler across rows;
    // call sites that close over their own index just ignore the argument.
    if (onPlay) {
      onPlay(index);
      return;
    }
    playTrack({
      id: track.id,
      title: track.title,
      album: track.album,
      artist: track.artist,
      cover_image: optimizedCover,
      audio_file: optimizedAudio,
      has_lyrics: hasLyrics,
    });
  };

  const handleDelete = () => {
    Alert.alert(t('trackItem.deleteTitle'), t('trackItem.deleteConfirm'), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const token = await getAccessToken();
            await axios.delete(`${API_URL}/tracks/${track.id}/`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            onDelete?.(track.id);
          } catch (error) {
            Alert.alert(t('common.error'), t('trackItem.deleteFailed'));
          }
        },
      },
    ]);
  };

  const handleDownload = async () => {
    if (!track.audio_file) {
      Alert.alert(t('common.error'), t('trackItem.fileMissing'));
      return;
    }
    try {
      setIsDownloading(true);
      setDownloadProgress(0);
      setDownloadError(null);

      // The server hands back a copy with the title, artist, album and cover
      // written inside the file, plus the song's name as a file name — so the
      // phone's music player shows it exactly as it looks here, instead of
      // "track_7" with a blank square. Falls back to the plain file if that
      // lookup fails.
      let sourceUrl = optimizedAudio;
      let fileName = `${(track.title || 'Song').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Song'}.mp3`;
      try {
        const info = await apiRequest('get', `/tracks/${track.id}/download/`);
        if (info?.download_url) sourceUrl = info.download_url;
        if (info?.filename) fileName = info.filename;
      } catch { /* keep the plain file */ }

      // A folder per track, so two songs with the same title can't collide.
      const downloadDir = `${FileSystem.documentDirectory}downloads/${track.id}/`;
      const fileUri = `${downloadDir}${fileName}`;
      await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true });

      const downloadResumable = FileSystem.createDownloadResumable(
        sourceUrl,
        fileUri,
        {},
        (p) => setDownloadProgress((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100)
      );
      const { uri } = await downloadResumable.downloadAsync();
      // Into the phone's music (Android) or the share sheet (iOS) — without the
      // per-file "allow modifications" prompt; see utils/saveToPhone.
      const where = await saveToPhone(uri);
      // The phone has its own copy now; don't keep a second one in the app.
      FileSystem.deleteAsync(downloadDir, { idempotent: true }).catch(() => {});
      if (where === 'library') Alert.alert(t('market.success'), t('trackItem.downloadedOk'));
    } catch (error) {
      setDownloadError(error.message);
      Alert.alert(t('trackItem.downloadFailedTitle'), error.message || t('trackItem.downloadFailedBody'), [
        { text: 'OK' },
        { text: 'Retry', onPress: handleDownload },
      ]);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <View style={[styles.card, isActive && styles.cardActive]}>
      {/* Frosted-glass backdrop that blends into the screen background */}
      <GlassView intensity={28} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={[StyleSheet.absoluteFill, styles.glassTint]} pointerEvents="none" />

      {/* Main row: cover + play overlay, title/artist, play button */}
      <View style={styles.mainRow}>
        <TouchableOpacity style={styles.coverWrap} onPress={handlePlay} activeOpacity={0.85}>
          {optimizedCover ? (
            <Image source={{ uri: optimizedCover }} style={styles.cover} contentFit="cover" transition={150} />
          ) : (
            <View style={[styles.cover, styles.coverPlaceholder]}>
              <Ionicons name="musical-notes" size={26} color={colors.textMuted} />
            </View>
          )}
          {isActive && (
            <View style={styles.coverBadge}>
              <Ionicons name={showPause ? 'volume-high' : 'pause'} size={14} color={colors.white} />
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.info} onPress={handlePlay} activeOpacity={0.7}>
          <Text
            style={[styles.title, isActive && styles.titleActive]}
            numberOfLines={1}
            maxFontSizeMultiplier={FONT_SCALE.chrome}
          >
            {track.title}
          </Text>
          <View style={styles.artistRow}>
            <Image
              source={artistAvatar ? { uri: artistAvatar } : DEFAULT_AVATAR}
              placeholder={DEFAULT_AVATAR}
              contentFit="cover"
              transition={150}
              style={styles.avatar}
            />
            <Text
              style={styles.subtitle}
              numberOfLines={1}
              maxFontSizeMultiplier={FONT_SCALE.chrome}
            >
              {track.artist?.username}
              {!!track.album && `  ·  ${track.album}`}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.playButton} onPress={handlePlay} activeOpacity={0.85}>
          {showSpinner ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Ionicons
              name={showPause ? 'pause' : 'play'}
              size={22}
              color={colors.white}
              style={!showPause && { marginLeft: 2 }}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* Compact action bar */}
      <View style={styles.actionBar}>
        <View style={styles.actionLeft}>
          <Likes trackId={track.id} initialLikes={track.likes_count} initialIsLiked={track.is_liked} />
          <CommentAction trackId={track.id} commentCount={track.comments_count} triggerVariant="compact" />
          {hasLyrics && (
            <TouchableOpacity style={styles.iconBtn} onPress={openLyrics} hitSlop={HIT}>
              <MaterialIcons name="lyrics" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.actionRight}>
          {isOwner && (
            <TouchableOpacity style={styles.iconBtn} onPress={() => setMenuVisible(true)} hitSlop={HIT}
              accessibilityRole="button" accessibilityLabel="Track options">
              <MaterialIcons name="more-horiz" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}

          {/* Report — a direct flag on other artists' tracks (mirrors posts). */}
          {!isOwner && (
            <TouchableOpacity style={styles.iconBtn} onPress={() => setReportVisible(true)} hitSlop={HIT}
              accessibilityRole="button" accessibilityLabel="Report track">
              <MaterialIcons name="flag" size={20} color={colors.warning} />
            </TouchableOpacity>
          )}

          {onRemoveFromPlaylist && (
            <TouchableOpacity style={styles.iconBtn} onPress={onRemoveFromPlaylist} hitSlop={HIT}>
              <MaterialCommunityIcons name="playlist-remove" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.iconBtn} onPress={() => setPlaylistModalVisible(true)} hitSlop={HIT}>
            <MaterialCommunityIcons name="playlist-plus" size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Tap asks: save to the phone's storage (as this button always
              did), or keep it in the app for offline listening. */}
          {isDownloading ? (
            <View style={styles.downloadProgress}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.downloadText}>{Math.round(downloadProgress)}%</Text>
            </View>
          ) : (
            <DownloadButton track={track} style={styles.iconBtn} onSaveToPhone={handleDownload} />
          )}
        </View>
      </View>

      <AddToPlaylistModal
        visible={playlistModalVisible}
        onClose={() => setPlaylistModalVisible(false)}
        trackId={track.id}
        trackTitle={track.title}
      />

      <ReportModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        contentType="track"
        objectId={track.id}
      />

      {/* Floating lyrics page */}
      {/* Mounted only while open. A Modal per row, times every visible row,
          is real view-hierarchy weight for something nobody has opened. */}
      {lyricsVisible && (
      <Modal
        visible
        animationType="slide"
        transparent
        onRequestClose={() => setLyricsVisible(false)}
      >
        <View style={styles.lyricsOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setLyricsVisible(false)} />
          <View style={styles.lyricsSheet}>
            <View style={styles.lyricsHandle} />
            <View style={styles.lyricsHeader}>
              <View style={styles.lyricsHeaderText}>
                <Text style={styles.lyricsTitle} numberOfLines={1}>{track.title}</Text>
                <Text style={styles.lyricsArtist} numberOfLines={1}>{track.artist?.username}</Text>
              </View>
              <TouchableOpacity onPress={() => setLyricsVisible(false)} hitSlop={HIT} style={styles.lyricsClose}>
                <Ionicons name="close" size={26} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.lyricsBody}
              contentContainerStyle={styles.lyricsContent}
              showsVerticalScrollIndicator={false}
            >
              {lyricsLoading && lyricsText === null ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
              ) : (
                <Text style={styles.lyricsText}>
                  {lyricsText?.trim() || t('music.noLyricsAdded')}
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}

      {/* Owner action sheet: Edit / Delete (tap the "..." to open). */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <View style={styles.sheetRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => { setMenuVisible(false); navigation.navigate('EditTrack', { track }); }}
            >
              <MaterialIcons name="edit" size={22} color={colors.primary} />
              <Text style={styles.sheetLabel}>{t('trackItem.edit')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => { setMenuVisible(false); handleDelete(); }}
            >
              <MaterialIcons name="delete-outline" size={22} color={colors.error} />
              <Text style={[styles.sheetLabel, styles.sheetLabelDestructive]}>{t('trackItem.delete')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginVertical: spacing.xs,
    marginHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    ...shadows.sm,
  },
  // Faint bluish veil over the blur so the card reads as glass tinted toward
  // the deep-blue background instead of a hard opaque panel.
  glassTint: { backgroundColor: 'rgba(16,46,80,0.30)' },
  cardActive: { borderColor: colors.primary },
  mainRow: { flexDirection: 'row', alignItems: 'center' },
  coverWrap: { borderRadius: radius.md, overflow: 'hidden' },
  cover: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: colors.surface },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  coverBadge: {
    position: 'absolute', top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  info: { flex: 1, marginHorizontal: spacing.sm },
  title: { ...typography.label, fontSize: 15, color: colors.textPrimary },
  titleActive: { color: colors.primary },
  artistRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  avatar: { width: 18, height: 18, borderRadius: 9, marginRight: spacing.xs, backgroundColor: colors.surface },
  subtitle: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  playButton: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 5,
  },
  actionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border,
  },
  actionLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actionRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: { padding: spacing.xs },
  downloadProgress: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
  downloadText: { color: colors.textSecondary, fontSize: 12 },

  // Owner action sheet (Edit / Delete)
  sheetRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sheetHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, marginTop: 8, marginBottom: 6,
  },
  sheetItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 15, paddingHorizontal: 22,
  },
  sheetLabel: { fontSize: 16, color: colors.textPrimary, fontWeight: '600' },
  sheetLabelDestructive: { color: colors.error },

  // Floating lyrics page
  lyricsOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  lyricsSheet: {
    height: '82%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.lg,
  },
  lyricsHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  lyricsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lyricsHeaderText: { flex: 1, marginRight: spacing.sm },
  lyricsTitle: { ...typography.h3, color: colors.textPrimary },
  lyricsArtist: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  lyricsClose: { padding: spacing.xs },
  lyricsBody: { flex: 1 },
  lyricsContent: { paddingVertical: spacing.lg },
  lyricsText: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 26,
  },
});

export default TrackItem;
