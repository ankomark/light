import 'react-native-get-random-values';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { createSound } from '../services/audioPlayer';
import * as FileSystem from 'expo-file-system/legacy';
import axios from 'axios';
import { useNavigation } from '@react-navigation/native';
import { API_URL, getAccessToken } from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import { compressImage } from '../services/imageProcessing';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';

const TrackUploadForm = () => {
  const navigation = useNavigation();
  const [trackData, setTrackData] = useState({
    title: '',
    audioFile: null,
    coverImage: null,
    album: '',
    lyrics: '',
  });
  const [isUploading, setIsUploading] = useState(false);
  const [previewSound, setPreviewSound] = useState(null);
  const [statusMessages, setStatusMessages] = useState({
    audio: '',
    image: ''
  });

  const MAX_AUDIO_SIZE_MB = 20;
  const MAX_IMAGE_SIZE_MB = 5;

  // Clean up audio preview on unmount
  useEffect(() => {
    return () => {
      if (previewSound) {
        previewSound.unloadAsync();
      }
    };
  }, [previewSound]);

  const pickAudioFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });
      
      if (result.canceled || !result.assets?.[0]) {
        setStatusMessages(prev => ({ ...prev, audio: 'No file selected' }));
        return;
      }

      const file = result.assets[0];
      const fileInfo = await FileSystem.getInfoAsync(file.uri);
      const fileSizeMB = fileInfo.size / (1024 * 1024);

      if (fileSizeMB > MAX_AUDIO_SIZE_MB) {
        setStatusMessages(prev => ({ 
          ...prev, 
          audio: `File too large (max ${MAX_AUDIO_SIZE_MB}MB)` 
        }));
        return;
      }

      setTrackData({...trackData, audioFile: file});
      setStatusMessages(prev => ({ 
        ...prev, 
        audio: `Selected: ${file.name} (${fileSizeMB.toFixed(1)}MB)` 
      }));
    } catch (error) {
      console.error('Error picking audio file:', error);
      setStatusMessages(prev => ({ ...prev, audio: 'Failed to select audio' }));
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

      if (result.canceled || !result.assets?.[0]) {
        setStatusMessages(prev => ({ ...prev, image: 'No image selected' }));
        return;
      }

      const image = result.assets[0];
      const fileInfo = await FileSystem.getInfoAsync(image.uri);
      const fileSizeMB = fileInfo.size / (1024 * 1024);

      if (fileSizeMB > MAX_IMAGE_SIZE_MB) {
        setStatusMessages(prev => ({ 
          ...prev, 
          image: `Image too large (max ${MAX_IMAGE_SIZE_MB}MB)` 
        }));
        return;
      }

      // Compress cover image before upload
      const compressed = await compressImage(image.uri, { width: 800, quality: 0.8 });
      setTrackData({...trackData, coverImage: { ...image, uri: compressed.uri }});
      setStatusMessages(prev => ({ 
        ...prev, 
        image: `Selected: ${image.fileName || 'cover'} (${fileSizeMB.toFixed(1)}MB)` 
      }));
    } catch (error) {
      console.error('Error picking image:', error);
      setStatusMessages(prev => ({ ...prev, image: 'Failed to select image' }));
    }
  };

  const playPreview = async () => {
    if (!trackData.audioFile) return;
    
    try {
      // Stop any existing playback
      if (previewSound) {
        await previewSound.unloadAsync();
      }

      const { sound } = await createSound(
        { uri: trackData.audioFile.uri },
        { shouldPlay: true }
      );
      setPreviewSound(sound);
      await sound.playAsync();
    } catch (error) {
      console.error('Error playing preview:', error);
      Alert.alert('Playback Error', 'Could not play audio file');
    }
  };

  const stopPreview = async () => {
    if (previewSound) {
      await previewSound.stopAsync();
      await previewSound.unloadAsync();
      setPreviewSound(null);
    }
  };

  const uploadToCloudinary = async (file, type) => {
    return uploadMedia(file, type);
  };

  const uploadTrack = async () => {
    if (!trackData.title || !trackData.audioFile) {
      Alert.alert('Error', 'Title and audio file are required');
      return;
    }

    setIsUploading(true);

    try {
      // Upload audio to Cloudinary
      setStatusMessages(prev => ({ ...prev, audio: 'Uploading audio...' }));
      const audioResponse = await uploadToCloudinary(trackData.audioFile, 'audio');

      // Upload cover image if exists
      let coverResponse = null;
      if (trackData.coverImage) {
        setStatusMessages(prev => ({ ...prev, image: 'Uploading cover...' }));
        coverResponse = await uploadToCloudinary(trackData.coverImage, 'cover');
      }

      // Prepare data for backend
      const trackPayload = {
        title: trackData.title,
        audio_file: audioResponse.publicId,
        cover_image: coverResponse?.publicId || null,
        album: trackData.album || null,
        lyrics: trackData.lyrics || null
      };

      const token = await getAccessToken().catch(() => null);
      if (!token) {
        throw new Error('Authentication token not found. Please log in again.');
      }

      // Send to your Django backend
      const response = await axios.post(
        `${API_URL}/tracks/upload/`,
        trackPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        }
      );

      Alert.alert('Success', 'Track uploaded successfully!');
      navigation.goBack();
    } catch (error) {
      console.error('Upload error:', error);
      
      // Improved error message
      let errorMessage = 'Upload failed';
      if (error.response) {
        // Handle Django error formats
        if (error.response.data?.detail) {
          errorMessage = error.response.data.detail;
        } else if (error.response.data?.error) {
          errorMessage = error.response.data.error;
        } else if (typeof error.response.data === 'string') {
          errorMessage = error.response.data;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      Alert.alert('Upload Failed', errorMessage);
    } finally {
      setIsUploading(false);
      setStatusMessages({ audio: '', image: '' });
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.header}>Upload New Track</Text>
          
          <View style={styles.formGroup}>
            <Text style={styles.label}>Track Title *</Text>
            <TextInput
              style={styles.input}
              value={trackData.title}
              onChangeText={(text) => setTrackData({...trackData, title: text})}
              placeholder="Enter track title"
              placeholderTextColor={colors.placeholder}
              editable={!isUploading}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Audio File *</Text>
            <TouchableOpacity 
              style={[
                styles.button,
                isUploading && styles.buttonDisabled
              ]} 
              onPress={pickAudioFile}
              disabled={isUploading}
            >
              <Text style={styles.buttonText}>
                {trackData.audioFile ? 'Change Audio File' : 'Select Audio File'}
              </Text>
            </TouchableOpacity>
            <Text style={[
              styles.statusMessage,
              statusMessages.audio.includes('Selected:') ? styles.statusSuccess : styles.statusInfo
            ]}>
              {statusMessages.audio}
            </Text>

            {trackData.audioFile && (
              <View style={styles.previewControls}>
                <TouchableOpacity 
                  style={styles.previewButton} 
                  onPress={playPreview}
                >
                  <Text style={styles.previewButtonText}>▶️ Play Preview</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.previewButton} 
                  onPress={stopPreview}
                >
                  <Text style={styles.previewButtonText}>⏹ Stop</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Cover Image</Text>
            <TouchableOpacity 
              style={[
                styles.button,
                isUploading && styles.buttonDisabled
              ]} 
              onPress={pickCoverImage}
              disabled={isUploading}
            >
              <Text style={styles.buttonText}>
                {trackData.coverImage ? 'Change Cover Image' : 'Select Cover Image'}
              </Text>
            </TouchableOpacity>
            <Text style={[
              styles.statusMessage,
              statusMessages.image.includes('Selected:') ? styles.statusSuccess : styles.statusInfo
            ]}>
              {statusMessages.image}
            </Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Album</Text>
            <TextInput
              style={styles.input}
              value={trackData.album}
              onChangeText={(text) => setTrackData({...trackData, album: text})}
              placeholder="Enter album name"
              placeholderTextColor={colors.placeholder}
              editable={!isUploading}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Lyrics</Text>
            <TextInput
              style={styles.textArea}
              value={trackData.lyrics}
              onChangeText={(text) => setTrackData({...trackData, lyrics: text})}
              placeholder="Enter lyrics"
              placeholderTextColor={colors.placeholder}
              multiline
              numberOfLines={6}
              editable={!isUploading}
            />
          </View>

          <TouchableOpacity 
            style={[
              styles.submitButton,
              isUploading && styles.submitButtonDisabled
            ]} 
            onPress={uploadTrack}
            disabled={isUploading}
          >
            {isUploading ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitButtonText}>Upload Track</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContainer: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.md,
  },
  header: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  formGroup: {
    marginBottom: spacing.md + 4,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
  },
  textArea: {
    height: 150,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '500',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  statusMessage: {
    fontSize: 14,
    marginTop: 6,
    paddingHorizontal: 4,
  },
  statusInfo: {
    color: colors.textMuted,
  },
  statusSuccess: {
    color: colors.success,
  },
  previewControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.sm + 4,
    gap: 10,
  },
  previewButton: {
    backgroundColor: colors.surface,
    padding: 10,
    borderRadius: radius.sm,
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  previewButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  submitButton: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    ...shadows.sm,
  },
  submitButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
});

export default TrackUploadForm;