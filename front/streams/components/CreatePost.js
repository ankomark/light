import React, { useState, useEffect, useRef, useCallback, useMemo, memo, useSyncExternalStore } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Switch,
  ScrollView, Alert, Modal, useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AudioTrimmer from './AudioTrimmer';
import CaptionComposer from './CaptionComposer';
import CoverPicker from './CoverPicker';
import SoundLibrary from './SoundLibrary';
import DraftsList from './DraftsList';
import FullSheet from './FullSheet';
import ImageCropper from './ImageCropper';
import VideoTrimmer from './VideoTrimmer';
import RotatingBackground from './RotatingBackground';
import * as ImagePicker from 'expo-image-picker';
import { createSound } from '../services/audioPlayer';
import AppVideo from './AppVideo';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { compressImage as compressImageFile } from '../services/imageProcessing';
import { isVideoProcessingAvailable } from '../services/videoProcessing';
import { enqueueUpload } from '../services/uploadQueue';
import * as DocumentPicker from 'expo-document-picker';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import { userKey } from '../utils/screenCache';
import { listDrafts, saveDraft, deleteDraft } from '../utils/drafts';
import { colors, radius, spacing, shadows } from '../constants/theme';

// Instagram-style aspect-ratio clamp (matches the feed's mediaAspectRatio so the
// preview is WYSIWYG): width:height between 1.91:1 (landscape) and 4:5 (portrait,
// ratio 0.8). Outside that range the image is center-cropped; the 4:5 floor caps
// height at 1.25×width so tall portraits never run past the screen. Falls back
// to square when dimensions are unknown.
const clampAspect = (w, h) => {
  if (!w || !h) return 1;
  const r = w / h;
  if (!isFinite(r) || r <= 0) return 1;
  return Math.min(1.91, Math.max(0.8, r));
};

// Accept 1080p and below only; reject 2K/4K. Measured on the shorter edge — a
// 1080p clip (portrait or landscape) has a 1080px short side, while 1440p/4K
// have 1440/2160. The tolerance covers encoders that pad 1080 up to 1088.
const MAX_VIDEO_SHORT_SIDE = 1130;
const MAX_IMAGES = 4;
const MAX_CLIP = 30; // seconds — the trimmed audio clip is capped at 30s
const MAX_CAPTION = 2200;
const PAD = spacing.md;
const VISIBILITY_OPTIONS = [
  { key: 'public', icon: 'globe', label: 'create.post.visEveryone' },
  { key: 'followers', icon: 'users', label: 'create.post.visFollowers' },
  { key: 'private', icon: 'lock', label: 'create.post.visPrivate' },
];

