
import 'react-native-get-random-values'; 
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, TextInput,KeyboardAvoidingView,Platform, ScrollView } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { useNavigation } from '@react-navigation/native';


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

  // Cloudinary configuration
  const CLOUD_NAME = 'dxdmo9j4v';
  const AUDIO_UPLOAD_PRESET = 'audio_uploads';
  const IMAGE_UPLOAD_PRESET = 'cover_images_preset';
  const AUDIO_FOLDER = 'audio_uploads';
  const IMAGE_FOLDER = 'cover_images';
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

      setTrackData({...trackData, coverImage: image});
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

      const { sound } = await Audio.Sound.createAsync(
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

  const uploadToCloudinary = async (file, resourceType, folder) => {
    const isAudio = resourceType === 'video';
    const uploadPreset = isAudio ? AUDIO_UPLOAD_PRESET : IMAGE_UPLOAD_PRESET;

    const formData = new FormData();
    formData.append('file', {
      uri: file.uri,
      name: file.name || `${uuidv4()}.${isAudio ? 'mp3' : 'jpg'}`,
      type: file.mimeType || (isAudio ? 'audio/mpeg' : 'image/jpeg')
    });
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', folder);
    formData.append('cloud_name', CLOUD_NAME);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`,
      {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Cloudinary upload failed: ${response.status}`);
    }

    return await response.json();
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
      const audioResponse = await uploadToCloudinary(
        trackData.audioFile, 
        'video', 
        AUDIO_FOLDER
      );

      // Upload cover image if exists
      let coverResponse = null;
      if (trackData.coverImage) {
        setStatusMessages(prev => ({ ...prev, image: 'Uploading cover...' }));
        coverResponse = await uploadToCloudinary(
          trackData.coverImage, 
          'image', 
          IMAGE_FOLDER
        );
      }

      // Prepare data for backend
      const trackPayload = {
        title: trackData.title,
        audio_file: audioResponse.secure_url,
        cover_image: coverResponse?.secure_url || null,
        album: trackData.album || null,
        lyrics: trackData.lyrics || null
      };

      // Send to your Django backend
      const response = await axios.post('/api/tracks/upload/', trackPayload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer YOUR_AUTH_TOKEN`
        }
      });

      Alert.alert('Success', 'Track uploaded successfully!');
      navigation.goBack();
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert(
        'Upload Failed', 
        error.response?.data?.message || error.message || 'Upload failed'
      );
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
              placeholderTextColor="#999"
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
              placeholderTextColor="#999"
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
              placeholderTextColor="#999"
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
              <ActivityIndicator color="#fff" size="small" />
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
    backgroundColor: '#f8f9fa',
  },
  scrollContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2c3e50',
    marginBottom: 24,
    textAlign: 'center',
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#34495e',
    marginBottom: 8,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: '#e0e6ed',
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#2c3e50',
    backgroundColor: '#f8fafc',
  },
  textArea: {
    height: 150,
    borderWidth: 1,
    borderColor: '#e0e6ed',
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    color: '#2c3e50',
    backgroundColor: '#f8fafc',
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#4a6da7',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  buttonDisabled: {
    backgroundColor: '#b5c4e3',
  },
  statusMessage: {
    fontSize: 14,
    marginTop: 6,
    paddingHorizontal: 4,
  },
  statusInfo: {
    color: '#7f8c8d',
  },
  statusSuccess: {
    color: '#27ae60',
  },
  previewControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
    gap: 10,
  },
  previewButton: {
    backgroundColor: '#1DB954',
    padding: 10,
    borderRadius: 6,
    flex: 1,
    alignItems: 'center',
  },
  previewButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  submitButton: {
    backgroundColor: '#191414',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  submitButtonDisabled: {
    backgroundColor: '#555',
  },
});

export default TrackUploadForm;