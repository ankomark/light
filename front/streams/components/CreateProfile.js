
// import React, { useState } from 'react';
// import { View, Text, TextInput, TouchableOpacity, Image, Alert, StyleSheet } from 'react-native';
// import * as ImagePicker from 'expo-image-picker';
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import axios from 'axios';
// import { useNavigation } from '@react-navigation/native';
// import { API_URL } from '../services/api';

// const CreateProfile = () => {
//   const navigation = useNavigation();
//   const [profileData, setProfileData] = useState({
//     bio: '',
//     birth_date: '',
//     location: '',
//     picture: null,
//   });

//   // Handle text input changes
//   const handleChange = (key, value) => {
//     setProfileData((prev) => ({ ...prev, [key]: value }));
//   };

//   // Handle image selection
//   const handleFileChange = async () => {
//     try {
//       const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
//       if (status !== 'granted') {
//         Alert.alert('Permission Denied', 'You need to enable permissions to upload a picture.');
//         return;
//       }
  
//       const result = await ImagePicker.launchImageLibraryAsync({
//         mediaTypes: ImagePicker.MediaTypeOptions.Images, // Use MediaTypeOptions.Images
//         allowsEditing: true,
//         quality: 0.4,
//       });
  
//       console.log('ImagePicker Result:', result); // Debugging line
  
//       if (!result.canceled && result.assets && result.assets.length > 0) {
//         const selectedImage = result.assets[0];
//         if (selectedImage.uri) {
//           setProfileData((prev) => ({ ...prev, picture: selectedImage.uri }));
//           console.log('Updated Profile Data:', profileData); // Debugging line
//         } else {
//           Alert.alert('Error', 'Failed to select image. Please try again.');
//         }
//       } else {
//         Alert.alert('Action Canceled', 'No image was selected.');
//       }
//     } catch (error) {
//       console.error('Error selecting image:', error);
//       Alert.alert('Error', 'An unexpected error occurred while selecting the image.');
//     }
//   };

//   // Handle profile submission
//   const handleSubmit = async () => {
//     // Validate bio, birth_date, and location fields
//     if (!profileData.bio || !profileData.birth_date || !profileData.location) {
//       Alert.alert('Error', 'Please fill out all fields.');
//       return;
//     }
  
//     // Validate birth_date format
//     const isValidDate = validateDate(profileData.birth_date);
//     if (!isValidDate) {
//       Alert.alert('Error', 'Invalid date format. Please use YYYY-MM-DD.');
//       return;
//     }
  
//     // Create FormData object
//     const formData = new FormData();
//     Object.entries(profileData).forEach(([key, value]) => {
//       if (key === 'picture' && value) {
//         formData.append('picture', {
//           uri: value,
//           type: 'image/jpeg',
//           name: 'profile_picture.jpg',
//         });
//       } else if (key === 'birth_date') {
//         // Ensure birth_date is in YYYY-MM-DD format
//         formData.append(key, formatDate(value));
//       } else {
//         formData.append(key, value);
//       }
//     });
  
//     try {
//       const token = await AsyncStorage.getItem('accessToken');
//       if (!token) {
//         Alert.alert('Error', 'Authentication token missing. Please log in again.');
//         return;
//       }
  
//       const response = await axios.post(`${API_URL }/profiles/create_profile/`, formData, {
//         headers: {
//           Authorization: `Bearer ${token}`,
//           'Content-Type': 'multipart/form-data',
//         },
//       });
  
//       Alert.alert('Success', 'Profile created successfully!');
//       navigation.navigate('Home');
//     } catch (error) {
//       console.error('Error creating profile:', error.response?.data || error.message);
//       if (error.response?.data?.birth_date) {
//         Alert.alert('Error', error.response?.data?.birth_date[0]);
//       } else {
//         Alert.alert('Error', 'Could not create profile. Please check your details and try again.');
//       }
//     }
//   };
  
//   // Function to validate date format
//   const validateDate = (dateString) => {
//     const regex = /^\d{4}-\d{2}-\d{2}$/; // Matches YYYY-MM-DD format
//     return regex.test(dateString);
//   };
  
//   // Function to format date to YYYY-MM-DD if needed
//   const formatDate = (dateString) => {
//     if (validateDate(dateString)) {
//       return dateString; // Already in correct format
//     }
  
//     // Attempt to parse and reformat the date
//     const [day, month, year] = dateString.split('/'); // Assumes MM/DD/YYYY format
//     if (day && month && year) {
//       return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
//     }
  
//     return ''; // Return empty string if parsing fails
//   };

//   return (
//     <View style={styles.container}>
//       <Text style={styles.header}>Create Your Profile</Text>

//       <TextInput
//         style={styles.input}
//         placeholder="Bio"
//         placeholderTextColor="#ccc"
//         value={profileData.bio}
//         onChangeText={(value) => handleChange('bio', value)}
//       />

