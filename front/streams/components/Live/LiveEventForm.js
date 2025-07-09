import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  Button, 
  StyleSheet, 
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native';
import { useAuth } from '../../context/useAuth';
import { createLiveEvent } from '../../services/api';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const LiveEventForm = ({ navigation, route }) => {
  const { currentUser } = useAuth();
  const [formData, setFormData] = useState({
    youtube_url: route.params?.event?.youtube_url || '',
    title: route.params?.event?.title || '',
    description: route.params?.event?.description || '',
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      title: route.params?.event ? 'Edit Live Event' : 'Create Live Event',
    });
  }, [navigation, route.params]);

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.youtube_url) {
      newErrors.youtube_url = 'YouTube URL is required';
    } else {
      const videoId = extractYoutubeId(formData.youtube_url);
      if (!videoId) {
        newErrors.youtube_url = 'Please enter a valid YouTube live URL';
      }
    }
    
    if (!formData.title) {
      newErrors.title = 'Title is required';
    } else if (formData.title.length > 200) {
      newErrors.title = 'Title must be less than 200 characters';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    
    try {
      const videoId = extractYoutubeId(formData.youtube_url);
      if (!videoId) throw new Error('Invalid YouTube URL');

      const eventData = {
        ...formData,
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        embed_url: `https://www.youtube.com/embed/${videoId}`
      };

      const response = await createLiveEvent(eventData);
      
      // Create complete event object with user data
      const newEvent = {
        ...response,
        user: currentUser,
        is_live: true,
        viewers_count: 0,
        start_time: new Date().toISOString(),
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        embed_url: `https://www.youtube.com/embed/${videoId}`
      };

      // Reset form
      setFormData({ youtube_url: '', title: '', description: '' });

      // Navigate to home screen with new event
      navigation.navigate('LiveHomeScreen', { 
        newEvent,
        refresh: true
      });
      
    } catch (error) {
      let errorMessage = 'Failed to create event';
      
      // Handle specific error cases
      if (error.response) {
        if (error.response.data?.error?.includes('already have an active live event')) {
          errorMessage = 'You already have an active live event. Please end it before creating a new one.';
          
          // Try to fetch the existing event
          try {
            const existingEvents = await fetchLiveEvents({ 
              user_id: currentUser.id,
              is_active: 'true'
            });
            
            if (existingEvents.results?.length > 0) {
              navigation.navigate('LiveEventPlayer', { 
                event: existingEvents.results[0] 
              });
              return;
            }
          } catch (fetchError) {
            console.error('Error fetching existing events:', fetchError);
          }
        } else {
          errorMessage = error.response.data?.error || 
                       error.response.data?.message || 
                       errorMessage;
        }
      } else {
        errorMessage = error.message || errorMessage;
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (name, value) => {
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear error when user types
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: undefined
      }));
    }
  };

  // YouTube ID extraction helper
  const extractYoutubeId = (url) => {
    if (!url) return null;
    
    const patterns = [
      /youtube\.com\/live\/([^"&?\/\s]{11})/,
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|watch\?v=)|youtu\.be\/)([^"&?\/\s]{11})/,
      /youtu\.be\/([^"&?\/\s]{11})/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.formGroup}>
          <Text style={styles.label}>
            YouTube Live URL <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[
              styles.input, 
              errors.youtube_url && styles.inputError
            ]}
            value={formData.youtube_url}
            onChangeText={(text) => handleChange('youtube_url', text)}
            placeholder="https://www.youtube.com/live/..."
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {errors.youtube_url && (
            <Text style={styles.errorText}>{errors.youtube_url}</Text>
          )}
          <Text style={styles.helpText}>
            Paste the URL of your YouTube live stream (e.g., https://youtube.com/live/VIDEO_ID)
          </Text>
        </View>
        
        <View style={styles.formGroup}>
          <Text style={styles.label}>
            Title <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[
              styles.input, 
              errors.title && styles.inputError
            ]}
            value={formData.title}
            onChangeText={(text) => handleChange('title', text)}
            placeholder="Live Event Title"
            maxLength={200}
          />
          {errors.title && (
            <Text style={styles.errorText}>{errors.title}</Text>
          )}
        </View>
        
        <View style={styles.formGroup}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[
              styles.input, 
              styles.multilineInput,
              errors.description && styles.inputError
            ]}
            value={formData.description}
            onChangeText={(text) => handleChange('description', text)}
            placeholder="Describe your live event..."
            multiline
            numberOfLines={4}
          />
        </View>
        
        <View style={styles.buttonContainer}>
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#6200ee" />
          ) : (
            <Button
              title={route.params?.event ? "Update Event" : "Create Event"}
              onPress={handleSubmit}
              disabled={isSubmitting}
              color="#6200ee"
            />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContainer: {
    padding: 20,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    marginBottom: 8,
    fontWeight: '500',
  },
  required: {
    color: 'red',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
  },
  inputError: {
    borderColor: 'red',
  },
  multilineInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  errorText: {
    color: 'red',
    marginTop: 5,
  },
  helpText: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  buttonContainer: {
    marginTop: 20,
  },
});

export default LiveEventForm;