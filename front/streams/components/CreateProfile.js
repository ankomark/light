
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image, Alert,
  StyleSheet, ScrollView, ActivityIndicator
} from 'react-native';
import KeyboardLift from './tickets/KeyboardLift';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../services/imageProcessing';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import { fetchProfile, updateProfile, getAccessToken, API_URL } from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import axios from 'axios';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/useAuth';
import { useI18n } from '../context/I18nContext';
import { parseDay, formatDay } from '../utils/calendarDay';

const BIO_MAX = 150;
// Shown as typed; the server reads "example.org" as https://example.org.
const looksLikeLink = (v) => /^(https?:\/\/)?[^\s/.]+\.[^\s]+$/i.test(v.trim());
// The server's own words for a field, when it refuses one.
const FIELDS = ['display_name', 'website', 'bio', 'birth_date', 'location', 'picture'];

const CreateProfile = () => {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const navigation = useNavigation();
  const { updateUser, currentUser } = useAuth();
  // Your profile as the app last read it (/profiles/me/): the form opens
  // filled in at once, and the fresh copy follows.
  const known = currentUser && 'bio' in currentUser ? currentUser : null;
  const kbScroll = useRef(null);
  const [isEditMode, setIsEditMode] = useState(!!(currentUser && 'bio' in currentUser));
  const [checkingProfile, setCheckingProfile] = useState(!known);
  // Your profile couldn't be read (offline): not the same as having none —
  // the form would otherwise offer to create a second one.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [profileData, setProfileData] = useState(() => ({
    display_name: known?.display_name ?? '',
    website: known?.website ?? '',
    bio: known?.bio ?? '',
    birth_date: known?.birth_date ?? '',
    location: known?.location ?? '',
    picture: known?.picture_url ?? null,
  }));
  // Typing has begun: the fresh copy must not overwrite it.
  const touched = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [errors, setErrors] = useState({});
  const [selectedDate, setSelectedDate] = useState(() => parseDay(known?.birth_date) || new Date());

  // Detect edit mode: pre-fill if profile already exists
  useEffect(() => {
    (async () => {
      setLoadFailed(false);
      if (!known) setCheckingProfile(true);
      try {
        const existing = await fetchProfile();
        if (existing && !touched.current) {
          setIsEditMode(true);
          setProfileData({
            display_name: existing.display_name ?? '',
            website: existing.website ?? '',
            bio: existing.bio ?? '',
            birth_date: existing.birth_date ?? '',
            location: existing.location ?? '',
            // `picture` is write-only on the API; the stored URL comes back
            // as picture_url (reading `picture` left the photo blank).
            picture: existing.picture_url ?? null,
          });
          if (existing.birth_date) setSelectedDate(parseDay(existing.birth_date) || new Date());
        }
      } catch (err) {
        // Only "there is none" means create; anything else is a failed read
        // (with the known copy on screen, it simply stays).
        if (err?.response?.status !== 404 && !known) setLoadFailed(true);
      } finally {
        setCheckingProfile(false);
      }
    })();
  }, [attempt]);

  // Handle text input changes
  const handleChange = (key, value) => {
    touched.current = true;
    setProfileData(prev => ({ ...prev, [key]: value }));
    // Clear error when user types
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: null }));
  };

  // Handle image selection with compression
  const handleFileChange = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('createProfile.permissionTitle'), t('createProfile.permissionBody'));
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

        touched.current = true;
        setProfileData(prev => ({ ...prev, picture: compressedImage.uri }));
      }
    } catch (error) {
      console.warn('Image selection error:', error);
      Alert.alert(t('common.error'), t('createProfile.imageFailed'));
    }
  };

  // Handle date selection
  const handleDateChange = (event, date) => {
    setShowDatePicker(false);
    if (date) {
      const formattedDate = formatDay(date);
      setSelectedDate(date);
      handleChange('birth_date', formattedDate);
    }
  };

  // Validate form data
  const validateForm = () => {
    const newErrors = {};
    
    if (!profileData.bio.trim()) {
      newErrors.bio = t('createProfile.bioRequired');
    } else if (profileData.bio.length > BIO_MAX) {
      newErrors.bio = t('createProfile.bioTooLong');
    }
    
    if (!profileData.birth_date) {
      newErrors.birth_date = t('createProfile.birthRequired');
    } else {
      const birthDate = parseDay(profileData.birth_date);
      const minAgeDate = new Date();
      minAgeDate.setFullYear(minAgeDate.getFullYear() - 13);
      
      if (birthDate > minAgeDate) {
        newErrors.birth_date = t('createProfile.tooYoung');
      }
    }
    
    if (!profileData.location.trim()) {
      newErrors.location = t('createProfile.locationRequired');
    }

    if (profileData.website.trim() && !looksLikeLink(profileData.website)) {
      newErrors.website = t('createProfile.websiteInvalid');
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setIsLoading(true);
    try {
      const payload = {
        display_name: profileData.display_name.trim(),
        website: profileData.website.trim(),
        bio: profileData.bio.trim(),
        birth_date: profileData.birth_date,
        location: profileData.location.trim(),
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
        Alert.alert(t('createProfile.updatedTitle'), t('createProfile.updatedBody'));
      } else {
        const token = await getAccessToken().catch(() => null);
        if (!token) {
          Alert.alert(t('createProfile.sessionExpiredTitle'), t('createProfile.sessionExpiredBody'));
          navigation.navigate('Login');
          return;
        }
        await axios.post(`${API_URL}/profiles/create_profile/`, payload, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 15000,
        });
        Alert.alert(t('createProfile.createdTitle'), t('createProfile.createdBody'));
      }
      // Refresh the shared auth state so the new/updated profile shows app-wide.
      await updateUser();
      if (isEditMode && navigation.canGoBack()) {
        // Editing: back to the profile you came from (it refreshes on focus).
        navigation.goBack();
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      }
    } catch (error) {
      console.warn('Profile creation error:', error.response?.data || error);
      
      let errorMessage = t('createProfile.createFailed');
      
      const data = error.response?.data;
      if (data && typeof data === 'object') {
        // The server's words, under the field it refused (and in the alert).
        const fieldErrors = {};
        FIELDS.forEach((f) => { if (Array.isArray(data[f]) && data[f][0]) fieldErrors[f] = String(data[f][0]); });
        if (Object.keys(fieldErrors).length) {
          setErrors((prev) => ({ ...prev, ...fieldErrors }));
          errorMessage = Object.values(fieldErrors)[0];
        } else if (data.non_field_errors) {
          errorMessage = data.non_field_errors[0];
        } else if (data.detail) {
          errorMessage = String(data.detail);
        }
      } else if (String(error?.message || '').includes('timeout')) {
        errorMessage = t('createProfile.timeout');
      }
      
      Alert.alert(t('common.error'), errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  if (!checkingProfile && loadFailed) {
    return (
      <View style={styles.loadFailed} testID="profile-form-failed">
        <MaterialIcons name="wifi-off" size={40} color={colors.textMuted} />
        <Text style={styles.subHeader}>{t('profile.loadFailed')}</Text>
        <TouchableOpacity style={styles.submitButton} onPress={() => setAttempt((n) => n + 1)} accessibilityRole="button">
          <Text style={styles.submitButtonText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (checkingProfile) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardLift scrollRef={kbScroll} style={{ flex: 1 }}>
    <ScrollView
      ref={kbScroll}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.header}>{isEditMode ? t('createProfile.editTitle') : t('createProfile.completeTitle')}</Text>
      <Text style={styles.subHeader}>
        {isEditMode ? t('createProfile.updateSub') : t('createProfile.addSub')}
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
          {profileData.picture ? t('createProfile.changePhoto') : t('createProfile.addPhoto')}
        </Text>
      </TouchableOpacity>

      {/* Name (above the @handle on the profile) */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>{t('createProfile.displayName')}</Text>
        <TextInput
          style={[styles.input, errors.display_name && styles.inputError]}
          placeholder={t('createProfile.displayNamePlaceholder')}
          placeholderTextColor="#a0aec0"
          value={profileData.display_name}
          onChangeText={(value) => handleChange('display_name', value)}
          maxLength={50}
          autoCapitalize="words"
          testID="profile-name-input"
        />
        {errors.display_name && <Text style={styles.errorText}>{errors.display_name}</Text>}
      </View>

      {/* Bio Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>{t('createProfile.bio')}</Text>
        <TextInput
          style={[styles.input, errors.bio && styles.inputError]}
          placeholder={t('createProfile.bioPlaceholder')}
          placeholderTextColor="#a0aec0"
          value={profileData.bio}
          onChangeText={(value) => handleChange('bio', value)}
          multiline
          maxLength={BIO_MAX}
        />
        <Text style={styles.charCount}>
          {profileData.bio.length}/{BIO_MAX}
        </Text>
        {errors.bio && <Text style={styles.errorText}>{errors.bio}</Text>}
      </View>

      {/* Birth Date Input */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>{t('createProfile.birthDate')}</Text>
        <TouchableOpacity 
          style={[styles.input, errors.birth_date && styles.inputError]}
          onPress={() => setShowDatePicker(true)}
        >
          <Text style={profileData.birth_date ? styles.dateText : styles.placeholderText}>
            {profileData.birth_date || t('createProfile.selectBirthDate')}
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
        <Text style={styles.label}>{t('createProfile.location')}</Text>
        <TextInput
          style={[styles.input, errors.location && styles.inputError]}
          placeholder={t('createProfile.locationPlaceholder')}
          placeholderTextColor="#a0aec0"
          value={profileData.location}
          onChangeText={(value) => handleChange('location', value)}
        />
        {errors.location && <Text style={styles.errorText}>{errors.location}</Text>}
      </View>

      {/* One link: a website or ministry page */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>{t('createProfile.website')}</Text>
        <TextInput
          style={[styles.input, errors.website && styles.inputError]}
          placeholder={t('createProfile.websitePlaceholder')}
          placeholderTextColor="#a0aec0"
          value={profileData.website}
          onChangeText={(value) => handleChange('website', value)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          maxLength={200}
          testID="profile-link-input"
        />
        {errors.website && <Text style={styles.errorText}>{errors.website}</Text>}
        {errors.picture && <Text style={styles.errorText}>{errors.picture}</Text>}
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
          <Text style={styles.submitButtonText}>{isEditMode ? t('createProfile.save') : t('createProfile.complete')}</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
    </KeyboardLift>
  );
};

const styles = StyleSheet.create({
  loadFailed: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, backgroundColor: colors.bg },
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