//       <TextInput
//         style={styles.input}
//         placeholder="Birth Date (YYYY-MM-DD)"
//         placeholderTextColor="#ccc"
//         value={profileData.birth_date}
//         onChangeText={(value) => handleChange('birth_date', value)}
//       />

//       <TextInput
//         style={styles.input}
//         placeholder="Location"
//         placeholderTextColor="#ccc"
//         value={profileData.location}
//         onChangeText={(value) => handleChange('location', value)}
//       />

//       <TouchableOpacity style={styles.fileButton} onPress={handleFileChange} activeOpacity={0.7}>
//         <Text style={styles.fileButtonText}>
//           {profileData.picture ? 'Change Picture' : 'Upload Picture'}
//         </Text>
//       </TouchableOpacity>

//       {profileData.picture && (
//         <Image source={{ uri: profileData.picture }} style={styles.imagePreview} />
//       )}

//       <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
//         <Text style={styles.submitButtonText}>Create Profile</Text>
//       </TouchableOpacity>
//     </View>
//   );
// };

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: '#1a1a2e',
//     padding: 20,
//     justifyContent: 'center',
//   },
//   header: {
//     fontSize: 24,
//     fontWeight: 'bold',
//     color: '#f2f2f2',
//     marginBottom: 20,
//     textAlign: 'center',
//   },
//   input: {
//     backgroundColor: '#0f3460',
//     color: '#f2f2f2',
//     borderRadius: 8,
//     padding: 12,
//     marginBottom: 15,
//     fontSize: 16,
//   },
//   fileButton: {
//     backgroundColor: '#e94560',
//     borderRadius: 8,
//     padding: 12,
//     alignItems: 'center',
//     marginBottom: 15,
//   },
//   fileButtonText: {
//     color: '#f2f2f2',
//     fontSize: 16,
//     fontWeight: 'bold',
//   },
//   imagePreview: {
//     width: 100,
//     height: 100,
//     borderRadius: 50,
//     alignSelf: 'center',
//     marginBottom: 15,
//   },
//   submitButton: {
//     backgroundColor: '#16213e',
//     borderRadius: 8,
//     padding: 12,
//     alignItems: 'center',
//   },
//   submitButtonText: {
//     color: '#f2f2f2',
//     fontSize: 18,
//     fontWeight: 'bold',
//   },
// });

// export default CreateProfile;

import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  Image, 
  Alert, 
  StyleSheet, 
  ScrollView,
  ActivityIndicator
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import DateTimePicker from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useNavigation } from '@react-navigation/native';
import { API_URL } from '../services/api';
import { MaterialIcons } from '@expo/vector-icons';

