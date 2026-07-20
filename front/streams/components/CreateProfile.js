
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image, Alert,
  StyleSheet, ScrollView, ActivityIndicator
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../services/imageProcessing';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import { fetchProfile, updateProfile, getAccessToken, API_URL } from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import axios from 'axios';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useAuth } from '../context/useAuth';

const CreateProfile = () => {
  const navigation = useNavigation();
  const { updateUser } = useAuth();
  const [isEditMode, setIsEditMode] = useState(false);
  const [checkingProfile, setCheckingProfile] = useState(true);
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

  // Detect edit mode: pre-fill if profile already exists
  useEffect(() => {
    (async () => {
      try {
        const existing = await fetchProfile();
        if (existing) {
          setIsEditMode(true);
          setProfileData({
            bio: existing.bio ?? '',
            birth_date: existing.birth_date ?? '',
            location: existing.location ?? '',
            picture: existing.picture ?? null,
          });
          if (existing.birth_date) setSelectedDate(new Date(existing.birth_date));
        }
      } catch {
        // No profile yet — stay in create mode
      } finally {
        setCheckingProfile(false);
      }
    })();
  }, []);

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
        const compressedImage = await compressImage(result.assets[0].uri, { width: 800, quality: 0.7 });

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

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setIsLoading(true);
    try {
      const payload = {
        bio: profileData.bio,
        birth_date: profileData.birth_date,
        location: profileData.location,
      };

      // A newly picked photo is a local file — upload it to R2 first and send
      // the resulting URL (the picture column stores a URL string now, not a
      // file). An unchanged existing picture (already an http URL) is left out
      // so the backend keeps the current value.
      if (profileData.picture && (profileData.picture.startsWith('file://') || profileData.picture.startsWith('content://'))) {
        const uploaded = await uploadMedia(
          { uri: profileData.picture, name: `profile_${Date.now()}.jpg`, mimeType: 'image/jpeg' },
          'profile-image',
        );
        payload.picture = uploaded.url;
      }

      if (isEditMode) {
        await updateProfile(payload);
        Alert.alert('Updated!', 'Your profile has been updated.');
      } else {
        const token = await getAccessToken().catch(() => null);
        if (!token) {
          Alert.alert('Session Expired', 'Please log in again');
          navigation.navigate('Login');
          return;
        }
        await axios.post(`${API_URL}/profiles/create_profile/`, payload, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 15000,
        });
        Alert.alert('Profile Created!', 'Your profile has been successfully set up');
      }
      // Refresh the shared auth state so the new/updated profile shows app-wide.
      await updateUser();
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
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

  if (checkingProfile) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.header}>{isEditMode ? 'Edit Profile' : 'Complete Your Profile'}</Text>
      <Text style={styles.subHeader}>
        {isEditMode ? 'Update your personal details' : 'Add your personal details to help others connect with you'}
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
          <Text style={styles.submitButtonText}>{isEditMode ? 'Save Changes' : 'Complete Profile'}</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  header: {
    ...typography.h1,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subHeader: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: colors.primary,
  },
  avatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.inputBg,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  avatarText: {
    marginTop: spacing.sm,
    color: colors.primary,
    fontWeight: '500',
  },
  inputContainer: {
    marginBottom: spacing.md,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  inputError: {
    borderColor: colors.error,
  },
  placeholderText: {
    color: colors.placeholder,
  },
  dateText: {
    color: colors.textPrimary,
  },
  charCount: {
    textAlign: 'right',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
    marginTop: spacing.xs,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    ...shadows.md,
  },
  submitButtonText: {
    ...typography.button,
    color: colors.white,
  },
});

export default CreateProfile;