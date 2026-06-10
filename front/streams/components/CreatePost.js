import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Image, TextInput, StyleSheet,
  ScrollView, Alert, Modal
} from 'react-native';
import Slider from '@react-native-community/slider';
import * as ImagePicker from 'expo-image-picker';
import { Video, Audio } from 'expo-av';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { createSocialPost, fetchTracks } from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';

// Display aspect ratio from the picked media's real dimensions, clamped so very
// tall/wide images still sit nicely in the card. Falls back to square.
const clampAspect = (w, h) => {
  if (!w || !h) return 1;
  const r = w / h;
  if (!isFinite(r) || r <= 0) return 1;
  return Math.min(1.91, Math.max(0.56, r));
};

const CreatePost = ({ navigation }) => {
  const [contentType, setContentType] = useState('image');
  const [media, setMedia] = useState(null);
  const [caption, setCaption] = useState('');
  const [tracks, setTracks] = useState([]);
  const [selectedSong, setSelectedSong] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showSongModal, setShowSongModal] = useState(false);
  const [showTrimModal, setShowTrimModal] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(30);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const soundRef = useRef(null);
  const previewTimerRef = useRef(null);
  const [localAudio, setLocalAudio] = useState(null);

  const MAX_CLIP = 30; // seconds — the trimmed audio clip is capped at 30s

  // Library tracks expose the audio at `audio_file`; local picks use `audio_url`.
  const songAudioUri = (song) => song?.audio_file || song?.audio_url || null;

  // Local picks get a string id like `local-1700…`; library tracks have a numeric id.
  const isLocalSong = (song) => String(song?.id ?? '').startsWith('local-');

  // Library tracks serialize `artist` as a nested user object; local picks use a
  // plain string. Normalise to a display/storage string either way.
  const artistName = (song) =>
    typeof song?.artist === 'string'
      ? song.artist
      : song?.artist?.username || 'Unknown Artist';

  // Stop preview playback and clear any pending auto-stop timer.
  const stopPreview = async () => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setIsPreviewing(false);
    try {
      if (soundRef.current) await soundRef.current.stopAsync();
    } catch {}
  };

  // Unload audio + clear timers when leaving the screen.
  useEffect(() => () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    if (soundRef.current) soundRef.current.unloadAsync().catch(() => {});
  }, []);

  // Request media library permissions
  useEffect(() => {
    (async () => {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required!', 'We need access to your media library to upload files');
      }
    })();
  }, []);

  useEffect(() => {
    if (contentType === 'image') {
      // fetchTracks returns a paginated { results, next, ... } object; unwrap to
      // an array (tolerating a bare array) so the song picker can map over it.
      fetchTracks()
        .then(data => setTracks(Array.isArray(data) ? data : data?.results ?? []))
        .catch(() => setTracks([]));
    }
  }, [contentType]);

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
        if (selectedMedia.fileSize && selectedMedia.fileSize > 50 * 1024 * 1024) {
          Alert.alert('Error', 'File size must be less than 50MB');
          return;
        }
        
        // Compress images before upload (expo-image-manipulator)
        if (contentType === 'image') {
          const compressed = await ImageManipulator.manipulateAsync(
            selectedMedia.uri,
            [{ resize: { width: 1080 } }],
            { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
          );
          setMedia({ ...selectedMedia, uri: compressed.uri });
        } else {
          setMedia(selectedMedia);
        }
      }
    } catch (error) {
      console.error('Media picker error:', error);
      Alert.alert('Error', 'Failed to pick media. Please try again.');
    }
  };
  const pickLocalAudio = async () => {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
    });

    // Expo SDK 53 returns { canceled, assets:[...] }; tolerate the legacy
    // { type:'success', uri,... } shape too.
    if (result.canceled) return;
    const asset = result.assets?.[0] ?? (result.type === 'success' ? result : null);
    if (!asset?.uri) return;

    const name = asset.name || `audio_${Date.now()}.mp3`;
    setLocalAudio({
      uri: asset.uri,
      name,
      type: asset.mimeType || 'audio/mpeg',
      size: asset.size,
    });
    // Open the trim editor (loads the audio for preview + trimming).
    handleTrimSong({
      id: `local-${Date.now()}`,
      title: name.replace(/\.[^/.]+$/, ''),
      artist: 'Local File',
      audio_url: asset.uri,
    });
  } catch (error) {
    console.error('Error picking audio:', error);
    Alert.alert('Error', 'Failed to pick audio file');
  }
};
  const handleTrimSong = async (song) => {
    const uri = songAudioUri(song);
    if (!uri) {
      Alert.alert('Error', 'This song has no playable audio');
      return;
    }
    setSelectedSong(song);
    setShowSongModal(false);   // close the library list
    setShowTrimModal(true);    // open the trim editor
    setPlaybackStatus(null);
    setTrimStart(0);

    try {
      await stopPreview();
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false }
      );
      soundRef.current = sound;

      const status = await sound.getStatusAsync();
      setPlaybackStatus(status);

      // Default trim range: first 30s (or the whole song if it's shorter).
      const songSeconds = (status.durationMillis || 0) / 1000;
      setTrimEnd(Math.min(MAX_CLIP, songSeconds || MAX_CLIP));
    } catch (error) {
      console.error('Error loading song:', error);
      Alert.alert('Error', 'Failed to load song for trimming');
    }
  };

  const previewTrimmedSong = async () => {
    if (!soundRef.current) return;
    try {
      await stopPreview();
      await soundRef.current.setPositionAsync(trimStart * 1000);
      await soundRef.current.playAsync();
      setIsPreviewing(true);
      // Auto-stop at the end of the trimmed window.
      previewTimerRef.current = setTimeout(() => {
        stopPreview();
      }, Math.max(0, (trimEnd - trimStart) * 1000));
    } catch (error) {
      console.error('Preview error:', error);
      setIsPreviewing(false);
    }
  };

  // Keep the trim window valid: start ≥ 0, end > start, and clip ≤ MAX_CLIP.
  const onChangeTrimStart = (value) => {
    const songSeconds = (playbackStatus?.durationMillis || 0) / 1000;
    const start = Math.max(0, Math.min(value, Math.max(0, songSeconds - 0.5)));
    setTrimStart(start);
    setTrimEnd((prevEnd) => {
      const maxEnd = Math.min(start + MAX_CLIP, songSeconds || start + MAX_CLIP);
      const minEnd = Math.min(start + 1, maxEnd);
      return Math.max(minEnd, Math.min(prevEnd, maxEnd));
    });
  };

  const onChangeTrimEnd = (value) => {
    const songSeconds = (playbackStatus?.durationMillis || 0) / 1000;
    const maxEnd = Math.min(trimStart + MAX_CLIP, songSeconds || trimStart + MAX_CLIP);
    setTrimEnd(Math.max(trimStart + 1, Math.min(value, maxEnd)));
  };

  const handlePost = async () => {
  if (!media) {
    Alert.alert('Error', 'Please select a media file');
    return;
  }

  setIsUploading(true);
  try {
    await stopPreview();
    const uploadResult = await uploadToCloudinary(media, contentType);

    // Denormalised song fields persisted on the post (work for both library
    // tracks and local uploads). Only images carry an accompanying song.
    let songData = {};
    if (contentType === 'image' && selectedSong) {
      const isLocal = isLocalSong(selectedSong);
      let audioUrl = songAudioUri(selectedSong);
      if (isLocal && localAudio) {
        const audioUploadResult = await uploadToCloudinary(localAudio, 'audio');
        audioUrl = audioUploadResult.secure_url;
      }
      if (audioUrl) {
        songData = {
          song_audio_url: audioUrl,
          song_title: selectedSong.title || '',
          song_artist: artistName(selectedSong),
          song_start_time: Number(trimStart.toFixed(2)),
          song_end_time: Number(trimEnd.toFixed(2)),
          // Reference the library Track when there is one (skip for local audio).
          ...(!isLocal && { song_id: selectedSong.id }),
        };
      }
    }

    const postData = {
      caption: caption.trim(),
      media_file: uploadResult.public_id,
      content_type: contentType,
      width: uploadResult.width,
      height: uploadResult.height,
      ...(contentType === 'video' && media.duration && {
        duration: Math.floor(media.duration / 1000)
      }),
      ...songData,
    };

    await createSocialPost(postData);
    Alert.alert('Success', 'Post created successfully!');
    navigation.goBack();
  } catch (error) {
    console.error('Upload error:', error);
    Alert.alert('Error', error.message || 'Failed to create post. Please try again.');
  } finally {
    setIsUploading(false);
  }
};