const CreateProfile = () => {
  const navigation = useNavigation();
  const [profileData, setProfileData] = useState({
    bio: '',
    birth_date: '',
    location: '',
    picture: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [errors, setErrors] = useState({});
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Handle text input changes
  const handleChange = (key, value) => {
    setProfileData(prev => ({ ...prev, [key]: value }));
    // Clear error when user types
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: null }));
  };

  // Handle image selection with compression
  const handleFileChange = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please enable photo access to upload a profile picture');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.4,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        // Compress image
        const compressedImage = await ImageManipulator.manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 800 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
        );
        
        setProfileData(prev => ({ ...prev, picture: compressedImage.uri }));
      }
    } catch (error) {
      console.error('Image selection error:', error);
      Alert.alert('Error', 'Could not process the image. Please try another one.');
    }
  };

  // Handle date selection
  const handleDateChange = (event, date) => {
    setShowDatePicker(false);
    if (date) {
      const formattedDate = date.toISOString().split('T')[0];
      setSelectedDate(date);
      handleChange('birth_date', formattedDate);
    }
  };

  // Validate form data
  const validateForm = () => {
    const newErrors = {};
    
    if (!profileData.bio.trim()) {
      newErrors.bio = 'Bio is required';
    } else if (profileData.bio.length > 150) {
      newErrors.bio = 'Bio should be under 150 characters';
    }
    
    if (!profileData.birth_date) {
      newErrors.birth_date = 'Birth date is required';
    } else {
      const birthDate = new Date(profileData.birth_date);
      const currentDate = new Date();
      const minAgeDate = new Date();
      minAgeDate.setFullYear(minAgeDate.getFullYear() - 13);
      
      if (birthDate > minAgeDate) {
        newErrors.birth_date = 'You must be at least 13 years old';
      }
    }
    
    if (!profileData.location.trim()) {
      newErrors.location = 'Location is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle profile submission
  const handleSubmit = async () => {
    if (!validateForm()) return;
    
    setIsLoading(true);
    
    try {
      const token = await AsyncStorage.getItem('accessToken');
      if (!token) {
        Alert.alert('Session Expired', 'Please log in again');
        navigation.navigate('Login');
        return;
      }

      const formData = new FormData();
      
      // Append text fields
      formData.append('bio', profileData.bio);
      formData.append('birth_date', profileData.birth_date);
      formData.append('location', profileData.location);
      
      // Append image if exists
      if (profileData.picture) {
        formData.append('picture', {
          uri: profileData.picture,
          type: 'image/jpeg',
          name: 'profile_pic.jpg',
        });
      }

      const response = await axios.post(
        `${API_URL}/profiles/create_profile/`, 
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
          timeout: 15000,
        }
      );

      Alert.alert('Profile Created!', 'Your profile has been successfully set up');
      navigation.navigate('Home');
    } catch (error) {
      console.error('Profile creation error:', error.response?.data || error);
      
      let errorMessage = 'Could not create profile. Please try again.';
      
      if (error.response?.data) {
        // Handle backend validation errors
        if (error.response.data.birth_date) {
          errorMessage = error.response.data.birth_date[0];
        } else if (error.response.data.non_field_errors) {
          errorMessage = error.response.data.non_field_errors[0];
        }
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Request timed out. Check your connection.';
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView 
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.header}>Complete Your Profile</Text>
      <Text style={styles.subHeader}>
        Add your personal details to help others connect with you
      </Text>

      {/* Profile Picture Section */}
      <TouchableOpacity 
        style={styles.avatarContainer}
        onPress={handleFileChange}
      >
        {profileData.picture ? (
          <Image 
            source={{ uri: profileData.picture }} 
            style={styles.avatar}
          />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <MaterialIcons name="add-a-photo" size={40} color="#6c757d" />
          </View>
        )}
        <Text style={styles.avatarText}>
          {profileData.picture ? 'Change Photo' : 'Add Profile Photo'}
        </Text>
      </TouchableOpacity>

      {/* Bio Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>Bio</Text>
        <TextInput
          style={[styles.input, errors.bio && styles.inputError]}
          placeholder="Tell others about yourself"
          placeholderTextColor="#a0aec0"
          value={profileData.bio}
          onChangeText={(value) => handleChange('bio', value)}
          multiline
          maxLength={150}
        />
        <Text style={styles.charCount}>
          {profileData.bio.length}/150
        </Text>
        {errors.bio && <Text style={styles.errorText}>{errors.bio}</Text>}
      </View>

      {/* Birth Date Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>Birth Date</Text>
        <TouchableOpacity 
          style={[styles.input, errors.birth_date && styles.inputError]}
          onPress={() => setShowDatePicker(true)}
        >
          <Text style={profileData.birth_date ? styles.dateText : styles.placeholderText}>
            {profileData.birth_date || 'Select your birth date'}
          </Text>
        </TouchableOpacity>
        {errors.birth_date && <Text style={styles.errorText}>{errors.birth_date}</Text>}
        
        {showDatePicker && (
          <DateTimePicker
            value={selectedDate}
            mode="date"
            display="default"
            onChange={handleDateChange}
            maximumDate={new Date()}
          />
        )}
      </View>

      {/* Location Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>Location</Text>
        <TextInput
          style={[styles.input, errors.location && styles.inputError]}
          placeholder="City, Country"
          placeholderTextColor="#a0aec0"
          value={profileData.location}
          onChangeText={(value) => handleChange('location', value)}
        />
        {errors.location && <Text style={styles.errorText}>{errors.location}</Text>}
      </View>

      {/* Submit Button */}
      <TouchableOpacity 
        style={styles.submitButton}
        onPress={handleSubmit}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>Complete Profile</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#fff',
    padding: 20,
    paddingTop: 40,
  },
  header: {
    fontSize: 28,
    fontWeight: '700',
    color: '#2d3748',
    marginBottom: 8,
    textAlign: 'center',
  },
  subHeader: {
    fontSize: 16,
    color: '#718096',
    textAlign: 'center',
    marginBottom: 30,
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#e2e8f0',
  },
  avatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#edf2f7',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
  },
  avatarText: {
    marginTop: 10,
    color: '#4299e1',
    fontWeight: '500',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: '#4a5568',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f7fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    color: '#2d3748',
  },
  inputError: {
    borderColor: '#e53e3e',
  },
  placeholderText: {
    color: '#a0aec0',
  },
  dateText: {
    color: '#2d3748',
  },
  charCount: {
    textAlign: 'right',
    fontSize: 12,
    color: '#a0aec0',
    marginTop: 4,
  },
  errorText: {
    color: '#e53e3e',
    fontSize: 14,
    marginTop: 5,
  },
  submitButton: {
    backgroundColor: '#4299e1',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    shadowColor: '#4299e1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});

export default CreateProfile;