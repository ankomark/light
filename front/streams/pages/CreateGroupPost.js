import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  ScrollView,
  SafeAreaView,
  Dimensions,
  Keyboard,
  Animated,
  ActivityIndicator,
  Easing,
  Alert
} from 'react-native';
import { useAuth } from '../context/useAuth';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { MaterialIcons, FontAwesome, Ionicons, Feather, AntDesign } from '@expo/vector-icons';

const { height } = Dimensions.get('window');

const CreateGroupPost = ({ onSubmit, onCancel }) => {
  const { currentUser } = useAuth();
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const inputRef = useRef(null);
  const scrollViewRef = useRef(null);
  const buttonScaleAnim = useRef(new Animated.Value(1)).current;
  const modalSlideAnim = useRef(new Animated.Value(height)).current;
  const recordingTimerRef = useRef(null);

  // Animation for recording indicator
  const recordingPulseAnim = useRef(new Animated.Value(1)).current;
  const recordingColorAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    // Entry animation
    Animated.timing(modalSlideAnim, {
      toValue: 0,
      duration: 350,
      useNativeDriver: true,
      easing: Easing.out(Easing.back(1)),
    }).start();

    // Focus input after animation completes
    setTimeout(() => inputRef.current?.focus(), 400);
  }, []);

  useEffect(() => {
    if (isRecording) {
      // Start recording timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      // Pulse animation for recording
      Animated.loop(
        Animated.sequence([
          Animated.timing(recordingPulseAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(recordingPulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Color change animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(recordingColorAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: false,
          }),
          Animated.timing(recordingColorAnim, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: false,
          }),
        ])
      ).start();
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      setRecordingDuration(0);
      recordingPulseAnim.stopAnimation();
      recordingColorAnim.stopAnimation();
    }
  }, [isRecording]);

  const closeModal = () => {
    Animated.timing(modalSlideAnim, {
      toValue: height,
      duration: 300,
      useNativeDriver: true,
    }).start(onCancel);
  };

  const requestPermissions = async () => {
    await Audio.requestPermissionsAsync();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
  };

  const handleAddMedia = async (type) => {
    try {
      if (type === 'image' || type === 'video') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: type === 'image' 
            ? ImagePicker.MediaTypeOptions.Images 
            : ImagePicker.MediaTypeOptions.Videos,
          allowsEditing: true,
          quality: 0.8,
        });

        if (!result.canceled) {
          addAttachment({
            type,
            uri: result.assets[0].uri,
            name: `${type}_${Date.now()}.${type === 'image' ? 'jpg' : 'mp4'}`,
          });
        }
      } else if (type === 'document') {
        const result = await DocumentPicker.getDocumentAsync({
          type: '*/*',
          copyToCacheDirectory: true,
        });

        if (result.type === 'success') {
          addAttachment({
            type: 'document',
            uri: result.uri,
            name: result.name,
            mimeType: result.mimeType,
          });
        }
      }
    } catch (error) {
      console.error(`Error picking ${type}:`, error);
      Alert.alert('Error', `Failed to select ${type}. Please try again.`);
    }
  };

  const addAttachment = (attachment) => {
    setAttachments(prev => [...prev, attachment]);
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const startRecording = async () => {
    try {
      await requestPermissions();
      setIsRecording(true);
      
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
    } catch (error) {
      console.error('Failed to start recording:', error);
      setIsRecording(false);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    try {
      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      
      addAttachment({
        type: 'audio',
        uri,
        name: `recording_${Date.now()}.m4a`,
        duration: recordingDuration,
      });
      
      setRecording(null);
      setRecordingDuration(0);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Error', 'Failed to save recording.');
    }
  };

  const handleRecordVoice = async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  const playAudio = async (uri) => {
    try {
      const { sound } = await Audio.Sound.createAsync({ uri });
      await sound.playAsync();
    } catch (error) {
      console.error('Failed to play audio:', error);
      Alert.alert('Error', 'Failed to play audio.');
    }
  };

  const handleSubmit = async () => {
    if (!content.trim() && attachments.length === 0) {
      Alert.alert('Empty Post', 'Please add content or an attachment');
      return;
    }

    try {
      setIsSubmitting(true);
      const formData = new FormData();
      
      formData.append('content', content);
      
      attachments.forEach((attachment) => {
        formData.append('attachments', {
          uri: attachment.uri,
          type: getMimeType(attachment.type),
          name: attachment.name,
        });
      });

      await onSubmit(formData);
      setContent('');
      setAttachments([]);
    } catch (error) {
      console.error('Failed to create post:', error);
      Alert.alert('Error', error.message || 'Failed to create post. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getMimeType = (type) => {
    const mimeTypes = {
      image: 'image/jpeg',
      video: 'video/mp4',
      audio: 'audio/m4a',
      document: 'application/octet-stream',
    };
    return mimeTypes[type] || 'application/octet-stream';
  };

  const removeAttachment = (index) => {
    const newAttachments = [...attachments];
    newAttachments.splice(index, 1);
    setAttachments(newAttachments);
  };

  const animateButton = (type) => {
    Animated.sequence([
      Animated.timing(buttonScaleAnim, {
        toValue: 0.9,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.timing(buttonScaleAnim, {
        toValue: 1,
        duration: 80,
        useNativeDriver: true,
      }),
    ]).start(() => {
      switch (type) {
        case 'image': handleAddMedia('image'); break;
        case 'video': handleAddMedia('video'); break;
        case 'document': handleAddMedia('document'); break;
        case 'audio': handleRecordVoice(); break;
      }
    });
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const renderAttachmentPreview = (attachment, index) => {
    const attachmentStyles = {
      image: {
        view: styles.attachmentImageContainer,
        content: (
          <Image 
            source={{ uri: attachment.uri }} 
            style={styles.attachmentImage}
            resizeMode="cover"
          />
        )
      },
      video: {
        view: styles.attachmentVideoContainer,
        content: (
          <>
            <Ionicons name="videocam" size={24} color="#FFFFFF" />
            <Text style={styles.attachmentVideoText}>Video</Text>
          </>
        )
      },
      audio: {
        view: styles.attachmentAudioContainer,
        content: (
          <>
            <Feather name="mic" size={24} color="#FFFFFF" />
            <Text style={styles.attachmentAudioText}>
              {formatDuration(attachment.duration || 0)}
            </Text>
          </>
        )
      },
      document: {
        view: styles.attachmentDocumentContainer,
        content: (
          <>
            <AntDesign name="file1" size={24} color="#FFFFFF" />
            <Text 
              style={styles.attachmentDocumentText} 
              numberOfLines={1} 
              ellipsizeMode="middle"
            >
              {attachment.name}
            </Text>
          </>
        )
      }
    };

    const style = attachmentStyles[attachment.type] || attachmentStyles.document;

    return (
      <TouchableOpacity
        onPress={() => attachment.type === 'audio' && playAudio(attachment.uri)}
        activeOpacity={0.8}
      >
        <View style={style.view}>
          {style.content}
        </View>
      </TouchableOpacity>
    );
  };

  const recordingColor = recordingColorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#EF4444', '#F87171']
  });

  return (
    <View style={styles.overlayContainer}>
      <TouchableOpacity 
        style={styles.overlay} 
        activeOpacity={1} 
        onPress={closeModal}
      />
      
      <Animated.View
        style={[
          styles.modalContainer,
          { 
            transform: [{ translateY: modalSlideAnim }],
            paddingBottom: keyboardHeight > 0 ? keyboardHeight + 20 : 20,
          },
        ]}
      >
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <View style={styles.userInfo}>
              <Image
                source={
                  currentUser?.profile?.picture
                    ? { uri: currentUser.profile.picture }
                    : require('../assets/user-placeholder.png')
                }
                style={styles.avatar}
                onError={(e) => console.error('Image load error:', e.nativeEvent.error)}
              />
              <View style={styles.userText}>
                <Text style={styles.username}>
                  {currentUser?.username || 'User'}
                </Text>
                <Text style={styles.postingTo}>Create Post</Text>
              </View>
            </View>
            
            <TouchableOpacity 
              onPress={closeModal}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={scrollViewRef}
            style={styles.contentScroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {attachments.length > 0 && (
              <ScrollView
                horizontal
                style={styles.attachmentsScroll}
                contentContainerStyle={styles.attachmentsContainer}
                showsHorizontalScrollIndicator={false}
              >
                {attachments.map((attachment, index) => (
                  <View key={`attachment-${index}`} style={styles.attachmentItem}>
                    {renderAttachmentPreview(attachment, index)}
                    <TouchableOpacity
                      style={styles.removeAttachmentButton}
                      onPress={() => removeAttachment(index)}
                    >
                      <MaterialIcons name="close" size={18} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            <View style={styles.inputContainer}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="What's on your mind?"
                placeholderTextColor="#9CA3AF"
                value={content}
                onChangeText={setContent}
                multiline
                editable={!isSubmitting}
                textAlignVertical="top"
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.attachmentOptions}>
              <Animated.View style={{ transform: [{ scale: buttonScaleAnim }] }}>
                <TouchableOpacity
                  style={[styles.attachmentOption, styles.photoOption]}
                  onPress={() => animateButton('image')}
                  disabled={isSubmitting}
                >
                  <FontAwesome name="photo" size={22} color="#4F46E5" />
                </TouchableOpacity>
              </Animated.View>

              <Animated.View style={{ transform: [{ scale: buttonScaleAnim }] }}>
                <TouchableOpacity
                  style={[styles.attachmentOption, styles.videoOption]}
                  onPress={() => animateButton('video')}
                  disabled={isSubmitting}
                >
                  <Ionicons name="videocam-outline" size={22} color="#10B981" />
                </TouchableOpacity>
              </Animated.View>

              <Animated.View style={{ transform: [{ scale: buttonScaleAnim }] }}>
                <TouchableOpacity
                  style={[styles.attachmentOption, styles.documentOption]}
                  onPress={() => animateButton('document')}
                  disabled={isSubmitting}
                >
                  <FontAwesome name="file-text-o" size={22} color="#F59E0B" />
                </TouchableOpacity>
              </Animated.View>

              <Animated.View style={[
                styles.attachmentOption, 
                styles.audioOption,
                isRecording && { 
                  backgroundColor: recordingColor,
                  transform: [{ scale: recordingPulseAnim }]
                }
              ]}>
                <TouchableOpacity
                  onPress={() => animateButton('audio')}
                  disabled={isSubmitting}
                >
                  <FontAwesome
                    name={isRecording ? 'stop' : 'microphone'}
                    size={22}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>
              </Animated.View>

              {isRecording && (
                <View style={styles.recordingTimer}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingTime}>
                    {formatDuration(recordingDuration)}
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.postButton,
                (!content.trim() && attachments.length === 0) && styles.postButtonDisabled,
                isSubmitting && styles.postButtonSubmitting,
              ]}
              onPress={handleSubmit}
              disabled={isSubmitting || (!content.trim() && attachments.length === 0)}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.postButtonText}>Post</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlayContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    marginTop: 60,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: '#E5E7EB',
    resizeMode: 'cover',
  },
  username: {
    fontWeight: '600',
    fontSize: 15,
    color: '#006060',
  },
  postingTo: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  contentScroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 8,
  },
  attachmentsScroll: {
    marginBottom: 16,
  },
  attachmentsContainer: {
    paddingRight: 16,
  },
  attachmentItem: {
    position: 'relative',
    marginRight: 12,
  },
  attachmentImageContainer: {
    width: 100,
    height: 100,
    borderRadius: 12,
    overflow: 'hidden',
  },
  attachmentImage: {
    width: '100%',
    height: '100%',
  },
  attachmentVideoContainer: {
    width: 100,
    height: 100,
    borderRadius: 12,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentVideoText: {
    fontSize: 14,
    color: '#FFFFFF',
    marginTop: 8,
    fontWeight: '500',
  },
  attachmentAudioContainer: {
    width: 100,
    height: 100,
    borderRadius: 12,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentAudioText: {
    fontSize: 14,
    color: '#FFFFFF',
    marginTop: 8,
    fontWeight: '500',
  },
  attachmentDocumentContainer: {
    width: 100,
    height: 100,
    borderRadius: 12,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  attachmentDocumentText: {
    fontSize: 12,
    color: '#FFFFFF',
    marginTop: 8,
    fontWeight: '500',
    textAlign: 'center',
  },
  removeAttachmentButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  inputContainer: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    minHeight: 120,
  },
  input: {
    fontSize: 16,
    color: '#111827',
    lineHeight: 24,
    padding: 0,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  attachmentOptions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attachmentOption: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  photoOption: {
    backgroundColor: '#E0E7FF',
  },
  videoOption: {
    backgroundColor: '#D1FAE5',
  },
  documentOption: {
    backgroundColor: '#FEF3C7',
  },
  audioOption: {
    backgroundColor: '#3B82F6',
  },
  recordingTimer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    marginRight: 6,
  },
  recordingTime: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  postButton: {
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    minWidth: 100,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  postButtonDisabled: {
    backgroundColor: '#E5E7EB',
    shadowColor: 'transparent',
  },
  postButtonSubmitting: {
    opacity: 0.8,
  },
  postButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default CreateGroupPost;