// Format seconds as m:ss.
const fmtTime = (s) => {
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// Library tracks expose the audio at `audio_file`; local picks use `audio_url`.
const songAudioUri = (song) => song?.audio_file || song?.audio_url || null;
// Local picks get a string id like `local-1700…`; library tracks have a numeric id.
const isLocalSong = (song) => String(song?.id ?? '').startsWith('local-');
// Library tracks serialize `artist` as a nested user object; local picks use a
// plain string.
const artistName = (song) =>
  typeof song?.artist === 'string' ? song.artist : song?.artist?.username || 'Unknown Artist';

// The trim preview reports its position every 50 ms. Kept out of React state on
// purpose: as state it re-rendered this entire screen twenty times a second
// while a song played. Only the trimmer's playhead subscribes to it.
const createPlayhead = () => {
  let value = null;
  const subs = new Set();
  return {
    get: () => value,
    set: (v) => { if (v !== value) { value = v; subs.forEach((fn) => fn()); } },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
};

const LiveAudioTrimmer = ({ playhead, ...props }) => {
  const playheadMs = useSyncExternalStore(playhead.subscribe, playhead.get, playhead.get);
  return <AudioTrimmer {...props} playheadMs={playheadMs} />;
};

// ── Media previews ────────────────────────────────────────────────────────────
// Memoised so typing a caption doesn't re-render (and re-decode) the carousel
// or the video player on every keystroke.

const ImageCarousel = memo(({ images, width, onRemove, onCrop, onAdd, t }) => {
  const [index, setIndex] = useState(0);
  return (
    <View style={styles.mediaBlock}>
      <View style={[styles.carouselWrap, { aspectRatio: clampAspect(images[0].width, images[0].height) }]}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {images.map((img, i) => (
            <View key={`${img.uri}_${i}`} style={{ width, height: '100%' }}>
              <Image source={{ uri: img.uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
              <TouchableOpacity style={styles.removeImageBtn} onPress={() => onRemove(i)} hitSlop={8}>
                <Feather name="x" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
        {images.length > 1 && (
          <View style={styles.counterBadge}>
            <Text style={styles.counterText}>{Math.min(index + 1, images.length)}/{images.length}</Text>
          </View>
        )}
      </View>

      {images.length > 1 && (
        <View style={styles.dotsRow}>
          {images.map((_, i) => <View key={i} style={[styles.dot, i === index && styles.dotActive]} />)}
        </View>
      )}

      <View style={styles.chipRow}>
        {images.length === 1 && (
          <TouchableOpacity style={styles.chip} onPress={onCrop}>
            <Feather name="crop" size={15} color={colors.primary} />
            <Text style={styles.chipText}>{t('create.post.crop')}</Text>
          </TouchableOpacity>
        )}
        {images.length < MAX_IMAGES && (
          <TouchableOpacity style={styles.chip} onPress={onAdd}>
            <Feather name="plus" size={15} color={colors.primary} />
            <Text style={styles.chipText}>{t('create.post.addMore', { count: images.length, max: MAX_IMAGES })}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});
ImageCarousel.displayName = 'ImageCarousel';

const VideoPreview = memo(({ media, trimSecs, onTrim, onChange, onCover, coverUri, t }) => (
  <View style={styles.mediaBlock}>
    <View style={[styles.carouselWrap, { aspectRatio: clampAspect(media.width, media.height) }]}>
      <AppVideo
        source={{ uri: media.uri }}
        style={StyleSheet.absoluteFill}
        useNativeControls
        resizeMode="cover"
        isLooping
        shouldPlay={false}
      />
    </View>
    <View style={styles.chipRow}>
      <TouchableOpacity style={styles.chip} onPress={onTrim}>
        <Feather name="scissors" size={15} color={colors.primary} />
        <Text style={styles.chipText}>{t('create.post.trimLabel', { secs: trimSecs })}</Text>
      </TouchableOpacity>
      {onCover && (
        <TouchableOpacity style={styles.chip} onPress={onCover}>
          {coverUri
            ? <Image source={{ uri: coverUri }} style={styles.chipThumb} contentFit="cover" />
            : <Feather name="image" size={15} color={colors.primary} />}
          <Text style={styles.chipText}>{t('create.post.cover')}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.chip} onPress={onChange}>
        <Feather name="refresh-cw" size={15} color={colors.primary} />
        <Text style={styles.chipText}>{t('create.post.changeVideo')}</Text>
      </TouchableOpacity>
    </View>
  </View>
));
VideoPreview.displayName = 'VideoPreview';

const EmptyPicker = memo(({ onCamera, onPick, label, t }) => (
  <View style={styles.mediaBlock}>
    <TouchableOpacity style={styles.pickArea} onPress={onPick} activeOpacity={0.85}>
      <View style={styles.pickIcon}><Feather name="image" size={28} color={colors.primary} /></View>
      <Text style={styles.pickText}>{label}</Text>
    </TouchableOpacity>
    <TouchableOpacity style={styles.cameraButton} onPress={onCamera} activeOpacity={0.85}>
      <Feather name="camera" size={18} color="#fff" />
      <Text style={styles.cameraButtonText}>{t('camera.open')}</Text>
    </TouchableOpacity>
  </View>
));
EmptyPicker.displayName = 'EmptyPicker';

const CreatePost = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const insets = useSafeAreaInsets();
  const kbHeight = useKeyboardHeight();
  const { width: winW } = useWindowDimensions();
  const previewW = winW - PAD * 2;

  const [contentType, setContentType] = useState('image');
  const [media, setMedia] = useState(null);          // single video
  const [images, setImages] = useState([]);          // 1–4 image carousel: [{uri,width,height}]
  const [preparingMedia, setPreparingMedia] = useState(false);
  const [caption, setCaption] = useState('');

  // Song library: the picker paints from the Music tab's cache and loads only
  // when opened. It used to download the library every time this screen
  // opened, for a picker most posts never touch.
  const tracksKey = userKey(currentUser?.id, 'tracks');

  // Who can see it, and whether people can comment.
  const [visibility, setVisibility] = useState('public');
  const [commentsEnabled, setCommentsEnabled] = useState(true);

  // Video cover: a moment of the source clip (seconds) plus its preview still.
  const [coverSec, setCoverSec] = useState(null);
  const [coverUri, setCoverUri] = useState(null);
  const [showCover, setShowCover] = useState(false);
  const coverAvailable = isVideoProcessingAvailable();

  // Drafts saved on this device.
  const [draftId, setDraftId] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const refreshDrafts = useCallback(() => {
    listDrafts(currentUser?.id).then(setDrafts);
  }, [currentUser?.id]);
  useFocusEffect(refreshDrafts);

  const [selectedSong, setSelectedSong] = useState(null);
  const [showSongModal, setShowSongModal] = useState(false);
  const [showTrimModal, setShowTrimModal] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(30);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const playhead = useMemo(createPlayhead, []);
  const soundRef = useRef(null);
  const [localAudio, setLocalAudio] = useState(null);

  // Image cropping
  const [showCropper, setShowCropper] = useState(false);
  const [cropTarget, setCropTarget] = useState(null); // { uri, width, height }
  const originalAssetRef = useRef(null);              // last picked image (crop from original)

  // Video trimming
  const [showVideoTrimmer, setShowVideoTrimmer] = useState(false);
  const [videoTrim, setVideoTrim] = useState({ start: 0, end: 30 }); // seconds

  // Live mirrors so the playback-status callback (set once) reads current values.
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(30);
  const isPreviewingRef = useRef(false);
  trimStartRef.current = trimStart;
  trimEndRef.current = trimEnd;

  // ── Leaving with unsaved work ──
  const submittedRef = useRef(false);
  const hasWork = images.length > 0 || !!media || caption.trim().length > 0 || !!selectedSong;
  const hasWorkRef = useRef(hasWork);
  hasWorkRef.current = hasWork;
  const saveDraftRef = useRef(null);
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (submittedRef.current || !hasWorkRef.current) return;
    e.preventDefault();
    Alert.alert(t('create.post.discardTitle'), t('create.post.leaveBody'), [
      { text: t('create.post.keepEditing'), style: 'cancel' },
      {
        text: t('create.post.saveDraft'),
        onPress: async () => {
          await saveDraftRef.current?.();
          submittedRef.current = true;
          navigation.dispatch(e.data.action);
        },
      },
      { text: t('create.post.discard'), style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
    ]);
  }), [navigation, t]);

  // Drives the playhead and loops playback within the selected [start, end]
  // window (never jumps back to 0). Set once on the sound; reads live refs.
  const onPreviewStatus = useCallback((status) => {
    if (!status.isLoaded || !isPreviewingRef.current) return;
    const pos = status.positionMillis || 0;
    const startMs = trimStartRef.current * 1000;
    const endMs = trimEndRef.current * 1000;
    if (pos >= endMs - 20) {
      soundRef.current?.setPositionAsync(startMs).catch(() => {});
      playhead.set(startMs);
    } else {
      playhead.set(pos);
    }
  }, [playhead]);

  const startPreview = async () => {
    if (!soundRef.current) return;
    try {
      isPreviewingRef.current = true;
      setIsPreviewing(true);
      await soundRef.current.setPositionAsync(trimStartRef.current * 1000);
      playhead.set(trimStartRef.current * 1000);
      await soundRef.current.playAsync();
    } catch {
      isPreviewingRef.current = false;
      setIsPreviewing(false);
    }
  };

  const stopPreview = useCallback(async () => {
    isPreviewingRef.current = false;
    setIsPreviewing(false);
    playhead.set(null);
    try {
      if (soundRef.current) await soundRef.current.pauseAsync();
    } catch { /* already stopped */ }
  }, [playhead]);

  // The trimmer reports the window in ms; mirror to seconds (state + refs).
  const onTrimChange = useCallback((startMs, endMs) => {
    trimStartRef.current = startMs / 1000;
    trimEndRef.current = endMs / 1000;
    setTrimStart(startMs / 1000);
    setTrimEnd(endMs / 1000);
  }, []);

  // Unload audio when leaving the screen.
  useEffect(() => () => {
    if (soundRef.current) soundRef.current.unloadAsync().catch(() => {});
  }, []);

  const openSongLibrary = useCallback(() => setShowSongModal(true), []);

  // Compress an image to a sane upload size (cap at 1080px wide, no upscaling).
  const compressImage = (uri, width) =>
    compressImageFile(uri, { maxWidth: 1080, sourceWidth: width, quality: 0.8 });

  const acceptVideo = useCallback((asset) => {
    // Reject 2K/4K — only 1080p and below. (Unknown dimensions are allowed
    // through; the backend caps resolution on upload as a net.)
    const shortSide = asset.width && asset.height ? Math.min(asset.width, asset.height) : 0;
    if (shortSide > MAX_VIDEO_SHORT_SIDE) {
      Alert.alert(t('create.post.resolutionTitle'), t('create.post.resolutionBody'));
      return;
    }
    setMedia(asset);
    setCoverSec(null);
    setCoverUri(null);
    const durSec = (asset.duration || 0) / 1000;
    setVideoTrim({ start: 0, end: Math.min(30, durSec || 30) });
    setShowVideoTrimmer(true);
  }, [t]);

  useEffect(() => {
    if (coverSec != null && (coverSec < videoTrim.start || coverSec > videoTrim.end)) {
      setCoverSec(null);
      setCoverUri(null);
    }
  }, [videoTrim.start, videoTrim.end, coverSec]);

  const pickMedia = useCallback(async () => {
    try {
      if (contentType === 'video') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          allowsEditing: false,
          quality: 1,
          allowsMultipleSelection: false,
        });
        if (result.canceled || !result.assets?.length) return;
        const selected = result.assets[0];
        // Any length is allowed — the user trims to ≤30s next. Only guard
        // against an unreasonably large raw file.
        if (selected.fileSize && selected.fileSize > 300 * 1024 * 1024) {
          Alert.alert(t('common.error'), t('create.post.videoTooLarge'));
          return;
        }
        acceptVideo(selected);
        return;
      }

      const remaining = MAX_IMAGES - images.length;
      if (remaining <= 0) {
        Alert.alert(t('create.post.limitTitle'), t('create.post.limitBody', { max: MAX_IMAGES }));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.7,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
      });
      if (result.canceled || !result.assets?.length) return;
      const picked = result.assets.slice(0, remaining);

      // A single image into an empty post → offer the crop editor, after a
      // pre-downscale to the upload cap so the cropper decodes a small file.
      if (picked.length === 1 && images.length === 0) {
        const sel = picked[0];
        setPreparingMedia(true);
        try {
          let cropSrc = { uri: sel.uri, width: sel.width, height: sel.height };
          try {
            const out = await compressImage(sel.uri, sel.width);
            cropSrc = { uri: out.uri, width: out.width || sel.width, height: out.height || sel.height };
          } catch (e) {
            console.error('Pre-crop downscale failed; using original:', e);
          }
          originalAssetRef.current = cropSrc;
          setCropTarget(cropSrc);
          setShowCropper(true);
        } finally {
          setPreparingMedia(false);
        }
        return;
      }

      setPreparingMedia(true);
      try {
        const compressed = await Promise.all(
          picked.map(async (a) => {
            try {
              const out = await compressImage(a.uri, a.width);
              return { uri: out.uri, width: out.width || a.width, height: out.height || a.height };
            } catch {
              return { uri: a.uri, width: a.width, height: a.height };
            }
          })
        );
        setImages((prev) => [...prev, ...compressed].slice(0, MAX_IMAGES));
      } finally {
        setPreparingMedia(false);
      }
    } catch (error) {
      console.error('Media picker error:', error);
      Alert.alert(t('common.error'), t('create.post.pickMediaFailed'));
    }
  }, [contentType, images.length, acceptVideo, t]);

  const removeImage = useCallback((index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // A shot from the in-app camera flows into the same paths as a gallery pick.
  const handleCapturedAsset = async (asset) => {
    if (!asset?.uri) return;
    if (asset.type === 'video') {
      setContentType('video');
      acceptVideo(asset);
      return;
    }
    setContentType('image');
    if (images.length >= MAX_IMAGES) {
      Alert.alert(t('create.post.limitTitle'), t('create.post.limitBody', { max: MAX_IMAGES }));
      return;
    }
    setPreparingMedia(true);
    try {
      let src = { uri: asset.uri, width: asset.width, height: asset.height };
      try {
        const out = await compressImage(asset.uri, asset.width);
        src = { uri: out.uri, width: out.width || asset.width, height: out.height || asset.height };
      } catch { /* keep original on compress failure */ }
      if (images.length === 0) {
        originalAssetRef.current = src;
        setCropTarget(src);
        setShowCropper(true);
      } else {
        setImages((prev) => [...prev, src].slice(0, MAX_IMAGES));
      }
    } finally { setPreparingMedia(false); }
  };
  const handleCapturedRef = useRef(handleCapturedAsset);
  handleCapturedRef.current = handleCapturedAsset;

  const openCamera = useCallback(
    () => navigation.navigate('CameraCapture', { onCapture: (a) => handleCapturedRef.current(a) }),
    [navigation],
  );

  // The cropper outputs a compressed JPEG capped at 1080px — used directly.
  const handleCropped = ({ uri, width, height }) => {
    setShowCropper(false);
    setImages([{ uri, width, height }]);
  };

  // Cropper cancelled: keep the current image on a re-crop; on the first pick,
  // fall back to the (pre-downscaled) original so it can still be posted.
  const handleCropCancel = () => {
    setShowCropper(false);
    if (images.length) return;
    const asset = originalAssetRef.current;
    if (asset) setImages([{ uri: asset.uri, width: asset.width, height: asset.height }]);
  };

  const reopenCropper = useCallback(() => {
    const asset = originalAssetRef.current;
    if (!asset) { pickMedia(); return; }
    setCropTarget({ uri: asset.uri, width: asset.width, height: asset.height });
    setShowCropper(true);
  }, [pickMedia]);

  const handleTrimSong = async (song) => {
    const uri = songAudioUri(song);
    if (!uri) {
      Alert.alert(t('common.error'), t('create.post.noPlayableAudio'));
      return;
    }
    setSelectedSong(song);
    setShowSongModal(false);
    setShowTrimModal(true);
    setPlaybackStatus(null);
    setTrimStart(0);

    try {
      await stopPreview();
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const { sound } = await createSound(
        { uri },
        { shouldPlay: false, progressUpdateIntervalMillis: 50, isLooping: true },
        onPreviewStatus
      );
      soundRef.current = sound;
      const status = await sound.getStatusAsync();
      setPlaybackStatus(status);

      // Default: a 30s window centred on the song (or the whole song if shorter).
      const songSeconds = (status.durationMillis || 0) / 1000;
      const clip = Math.min(MAX_CLIP, songSeconds || MAX_CLIP);
      const start = Math.max(0, (songSeconds - clip) / 2);
      trimStartRef.current = start;
      trimEndRef.current = start + clip;
      setTrimStart(start);
      setTrimEnd(start + clip);
    } catch (error) {
      console.error('Error loading song:', error);
      Alert.alert(t('common.error'), t('create.post.trimLoadFailed'));
    }
  };

  const pickLocalAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      // Expo SDK 53+ returns { canceled, assets }; tolerate the legacy shape too.
      if (result.canceled) return;
      const asset = result.assets?.[0] ?? (result.type === 'success' ? result : null);
      if (!asset?.uri) return;
      const name = asset.name || `audio_${Date.now()}.mp3`;
      setLocalAudio({ uri: asset.uri, name, type: asset.mimeType || 'audio/mpeg', size: asset.size });
      handleTrimSong({
        id: `local-${Date.now()}`,
        title: name.replace(/\.[^/.]+$/, ''),
        artist: 'Local File',
        audio_url: asset.uri,
      });
    } catch (error) {
      console.error('Error picking audio:', error);
      Alert.alert(t('common.error'), t('create.post.pickAudioFailed'));
    }
  };

  const closeTrim = async () => { await stopPreview(); setShowTrimModal(false); };

  // Everything on this screen, as a plain object — what a draft stores.
  const draftState = () => ({
    contentType, caption, images, video: media, trim: videoTrim,
    coverSec, thumbUri: coverUri, visibility, commentsEnabled,
    song: selectedSong ? {
      ...selectedSong, start: trimStart, end: trimEnd,
      localAudio: isLocalSong(selectedSong) ? localAudio : null,
    } : null,
  });

  const saveCurrentDraft = async () => {
    try {
      const entry = await saveDraft(currentUser?.id, { id: draftId, state: draftState() });
      setDraftId(entry.id);
      refreshDrafts();
      return entry;
    } catch (e) {
      console.warn('[CreatePost] draft save failed', e?.message);
      Alert.alert(t('common.error'), t('create.post.draftFailed'));
      return null;
    }
  };
  saveDraftRef.current = saveCurrentDraft;

  const openDraft = async (entry) => {
    const s = entry.state || {};
    await stopPreview();
    setShowDrafts(false);
    setDraftId(entry.id);
    setContentType(s.contentType || 'image');
    setCaption(s.caption || '');
    setImages(Array.isArray(s.images) ? s.images : []);
    originalAssetRef.current = s.images?.[0] || null;
    setMedia(s.video || null);
    setVideoTrim(s.trim || { start: 0, end: 30 });
    setCoverSec(s.coverSec ?? null);
    setCoverUri(s.thumbUri || null);
    setVisibility(s.visibility || 'public');
    setCommentsEnabled(s.commentsEnabled !== false);
    if (s.song) {
      const { start, end, localAudio: la, ...song } = s.song;
      // A local song's player source is its draft copy, not the long-gone
      // picker cache file.
      setSelectedSong(la ? { ...song, audio_url: la.uri } : song);
      setLocalAudio(la || null);
      setTrimStart(start || 0);
      setTrimEnd(end || 30);
      trimStartRef.current = start || 0;
      trimEndRef.current = end || 30;
    } else {
      setSelectedSong(null);
      setLocalAudio(null);
    }
  };

  const removeDraft = async (entry) => {
    await deleteDraft(currentUser?.id, entry.id);
    if (entry.id === draftId) setDraftId(null);
    refreshDrafts();
  };

  const removeSong = async () => {
    await stopPreview();
    setSelectedSong(null);
    setLocalAudio(null);
    setPlaybackStatus(null);
  };

  // Hand the post to the background queue and leave. Everything the job needs
  // is copied into a plain snapshot — this screen is gone before it runs.
  const handlePost = async () => {
    if (contentType === 'image' ? images.length === 0 : !media) {
      Alert.alert(t('common.error'), contentType === 'image' ? t('create.post.needImage') : t('create.post.needVideo'));
      return;
    }
    await stopPreview();

    const local = selectedSong && isLocalSong(selectedSong);
    const snap = {
      contentType,
      caption,
      visibility,
      commentsEnabled,
      images: contentType === 'image' ? images : [],
      video: contentType === 'video' ? media : null,
      trim: videoTrim,
      coverSec: contentType === 'video' ? coverSec : null,
      // The cover still, staged with the media so the feed card still has a
      // picture if the upload resumes after a restart. The job ignores it.
      thumbUri: contentType === 'video' ? coverUri : null,
      // Posting a draft: its media folder becomes the upload's (moved, not
      // copied again — see UploadStatus' stageMedia).
      draftId,
      song: contentType === 'image' && selectedSong ? {
        title: selectedSong.title || '',
        artist: artistName(selectedSong),
        audioUrl: local ? null : songAudioUri(selectedSong),
        songId: local ? null : selectedSong.id,
        start: trimStart,
        end: trimEnd,
        localAudio: local ? localAudio : null,
      } : null,
    };

    const previewUri = contentType === 'image' ? images[0].uri : coverUri;
    enqueueUpload({
      kind: 'post',
      title: caption.trim().slice(0, 60),
      thumbUri: previewUri,
      // What the feed's "posting…" card shows until the real post lands.
      preview: {
        contentType,
        uri: previewUri,
        aspect: contentType === 'image'
          ? clampAspect(images[0].width, images[0].height)
          : clampAspect(media.width, media.height),
        caption: caption.trim(),
        visibility,
      },
      snap,
    });
    // The draft's files now belong to the upload; only forget the entry.
    if (draftId) deleteDraft(currentUser?.id, draftId, { keepFiles: true });
    submittedRef.current = true;
    navigation.goBack();
  };

  const canPost = contentType === 'image' ? images.length > 0 : !!media;
  const trimSecs = (videoTrim.end - videoTrim.start).toFixed(0);
  const openVideoTrimmer = useCallback(() => setShowVideoTrimmer(true), []);
  const openCover = useCallback(() => setShowCover(true), []);
  const postsLabel = useCallback((n) => t('sound.uses', { count: n }), [t]);

  return (
    <View style={styles.root}>
      <RotatingBackground intervalMs={60000} scrimColor="rgba(8,18,34,0.72)" />
      <SafeAreaView edges={['top']} style={styles.safe}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.headerIcon} accessibilityLabel={t('common.cancel')}>
            <Feather name="x" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('create.post.title')}</Text>
          <TouchableOpacity
            onPress={() => setShowDrafts(true)}
            hitSlop={8}
            style={styles.draftsBtn}
            accessibilityLabel={t('create.post.drafts')}
          >
            <Feather name="file-text" size={20} color={colors.textPrimary} />
            {drafts.length > 0 && (
              <View style={styles.badge}><Text style={styles.badgeText}>{drafts.length}</Text></View>
            )}
          </TouchableOpacity>
        </View>

        {/* Photo / Video switch */}
        <View style={styles.segment}>
          {[
            { key: 'image', icon: 'image', label: t('create.post.photo') },
            { key: 'video', icon: 'videocam', label: t('create.post.video') },
          ].map((opt) => {
            const active = contentType === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                onPress={() => setContentType(opt.key)}
                activeOpacity={0.85}
              >
                <MaterialIcons name={opt.icon} size={18} color={active ? '#fff' : colors.textSecondary} />
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + (kbHeight || 0) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {contentType === 'video' ? (
            media ? (
              <VideoPreview
                media={media}
                trimSecs={trimSecs}
                onTrim={openVideoTrimmer}
                onChange={pickMedia}
                onCover={coverAvailable ? openCover : null}
                coverUri={coverUri}
                t={t}
              />
            ) : (
              <EmptyPicker onCamera={openCamera} onPick={pickMedia} label={t('create.post.selectVideo')} t={t} />
            )
          ) : images.length > 0 ? (
            <ImageCarousel
              images={images}
              width={previewW}
              onRemove={removeImage}
              onCrop={reopenCropper}
              onAdd={pickMedia}
              t={t}
            />
          ) : (
            <EmptyPicker onCamera={openCamera} onPick={pickMedia} label={t('create.post.selectImages', { max: MAX_IMAGES })} t={t} />
          )}

          {/* Caption */}
          <View style={styles.card}>
            <CaptionComposer
              value={caption}
              onChangeText={setCaption}
              placeholder={t('create.post.captionPlaceholder')}
              maxLength={MAX_CAPTION}
              postsLabel={postsLabel}
            />
          </View>

          {/* Privacy + comments */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>{t('create.post.whoCanSee')}</Text>
            <View style={styles.visRow}>
              {VISIBILITY_OPTIONS.map((opt) => {
                const active = visibility === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.visChip, active && styles.visChipActive]}
                    onPress={() => setVisibility(opt.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <Feather name={opt.icon} size={14} color={active ? '#fff' : colors.textSecondary} />
                    <Text style={[styles.visText, active && styles.visTextActive]}>{t(opt.label)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{t('create.post.allowComments')}</Text>
              <Switch
                value={commentsEnabled}
                onValueChange={setCommentsEnabled}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Song (photos only) */}
          {contentType === 'image' && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{t('create.post.song')}</Text>
              {selectedSong ? (
                <View style={styles.songRow}>
                  <View style={styles.songIcon}><MaterialIcons name="music-note" size={20} color={colors.accent} /></View>
                  <View style={styles.flex}>
                    <Text style={styles.songTitle} numberOfLines={1}>{selectedSong.title}</Text>
                    <Text style={styles.songArtist} numberOfLines={1}>
                      {isLocalSong(selectedSong) ? t('create.post.localFile') : artistName(selectedSong)}
                      {'  ·  '}
                      {t('create.post.trimmed', { start: trimStart.toFixed(1), end: trimEnd.toFixed(1) })}
                    </Text>
                  </View>
                  <TouchableOpacity
                    hitSlop={8}
                    style={styles.songAction}
                    onPress={() => (isLocalSong(selectedSong) ? pickLocalAudio() : handleTrimSong(selectedSong))}
                  >
                    <Feather name="scissors" size={17} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity hitSlop={8} style={styles.songAction} onPress={removeSong}>
                    <Feather name="x" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.songOptions}>
                  <TouchableOpacity style={styles.songOption} onPress={openSongLibrary}>
                    <MaterialIcons name="library-music" size={20} color={colors.primary} />
                    <Text style={styles.songOptionText}>{t('create.post.chooseLibrary')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.songOption} onPress={pickLocalAudio}>
                    <MaterialIcons name="audiotrack" size={20} color={colors.primary} />
                    <Text style={styles.songOptionText}>{t('create.post.pickLocalAudio')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Sticky Post bar, above the home indicator — hidden while typing so it
            doesn't ride up over the caption. */}
        {!kbHeight && (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.sm) + spacing.xs }]}>
            <TouchableOpacity
              style={[styles.draftButton, !hasWork && styles.postButtonDisabled]}
              onPress={async () => {
                const saved = await saveCurrentDraft();
                if (saved) {
                  submittedRef.current = true;
                  navigation.goBack();
                }
              }}
              disabled={!hasWork}
              activeOpacity={0.85}
            >
              <Feather name="save" size={17} color={colors.textPrimary} />
              <Text style={styles.draftButtonText}>{t('create.post.saveDraft')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.postButton, !canPost && styles.postButtonDisabled]}
              onPress={handlePost}
              disabled={!canPost}
              activeOpacity={0.85}
            >
              <Feather name="send" size={18} color="#fff" />
              <Text style={styles.postButtonText}>{t('create.post.share')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>

      {/* Song library */}
      <FullSheet visible={showSongModal} title={t('create.post.selectSong')} onClose={() => setShowSongModal(false)}>
        <SoundLibrary
          tracksKey={tracksKey}
          selectedId={selectedSong?.id}
          onPick={handleTrimSong}
          t={t}
        />
      </FullSheet>

      {/* Song trimming */}
      {showTrimModal && selectedSong && (
        <FullSheet visible={showTrimModal} title={t('create.post.trimSong')} onClose={closeTrim} gestures>
          {playbackStatus ? (
            <View style={styles.trimContainer}>
              <Text style={styles.songTitle} numberOfLines={1}>{selectedSong.title || 'Untitled Song'}</Text>
              <Text style={styles.songArtist} numberOfLines={1}>{artistName(selectedSong)}</Text>

              <View style={styles.trimTimes}>
                <Text style={styles.trimTimeText}>{fmtTime(trimStart)}</Text>
                <View style={styles.trimDurationPill}>
                  <Text style={styles.trimDurationPillText}>{(trimEnd - trimStart).toFixed(1)}s</Text>
                </View>
                <Text style={styles.trimTimeText}>{fmtTime(trimEnd)}</Text>
              </View>

              <LiveAudioTrimmer
                playhead={playhead}
                durationMs={playbackStatus.durationMillis || 0}
                startMs={trimStart * 1000}
                endMs={trimEnd * 1000}
                maxClipMs={MAX_CLIP * 1000}
                minClipMs={1000}
                onChange={onTrimChange}
              />

              <Text style={styles.trimHint}>{t('create.post.trimHint', { max: MAX_CLIP })}</Text>

              <TouchableOpacity style={styles.secondaryButton} onPress={isPreviewing ? stopPreview : startPreview}>
                <Feather name={isPreviewing ? 'pause' : 'play'} size={18} color="#fff" />
                <Text style={styles.secondaryButtonText}>
                  {isPreviewing ? t('create.post.pause') : t('create.post.playSelection')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButton} onPress={closeTrim}>
                <Text style={styles.confirmButtonText}>{t('create.post.confirmSelection')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
          )}
        </FullSheet>
      )}

      {/* Video trimming */}
      {showVideoTrimmer && media && contentType === 'video' && (
        <FullSheet visible={showVideoTrimmer} title={t('create.post.trimVideo')} onClose={() => setShowVideoTrimmer(false)}>
          <ScrollView contentContainerStyle={styles.trimContainer}>
            <VideoTrimmer
              uri={media.uri}
              durationSec={(media.duration || 0) / 1000}
              aspectRatio={clampAspect(media.width, media.height)}
              onChange={(start, end) => setVideoTrim({ start, end })}
            />
            <TouchableOpacity style={styles.confirmButton} onPress={() => setShowVideoTrimmer(false)}>
              <Text style={styles.confirmButtonText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </FullSheet>
      )}

      {/* Video cover */}
      {showCover && media && (
        <FullSheet
          visible={showCover}
          title={t('create.post.selectCover')}
          onClose={() => setShowCover(false)}
          right={(
            <TouchableOpacity onPress={() => setShowCover(false)} hitSlop={8}>
              <Text style={styles.doneText}>{t('common.done')}</Text>
            </TouchableOpacity>
          )}
        >
          <CoverPicker
            uri={media.uri}
            start={videoTrim.start}
            end={videoTrim.end}
            value={coverSec}
            aspect={clampAspect(media.width, media.height)}
            onPick={(sec, uri) => { setCoverSec(sec); setCoverUri(uri); }}
            t={t}
          />
        </FullSheet>
      )}

      {/* Drafts */}
      <FullSheet visible={showDrafts} title={t('create.post.drafts')} onClose={() => setShowDrafts(false)}>
        <DraftsList drafts={drafts} onOpen={openDraft} onDelete={removeDraft} t={t} />
      </FullSheet>

      {/* Preparing overlay while big picked images are compressed. */}
      <Modal visible={preparingMedia} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.preparingOverlay}>
          <View style={styles.preparingCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.preparingText}>{t('create.post.preparingImage')}</Text>
          </View>
        </View>
      </Modal>

      {showCropper && cropTarget && (
        <ImageCropper
          visible={showCropper}
          uri={cropTarget.uri}
          imageWidth={cropTarget.width}
          imageHeight={cropTarget.height}
          onCancel={handleCropCancel}
          onCropped={handleCropped}
        />
      )}
    </View>
  );
};

const GLASS = 'rgba(14,30,52,0.82)';
const HAIRLINE = 'rgba(255,255,255,0.10)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
  },
  headerIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', letterSpacing: 0.2 },
  draftsBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: 3, right: 1, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#0A1628', fontSize: 10, fontWeight: '800' },
  doneText: { color: colors.primary, fontSize: 15, fontWeight: '800' },

  segment: {
    flexDirection: 'row', marginHorizontal: PAD, marginBottom: spacing.sm,
    padding: 4, borderRadius: radius.full, backgroundColor: GLASS,
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: radius.full,
  },
  segmentBtnActive: { backgroundColor: colors.primary },
  segmentText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  segmentTextActive: { color: '#fff' },

  content: { paddingHorizontal: PAD, paddingTop: spacing.xs },

  mediaBlock: { marginBottom: spacing.md },
  pickArea: {
    height: 220, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: GLASS, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(29,161,242,0.45)',
  },
  pickIcon: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(29,161,242,0.14)',
  },
  pickText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600', textAlign: 'center', paddingHorizontal: spacing.md },
  cameraButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: spacing.sm, paddingVertical: 13, borderRadius: radius.full,
    backgroundColor: 'rgba(29,161,242,0.18)', borderWidth: 1, borderColor: 'rgba(29,161,242,0.55)',
  },
  cameraButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  carouselWrap: { width: '100%', borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' },
  removeImageBtn: {
    position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  counterBadge: {
    position: 'absolute', top: 8, left: 8, paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)',
  },
  counterText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { backgroundColor: colors.primary, width: 16 },
  chipRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: GLASS, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(29,161,242,0.5)',
  },
  chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  chipThumb: { width: 18, height: 24, borderRadius: 3 },

  card: {
    backgroundColor: GLASS, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  cardLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm, letterSpacing: 0.3 },
  visRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  visChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  visChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  visText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  visTextActive: { color: '#fff' },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md,
    paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE,
  },
  switchLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },

  songOptions: { flexDirection: 'row', gap: spacing.sm },
  songOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, paddingHorizontal: spacing.sm, borderRadius: radius.md,
    backgroundColor: 'rgba(29,161,242,0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(29,161,242,0.45)',
  },
  songOptionText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  songIcon: {
    width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(244,162,97,0.14)',
  },
  songAction: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  songTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  songArtist: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },

  footer: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: PAD, paddingTop: spacing.sm,
    backgroundColor: 'rgba(8,18,34,0.92)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE,
  },
  draftButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 15, paddingHorizontal: spacing.md, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)',
  },
  draftButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  postButton: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, paddingVertical: 15, borderRadius: radius.full, ...shadows.md,
  },
  postButtonDisabled: { opacity: 0.4 },
  postButtonText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },

  trimContainer: { padding: PAD },
  trimTimes: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 },
  trimTimeText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  trimDurationPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.primary },
  trimDurationPillText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  trimHint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 12, marginBottom: 4 },
  secondaryButton: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(29,161,242,0.18)', borderWidth: 1, borderColor: 'rgba(29,161,242,0.55)',
    padding: 14, borderRadius: radius.full, marginTop: spacing.md,
  },
  secondaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  confirmButton: {
    backgroundColor: colors.primary, padding: 15, borderRadius: radius.full, alignItems: 'center', marginTop: spacing.sm,
  },
  confirmButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  preparingOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  preparingCard: {
    backgroundColor: 'rgba(14,30,52,0.97)', paddingHorizontal: 28, paddingVertical: 24, borderRadius: radius.lg,
    alignItems: 'center', gap: 12, minWidth: 170, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
  },
  preparingText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
});

export default CreatePost;
