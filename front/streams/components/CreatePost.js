import React, { useState, useEffect } from 'react';
import config from '../config';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  Image, 
  TextInput, 
  StyleSheet, 
  ScrollView,
  Alert 
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Video } from 'expo-av';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { createSocialPost } from '../services/api';

const CreatePost = ({ navigation }) => {
  const [contentType, setContentType] = useState('image');
  const [media, setMedia] = useState(null);
  const [caption, setCaption] = useState('');
  const [selectedSong, setSelectedSong] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  // Request media library permissions
  useEffect(() => {
    (async () => {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required!', 'We need access to your media library to upload files');
      }
    })();
  }, []);

  const pickMedia = async () => {
    try {
      const mediaTypesArray = [contentType === 'video' ? 'videos' : 'images'];
    
      const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: contentType === 'video'
        ? ImagePicker.MediaTypeOptions.Videos
        : ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false, // Don't crop or enforce aspect ratio
      quality: 0.7,
      allowsMultipleSelection: false,
    });
    
      if (!result.canceled && result.assets.length > 0) {
        console.log('PICKED MEDIA OBJECT →', result.assets[0]);
        
        // Validate the selected media
        const selectedMedia = result.assets[0];
        
        if (contentType === 'video') {
          // Check video duration (max 1 minute = 60000ms)
          if (selectedMedia.duration && selectedMedia.duration > 60000) {
            Alert.alert('Error', 'Video must be shorter than 1 minute');
            return;
          }
        }
        
        // Check file size (max 10MB)
        if (selectedMedia.fileSize && selectedMedia.fileSize > 10 * 1024 * 1024) {
          Alert.alert('Error', 'File size must be less than 10MB');
          return;
        }
        
        setMedia(selectedMedia);
      }
    } catch (error) {
      console.error('Media picker error:', error);
      Alert.alert('Error', 'Failed to pick media. Please try again.');
    }
  };

  const handlePost = async () => {
  if (!media) {
    Alert.alert('Error', 'Please select a media file');
    return;
  }

  if (!caption.trim()) {
    Alert.alert('Error', 'Please add a caption');
    return;
  }

  setIsUploading(true);
  try {
    // 1. Upload to Cloudinary first
    console.log('Uploading to Cloudinary...');
    
    const uploadResult = await uploadToCloudinary(media, contentType);
    
    if (!uploadResult.public_id) {
      throw new Error('Failed to get Cloudinary public_id');
    }

    console.log('Cloudinary upload successful:', uploadResult);

    // 2. Create post with Cloudinary public_id (extract filename only)
    const postData = {
      caption: caption.trim(),
      media_file: uploadResult.public_id,  // Send FULL public_id with folder
      content_type: contentType,
      width: uploadResult.width,
      height: uploadResult.height,
      ...(contentType === 'video' && media.duration && { 
        duration: Math.floor(media.duration / 1000)
      }),
    };

    console.log('Sending to backend:', postData);

    const response = await createSocialPost(postData);
    console.log('Post created successfully:', response);
    
    Alert.alert('Success', 'Post created successfully!');
    navigation.goBack();
  } catch (error) {
    console.error('Upload error:', error);
    Alert.alert(
      'Error',
      error.message || 'Failed to create post. Please try again.'
    );
  } finally {
    setIsUploading(false);
  }
};

const uploadToCloudinary = async (mediaFile, type) => {
  const formData = new FormData();
  
  // Prepare file object
  const file = {
    uri: mediaFile.uri,
    name: mediaFile.fileName || `post_${Date.now()}.${type === 'video' ? 'mp4' : 'jpg'}`,
    type: mediaFile.mimeType || (type === 'video' ? 'video/mp4' : 'image/jpeg')
  };

  formData.append('file', file);
  formData.append('upload_preset', config.cloudinary.presets.socialImages);
  formData.append('folder', 'social_media');

  // Determine endpoint
  const endpoint = type === 'video' ? 'video/upload' : 'image/upload';
  
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudinary.cloudName}/${endpoint}`,
    {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Cloudinary upload failed');
  }

  const result = await response.json();
  
  // Log original and processed public_id for debugging
  console.log('Original public_id:', result.public_id);
  console.log('Processed public_id:', result.public_id.split('/').pop());
  
  return result;
};

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>Create New Post</Text>

      {/* Media Type Selector */}
      <View style={styles.typeSelector}>
        <TouchableOpacity
          style={[styles.typeButton, contentType === 'image' && styles.activeType]}
          onPress={() => setContentType('image')}
        >
          <MaterialIcons 
            name="image" 
            size={24} 
            color={contentType === 'image' ? '#fff' : '#666'} 
          />
          <Text style={[styles.typeText, contentType === 'image' && styles.activeTypeText]}>
            Image
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.typeButton, contentType === 'video' && styles.activeType]}
          onPress={() => setContentType('video')}
        >
          <MaterialIcons 
            name="videocam" 
            size={24} 
            color={contentType === 'video' ? '#fff' : '#666'} 
          />
          <Text style={[styles.typeText, contentType === 'video' && styles.activeTypeText]}>
            Video
          </Text>
        </TouchableOpacity>
      </View>

      {/* Media Preview */}
      {media ? (
        <View style={styles.mediaPreviewContainer}>
          {contentType === 'image' ? (
            <Image
              source={{ uri: media.uri }}
              style={styles.mediaPreview}
              resizeMode="contain"
            />
          ) : (
            <Video
              source={{ uri: media.uri }}
              style={styles.mediaPreview}
              useNativeControls
              resizeMode="contain"
              isLooping
              shouldPlay={false}
            />
          )}
          <TouchableOpacity
            style={styles.changeMediaButton}
            onPress={pickMedia}
          >
            <Feather name="edit" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity 
          style={styles.uploadButton}
          onPress={pickMedia}
        >
          <Feather name="upload" size={32} color="#666" />
          <Text style={styles.uploadText}>
            Select {contentType === 'video' ? 'Video' : 'Image'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Caption Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Caption *</Text>
        <TextInput
          style={styles.captionInput}
          placeholder="Write a caption..."
          placeholderTextColor="#999"
          value={caption}
          onChangeText={setCaption}
          multiline
          maxLength={2200}
        />
        <Text style={styles.charCount}>{caption.length}/2200</Text>
      </View>

      {/* Post Button */}
      <TouchableOpacity 
        style={[styles.postButton, isUploading && styles.disabledButton]}
        onPress={handlePost}
        disabled={isUploading}
      >
        <Text style={styles.postButtonText}>
          {isUploading ? 'Posting...' : 'Share Post'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

// Keep the same styles as before
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  typeSelector: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  activeType: {
    backgroundColor: '#1DA1F2',
    borderColor: '#1DA1F2',
  },
  typeText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#666',
  },
  activeTypeText: {
    color: '#fff',
  },
  uploadButton: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ddd',
    borderRadius: 15,
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  uploadText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  mediaPreviewContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  mediaPreview: {
    width: '100%',
    height: 300,
    borderRadius: 8,
    backgroundColor: '#eee'
  },
  changeMediaButton: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: '#0008',
    padding: 6,
    borderRadius: 20,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    color: '#333',
  },
  captionInput: {
    height: 100,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    textAlignVertical: 'top',
    color: '#333',
  },
  postButton: {
    backgroundColor: '#1DA1F2',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  disabledButton: {
    opacity: 0.7,
  },
  postButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  videoThumbnail: {
  width: '100%',
  height: '100%',
  resizeMode: 'cover',
},
videoContainer: {
  position: 'relative',
},
});

export default CreatePost;