const uploadToCloudinary = async (mediaFile, type) => {
  const uploadType =
    type === 'video' ? 'social-video' : type === 'audio' ? 'audio' : 'social-image';
  const ext = type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg';
  const defaultMime =
    type === 'video' ? 'video/mp4' : type === 'audio' ? 'audio/mpeg' : 'image/jpeg';
  const result = await uploadMedia(
    {
      uri: mediaFile.uri,
      name: mediaFile.fileName ?? mediaFile.name ?? `post_${Date.now()}.${ext}`,
      mimeType: mediaFile.mimeType ?? mediaFile.type ?? defaultMime,
    },
    uploadType
  );
  // Normalise to the shape the rest of CreatePost expects
  return {
    public_id: result.publicId,
    secure_url: result.url,
    width: result.width,
    height: result.height,
    duration: result.duration,
  };
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

      {/* Media Preview — sized to the media's real aspect ratio so portrait /
          landscape images fill the card without letterbox bars. */}
      {media ? (
        <View style={styles.mediaPreviewContainer}>
          {contentType === 'image' ? (
            <Image
              source={{ uri: media.uri }}
              style={[styles.mediaPreview, { aspectRatio: clampAspect(media.width, media.height) }]}
              resizeMode="cover"
            />
          ) : (
            <Video
              source={{ uri: media.uri }}
              style={[styles.mediaPreview, { aspectRatio: clampAspect(media.width, media.height) }]}
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

      {/* Song Picker (only for images) */}
      {contentType === 'image' && (
  <View style={styles.inputContainer}>
    <Text style={styles.inputLabel}>Accompanying Song (optional)</Text>
    
    <View style={styles.songOptionsContainer}>
      <TouchableOpacity
        style={styles.audioOptionButton}
        onPress={pickLocalAudio}
      >
        <MaterialIcons name="audiotrack" size={24} color="#1DA1F2" />
        <Text style={styles.audioOptionText}>Pick Local Audio</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={styles.audioOptionButton}
        onPress={() => setShowSongModal(true)}
      >
        <MaterialIcons name="library-music" size={24} color="#1DA1F2" />
        <Text style={styles.audioOptionText}>Choose from Library</Text>
      </TouchableOpacity>
    </View>

    {selectedSong && (
      <View style={styles.selectedSongContainer}>
        <Text style={styles.songTitle}>{selectedSong.title}</Text>
        <Text style={styles.songArtist}>{artistName(selectedSong)}</Text>
        {isLocalSong(selectedSong) && (
          <Text style={styles.localFileTag}>(Local File)</Text>
        )}
        <Text style={styles.trimInfo}>
          Trimmed: {trimStart.toFixed(1)}s - {trimEnd.toFixed(1)}s
        </Text>
        <View style={styles.songActionButtons}>
          <TouchableOpacity
            style={styles.editSongButton}
            onPress={() => isLocalSong(selectedSong) ? pickLocalAudio() : handleTrimSong(selectedSong)}
          >
            <Feather name="edit" size={16} color="#1DA1F2" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.removeSongButton}
            onPress={async () => {
              await stopPreview();
              setSelectedSong(null);
              setLocalAudio(null);
              setPlaybackStatus(null);
            }}
          >
            <Feather name="x-circle" size={16} color="#FF4444" />
          </TouchableOpacity>
        </View>
      </View>
    )}
  </View>
)}

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

      {/* Song Selection Modal */}
      <Modal
        visible={showSongModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowSongModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowSongModal(false)}>
              <Feather name="x" size={24} color="#1DA1F2" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Select a Song</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView>
            {tracks.map(track => (
              <TouchableOpacity
                key={track.id}
                style={[
                  styles.songItem,
                  selectedSong?.id === track.id && styles.selectedSongItem
                ]}
                onPress={() => handleTrimSong(track)}
              >
                <MaterialIcons name="music-note" size={24} color="#666" />
                <View style={styles.songInfo}>
                  <Text style={styles.songTitle}>{track.title}</Text>
                  <Text style={styles.songArtist}>{artistName(track)}</Text>
                </View>
                <Feather name="chevron-right" size={20} color="#666" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Song Trimming Modal */}
{showTrimModal && selectedSong && playbackStatus && (
  <Modal
    visible={showTrimModal}
    animationType="slide"
    transparent={false}
    onRequestClose={async () => { await stopPreview(); setShowTrimModal(false); }}
  >
    <View style={styles.modalContainer}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={async () => { await stopPreview(); setShowTrimModal(false); }}>
          <Feather name="x" size={24} color="#1DA1F2" />
        </TouchableOpacity>
        <Text style={styles.modalTitle}>Trim Song</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.trimContainer}>
        <Text style={styles.songTitle}>
          {selectedSong.title || 'Untitled Song'}
        </Text>
        <Text style={styles.songArtist}>
          {artistName(selectedSong)}
        </Text>

        <View style={styles.trimControls}>
          <Text style={styles.trimLabel}>
            Start: {trimStart.toFixed(1)}s
          </Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={Math.max(1, (playbackStatus.durationMillis || 0) / 1000)}
            value={trimStart}
            onValueChange={onChangeTrimStart}
            minimumTrackTintColor="#1DA1F2"
            maximumTrackTintColor="#ddd"
            thumbTintColor="#1DA1F2"
            step={0.1}
          />

          <Text style={styles.trimLabel}>
            End: {trimEnd.toFixed(1)}s (max {MAX_CLIP}s clip)
          </Text>
          <Slider
            style={styles.slider}
            minimumValue={trimStart + 1}
            maximumValue={Math.min(trimStart + MAX_CLIP, (playbackStatus.durationMillis || 0) / 1000)}
            value={trimEnd}
            onValueChange={onChangeTrimEnd}
            minimumTrackTintColor="#1DA1F2"
            maximumTrackTintColor="#ddd"
            thumbTintColor="#1DA1F2"
            step={0.1}
          />

          <Text style={styles.trimDuration}>
            Duration: {(trimEnd - trimStart).toFixed(1)} seconds
          </Text>
        </View>

        <TouchableOpacity
          style={styles.previewButton}
          onPress={isPreviewing ? stopPreview : previewTrimmedSong}
        >
          <Feather name={isPreviewing ? 'square' : 'play'} size={20} color="white" />
          <Text style={styles.previewButtonText}>
            {isPreviewing ? 'Stop' : 'Preview'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.confirmButton}
          onPress={async () => { await stopPreview(); setShowTrimModal(false); }}
        >
          <Text style={styles.confirmButtonText}>Confirm Selection</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
)}
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
    borderRadius: 8,
    backgroundColor: '#000'
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
songOption: {
  backgroundColor: '#f9f9f9',
  borderRadius: 10,
  padding: 10,
  marginRight: 10,
  borderWidth: 1,
  borderColor: '#ddd',
},
selectedSongOption: {
  backgroundColor: '#1DA1F2',
  borderColor: '#1DA1F2',
},
songTitle: {
  fontSize: 16,
  fontWeight: '500',
  color: '#333',
},
songArtist: {
  fontSize: 14,
  color: '#666',
},
pickSongButton: {
  flexDirection: 'row',
  alignItems: 'center',
  padding: 10,
  marginBottom: 10,
  backgroundColor: '#f0f8ff',
  borderRadius: 8,
  borderWidth: 1,
  borderColor: '#1DA1F2',
},
pickSongText: {
  marginLeft: 8,
  fontSize: 16,
  color: '#1DA1F2',
  fontWeight: '500',
},
selectedSongContainer: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: '#e6f7ff',
  borderRadius: 8,
  padding: 10,
  marginBottom: 10,
},
removeSongButton: {
  marginLeft: 10,
},
modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  songItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  selectedSongItem: {
    backgroundColor: '#e6f7ff',
  },
  songInfo: {
    flex: 1,
    marginLeft: 15,
  },
  trimContainer: {
    padding: 20,
  },
  trimControls: {
    marginVertical: 20,
  },
  slider: {
    height: 40,
    marginBottom: 20,
  },
  trimLabel: {
    fontSize: 16,
    marginBottom: 5,
    color: '#333',
  },
  trimDuration: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 10,
  },
  trimInfo: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  previewButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1DA1F2',
    padding: 15,
    borderRadius: 8,
    marginVertical: 10,
  },
  previewButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  confirmButton: {
    backgroundColor: '#34C759',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 10,
  },
  confirmButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  editSongButton: {
    marginLeft: 10,
    padding: 5,
  },
  selectedSongContainer: {
    position: 'relative',
    backgroundColor: '#e6f7ff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10
},
songOptionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  audioOptionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1DA1F2',
    marginHorizontal: 5,
  },
  audioOptionText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#1DA1F2',
  },
  localFileTag: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  songActionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
});

export default CreatePost;