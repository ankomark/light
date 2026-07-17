import React, { useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert, Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { uploadMedia } from '../services/cloudinary';
import { processVideo } from '../services/videoProcessing';
import { createStory } from '../services/api';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const { width } = Dimensions.get('window');

// Stories cap video at 30s (WhatsApp-style). expo-image-picker reports asset
// duration in milliseconds; allow a small tolerance so a ~30s clip isn't
// rejected for being a few frames over.
const MAX_VIDEO_MS = 30000;
const MAX_VIDEO_TOLERANCE_MS = 31000;

const CreateStoryScreen = () => {
  const navigation = useNavigation();
  const [media, setMedia] = useState(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);

  const pickMedia = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your media library to add a story.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: true,
      aspect: [9, 16],
      quality: 0.9,
      videoMaxDuration: 30, // caps in-picker trimming / recording to 30s
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      // Hard 30s cap: in-picker trimming isn't guaranteed on gallery picks, so
      // reject anything clearly longer rather than uploading an over-length clip.
      if (asset.type === 'video' && asset.duration && asset.duration > MAX_VIDEO_TOLERANCE_MS) {
        Alert.alert(
          'Video too long',
          'Stories can be up to 30 seconds. Please trim your clip and try again.',
        );
        return;
      }
      if (asset.type === 'image') {
        // Compress image before upload
        const compressed = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 1080 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );
        setMedia({ ...asset, uri: compressed.uri });
      } else {
        setMedia(asset);
      }
    }
  };

  const handlePost = async () => {
    if (!media) { Alert.alert('No media', 'Please select a photo or video first.'); return; }
    setUploading(true);
    try {
      const isVideo = media.type === 'video';
      // R2 stores bytes verbatim, so compress/downscale story video on-device
      // (Cloudinary used to do this at ingest). Stories are already <=30s, so
      // no trim window here — just compress to <=1080p.
      let uploadUri = media.uri;
      if (isVideo) {
        const processed = await processVideo({
          uri: media.uri, width: media.width, height: media.height,
        });
        uploadUri = processed.uri;
      }
      const uploadType = isVideo ? 'story-video' : 'social-image';
      const result = await uploadMedia(
        { uri: uploadUri, name: `story_${Date.now()}`, mimeType: isVideo ? 'video/mp4' : 'image/jpeg' },
        uploadType,
      );
      await createStory({
        media_file: result.publicId,
        media_url: result.url,
        content_type: media.type === 'video' ? 'video' : 'image',
        caption: caption.trim(),
      });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Upload failed', err.message ?? 'Could not post your story. Try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="close" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>New Story</Text>
        <TouchableOpacity
          style={[styles.postBtn, (!media || uploading) && styles.postBtnDisabled]}
          onPress={handlePost}
          disabled={!media || uploading}
        >
          {uploading
            ? <ActivityIndicator size="small" color={colors.white} />
            : <Text style={styles.postBtnText}>Share</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Preview */}
      {media ? (
        <TouchableOpacity style={styles.preview} onPress={pickMedia} activeOpacity={0.9}>
          <Image source={{ uri: media.uri }} style={styles.previewImage} resizeMode="cover" />
          <View style={styles.changeOverlay}>
            <Ionicons name="images-outline" size={22} color="#fff" />
            <Text style={styles.changeText}>Change</Text>
          </View>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.picker} onPress={pickMedia} activeOpacity={0.8}>
          <Ionicons name="images-outline" size={52} color={colors.textMuted} />
          <Text style={styles.pickerTitle}>Add Photo or Video</Text>
          <Text style={styles.pickerSub}>Stories disappear after 24 hours</Text>
        </TouchableOpacity>
      )}

      {/* Caption */}
      <View style={styles.captionWrap}>
        <TextInput
          style={styles.captionInput}
          placeholder="Add a caption..."
          placeholderTextColor={colors.placeholder}
          value={caption}
          onChangeText={setCaption}
          maxLength={200}
          multiline
        />
        <Text style={styles.charCount}>{caption.length}/200</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40 },
  title: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  postBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  postBtnDisabled: { opacity: 0.4 },
  postBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  preview: {
    width: '100%',
    height: width * (16 / 9),
    maxHeight: 420,
    backgroundColor: colors.surface,
  },
  previewImage: { width: '100%', height: '100%' },
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
  changeText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  picker: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  pickerTitle: { ...typography.h3, color: colors.textSecondary },
  pickerSub: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  captionWrap: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  captionInput: { color: colors.textPrimary, fontSize: 15, minHeight: 50 },
  charCount: { ...typography.caption, color: colors.textMuted, textAlign: 'right', marginTop: 4 },
});

export default CreateStoryScreen;
