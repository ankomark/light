import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView,
  ActivityIndicator, Alert, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppVideo from './AppVideo';
import KeyboardLift from './tickets/KeyboardLift';
import { uploadMedia } from '../services/cloudinary';
import { compressImage } from '../services/imageProcessing';
import { processVideo } from '../services/videoProcessing';
import { createStory } from '../services/api';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { allowAllOrientations, lockPortrait } from '../utils/orientation';
import { emit, EVENTS } from '../utils/appEvents';

// Stories cap video at 30s (WhatsApp-style). expo-image-picker reports asset
// duration in milliseconds; allow a small tolerance so a ~30s clip isn't
// rejected for being a few frames over.
const MAX_VIDEO_TOLERANCE_MS = 31000;
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
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: true,
        aspect: [9, 16],
        quality: 0.9,
        videoMaxDuration: 30, // caps in-picker trimming / recording to 30s
      });
      const asset = !result.canceled ? result.assets?.[0] : null;
      if (!asset) return;
      // Hard 30s cap: in-picker trimming isn't guaranteed on gallery picks, so
      // reject anything clearly longer rather than uploading an over-length clip.
      if (asset.type === 'video' && asset.duration && asset.duration > MAX_VIDEO_TOLERANCE_MS) {
        Alert.alert(t('story.tooLongTitle'), t('story.tooLong'));
        return;
      }
      if (asset.type === 'video') {
        if (live.current) setMedia(asset);
      } else {
        // Smaller before upload; a failed squeeze keeps the original.
        const compressed = await compressImage(asset.uri, { width: 1080, quality: 0.8 }).catch(() => null);
        if (live.current) setMedia({ ...asset, type: 'image', uri: compressed?.uri || asset.uri });
      }
    } catch {
      Alert.alert(t('common.error'), t('story.pickFailed'));
    } finally {
      if (live.current) setPicking(false);
    }
  };

  const handlePost = async () => {
    if (!media) { Alert.alert(t('story.noMediaTitle'), t('story.noMediaBody')); return; }
    if (uploading) return;
    setUploading(true);
    try {
      const isVideo = media.type === 'video';
      // R2 stores bytes verbatim, so compress/downscale story video on-device.
      // Stories are already <=30s, so no trim window — just 720p at a capped bitrate.
      let uploadUri = media.uri;
      if (isVideo) {
        const processed = await processVideo({ uri: media.uri, width: media.width, height: media.height });
        uploadUri = processed.uri;
      }
      const result = await uploadMedia(
        { uri: uploadUri, name: `story_${Date.now()}`, mimeType: isVideo ? 'video/mp4' : 'image/jpeg' },
        isVideo ? 'story-video' : 'social-image',
      );
      const story = await createStory({
        media_file: result.publicId,
        media_url: result.url,
        content_type: isVideo ? 'video' : 'image',
        caption: caption.trim(),
      });
      // The stories row shows it now, not after its next refresh.
      emit(EVENTS.STORY_CREATED, story);
      posted.current = true;
      navigation.goBack();
    } catch (err) {
      if (live.current) Alert.alert(t('common.uploadFailedTitle'), err?.message || t('story.uploadFailed'));
    } finally {
      if (live.current) setUploading(false);
    }
  };

  // The preview: 9:16, as large as the space allows.
  const sideRoom = landscape ? Math.min(width * 0.42, 360) : 0;
  const availH = height - insets.top - insets.bottom - HEADER_H - spacing.md * 2 - (landscape ? 0 : 150);
  const availW = (landscape ? width - insets.left - insets.right - sideRoom - spacing.md * 3 : width - spacing.md * 2);
  const previewH = Math.max(160, Math.min(availH, (availW * 16) / 9));
  const previewW = (previewH * 9) / 16;

  const preview = media ? (
    <TouchableOpacity style={[styles.preview, { width: previewW, height: previewH }]} onPress={pickMedia}
                      activeOpacity={0.9} accessibilityRole="button" accessibilityLabel={t('story.change')}
                      testID="story-preview">
      {media.type === 'video' ? (
        <AppVideo source={{ uri: media.uri }} style={StyleSheet.absoluteFill} resizeMode="cover"
                  shouldPlay isMuted isLooping />
      ) : (
        <Image source={{ uri: media.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      )}
      <View style={styles.changeOverlay} pointerEvents="none">
        <Ionicons name="images-outline" size={18} color="#fff" />
        <Text style={styles.changeText}>{t('story.change')}</Text>
      </View>
    </TouchableOpacity>
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
          {captionBox}
        </ScrollView>
      </KeyboardLift>
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
    backgroundColor: colors.surface,
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
  captionWrap: {
    alignSelf: 'stretch',
    marginHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  captionWrapSide: { flex: 1, alignSelf: 'flex-start', marginHorizontal: 0, maxWidth: 420 },
  captionInput: { color: colors.textPrimary, fontSize: 15, minHeight: 72, maxHeight: 160 },
  charCount: { ...typography.caption, color: colors.textMuted, textAlign: 'right', marginTop: 4 },
});

export default CreateStoryScreen;
