
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, Alert, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useNavigation } from '@react-navigation/native';
import { API_URL } from '../services/api';

const CreateProfile = () => {
  const navigation = useNavigation();
  const [profileData, setProfileData] = useState({
    bio: '',
    birth_date: '',
    location: '',
    picture: null,
  });

  // Handle text input changes
  const handleChange = (key, value) => {
    setProfileData((prev) => ({ ...prev, [key]: value }));
  };

  // Handle image selection
  const handleFileChange = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'You need to enable permissions to upload a picture.');
        return;
      }
  
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, // Use MediaTypeOptions.Images
        allowsEditing: true,
        quality: 1,
      });
  
      console.log('ImagePicker Result:', result); // Debugging line
  
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const selectedImage = result.assets[0];
        if (selectedImage.uri) {
          setProfileData((prev) => ({ ...prev, picture: selectedImage.uri }));
          console.log('Updated Profile Data:', profileData); // Debugging line
        } else {
          Alert.alert('Error', 'Failed to select image. Please try again.');
        }
      } else {
        Alert.alert('Action Canceled', 'No image was selected.');
      }
    } catch (error) {
      console.error('Error selecting image:', error);
      Alert.alert('Error', 'An unexpected error occurred while selecting the image.');
    }
  };

  // Handle profile submission
  const handleSubmit = async () => {
    // Validate bio, birth_date, and location fields
    if (!profileData.bio || !profileData.birth_date || !profileData.location) {
      Alert.alert('Error', 'Please fill out all fields.');
      return;
    }
  
    // Validate birth_date format
    const isValidDate = validateDate(profileData.birth_date);
    if (!isValidDate) {
      Alert.alert('Error', 'Invalid date format. Please use YYYY-MM-DD.');
      return;
    }
  
    // Create FormData object
    const formData = new FormData();
    Object.entries(profileData).forEach(([key, value]) => {
      if (key === 'picture' && value) {
        formData.append('picture', {
          uri: value,
          type: 'image/jpeg',
          name: 'profile_picture.jpg',
        });
      } else if (key === 'birth_date') {
        // Ensure birth_date is in YYYY-MM-DD format
        formData.append(key, formatDate(value));
      } else {
        formData.append(key, value);
      }
    });
  
    try {
      const token = await AsyncStorage.getItem('accessToken');
      if (!token) {
        Alert.alert('Error', 'Authentication token missing. Please log in again.');
        return;
      }
  
      const response = await axios.post(`${API_URL }/profiles/create_profile/`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });
  
      Alert.alert('Success', 'Profile created successfully!');
      navigation.navigate('Home');
    } catch (error) {
      console.error('Error creating profile:', error.response?.data || error.message);
      if (error.response?.data?.birth_date) {
        Alert.alert('Error', error.response?.data?.birth_date[0]);
      } else {
        Alert.alert('Error', 'Could not create profile. Please check your details and try again.');
      }
    }
  };
  
  // Function to validate date format
  const validateDate = (dateString) => {
    const regex = /^\d{4}-\d{2}-\d{2}$/; // Matches YYYY-MM-DD format
    return regex.test(dateString);
  };
  
  // Function to format date to YYYY-MM-DD if needed
  const formatDate = (dateString) => {
    if (validateDate(dateString)) {
      return dateString; // Already in correct format
    }
  
    // Attempt to parse and reformat the date
    const [day, month, year] = dateString.split('/'); // Assumes MM/DD/YYYY format
    if (day && month && year) {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  
    return ''; // Return empty string if parsing fails
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Create Your Profile</Text>

      <TextInput
        style={styles.input}
        placeholder="Bio"
        placeholderTextColor="#ccc"
        value={profileData.bio}
        onChangeText={(value) => handleChange('bio', value)}
      />

      <TextInput
        style={styles.input}
        placeholder="Birth Date (YYYY-MM-DD)"
        placeholderTextColor="#ccc"
        value={profileData.birth_date}
        onChangeText={(value) => handleChange('birth_date', value)}
      />

      <TextInput
        style={styles.input}
        placeholder="Location"
        placeholderTextColor="#ccc"
        value={profileData.location}
        onChangeText={(value) => handleChange('location', value)}
      />

      <TouchableOpacity style={styles.fileButton} onPress={handleFileChange} activeOpacity={0.7}>
        <Text style={styles.fileButtonText}>
          {profileData.picture ? 'Change Picture' : 'Upload Picture'}
        </Text>
      </TouchableOpacity>

      {profileData.picture && (
        <Image source={{ uri: profileData.picture }} style={styles.imagePreview} />
      )}

      <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
        <Text style={styles.submitButtonText}>Create Profile</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    padding: 20,
    justifyContent: 'center',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f2f2f2',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#0f3460',
    color: '#f2f2f2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 15,
    fontSize: 16,
  },
  fileButton: {
    backgroundColor: '#e94560',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginBottom: 15,
  },
  fileButtonText: {
    color: '#f2f2f2',
    fontSize: 16,
    fontWeight: 'bold',
  },
  imagePreview: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignSelf: 'center',
    marginBottom: 15,
  },
  submitButton: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#f2f2f2',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default CreateProfile;
