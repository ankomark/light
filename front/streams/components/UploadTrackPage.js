import 'react-native-get-random-values';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, TextInput, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useNavigation } from '@react-navigation/native';
import { createSound } from '../services/audioPlayer';
import { compressImage } from '../services/imageProcessing';
import { enqueueUpload } from '../services/uploadQueue';
import { buildTrackJob } from '../services/postUploads';
import RotatingBackground from './RotatingBackground';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import { colors, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const MAX_AUDIO_SIZE_MB = 20;
const MAX_IMAGE_SIZE_MB = 5;
const PAD = spacing.md;

const TrackUploadForm = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const kbHeight = useKeyboardHeight();

  const [title, setTitle] = useState('');
  const [album, setAlbum] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [audioFile, setAudioFile] = useState(null);   // { uri, name, mimeType, sizeMB }
  const [coverImage, setCoverImage] = useState(null); // { uri, mimeType }
  const [audioError, setAudioError] = useState('');
  const [imageError, setImageError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);

  // A ref, not state: the old version kept the sound in state and ALSO
  // unloaded it from an effect keyed on it, so every new preview unloaded the
  // previous sound twice.
  const soundRef = useRef(null);

  const stopPreview = useCallback(async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    setIsPlaying(false);
    if (sound) {
      try { await sound.stopAsync(); } catch { /* not playing */ }
      sound.unloadAsync().catch(() => {});
    }
  }, []);

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => {}); }, []);

  // ── Leaving with unsaved work ──
  const submittedRef = useRef(false);
  const hasWorkRef = useRef(false);
  hasWorkRef.current = !!(audioFile || coverImage || title.trim() || lyrics.trim());
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    stopPreview();
    if (submittedRef.current || !hasWorkRef.current) return;
    e.preventDefault();
    Alert.alert(t('track.upload.discardTitle'), t('create.post.discardBody'), [
      { text: t('create.post.keepEditing'), style: 'cancel' },
      { text: t('create.post.discard'), style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
    ]);
  }), [navigation, t, stopPreview]);

  const pickAudioFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      const info = await FileSystem.getInfoAsync(file.uri);
      const sizeMB = (info.size || file.size || 0) / (1024 * 1024);
      if (sizeMB > MAX_AUDIO_SIZE_MB) {
        setAudioError(t('track.upload.tooLarge', { max: MAX_AUDIO_SIZE_MB }));
        return;
      }
      await stopPreview();
      setAudioError('');
      setAudioFile({ uri: file.uri, name: file.name, mimeType: file.mimeType, sizeMB });
      // Pre-fill the title from the file name — one less thing to type.
      setTitle((prev) => prev || (file.name || '').replace(/\.[^/.]+$/, ''));
    } catch (error) {
      console.error('Error picking audio file:', error);
      setAudioError(t('track.selectAudioFailed'));
    }
  };

  const pickCoverImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const image = result.assets[0];
      const info = await FileSystem.getInfoAsync(image.uri);
      if ((info.size || 0) / (1024 * 1024) > MAX_IMAGE_SIZE_MB) {
        setImageError(t('track.upload.tooLarge', { max: MAX_IMAGE_SIZE_MB }));
        return;
      }
      const compressed = await compressImage(image.uri, { width: 800, quality: 0.8 });
      setImageError('');
      setCoverImage({ uri: compressed.uri, mimeType: 'image/jpeg', name: `cover_${Date.now()}.jpg` });
    } catch (error) {
      console.error('Error picking image:', error);
      setImageError(t('track.selectImageFailed'));
    }
  };

  const togglePreview = async () => {
    if (isPlaying) { await stopPreview(); return; }
    if (!audioFile) return;
    try {
      await stopPreview();
      const { sound } = await createSound({ uri: audioFile.uri }, { shouldPlay: true }, (st) => {
        if (st.didJustFinish) stopPreview();
      });
      soundRef.current = sound;
      setIsPlaying(true);
    } catch (error) {
      console.error('Error playing preview:', error);
      Alert.alert(t('track.playbackErrorTitle'), t('track.playbackErrorBody'));
    }
  };

  // Hand the upload to the background queue and leave — the compress + upload
  // used to run here behind a spinner while the user waited.
  const uploadTrack = async () => {
    if (!title.trim() || !audioFile) {
      Alert.alert(t('common.error'), t('track.required'));
      return;
    }
    await stopPreview();
    enqueueUpload({
      kind: 'track',
      title: title.trim(),
      thumbUri: coverImage?.uri || null,
      run: buildTrackJob({
        title: title.trim(),
        album: album.trim(),
        lyrics: lyrics.trim(),
        audio: { uri: audioFile.uri, name: audioFile.name, mimeType: audioFile.mimeType },
        cover: coverImage,
      }),
    });
    submittedRef.current = true;
    navigation.goBack();
  };

  const canUpload = !!audioFile && !!title.trim();

  return (
    <View style={styles.root}>
      <RotatingBackground scope="music" intervalMs={60000} scrimColor="rgba(8,18,34,0.72)" />
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.headerIcon} accessibilityLabel={t('common.cancel')}>
            <Feather name="x" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('track.upload.title')}</Text>
          <View style={styles.headerIcon} />
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + (kbHeight || 0) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Cover + audio, side by side like a record sleeve */}
          <View style={styles.mediaRow}>
            <TouchableOpacity style={styles.cover} onPress={pickCoverImage} activeOpacity={0.85}>
              {coverImage ? (
                <Image source={{ uri: coverImage.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
              ) : (
                <View style={styles.coverEmpty}>
                  <Feather name="image" size={26} color={colors.primary} />
                  <Text style={styles.coverText}>{t('track.upload.pickCover')}</Text>
                </View>
              )}
              {coverImage && (
                <View style={styles.coverEdit}><Feather name="edit-2" size={13} color="#fff" /></View>
              )}
            </TouchableOpacity>

            <View style={styles.audioCard}>
              {audioFile ? (
                <>
                  <View style={styles.audioTop}>
                    <MaterialIcons name="audiotrack" size={20} color={colors.accent} />
                    <Text style={styles.audioName} numberOfLines={2}>{audioFile.name}</Text>
                  </View>
                  <Text style={styles.audioMeta}>{audioFile.sizeMB.toFixed(1)} MB</Text>
                  <View style={styles.audioActions}>
                    <TouchableOpacity style={styles.smallBtn} onPress={togglePreview}>
                      <Feather name={isPlaying ? 'square' : 'play'} size={14} color="#fff" />
                      <Text style={styles.smallBtnText}>{isPlaying ? t('track.upload.stop') : t('track.upload.play')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.smallBtn, styles.smallBtnGhost]} onPress={pickAudioFile}>
                      <Feather name="refresh-cw" size={14} color={colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <TouchableOpacity style={styles.audioEmpty} onPress={pickAudioFile} activeOpacity={0.85}>
                  <Feather name="music" size={24} color={colors.primary} />
                  <Text style={styles.audioEmptyText}>{t('track.upload.pickAudio')}</Text>
                  <Text style={styles.audioMeta}>≤ {MAX_AUDIO_SIZE_MB} MB</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          {!!audioError && <Text style={styles.errorText}>{audioError}</Text>}
          {!!imageError && <Text style={styles.errorText}>{imageError}</Text>}

          <View style={styles.card}>
            <Text style={styles.label}>{t('track.title')}</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder={t('track.titlePlaceholder')}
              placeholderTextColor={colors.placeholder}
              maxLength={200}
            />
            <Text style={[styles.label, styles.labelSpaced]}>{t('track.album')}</Text>
            <TextInput
              style={styles.input}
              value={album}
              onChangeText={setAlbum}
              placeholder={t('track.albumPlaceholder')}
              placeholderTextColor={colors.placeholder}
              maxLength={200}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>{t('track.lyrics')}</Text>
            <TextInput
              style={styles.textArea}
              value={lyrics}
              onChangeText={setLyrics}
              placeholder={t('track.lyricsPlaceholder')}
              placeholderTextColor={colors.placeholder}
              multiline
            />
          </View>
        </ScrollView>

        {!kbHeight && (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.sm) + spacing.xs }]}>
            <TouchableOpacity
              style={[styles.submitButton, !canUpload && styles.submitButtonDisabled]}
              onPress={uploadTrack}
              disabled={!canUpload}
              activeOpacity={0.85}
            >
              <Feather name="upload-cloud" size={18} color="#fff" />
              <Text style={styles.submitButtonText}>{t('track.upload.share')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
};

const GLASS = 'rgba(14,30,52,0.82)';
const HAIRLINE = 'rgba(255,255,255,0.10)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
  },
  headerIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  content: { paddingHorizontal: PAD, paddingTop: spacing.sm },

  mediaRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  cover: {
    width: 132, height: 132, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: GLASS, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(29,161,242,0.45)',
  },
  coverEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: spacing.sm },
  coverText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  coverEdit: {
    position: 'absolute', right: 6, bottom: 6, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  audioCard: {
    flex: 1, minHeight: 132, borderRadius: radius.lg, padding: spacing.sm + 2,
    backgroundColor: GLASS, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  audioEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  audioEmptyText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  audioTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  audioName: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  audioMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  audioActions: { flexDirection: 'row', gap: spacing.xs, marginTop: 'auto' },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.primary,
  },
  smallBtnGhost: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)' },
  smallBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  errorText: { color: colors.error, fontSize: 13, marginBottom: spacing.sm },

  card: {
    backgroundColor: GLASS, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs, letterSpacing: 0.3 },
  labelSpaced: { marginTop: spacing.md },
  input: {
    height: 48, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 16,
    color: colors.textPrimary, backgroundColor: 'rgba(6,16,32,0.6)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  textArea: {
    minHeight: 160, borderRadius: radius.md, padding: spacing.md, fontSize: 15, lineHeight: 21,
    color: colors.textPrimary, backgroundColor: 'rgba(6,16,32,0.6)', textAlignVertical: 'top',
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },

  footer: {
    paddingHorizontal: PAD, paddingTop: spacing.sm,
    backgroundColor: 'rgba(8,18,34,0.92)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE,
  },
  submitButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, paddingVertical: 15, borderRadius: radius.full, ...shadows.md,
  },
  submitButtonDisabled: { opacity: 0.4 },
  submitButtonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
});

export default TrackUploadForm;
