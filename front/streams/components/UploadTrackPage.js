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
import { useNavigation, useRoute } from '@react-navigation/native';
import { createSound, measureDurationMs } from '../services/audioPlayer';
import { compressImage } from '../services/imageProcessing';
import { enqueueUpload } from '../services/uploadQueue';
import { createAlbum } from '../services/api';
import { titleFromFileName, byFileName } from '../utils/uploadTitles';
import GenrePicker from './GenrePicker';
import AlbumPicker from './AlbumPicker';
import RightsFields, { EMPTY_RIGHTS, isrcLooksValid } from './RightsFields';
import RotatingBackground from './RotatingBackground';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import { colors, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const MAX_AUDIO_SIZE_MB = 20;
const MAX_IMAGE_SIZE_MB = 5;
// Songs in one go (an album upload). They upload one after another in the
// background queue, each resumable on its own.
const MAX_SONGS = 30;
const PAD = spacing.md;

const clock = (ms) => {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
let keySeq = 0;

const TrackUploadForm = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const kbHeight = useKeyboardHeight();

  // The title while there's one song; with several, each row has its own.
  const [title, setTitle] = useState('');
  const titleRef = useRef('');
  titleRef.current = title;
  // null | { id, title, count } | { newTitle } — see AlbumPicker.
  const [album, setAlbum] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [genre, setGenre] = useState(null);
  // Rights: the owner-or-permission confirmation (required), licence, credits.
  const [rightsOk, setRightsOk] = useState(false);
  const [rights, setRights] = useState(EMPTY_RIGHTS);
  const [lyrics, setLyrics] = useState('');
  // [{ key, uri, name, mimeType, sizeMB, durationMs, title }]
  const [songs, setSongs] = useState([]);
  const audioFile = songs[0] || null;
  const batch = songs.length > 1;
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
  hasWorkRef.current = !!(songs.length || coverImage || title.trim() || lyrics.trim());
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    stopPreview();
    if (submittedRef.current || !hasWorkRef.current) return;
    e.preventDefault();
    Alert.alert(t('track.upload.discardTitle'), t('create.post.discardBody'), [
      { text: t('create.post.keepEditing'), style: 'cancel' },
      { text: t('create.post.discard'), style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
    ]);
  }), [navigation, t, stopPreview]);

  // Several files at once make an album upload. `replace` swaps the one song
  // (its "change file" button); otherwise picked files join the list.
  const pickAudioFiles = async ({ replace = false } = {}) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*', copyToCacheDirectory: true, multiple: !replace,
      });
      if (result.canceled || !result.assets?.length) return;
      const picked = [];
      let tooBig = 0;
      for (const file of [...result.assets].sort(byFileName)) {
        const info = await FileSystem.getInfoAsync(file.uri);
        const sizeMB = (info.size || file.size || 0) / (1024 * 1024);
        if (sizeMB > MAX_AUDIO_SIZE_MB) { tooBig += 1; continue; }
        keySeq += 1;
        picked.push({
          key: `song_${keySeq}`, uri: file.uri, name: file.name, mimeType: file.mimeType, sizeMB,
          durationMs: null, title: titleFromFileName(file.name),
        });
      }
      setAudioError(tooBig
        ? t(picked.length ? 'upload.batch.skipped' : 'track.upload.tooLarge', { n: tooBig, max: MAX_AUDIO_SIZE_MB })
        : '');
      if (!picked.length) return;
      await stopPreview();
      setSongs((prev) => {
        // Becoming a list: the title typed for the one song goes with it.
        const base = replace ? [] : prev.map((s, i) => (
          i === 0 && prev.length === 1 && titleRef.current.trim() ? { ...s, title: titleRef.current.trim() } : s));
        return [...base, ...picked].slice(0, MAX_SONGS);
      });
      // One song: its title pre-filled from the file name — one less thing to type.
      if (replace || !songs.length) setTitle((cur) => cur || picked[0].title);
      // Each one's length, so the song shows "3:42" from the first moment it's live.
      picked.forEach((p) => measureDurationMs(p.uri).then((durationMs) => {
        setSongs((cur) => cur.map((s) => (s.key === p.key ? { ...s, durationMs } : s)));
      }));
    } catch (error) {
      console.error('Error picking audio file:', error);
      setAudioError(t('track.selectAudioFailed'));
    }
  };

  const setSongTitle = (key, value) => setSongs((cur) => cur.map((s) => (s.key === key ? { ...s, title: value } : s)));
  const moveSong = (index, by) => setSongs((cur) => {
    const to = index + by;
    if (to < 0 || to >= cur.length) return cur;
    const next = cur.slice();
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  });
  const removeSong = (key) => {
    const next = songs.filter((s) => s.key !== key);
    if (next.length === 1) setTitle(next[0].title);          // back to one song
    setSongs(next);
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

  // Hand the upload(s) to the background queue and leave — one job per song,
  // uploading one after another, each resumable if the app is killed.
  const uploadTrack = async () => {
    const list = batch
      ? songs.map((s) => ({ ...s, title: s.title.trim() }))
      : songs.slice(0, 1).map((s) => ({ ...s, title: title.trim() }));
    if (!list.length || list.some((s) => !s.title)) {
      Alert.alert(t('common.error'), t(batch ? 'upload.batch.titlesRequired' : 'track.required'));
      return;
    }
    await stopPreview();

    // A new album is made now, so every song can go straight onto it.
    let target = album?.id ? album : null;
    if (album && album.newTitle !== undefined) {
      const name = album.newTitle.trim();
      if (!name) {
        Alert.alert(t('common.error'), t('upload.album.needName'));
        return;
      }
      setSubmitting(true);
      try {
        const made = await createAlbum({ title: name });
        target = { id: made.id, title: made.title, count: 0 };
      } catch {
        setSubmitting(false);
        Alert.alert(t('common.error'), t('upload.album.createFailed'));
        return;
      }
    }

    list.forEach((song, i) => {
      enqueueUpload({
        kind: 'track',
        title: song.title,
        thumbUri: coverImage?.uri || null,
        // A plain snapshot, so the queue can persist it and resume the upload
        // if the app is killed before it finishes.
        snap: {
          title: song.title,
          album: target?.title || '',
          albumId: target?.id ?? null,
          // An album upload keeps the order chosen here whatever order the
          // songs land in; one song goes last on its album (the server's pick).
          trackNumber: target && batch ? target.count + i + 1 : null,
          genre,
          rightsConfirmed: rightsOk,
          rights: {
            license: rights.license,
            composer: rights.composer.trim(),
            producer: rights.producer.trim(),
            rights_holder: rights.rights_holder.trim(),
            // An ISRC names one recording, never a whole album.
            isrc: batch ? '' : rights.isrc.trim(),
          },
          lyrics: batch ? '' : lyrics.trim(),
          durationMs: song.durationMs || null,
          audio: { uri: song.uri, name: song.name, mimeType: song.mimeType },
          cover: coverImage,
        },
      });
    });
    submittedRef.current = true;
    navigation.goBack();
  };

  const titlesOk = batch ? songs.every((s) => s.title.trim()) : !!title.trim();
  const canUpload = !!audioFile && titlesOk && rightsOk && (batch || isrcLooksValid(rights.isrc)) && !submitting;

  return (
    <View style={styles.root}>
      <RotatingBackground scope="music" intervalMs={60000} scrimColor="rgba(8,18,34,0.72)" />
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.headerIcon} accessibilityLabel={t('common.cancel')}>
            <Feather name="x" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{batch ? t('upload.batch.title', { n: songs.length }) : t('track.upload.title')}</Text>
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
                  <Text style={styles.coverText}>{t(batch ? 'upload.batch.pickCover' : 'track.upload.pickCover')}</Text>
                </View>
              )}
              {coverImage && (
                <View style={styles.coverEdit}><Feather name="edit-2" size={13} color="#fff" /></View>
              )}
            </TouchableOpacity>

            <View style={styles.audioCard}>
              {batch ? (
                <View style={styles.audioEmpty}>
                  <MaterialIcons name="library-music" size={26} color={colors.accent} />
                  <Text style={styles.audioEmptyText}>{t('upload.batch.count', { n: songs.length })}</Text>
                  <Text style={styles.audioMeta}>{`${songs.reduce((n, s) => n + s.sizeMB, 0).toFixed(1)} MB`}</Text>
                </View>
              ) : audioFile ? (
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
                    <TouchableOpacity
                      style={[styles.smallBtn, styles.smallBtnGhost]}
                      onPress={() => pickAudioFiles({ replace: true })}
                      accessibilityLabel={t('upload.batch.change')}
                    >
                      <Feather name="refresh-cw" size={14} color={colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <TouchableOpacity style={styles.audioEmpty} onPress={() => pickAudioFiles()} activeOpacity={0.85}>
                  <Feather name="music" size={24} color={colors.primary} />
                  <Text style={styles.audioEmptyText}>{t('track.upload.pickAudio')}</Text>
                  <Text style={styles.audioMeta}>{t('upload.batch.pickHint', { max: MAX_AUDIO_SIZE_MB })}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          {!!audioError && <Text style={styles.errorText}>{audioError}</Text>}
          {!!imageError && <Text style={styles.errorText}>{imageError}</Text>}

          {batch ? (
            <View style={styles.card}>
              <Text style={styles.label}>{t('upload.batch.songs')}</Text>
              {songs.map((song, i) => (
                <View key={song.key} style={styles.songRow}>
                  <Text style={styles.songNo}>{i + 1}</Text>
                  <View style={styles.songBody}>
                    <TextInput
                      style={[styles.input, styles.songInput, !song.title.trim() && styles.inputBad]}
                      value={song.title}
                      onChangeText={(v) => setSongTitle(song.key, v)}
                      placeholder={t('track.titlePlaceholder')}
                      placeholderTextColor={colors.placeholder}
                      maxLength={200}
                      accessibilityLabel={t('upload.batch.songTitle', { n: i + 1 })}
                    />
                    <Text style={styles.songMeta} numberOfLines={1}>
                      {[song.name, `${song.sizeMB.toFixed(1)} MB`, clock(song.durationMs)].filter(Boolean).join('  ·  ')}
                    </Text>
                  </View>
                  <View style={styles.songBtns}>
                    <TouchableOpacity onPress={() => moveSong(i, -1)} disabled={i === 0} hitSlop={6} accessibilityLabel={t('upload.batch.moveUp')}>
                      <Feather name="chevron-up" size={20} color={i === 0 ? colors.textMuted : colors.textPrimary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => moveSong(i, 1)}
                      disabled={i === songs.length - 1}
                      hitSlop={6}
                      accessibilityLabel={t('upload.batch.moveDown')}
                    >
                      <Feather name="chevron-down" size={20} color={i === songs.length - 1 ? colors.textMuted : colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => removeSong(song.key)} hitSlop={8} style={styles.songRemove} accessibilityLabel={t('upload.batch.remove')}>
                    <Feather name="x" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ))}
              {songs.length < MAX_SONGS ? (
                <TouchableOpacity style={styles.addMore} onPress={() => pickAudioFiles()} accessibilityRole="button">
                  <Feather name="plus" size={16} color={colors.primary} />
                  <Text style={styles.addMoreText}>{t('upload.batch.addMore')}</Text>
                </TouchableOpacity>
              ) : <Text style={styles.confirmNote}>{t('upload.batch.max', { n: MAX_SONGS })}</Text>}
              <Text style={styles.confirmNote}>{t('upload.batch.lyricsLater')}</Text>
            </View>
          ) : audioFile ? (
            <TouchableOpacity style={styles.addMoreLink} onPress={() => pickAudioFiles()} accessibilityRole="button">
              <Feather name="plus-circle" size={16} color={colors.primary} />
              <Text style={styles.addMoreText}>{t('upload.batch.addMoreForAlbum')}</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.card}>
            {!batch ? (
              <>
                <Text style={styles.label}>{t('track.title')}</Text>
                <TextInput
                  style={styles.input}
                  value={title}
                  onChangeText={setTitle}
                  placeholder={t('track.titlePlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  maxLength={200}
                />
              </>
            ) : null}
            <Text style={[styles.label, !batch && styles.labelSpaced]}>{t('track.album')}</Text>
            <AlbumPicker value={album} onChange={setAlbum} preselectId={route?.params?.albumId ?? null} inputStyle={styles.input} />
            {batch && !album ? <Text style={styles.confirmNote}>{t('upload.batch.albumHint')}</Text> : null}
            <Text style={[styles.label, styles.labelSpaced]}>{t('track.genre')}</Text>
            <GenrePicker value={genre} onChange={setGenre} />
          </View>

          {!batch ? (
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
          ) : null}

          {/* Rights: required before sharing (songs/rights.py on the server). */}
          <View style={styles.card}>
            <RightsFields
              value={rights}
              onChange={setRights}
              hideIsrc={batch}
              inputStyle={styles.input}
              labelStyle={[styles.label, styles.labelSpaced]}
            />
            <TouchableOpacity
              style={styles.confirmRow}
              onPress={() => setRightsOk((v) => !v)}
              activeOpacity={0.8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rightsOk }}
            >
              <Feather name={rightsOk ? 'check-square' : 'square'} size={22} color={rightsOk ? colors.primary : colors.textSecondary} />
              <Text style={styles.confirmText}>{t(batch ? 'rights.confirmMany' : 'rights.confirm')}</Text>
            </TouchableOpacity>
            <Text style={styles.confirmNote}>{t('rights.confirmNote')}</Text>
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
              <Text style={styles.submitButtonText}>
                {batch ? t('upload.batch.share', { n: songs.length }) : t('track.upload.share')}
              </Text>
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
  content: { paddingHorizontal: PAD, paddingTop: spacing.sm, width: '100%', maxWidth: 760, alignSelf: 'center' },

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
  audioMeta: { color: colors.textMuted, fontSize: 12, marginTop: 4, textAlign: 'center' },
  audioActions: { flexDirection: 'row', gap: spacing.xs, marginTop: 'auto' },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: colors.primary,
  },
  smallBtnGhost: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)' },
  smallBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  errorText: { color: colors.error, fontSize: 13, marginBottom: spacing.sm },

  songRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  songNo: { width: 22, color: colors.textSecondary, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  songBody: { flex: 1, minWidth: 0 },
  songInput: { height: 42, fontSize: 15 },
  songMeta: { color: colors.textMuted, fontSize: 11.5, marginTop: 2 },
  songBtns: { alignItems: 'center', justifyContent: 'center' },
  songRemove: { width: 32, height: 42, alignItems: 'center', justifyContent: 'center' },
  inputBad: { borderColor: colors.error },
  addMore: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44,
    borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(29,161,242,0.45)',
  },
  addMoreLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, marginBottom: spacing.sm },
  addMoreText: { color: colors.primary, fontSize: 14, fontWeight: '700' },

  card: {
    backgroundColor: GLASS, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs, letterSpacing: 0.3 },
  labelSpaced: { marginTop: spacing.md },
  confirmRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md, minHeight: 44 },
  confirmText: { flex: 1, color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  confirmNote: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: spacing.xs },
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
