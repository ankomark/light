import React, { useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import PlayControls from './PlayControls';
import Likes from './LikeButton';
import Comments from './Comments';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import axios from 'axios';
import { API_URL, getAccessToken, toggleTrackFavorite } from '../services/api';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/useAuth';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

const TrackItem = ({ track, onDelete, onRefresh }) => {
  const { processProfilePicture } = useAuth();
  const navigation = useNavigation();
  const isOwner = track.is_owner;

  const [artistProfile, setArtistProfile] = useState(null);
  const [profileImageError, setProfileImageError] = useState(false);
  const [isFavorite, setIsFavorite] = useState(Boolean(track.is_liked));
  const [favBusy, setFavBusy] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const optimizedCover = track.cover_image?.includes('cloudinary')
    ? track.cover_image.replace('/upload/', '/upload/w_600,h_600,c_fill,q_auto,f_auto/')
    : track.cover_image;
  const optimizedAudio = track.audio_file?.includes('cloudinary')
    ? track.audio_file.replace('/upload/', '/upload/q_auto/')
    : track.audio_file;
  const optimizedProfile = artistProfile?.picture ? processProfilePicture(artistProfile.picture, 50) : null;

  useEffect(() => {
    let active = true;
    const fetchArtistProfile = async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const response = await axios.get(`${API_URL}/profiles/by_user/${track.artist.id}/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (active) setArtistProfile(response.data);
      } catch (error) {
        if (active) setArtistProfile({ picture: null });
      }
    };
    if (track?.artist?.id) fetchArtistProfile();
    return () => { active = false; };
  }, [track.artist?.id]);

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
    <View style={styles.card}>
      {/* Artist header */}
      <View style={styles.header}>
        <View style={styles.artistRow}>
          <Image
            source={profileImageError || !optimizedProfile ? DEFAULT_AVATAR : { uri: optimizedProfile, cache: 'force-cache' }}
            style={styles.avatar}
            defaultSource={DEFAULT_AVATAR}
            onError={() => setProfileImageError(true)}
          />
          <Text style={styles.artistName} numberOfLines={1}>{track.artist?.username}</Text>
        </View>

        {isOwner && (
          <View style={styles.ownerActions}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('EditTrack', { track })} hitSlop={HIT}>
              <MaterialIcons name="edit" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={handleDelete} hitSlop={HIT}>
              <MaterialIcons name="delete-outline" size={18} color={colors.error} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Cover art */}
      <View style={styles.coverWrap}>
        {optimizedCover ? (
          <Image source={{ uri: optimizedCover }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Ionicons name="musical-notes" size={56} color={colors.textMuted} />
          </View>
        )}
      </View>

      {/* Title + album */}
      <Text style={styles.title} numberOfLines={1}>{track.title}</Text>
      {!!track.album && <Text style={styles.album} numberOfLines={1}>{track.album}</Text>}

      {/* Player */}
      <PlayControls track={{ ...track, audio_file: optimizedAudio }} />

      {/* Action bar */}
      <View style={styles.actionBar}>
        <View style={styles.actionLeft}>
          <Likes trackId={track.id} initialLikes={track.likes_count} />
          <Comments trackId={track.id} />
        </View>

        <View style={styles.actionRight}>
          {isDownloading ? (
            <View style={styles.downloadProgress}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.downloadText}>{Math.round(downloadProgress)}%</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.iconBtn} onPress={handleDownload} hitSlop={HIT}>
              <MaterialIcons name={downloadError ? 'error-outline' : 'file-download'} size={22} color={downloadError ? colors.error : colors.textSecondary} />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.iconBtn} onPress={handleToggleFavorite} hitSlop={HIT} disabled={favBusy}>
            <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={24} color={isFavorite ? colors.error : colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginVertical: spacing.sm,
    marginHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  artistRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 34, height: 34, borderRadius: 17, marginRight: spacing.sm, backgroundColor: colors.surface },
  artistName: { ...typography.label, color: colors.textPrimary, flexShrink: 1 },
  ownerActions: { flexDirection: 'row', gap: spacing.sm },
  coverWrap: { borderRadius: radius.md, overflow: 'hidden', ...shadows.sm },
  cover: { width: '100%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surface },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.md },
  album: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  actionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border,
  },
  actionLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  actionRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBtn: { padding: spacing.xs },
  downloadProgress: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
  downloadText: { color: colors.textSecondary, fontSize: 12 },
});

export default TrackItem;
