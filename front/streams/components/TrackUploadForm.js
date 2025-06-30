

import React, { useState } from 'react';
import { View, TextInput, Button, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker'; // For file uploads
import * as ImagePicker from 'expo-image-picker'; // For image uploads
import { useNavigation } from '@react-navigation/native';
import { createTrack } from '../services/api';

const TrackUploadForm = () => {
    const [title, setTitle] = useState('');
    const [album, setAlbum] = useState('');
    const [audioFile, setAudioFile] = useState(null);
    const [coverImage, setCoverImage] = useState(null);
    const [lyrics, setLyrics] = useState('');
    const [audioFileMessage, setAudioFileMessage] = useState('');
    const [coverImageMessage, setCoverImageMessage] = useState('');
    const navigation = useNavigation();

    const handleAudioFileChange = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: 'audio/*', // Allow only audio files
            });

            if (result.canceled) {
                setAudioFile(null);
                setAudioFileMessage('Please select a valid audio file.');
                return;
            }

            if (result.assets && result.assets[0]) {
                const file = result.assets[0];
                if (file.mimeType.startsWith('audio/')) {
                    setAudioFile(file);
                    setAudioFileMessage(`Audio file selected: ${file.name}`);
                } else {
                    setAudioFile(null);
                    setAudioFileMessage('Please select a valid audio file.');
                }
            } else {
                setAudioFile(null);
                setAudioFileMessage('Failed to select audio file.');
            }
        } catch (error) {
            console.error('Error selecting audio file:', error);
            setAudioFileMessage('Failed to select audio file.');
        }
    };

    const handleCoverImageChange = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                quality: 1,
            });

            if (!result.canceled && result.assets && result.assets[0]) {
                setCoverImage(result.assets[0]);
                setCoverImageMessage(`Cover image selected: ${result.assets[0].fileName}`);
            } else {
                setCoverImage(null);
                setCoverImageMessage('Please select a valid image file.');
            }
        } catch (error) {
            console.error('Error selecting image:', error);
            setCoverImageMessage('Failed to select image.');
        }
    };

    const handleSubmit = async () => {
        if (!title || !audioFile) {
            Alert.alert('Error', 'Please fill out all required fields.');
            return;
        }
    
        const formData = new FormData();
        formData.append('title', title);
        formData.append('album', album);
    
        if (audioFile) {
            formData.append('audio_file', {
              uri: audioFile.uri,
              name: audioFile.name || 'audio.mp3',
              type: audioFile.mimeType || 'audio/mpeg',
            });
          }
          
          if (coverImage) {
            formData.append('cover_image', {
              uri: coverImage.uri,
              name: coverImage.fileName || 'cover.jpg',
              type: coverImage.mimeType || 'image/jpeg',
            });
          }
    
        formData.append('lyrics', lyrics);
    
        // Log the FormData for debugging
        for (let [key, value] of formData.entries()) {
            console.log(key, value);
        }
    
        try {
            const response = await createTrack(formData);
            console.log('Upload response:', response); // Log the response
            navigation.navigate('Home'); // Navigate to Home after successful upload
        } catch (error) {
            console.error('Error uploading track:', error);
            if (error.response) {
                // The request was made and the server responded with a status code
                Alert.alert('Error', `Server error: ${error.response.data.message || error.response.status}`);
            } else if (error.request) {
                // The request was made but no response was received
                Alert.alert('Error', 'No response from the server. Please check your network connection.');
            } else {
                // Something happened in setting up the request
                Alert.alert('Error', 'Failed to upload track. Please try again.');
            }
        }
    };

    return (
        <View style={styles.formContainer}>
            <TextInput
                style={styles.input}
                placeholder="Track Title"
                value={title}
                onChangeText={setTitle}
                required
            />
            <TextInput
                style={styles.input}
                placeholder="Album Name"
                value={album}
                onChangeText={setAlbum}
            />
            <TouchableOpacity style={styles.button} onPress={handleAudioFileChange}>
                <Text style={styles.buttonText}>Select Audio File</Text>
            </TouchableOpacity>
            <Text style={styles.message}>{audioFileMessage}</Text>
            <TouchableOpacity style={styles.button} onPress={handleCoverImageChange}>
                <Text style={styles.buttonText}>Select Cover Image</Text>
            </TouchableOpacity>
            <Text style={styles.message}>{coverImageMessage}</Text>
            <TextInput
                style={styles.textArea}
                placeholder="Lyrics"
                value={lyrics}
                onChangeText={setLyrics}
                multiline
            />
            <TouchableOpacity style={styles.uploadButton} onPress={handleSubmit}>
                <Text style={styles.uploadButtonText}>Upload Track</Text>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    formContainer: {
        padding: 20,
        backgroundColor: '#fff',
        borderRadius: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
        elevation: 5,
        marginVertical: 10,
    },
    input: {
        height: 40,
        borderColor: '#ccc',
        borderWidth: 1,
        borderRadius: 5,
        paddingHorizontal: 10,
        marginBottom: 10,
    },
    button: {
        backgroundColor: '#007BFF',
        padding: 10,
        borderRadius: 5,
        alignItems: 'center',
        marginBottom: 10,
    },
    buttonText: {
        color: '#fff',
    },
    message: {
        color: 'gray',
        fontSize: 12,
        marginBottom: 10,
    },
    textArea: {
        height: 80,
        borderColor: '#ccc',
        borderWidth: 1,
        borderRadius: 5,
        paddingHorizontal: 10,
        marginBottom: 10,
        textAlignVertical: 'top',
    },
    uploadButton: {
        backgroundColor: '#28a745',
        padding: 10,
        borderRadius: 5,
        alignItems: 'center',
    },
    uploadButtonText: {
        color: '#fff',
        fontWeight: 'bold',
    },
});

export default TrackUploadForm;