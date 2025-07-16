
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Alert,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  ScrollView,
  Platform
} from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { API_URL } from '../services/api';

const EditTrackScreen = ({ route }) => {
  const { track } = route.params;
  const navigation = useNavigation();
  const [title, setTitle] = useState(track.title);
  const [album, setAlbum] = useState(track.album || '');
  const [lyrics, setLyrics] = useState(track.lyrics || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleUpdate = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Track title is required');
      return;
    }

    setIsSubmitting(true);
    
    try {
      const token = await AsyncStorage.getItem('accessToken');
      const formData = new FormData();
      
      formData.append('title', title.trim());
      formData.append('album', album.trim());
      formData.append('lyrics', lyrics.trim());
      
      // Include the existing audio file in the update
      // This assumes track.audio_file is the URL to the existing file
      // You might need to fetch it as a blob first if your backend requires the actual file
      const audioFile = {
        uri: track.audio_file,
        name: 'audio.mp3',
        type: 'audio/mp3'
      };
      formData.append('audio_file', audioFile);

      const response = await axios.put(
        `${API_URL}/tracks/${track.id}/`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      Alert.alert('Success', 'Track updated successfully');
      
      // Navigate back with refresh indicator
      navigation.navigate('Tracks', { 
        shouldRefresh: true 
      });
    } catch (error) {
      console.error('Update error:', error.response?.data || error.message);
      const errorMessage = error.response?.data?.message || 
                         error.response?.data?.error || 
                         'Failed to update track. Please try again.';
      Alert.alert('Error', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 85 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.header}>Edit Track</Text>

        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Track Title *"
          placeholderTextColor="#888"
          maxLength={100}
        />

        <TextInput
          style={styles.input}
          value={album}
          onChangeText={setAlbum}
          placeholder="Album Name"
          placeholderTextColor="#888"
          maxLength={100}
        />

        <TextInput
          style={[styles.input, styles.lyricsInput]}
          value={lyrics}
          onChangeText={setLyrics}
          placeholder="Lyrics"
          placeholderTextColor="#888"
          multiline
          textAlignVertical="top"
          scrollEnabled={false}
          maxLength={2000}
        />

        <TouchableOpacity
          style={[styles.button, isSubmitting && styles.disabledButton]}
          onPress={handleUpdate}
          disabled={isSubmitting}
        >
          <Text style={styles.buttonText}>
            {isSubmitting ? 'Updating...' : 'Update Track'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    color: '#333',
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    fontSize: 16,
    color: '#333',
    backgroundColor: '#f9f9f9',
  },
  lyricsInput: {
    height: 150,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#1DB954',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  disabledButton: {
    backgroundColor: '#90EE90',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default EditTrackScreen;