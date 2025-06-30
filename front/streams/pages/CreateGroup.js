import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useAuth } from '../context/useAuth';
import { createGroup, updateGroup, deleteGroup } from '../services/api';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const GroupForm = ({ navigation, route }) => {
  const { group: existingGroup } = route.params || {};
  const isEditMode = !!existingGroup;
  
  const [name, setName] = useState(existingGroup?.name || '');
  const [description, setDescription] = useState(existingGroup?.description || '');
  const [isPrivate, setIsPrivate] = useState(existingGroup?.is_private ?? true);
  const [coverImage, setCoverImage] = useState(existingGroup?.cover_image || null);
  const [isLoading, setIsLoading] = useState(false);
  const { currentUser } = useAuth();

  useEffect(() => {
    if (isEditMode) {
      navigation.setOptions({
        title: 'Edit Group',
        headerRight: () => (
          <TouchableOpacity 
            onPress={handleDelete}
            style={styles.deleteButton}
          >
            <Ionicons name="trash-outline" size={24} color="#ef4444" />
          </TouchableOpacity>
        ),
      });
    }
  }, [isEditMode]);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please enable photo library access in settings');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets?.length) {
        const processedImage = await manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 1024 } }],
          { compress: 0.7, format: SaveFormat.JPEG }
        );
        setCoverImage(processedImage.uri);
      }
    } catch (error) {
      console.error('Image picker error:', error);
      Alert.alert('Error', 'Failed to select image');
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Validation Error', 'Group name is required');
      return;
    }

    try {
      setIsLoading(true);
      
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('description', description || '');
      formData.append('is_private', String(isPrivate));
      
      if (coverImage && typeof coverImage === 'string' && coverImage.startsWith('file://')) {
        formData.append('cover_image', {
          uri: coverImage,
          name: `cover_${Date.now()}.jpg`,
          type: 'image/jpeg'
        });
      }

      let response;
      if (isEditMode) {
        response = await updateGroup(existingGroup.id, formData);
      } else {
        response = await createGroup(formData);
      }

      route.params?.onSubmit?.(response);
      navigation.goBack();
      
    } catch (error) {
      console.error('Error:', error);
      Alert.alert(
        'Error',
        error.name?.[0] || error.detail || 'Failed to save group. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    Alert.alert(
      'Delete Group',
      'Are you sure you want to delete this group? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              setIsLoading(true);
              await deleteGroup(existingGroup.id);
              route.params?.onDelete?.();
              navigation.goBack();
            } catch (error) {
              console.error('Delete error:', error);
              Alert.alert('Error', 'Failed to delete group');
            } finally {
              setIsLoading(false);
            }
          }
        }
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {isEditMode ? 'Edit Group' : 'Create New Group'}
        </Text>
      </View>

      <View style={styles.formContainer}>
        <TouchableOpacity 
          style={styles.coverImageContainer} 
          onPress={pickImage}
          activeOpacity={0.8}
        >
          {coverImage ? (
            <>
              <Image 
                source={{ uri: coverImage }} 
                style={styles.coverImage} 
                resizeMode="cover"
              />
              <View style={styles.coverImageOverlay}>
                <MaterialIcons name="edit" size={24} color="white" />
              </View>
            </>
          ) : (
            <View style={styles.coverImagePlaceholder}>
              <MaterialIcons name="add-a-photo" size={32} color="#6b7280" />
              <Text style={styles.coverImageText}>Add Cover Image</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Group Name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Enter group name"
            placeholderTextColor="#9ca3af"
            autoCapitalize="words"
            autoFocus={!isEditMode}
          />
        </View>
        
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            value={description}
            onChangeText={setDescription}
            placeholder="What's this group about?"
            placeholderTextColor="#9ca3af"
            multiline
            numberOfLines={4}
          />
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy Settings</Text>
          <View style={styles.privacyContainer}>
            <TouchableOpacity
              style={[styles.privacyOption, isPrivate && styles.selectedOption]}
              onPress={() => setIsPrivate(true)}
              activeOpacity={0.7}
            >
              <View style={styles.radioCircle}>
                {isPrivate && <View style={styles.radioInnerCircle} />}
              </View>
              <Text style={isPrivate ? styles.selectedText : styles.optionText}>Private</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.privacyOption, !isPrivate && styles.selectedOption]}
              onPress={() => setIsPrivate(false)}
              activeOpacity={0.7}
            >
              <View style={styles.radioCircle}>
                {!isPrivate && <View style={styles.radioInnerCircle} />}
              </View>
              <Text style={!isPrivate ? styles.selectedText : styles.optionText}>Public</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.privacyHint}>
            {isPrivate 
              ? 'Only invited members can join this group' 
              : 'Anyone can find and join this group'}
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={[styles.button, styles.cancelButton]}
          onPress={() => navigation.goBack()}
          disabled={isLoading}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.button, 
            styles.submitButton, 
            (!name.trim() || isLoading) && styles.disabledButton
          ]}
          onPress={handleSubmit}
          disabled={!name.trim() || isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.submitButtonText}>
              {isEditMode ? 'Save Changes' : 'Create Group'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    paddingVertical: 20,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
    marginTop:15,
  },
  deleteButton: {
    marginRight: 15,
    padding: 5,
  },
  formContainer: {
    flex: 1,
    padding: 20,
  },
  coverImageContainer: {
    height: 150,
    marginBottom: 24,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverImageOverlay: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  coverImageText: {
    marginTop: 8,
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
    fontWeight: '500',
    color: '#374151',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#ffffff',
    color: '#111827',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  multilineInput: {
    height: 120,
    textAlignVertical: 'top',
  },
  section: {
    marginTop: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
  },
  privacyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  privacyOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginRight: 12,
    backgroundColor: '#ffffff',
  },
  selectedOption: {
    borderColor: '#3b82f6',
    backgroundColor: '#eff6ff',
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#d1d5db',
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInnerCircle: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#3b82f6',
  },
  optionText: {
    color: '#4b5563',
    fontSize: 14,
    fontWeight: '500',
  },
  selectedText: {
    color: '#3b82f6',
    fontWeight: '500',
    fontSize: 14,
  },
  privacyHint: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 6,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  cancelButton: {
    backgroundColor: '#f3f4f6',
  },
  cancelButtonText: {
    color: '#4b5563',
    fontWeight: '600',
    fontSize: 16,
  },
  submitButton: {
    backgroundColor: '#3b82f6',
  },
  disabledButton: {
    backgroundColor: '#93c5fd',
  },
  submitButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
});

export default GroupForm;