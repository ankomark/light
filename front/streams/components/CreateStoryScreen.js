import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView,
  ActivityIndicator, Alert, useWindowDimensions, Image as RNImage,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppVideo from './AppVideo';
import KeyboardLift from './tickets/KeyboardLift';
import FullSheet from './FullSheet';
import VideoTrimmer from './VideoTrimmer';
import CoverPicker from './CoverPicker';
import { compressImage } from '../services/imageProcessing';
import { isVideoProcessingAvailable, extractFrame } from '../services/videoProcessing';
import { enqueueUpload } from '../services/uploadQueue';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { allowAllOrientations, lockPortrait } from '../utils/orientation';

// Video works as on Home's composer (components/CreatePost): any length is
// picked, then trimmed to a window of at most 30 s; a cover frame is chosen;
// on posting the clip is cut to that window, compressed to 720p (~2 Mbps) on
// the phone, and its poster is uploaded with it (services/videoProcessing).
const MAX_CLIP_SEC = 30;
// Where trimming can't run (a build without the native module), only a clip
// that is already short enough can go up as it is.
const MAX_RAW_MS = 31000;
// Like Home: 1080p and below (a little headroom for odd encoder sizes), and a
// sane raw file size.
const MAX_VIDEO_SHORT_SIDE = 1130;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const fmtSec = (sec) => {
  const n = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
// A picture's own shape, within the same bounds Home's feed uses (0.5–1.91):
// shown whole, never cropped to a story-shaped box.
const aspectOf = (w, h) => (w && h ? Math.min(1.91, Math.max(0.5, w / h)) : 9 / 16);
const MAX_CAPTION = 200;
// The header's own height (title row), for sizing the preview to what's left.
const HEADER_H = 56;

/**
 * A new story: pick a photo or video, add a caption, share.
 *
 * Turns with the phone while open (the app is otherwise portrait-only): in
 * portrait the 9:16 preview sits above the caption; in landscape it sits to
 * the left of it, sized by the height, so neither is squeezed. Safe areas on
 * every side, and the caption is kept above the keyboard (KeyboardLift — the
 * window doesn't resize for it on edge-to-edge Android).
 */
const CreateStoryScreen = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const kbScroll = useRef(null);

  const [media, setMedia] = useState(null);
  const [caption, setCaption] = useState('');
  // Video: the window to keep (seconds), and the chosen cover frame.
  const [trim, setTrim] = useState({ start: 0, end: MAX_CLIP_SEC });
  const [coverSec, setCoverSec] = useState(null);
  const [coverUri, setCoverUri] = useState(null);
  const [showTrim, setShowTrim] = useState(false);
  const [showCover, setShowCover] = useState(false);
  // The preview's fallbacks: a still of a picked video, and whether the
  // photo needs React Native's Image instead.
  const [still, setStill] = useState(null);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
    setStill(null);
    if (media?.type !== 'video') return undefined;
    let alive = true;
    extractFrame(media.uri, 0, 720).then((uri) => { if (alive) setStill(uri); }).catch(() => {});
    return () => { alive = false; };
  }, [media]);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);
  const live = useRef(true);
  const posted = useRef(false);   // shared: leave without asking
  useEffect(() => () => { live.current = false; }, []);

  // Rotation only while this screen is in front; portrait again on leaving.
  useFocusEffect(useCallback(() => {
    allowAllOrientations();
    return () => { lockPortrait(); };
  }, []));

  // Leaving with something chosen or typed: ask first, the way the feed's
  // composer does. (Not while it uploads — that finishes on its own.)
  useEffect(() => navigation.addListener?.('beforeRemove', (e) => {
    if (posted.current || uploading || (!media && !caption.trim())) return;
    e.preventDefault();
    Alert.alert(t('story.discardTitle'), t('story.discardBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('story.discard'), style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
    ]);
  }), [navigation, media, caption, uploading, t]);

  const pickMedia = async () => {
    if (picking || uploading) return;
    setPicking(true);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('story.permissionTitle'), t('story.permissionBody'));
        return;
      }
      // No system editor: it trims video its own way on iOS and not at all on
      // Android. Video gets the app's trimmer below, as on Home.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.9,
      });
      const asset = !result.canceled ? result.assets?.[0] : null;
      if (!asset) return;
      if (asset.type === 'video') {
        const shortSide = asset.width && asset.height ? Math.min(asset.width, asset.height) : 0;
        if (shortSide > MAX_VIDEO_SHORT_SIDE) {
          Alert.alert(t('create.post.resolutionTitle'), t('create.post.resolutionBody'));
          return;
        }
        if (asset.fileSize && asset.fileSize > MAX_VIDEO_BYTES) {
          Alert.alert(t('common.error'), t('create.post.videoTooLarge'));
          return;
        }
        if (!isVideoProcessingAvailable() && asset.duration && asset.duration > MAX_RAW_MS) {
          Alert.alert(t('story.tooLongTitle'), t('story.tooLong'));
          return;
        }
        if (!live.current) return;
        const durSec = (asset.duration || 0) / 1000;
        setMedia(asset);
        setTrim({ start: 0, end: Math.min(MAX_CLIP_SEC, durSec || MAX_CLIP_SEC) });
        setCoverSec(null);
        setCoverUri(null);
        // Longer than a story allows: straight to the trimmer.
        if (durSec > MAX_CLIP_SEC) setShowTrim(true);
      } else {
        // As on Home: 1080 wide at most, JPEG ~0.8; a failed squeeze keeps the original.
        const compressed = await compressImage(asset.uri, { maxWidth: 1080, sourceWidth: asset.width, quality: 0.8 })
          .catch(() => null);
        if (live.current) setMedia({ ...asset, type: 'image', uri: compressed?.uri || asset.uri });
      }
    } catch {
      Alert.alert(t('common.error'), t('story.pickFailed'));
    } finally {
      if (live.current) setPicking(false);
    }
  };

  // Share: the work goes to the background queue (as Home's posts do) and
  // this screen closes at once. A pill shows the progress on every screen,
  // the story appears in the row when it's up, and a killed app resumes it.
  const handlePost = () => {
    if (!media) { Alert.alert(t('story.noMediaTitle'), t('story.noMediaBody')); return; }
    if (uploading) return;
    setUploading(true);
    const isVideo = media.type === 'video';
    const snap = {
      caption: caption.trim(),
      ...(isVideo
        ? {
          video: { uri: media.uri, width: media.width, height: media.height, duration: media.duration },
          trim: { start: trim.start, end: trim.end },
          coverSec,
          thumbUri: coverUri || still || null,
        }
        : { images: [{ uri: media.uri, width: media.width, height: media.height }] }),
    };
    enqueueUpload({
      kind: 'story',
      title: caption.trim().slice(0, 60),
      thumbUri: isVideo ? (coverUri || still || null) : media.uri,
      snap,
    });
    posted.current = true;
    navigation.goBack();
  };

  // The preview: the chosen photo or video at its own shape (portrait or
  // landscape, as Home shows it), as large as the space allows; 9:16 while
  // nothing is chosen yet.
  const sideRoom = landscape ? Math.min(width * 0.42, 360) : 0;
  const availH = Math.max(160, height - insets.top - insets.bottom - HEADER_H - spacing.md * 2 - (landscape ? 0 : 150));
  const availW = (landscape ? width - insets.left - insets.right - sideRoom - spacing.md * 3 : width - spacing.md * 2);
  const ratio = media ? aspectOf(media.width, media.height) : 9 / 16;
  const previewW = Math.min(availW, availH * ratio);
  const previewH = previewW / ratio;

  const preview = media ? (
    <View style={[styles.preview, { width: previewW, height: previewH }]} testID="story-preview">
      {media.type === 'video' ? (
        <>
          {/* A still of the clip under the player: the picked video shows even
              before (or if) the player draws. */}
          {!!(coverUri || still) && (
            <Image source={{ uri: coverUri || still }} style={StyleSheet.absoluteFill} contentFit="contain"
                   testID="story-preview-still" />
          )}
          {/* textureView: on Android the default surface ignores the rounded,
              clipped box and could draw nothing in it. */}
          <AppVideo source={{ uri: media.uri }} style={StyleSheet.absoluteFill} resizeMode="contain"
                    surfaceType="textureView" shouldPlay={!showTrim && !showCover} isMuted isLooping />
        </>
      ) : imageFailed ? (
        // expo-image couldn't draw this file: React Native's own Image can.
        <RNImage source={{ uri: media.uri }} style={StyleSheet.absoluteFill} resizeMode="contain"
                 testID="story-preview-fallback" />
      ) : (
        <Image source={{ uri: media.uri }} style={StyleSheet.absoluteFill} contentFit="contain"
               onError={() => setImageFailed(true)} testID="story-preview-image" />
      )}
      <TouchableOpacity style={styles.changeOverlay} onPress={pickMedia} accessibilityRole="button"
                        accessibilityLabel={t('story.change')} hitSlop={8} testID="story-change">
        <Ionicons name="images-outline" size={18} color="#fff" />
        <Text style={styles.changeText}>{t('story.change')}</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <TouchableOpacity style={[styles.picker, { width: previewW, height: previewH }]} onPress={pickMedia}
                      activeOpacity={0.8} accessibilityRole="button" testID="story-pick">
      {picking ? <ActivityIndicator color={colors.primary} /> : (
        <>
          <Ionicons name="images-outline" size={46} color={colors.textMuted} />
          <Text style={styles.pickerTitle}>{t('story.addMedia')}</Text>
          <Text style={styles.pickerSub}>{t('story.expiryNote')}</Text>
        </>
      )}
    </TouchableOpacity>
  );

  // Trim and cover, under a video's preview (as on Home's composer).
  const videoTools = media?.type === 'video' ? (
    <View style={[styles.tools, landscape && styles.toolsSide]}>
      <TouchableOpacity style={styles.chip} onPress={() => setShowTrim(true)} accessibilityRole="button"
                        testID="story-trim">
        <Ionicons name="cut-outline" size={16} color={colors.textPrimary} />
        <Text style={styles.chipText}>
          {t('story.trim', { from: fmtSec(trim.start), to: fmtSec(trim.end), secs: Math.round(trim.end - trim.start) })}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.chip} onPress={() => setShowCover(true)} accessibilityRole="button"
                        testID="story-cover">
        {coverUri
          ? <Image source={{ uri: coverUri }} style={styles.chipThumb} contentFit="cover" />
          : <Ionicons name="image-outline" size={16} color={colors.textPrimary} />}
        <Text style={styles.chipText}>{t('story.cover')}</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  const captionBox = (
    <View style={[styles.captionWrap, landscape && styles.captionWrapSide]}>
      <TextInput
        style={styles.captionInput}
        placeholder={t('story.captionPlaceholder')}
        placeholderTextColor={colors.placeholder}
        value={caption}
        onChangeText={setCaption}
        maxLength={MAX_CAPTION}
        multiline
        textAlignVertical="top"
        accessibilityLabel={t('story.captionPlaceholder')}
        testID="story-caption"
      />
      <Text style={styles.charCount}>{caption.length}/{MAX_CAPTION}</Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingLeft: insets.left, paddingRight: insets.right }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}
                          accessibilityRole="button" accessibilityLabel={t('common.close')} testID="story-close">
          <Ionicons name="close" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{t('story.new')}</Text>
        <TouchableOpacity
          style={[styles.postBtn, (!media || uploading) && styles.postBtnDisabled]}
          onPress={handlePost}
          disabled={!media || uploading}
          accessibilityRole="button"
          accessibilityState={{ disabled: !media || uploading, busy: uploading }}
          testID="story-share"
        >
          {uploading
            ? <ActivityIndicator size="small" color={colors.white} />
            : <Text style={styles.postBtnText}>{t('story.share')}</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardLift scrollRef={kbScroll}>
        <ScrollView
          ref={kbScroll}
          contentContainerStyle={[
            styles.body,
            landscape && styles.bodySide,
            { paddingBottom: insets.bottom + spacing.lg },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {preview}
          <View style={landscape ? styles.sideCol : styles.stackCol}>
            {videoTools}
            {captionBox}
          </View>
        </ScrollView>
      </KeyboardLift>

      {/* Trim: a window of up to 30 s, as on Home. */}
      {showTrim && media?.type === 'video' && (
        <FullSheet visible title={t('create.post.trimVideo')} onClose={() => setShowTrim(false)}>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <VideoTrimmer
              uri={media.uri}
              durationSec={(media.duration || 0) / 1000}
              aspectRatio={aspectOf(media.width, media.height)}
              onChange={(start, end) => {
                setTrim({ start, end });
                // A cover outside the new window no longer belongs to the clip.
                if (coverSec != null && (coverSec < start || coverSec > end)) { setCoverSec(null); setCoverUri(null); }
              }}
            />
            <TouchableOpacity style={styles.sheetDone} onPress={() => setShowTrim(false)} accessibilityRole="button"
                              testID="story-trim-done">
              <Text style={styles.sheetDoneText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </FullSheet>
      )}

      {/* Cover: the frame the stories row and the viewer show before it plays. */}
      {showCover && media?.type === 'video' && (
        <FullSheet
          visible
          title={t('story.cover')}
          onClose={() => setShowCover(false)}
          right={(
            <TouchableOpacity onPress={() => setShowCover(false)} hitSlop={8}>
              <Text style={styles.sheetDoneLink}>{t('common.done')}</Text>
            </TouchableOpacity>
          )}
        >
          <CoverPicker
            uri={media.uri}
            start={trim.start}
            end={trim.end}
            value={coverSec}
            aspect={aspectOf(media.width, media.height)}
            onPick={(sec, uri) => { setCoverSec(sec); setCoverUri(uri); }}
            t={t}
          />
        </FullSheet>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  postBtn: {
    minWidth: 76,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  postBtnDisabled: { opacity: 0.4 },
  postBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  body: { alignItems: 'center', paddingTop: spacing.md, gap: spacing.md },
  bodySide: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: spacing.md },
  preview: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    // Black behind the picture (its letterbox), never the theme's blue.
    backgroundColor: '#000',
  },
  changeOverlay: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  changeText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  picker: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pickerTitle: { ...typography.h3, color: colors.textSecondary, textAlign: 'center' },
  pickerSub: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  stackCol: { alignSelf: 'stretch', gap: spacing.md },
  sideCol: { flex: 1, gap: spacing.md, maxWidth: 420 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginHorizontal: spacing.md },
  toolsSide: { marginHorizontal: 0 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: spacing.md,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  chipThumb: { width: 22, height: 22, borderRadius: 4 },
  sheetBody: { padding: spacing.md, gap: spacing.md },
  sheetDone: {
    alignSelf: 'center', minHeight: 44, minWidth: 140, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.full, backgroundColor: colors.primary, paddingHorizontal: spacing.lg,
  },
  sheetDoneText: { color: colors.white, fontWeight: '700' },
  sheetDoneLink: { color: colors.primary, fontWeight: '700' },
  captionWrap: {
    alignSelf: 'stretch',
    marginHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  captionWrapSide: { alignSelf: 'stretch', marginHorizontal: 0 },
  captionInput: { color: colors.textPrimary, fontSize: 15, minHeight: 72, maxHeight: 160 },
  charCount: { ...typography.caption, color: colors.textMuted, textAlign: 'right', marginTop: 4 },
});

export default CreateStoryScreen;
