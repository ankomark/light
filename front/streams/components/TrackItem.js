import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Modal, ScrollView, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import Likes from './LikeButton';
import Comments from './Comments';
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import axios from 'axios';
import { API_URL, getAccessToken, toggleTrackFavorite } from '../services/api';
import { useNavigation } from '@react-navigation/native';
import { usePlayer } from '../context/PlayerContext';
import AddToPlaylistModal from './AddToPlaylistModal';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

const TrackItem = ({ track, onDelete, onRefresh, onPlay, onRemoveFromPlaylist }) => {
  const navigation = useNavigation();
  const { currentTrack, isPlaying, isLoading, isBuffering, playTrack, togglePlay } = usePlayer();
  const isOwner = track.is_owner;

  const [profileImageError, setProfileImageError] = useState(false);
  const [isFavorite, setIsFavorite] = useState(Boolean(track.is_liked));
  const [favBusy, setFavBusy] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [lyricsVisible, setLyricsVisible] = useState(false);
  const [playlistModalVisible, setPlaylistModalVisible] = useState(false);

  const hasLyrics = typeof track.lyrics === 'string' && track.lyrics.trim().length > 0;

  const optimizedCover = track.cover_image?.includes('cloudinary')
    ? track.cover_image.replace('/upload/', '/upload/w_200,h_200,c_fill,q_auto,f_auto/')
    : track.cover_image;
  const optimizedAudio = track.audio_file?.includes('cloudinary')
    ? track.audio_file.replace('/upload/', '/upload/q_auto/')
    : track.audio_file;
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
    if (onPlay) {
      onPlay();
      return;
    }
    playTrack({
      id: track.id,
      title: track.title,
      album: track.album,
      artist: track.artist,
      cover_image: optimizedCover,
      audio_file: optimizedAudio,
      lyrics: track.lyrics,
    });
  };

  const handleToggleFavorite = async () => {
    if (favBusy) return;
    const next = !isFavorite;
    setIsFavorite(next); // optimistic
    setFavBusy(true);
    try {
      await toggleTrackFavorite(track.id);
    } catch (error) {
      setIsFavorite(!next); // revert on failure
      Alert.alert('Error', 'Could not update favorite. Please try again.');
    } finally {
      setFavBusy(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete Track', 'Are you sure you want to delete this track?', [
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
            Alert.alert('Error', 'Failed to delete track');
          }
        },
      },
    ]);
  };

  const handleDownload = async () => {
    if (!track.audio_file) {
      Alert.alert('Error', 'Track file is missing!');
      return;
    }
    try {
      setIsDownloading(true);
      setDownloadProgress(0);
      setDownloadError(null);

      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') throw new Error('Storage access is required to save the track.');

      const safeTrackId = track.id.toString().replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `track_${safeTrackId}.mp3`;
      const downloadDir = `${FileSystem.documentDirectory}downloads/`;
      const fileUri = `${downloadDir}${fileName}`;
      await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true });

      const downloadResumable = FileSystem.createDownloadResumable(
        optimizedAudio,
        fileUri,
        {},
        (p) => setDownloadProgress((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100)
      );
      const { uri } = await downloadResumable.downloadAsync();
      const asset = await MediaLibrary.createAssetAsync(uri);
      try {
        await MediaLibrary.createAlbumAsync('Music Downloads', asset, false);
      } catch (albumError) {
        console.warn('Album creation failed:', albumError);
      }
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
      Alert.alert('Success', 'Track downloaded successfully');
    } catch (error) {
      setDownloadError(error.message);
      Alert.alert('Download Failed', error.message || 'An unexpected error occurred', [
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
      <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={[StyleSheet.absoluteFill, styles.glassTint]} pointerEvents="none" />

      {/* Main row: cover + play overlay, title/artist, play button */}
      <View style={styles.mainRow}>
        <TouchableOpacity style={styles.coverWrap} onPress={handlePlay} activeOpacity={0.85}>
          {optimizedCover ? (
            <Image source={{ uri: optimizedCover }} style={styles.cover} />
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
          <Text style={[styles.title, isActive && styles.titleActive]} numberOfLines={1}>
            {track.title}
          </Text>
          <View style={styles.artistRow}>
            <Image
              source={profileImageError || !artistAvatar ? DEFAULT_AVATAR : { uri: artistAvatar, cache: 'force-cache' }}
              style={styles.avatar}
              defaultSource={DEFAULT_AVATAR}
              onError={() => setProfileImageError(true)}
            />
            <Text style={styles.subtitle} numberOfLines={1}>
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
          <Comments trackId={track.id} />
          {hasLyrics && (
            <TouchableOpacity style={styles.iconBtn} onPress={() => setLyricsVisible(true)} hitSlop={HIT}>
              <MaterialIcons name="lyrics" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.actionRight}>
          {isOwner && (
            <>
              <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('EditTrack', { track })} hitSlop={HIT}>
                <MaterialIcons name="edit" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={handleDelete} hitSlop={HIT}>
                <MaterialIcons name="delete-outline" size={18} color={colors.error} />
              </TouchableOpacity>
            </>
          )}

          {onRemoveFromPlaylist && (
            <TouchableOpacity style={styles.iconBtn} onPress={onRemoveFromPlaylist} hitSlop={HIT}>
              <MaterialCommunityIcons name="playlist-remove" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.iconBtn} onPress={() => setPlaylistModalVisible(true)} hitSlop={HIT}>
            <MaterialCommunityIcons name="playlist-plus" size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          {isDownloading ? (
            <View style={styles.downloadProgress}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.downloadText}>{Math.round(downloadProgress)}%</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.iconBtn} onPress={handleDownload} hitSlop={HIT}>
              <MaterialIcons name={downloadError ? 'error-outline' : 'file-download'} size={20} color={downloadError ? colors.error : colors.textSecondary} />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.iconBtn} onPress={handleToggleFavorite} hitSlop={HIT} disabled={favBusy}>
            <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={22} color={isFavorite ? colors.error : colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <AddToPlaylistModal
        visible={playlistModalVisible}
        onClose={() => setPlaylistModalVisible(false)}
        trackId={track.id}
        trackTitle={track.title}
      />

      {/* Floating lyrics page */}
      <Modal
        visible={lyricsVisible}
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
              <Text style={styles.lyricsText}>
                {track.lyrics?.trim() || 'No lyrics added for this track.'}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

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
