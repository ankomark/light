import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Image, TextInput, StyleSheet,
  ScrollView, Alert, Modal, Dimensions
} from 'react-native';
import AudioTrimmer from './AudioTrimmer';
import ImageCropper from './ImageCropper';
import VideoTrimmer from './VideoTrimmer';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import AppVideo from './AppVideo';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { createSocialPost, fetchTracks } from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import { processVideo, cleanupProcessedVideos } from '../services/videoProcessing';
import { compressImage as compressImageFile } from '../services/imageProcessing';
import * as DocumentPicker from 'expo-document-picker';

// Instagram-style aspect-ratio clamp (matches the feed's mediaAspectRatio so the
// preview is WYSIWYG): width:height between 1.91:1 (landscape) and 4:5 (portrait,
// ratio 0.8). Outside that range the image is center-cropped via resizeMode
// "cover"; the 4:5 floor caps height at 1.25×width so tall portraits never run
// past the screen. Falls back to square when dimensions are unknown.
const clampAspect = (w, h) => {
  if (!w || !h) return 1;
  const r = w / h;
  if (!isFinite(r) || r <= 0) return 1;
  return Math.min(1.91, Math.max(0.8, r));
};

const PREVIEW_W = Dimensions.get('window').width - 40; // contentContainer padding 20 each side

// Accept 1080p and below only; reject 2K/4K. Measured on the shorter edge — a
// 1080p clip (portrait or landscape) has a 1080px short side, while 1440p/4K
// have 1440/2160. The tolerance covers encoders that pad 1080 up to 1088.
const MAX_VIDEO_SHORT_SIDE = 1130;

const CreatePost = ({ navigation }) => {
  const [contentType, setContentType] = useState('image');
  const [media, setMedia] = useState(null);          // single video
  const [images, setImages] = useState([]);          // 1–4 image carousel: [{uri,width,height}]
  const [previewIndex, setPreviewIndex] = useState(0);
  const MAX_IMAGES = 4;
  const [caption, setCaption] = useState('');
  const [tracks, setTracks] = useState([]);
  const [selectedSong, setSelectedSong] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0..1 across all files
  const [showSongModal, setShowSongModal] = useState(false);
  const [showTrimModal, setShowTrimModal] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(30);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewPosMs, setPreviewPosMs] = useState(null); // playhead during preview
  const soundRef = useRef(null);
  const previewTimerRef = useRef(null);
  const [localAudio, setLocalAudio] = useState(null);

  // Image cropping
  const [showCropper, setShowCropper] = useState(false);
  const [cropTarget, setCropTarget] = useState(null); // { uri, width, height }
  const originalAssetRef = useRef(null);              // last picked image (crop from original)

  // Video trimming
  const [showVideoTrimmer, setShowVideoTrimmer] = useState(false);
  const [videoTrim, setVideoTrim] = useState({ start: 0, end: 30 }); // seconds

  // Live mirrors so the playback-status callback (set once) reads current values.
  const trimStartRef = useRef(0);
  const trimEndRef = useRef(30);
  const isPreviewingRef = useRef(false);
  trimStartRef.current = trimStart;
  trimEndRef.current = trimEnd;

  const MAX_CLIP = 30; // seconds — the trimmed audio clip is capped at 30s

  // Format seconds as m:ss.
  const fmtTime = (s) => {
    const total = Math.max(0, Math.floor(s));
    const m = Math.floor(total / 60);
    const sec = String(total % 60).padStart(2, '0');
    return `${m}:${sec}`;
  };

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

  // Drives the playhead and loops playback within the selected [start, end]
  // window (never jumps back to 0). Set once on the sound; reads live refs.
  const onPreviewStatus = (status) => {
    if (!status.isLoaded || !isPreviewingRef.current) return;
    const pos = status.positionMillis || 0;
    const startMs = trimStartRef.current * 1000;
    const endMs = trimEndRef.current * 1000;
    if (pos >= endMs - 20) {
      soundRef.current?.setPositionAsync(startMs).catch(() => {});
      setPreviewPosMs(startMs);
    } else {
      setPreviewPosMs(pos);
    }
  };

  // Play the selected region, looping it.
  const startPreview = async () => {
    if (!soundRef.current) return;
    try {
      isPreviewingRef.current = true;
      setIsPreviewing(true);
      await soundRef.current.setPositionAsync(trimStartRef.current * 1000);
      setPreviewPosMs(trimStartRef.current * 1000);
      await soundRef.current.playAsync();
    } catch {
      isPreviewingRef.current = false;
      setIsPreviewing(false);
    }
  };

  // Stop preview playback and hide the playhead.
  const stopPreview = async () => {
    isPreviewingRef.current = false;
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setIsPreviewing(false);
    setPreviewPosMs(null);
    try {
      if (soundRef.current) await soundRef.current.pauseAsync();
    } catch {}
  };

  // The trimmer reports the window in ms; mirror to seconds (state + refs).
  const onTrimChange = (startMs, endMs) => {
    trimStartRef.current = startMs / 1000;
    trimEndRef.current = endMs / 1000;
    setTrimStart(startMs / 1000);
    setTrimEnd(endMs / 1000);
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
      if (contentType === 'video') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          allowsEditing: false,
          quality: 1,
          allowsMultipleSelection: false,
        });
        if (result.canceled || !result.assets?.length) return;
        const selected = result.assets[0];
        // Reject 2K/4K — only 1080p and below are accepted. (Unknown dimensions
        // are allowed through; the backend caps resolution on upload as a net.)
        const shortSide = selected.width && selected.height
          ? Math.min(selected.width, selected.height)
          : 0;
        if (shortSide > MAX_VIDEO_SHORT_SIDE) {
          Alert.alert(
            'Resolution too high',
            'Please upload a 1080p video or lower. 2K and 4K videos are not supported.',
          );
          return;
        }
        // Any length is allowed — the user trims to ≤30s next. Only guard against
        // an unreasonably large raw file (the full file still uploads).
        if (selected.fileSize && selected.fileSize > 300 * 1024 * 1024) {
          Alert.alert('Error', 'Video file is too large (max 300MB).');
          return;
        }
        setMedia(selected);
        const durSec = (selected.duration || 0) / 1000;
        setVideoTrim({ start: 0, end: Math.min(30, durSec || 30) });
        setShowVideoTrimmer(true);
        return;
      }

      // Images: select up to the remaining slots (max 4 total).
      const remaining = MAX_IMAGES - images.length;
      if (remaining <= 0) {
        Alert.alert('Limit reached', `You can add up to ${MAX_IMAGES} images`);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.7,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
      });
      if (result.canceled || !result.assets?.length) return;

      const picked = result.assets.slice(0, remaining);

      // A single image picked into an empty post → offer the crop editor.
      if (picked.length === 1 && images.length === 0) {
        const sel = picked[0];
        originalAssetRef.current = sel;
        setCropTarget({ uri: sel.uri, width: sel.width, height: sel.height });
        setShowCropper(true);
        return;
      }

      // Otherwise just compress each and append to the carousel.
      const compressed = await Promise.all(
        picked.map(async (a) => {
          try {
            const out = await compressImage(a.uri, a.width);
            return { uri: out.uri, width: out.width || a.width, height: out.height || a.height };
          } catch {
            return { uri: a.uri, width: a.width, height: a.height };
          }
        })
      );
      setImages((prev) => [...prev, ...compressed].slice(0, MAX_IMAGES));
    } catch (error) {
      console.error('Media picker error:', error);
      Alert.alert('Error', 'Failed to pick media. Please try again.');
    }
  };

  const removeImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Compress an image to a sane upload size (cap at 1080px wide, no upscaling).
  const compressImage = (uri, width) =>
    compressImageFile(uri, { maxWidth: 1080, sourceWidth: width, quality: 0.8 });

  // Cropper confirmed: compress the cropped output → single-image post.
  // (Crop is only offered for single-image posts, so this replaces the carousel.)
  const handleCropped = async ({ uri, width, height }) => {
    setShowCropper(false);
    try {
      const out = await compressImage(uri, width);
      setImages([{ uri: out.uri, width: out.width || width, height: out.height || height }]);
    } catch (e) {
      console.error('Post-crop compress failed:', e);
      setImages([{ uri, width, height }]);
    }
  };

  // Cropper cancelled. On a re-crop, keep the current image. On the very first
  // pick, fall back to the original (uncropped) so the user can still post it.
  const handleCropCancel = async () => {
    setShowCropper(false);
    if (images.length) return; // re-crop cancelled — keep what's already there
    const asset = originalAssetRef.current;
    if (!asset) return;
    try {
      const out = await compressImage(asset.uri, asset.width);
      setImages([{ uri: out.uri, width: asset.width, height: asset.height }]);
    } catch {
      setImages([{ uri: asset.uri, width: asset.width, height: asset.height }]);
    }
  };

  // Re-open the cropper from the originally picked image.
  const reopenCropper = () => {
    const asset = originalAssetRef.current;
    if (!asset) { pickMedia(); return; }
    setCropTarget({ uri: asset.uri, width: asset.width, height: asset.height });
    setShowCropper(true);
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
        { shouldPlay: false, progressUpdateIntervalMillis: 50, isLooping: true },
        onPreviewStatus
      );
      soundRef.current = sound;

      const status = await sound.getStatusAsync();
      setPlaybackStatus(status);

      // Default trim range: first 30s (or the whole song if it's shorter).
      const songSeconds = (status.durationMillis || 0) / 1000;
      const end = Math.min(MAX_CLIP, songSeconds || MAX_CLIP);
      trimStartRef.current = 0;
      trimEndRef.current = end;
      setTrimEnd(end);
    } catch (error) {
      console.error('Error loading song:', error);
      Alert.alert('Error', 'Failed to load song for trimming');
    }
  };

  const handlePost = async () => {
  if (contentType === 'image' ? images.length === 0 : !media) {
    Alert.alert('Error', contentType === 'image' ? 'Please add at least one image' : 'Please select a video');
    return;
  }

  setIsUploading(true);
  setUploadProgress(0);
  try {
    await stopPreview();

    // Aggregate upload progress across every file (images + optional audio, or video).
    const hasLocalAudio =
      contentType === 'image' && selectedSong && isLocalSong(selectedSong) && !!localAudio;
    const totalUploads = contentType === 'image' ? images.length + (hasLocalAudio ? 1 : 0) : 1;
    let done = 0;
    const fileProgress = (frac) =>
      setUploadProgress(Math.min(0.99, (done + (frac || 0)) / totalUploads));
    const fileDone = () => {
      done += 1;
      setUploadProgress(Math.min(0.99, done / totalUploads));
    };

    let postData;
    if (contentType === 'image') {
      // Upload every image; build the gallery + mirror the first onto media_file.
      const uploads = [];
      for (const img of images) {
        const r = await uploadToCloudinary(img, 'image', fileProgress);
        uploads.push({ public_id: r.public_id, width: r.width, height: r.height });
        fileDone();
      }

      // Accompanying song (denormalised; works for library + local audio).
      let songData = {};
      if (selectedSong) {
        const isLocal = isLocalSong(selectedSong);
        let audioUrl = songAudioUri(selectedSong);
        if (isLocal && localAudio) {
          const audioUploadResult = await uploadToCloudinary(localAudio, 'audio', fileProgress);
          audioUrl = audioUploadResult.secure_url;
          fileDone();
        }
        if (audioUrl) {
          songData = {
            song_audio_url: audioUrl,
            song_title: selectedSong.title || '',
            song_artist: artistName(selectedSong),
            song_start_time: Number(trimStart.toFixed(2)),
            song_end_time: Number(trimEnd.toFixed(2)),
            ...(!isLocal && { song_id: selectedSong.id }),
          };
        }
      }

      postData = {
        caption: caption.trim(),
        content_type: 'image',
        media_file: uploads[0].public_id,
        width: uploads[0].width,
        height: uploads[0].height,
        gallery: uploads,
        ...songData,
      };
    } else {
      // R2 stores bytes verbatim, so cut + compress the clip ON-DEVICE first
      // (this is what Cloudinary used to do at ingest). Trims to the chosen
      // window and downscales to 720p at a capped bitrate; the uploaded file IS
      // the final clip.
      const processed = await processVideo({
        uri: media.uri,
        startSec: videoTrim.start,
        endSec: videoTrim.end,
        width: media.width,
        height: media.height,
        thumbnail: true,   // grab a poster frame for the feed/explore grid
      });
      if (!processed.processed) {
        console.warn('[CreatePost] video processing unavailable — uploading raw clip.');
      }
      const uploadResult = await uploadToCloudinary(
        { ...media, uri: processed.uri }, 'video', fileProgress,
      );

      // Upload the poster frame (if we got one) so grids have a still to show —
      // R2 has no server-side frame extraction.
      let thumbnailUrl;
      if (processed.thumbnailUri) {
        try {
          const thumb = await uploadMedia(
            { uri: processed.thumbnailUri, name: `poster_${Date.now()}.jpg`, mimeType: 'image/jpeg' },
            'social-image',
          );
          thumbnailUrl = thumb.url;
        } catch (e) {
          console.warn('[CreatePost] poster upload failed', e?.message);
        }
      }
      fileDone();
      const clip = Math.max(1, Math.round(videoTrim.end - videoTrim.start));
      postData = {
        caption: caption.trim(),
        content_type: 'video',
        media_file: uploadResult.public_id,
        ...(thumbnailUrl ? { thumbnail: thumbnailUrl } : {}),
        width: uploadResult.width ?? media.width,
        height: uploadResult.height ?? media.height,
        // The stored file is already the trimmed clip starting at 0 — omit
        // video_start/end_time so no player-side trim is applied.
        duration: clip,
      };
    }

    setUploadProgress(1);
    await createSocialPost(postData);
    cleanupProcessedVideos();  // best-effort: drop the on-device scratch files
    Alert.alert('Success', 'Post created successfully!');
    navigation.goBack();
  } catch (error) {
    console.error('Upload error:', error);
    Alert.alert('Error', error.message || 'Failed to create post. Please try again.');
  } finally {
    setIsUploading(false);
  }
};

const uploadToCloudinary = async (mediaFile, type, onProgress, opts) => {
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
    uploadType,
    onProgress,
    opts
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

      {/* Media Preview — images render as a swipeable carousel (up to 4) at one
          shared aspect ratio; video is a single preview. */}
      {contentType === 'video' ? (
        media ? (
          <View style={styles.mediaPreviewContainer}>
            <AppVideo
              source={{ uri: media.uri }}
              style={[styles.mediaPreview, { aspectRatio: clampAspect(media.width, media.height) }]}
              useNativeControls
              resizeMode="cover"
              isLooping
              shouldPlay={false}
            />
            <TouchableOpacity style={styles.cropMediaButton} onPress={() => setShowVideoTrimmer(true)}>
              <Feather name="scissors" size={18} color="#fff" />
              <Text style={styles.cropMediaText}>Trim · {(videoTrim.end - videoTrim.start).toFixed(0)}s</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.changeMediaButton} onPress={pickMedia}>
              <Feather name="edit" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.uploadButton} onPress={pickMedia}>
            <Feather name="upload" size={32} color="#666" />
            <Text style={styles.uploadText}>Select Video (any length · trim to 30s)</Text>
          </TouchableOpacity>
        )
      ) : images.length > 0 ? (
        <View style={styles.mediaPreviewContainer}>
          <View style={[styles.carouselWrap, { aspectRatio: clampAspect(images[0].width, images[0].height) }]}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) =>
                setPreviewIndex(Math.round(e.nativeEvent.contentOffset.x / PREVIEW_W))
              }
            >
              {images.map((img, i) => (
                <View key={`${img.uri}_${i}`} style={{ width: PREVIEW_W, height: '100%' }}>
                  <Image source={{ uri: img.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  <TouchableOpacity style={styles.removeImageBtn} onPress={() => removeImage(i)}>
                    <Feather name="x" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            {images.length > 1 && (
              <View style={styles.counterBadge}>
                <Text style={styles.counterText}>{Math.min(previewIndex + 1, images.length)}/{images.length}</Text>
              </View>
            )}
          </View>

          {images.length > 1 && (
            <View style={styles.dotsRow}>
              {images.map((_, i) => (
                <View key={i} style={[styles.dot, i === previewIndex && styles.dotActive]} />
              ))}
            </View>
          )}

          <View style={styles.imageActionsRow}>
            {images.length === 1 && (
              <TouchableOpacity style={styles.imageActionBtn} onPress={reopenCropper}>
                <Feather name="crop" size={16} color="#1DA1F2" />
                <Text style={styles.imageActionText}>Crop</Text>
              </TouchableOpacity>
            )}
            {images.length < MAX_IMAGES && (
              <TouchableOpacity style={styles.imageActionBtn} onPress={pickMedia}>
                <Feather name="plus" size={16} color="#1DA1F2" />
                <Text style={styles.imageActionText}>Add ({images.length}/{MAX_IMAGES})</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.uploadButton} onPress={pickMedia}>
          <Feather name="upload" size={32} color="#666" />
          <Text style={styles.uploadText}>Select Images (up to {MAX_IMAGES})</Text>
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
          {isUploading ? `Posting… ${Math.round(uploadProgress * 100)}%` : 'Share Post'}
        </Text>
      </TouchableOpacity>

      {/* Upload progress overlay */}
      <Modal visible={isUploading} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.progressBackdrop}>
          <View style={styles.progressCard}>
            <Text style={styles.progressTitle}>
              {uploadProgress >= 1 ? 'Finishing up…' : 'Posting…'}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(3, Math.round(uploadProgress * 100))}%` }]} />
            </View>
            <Text style={styles.progressPct}>{Math.round(uploadProgress * 100)}%</Text>
            <Text style={styles.progressHint}>
              {contentType === 'video' ? 'Uploading video' : `Uploading ${images.length} ${images.length === 1 ? 'image' : 'images'}`}
            </Text>
          </View>
        </View>
      </Modal>

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
        <Text style={styles.songTitle} numberOfLines={1}>
          {selectedSong.title || 'Untitled Song'}
        </Text>
        <Text style={styles.songArtist} numberOfLines={1}>
          {artistName(selectedSong)}
        </Text>

        {/* Time read-out: start · selected length · end */}
        <View style={styles.trimTimes}>
          <Text style={styles.trimTimeText}>{fmtTime(trimStart)}</Text>
          <View style={styles.trimDurationPill}>
            <Text style={styles.trimDurationPillText}>
              {(trimEnd - trimStart).toFixed(1)}s
            </Text>
          </View>
          <Text style={styles.trimTimeText}>{fmtTime(trimEnd)}</Text>
        </View>

        <AudioTrimmer
          durationMs={playbackStatus.durationMillis || 0}
          startMs={trimStart * 1000}
          endMs={trimEnd * 1000}
          playheadMs={previewPosMs}
          maxClipMs={MAX_CLIP * 1000}
          minClipMs={1000}
          onChange={onTrimChange}
        />

        <Text style={styles.trimHint}>
          Drag the edges to trim · drag the middle to move · max {MAX_CLIP}s
        </Text>

        <TouchableOpacity
          style={styles.previewButton}
          onPress={isPreviewing ? stopPreview : startPreview}
        >
          <Feather name={isPreviewing ? 'pause' : 'play'} size={20} color="white" />
          <Text style={styles.previewButtonText}>
            {isPreviewing ? 'Pause' : 'Play selection'}
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

      {/* Image Cropper */}
      {showCropper && cropTarget && (
        <ImageCropper
          visible={showCropper}
          uri={cropTarget.uri}
          imageWidth={cropTarget.width}
          imageHeight={cropTarget.height}
          onCancel={handleCropCancel}
          onCropped={handleCropped}
        />
      )}

      {/* Video Trimmer */}
      {showVideoTrimmer && media && contentType === 'video' && (
        <Modal
          visible={showVideoTrimmer}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setShowVideoTrimmer(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowVideoTrimmer(false)}>
                <Feather name="x" size={24} color="#1DA1F2" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Trim Video</Text>
              <View style={{ width: 24 }} />
            </View>
            <View style={styles.trimContainer}>
              <VideoTrimmer
                uri={media.uri}
                durationSec={(media.duration || 0) / 1000}
                aspectRatio={clampAspect(media.width, media.height)}
                onChange={(start, end) => setVideoTrim({ start, end })}
              />
              <TouchableOpacity
                style={styles.confirmButton}
                onPress={() => setShowVideoTrimmer(false)}
              >
                <Text style={styles.confirmButtonText}>Done</Text>
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
  cropMediaButton: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0008',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  cropMediaText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  carouselWrap: {
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  removeImageBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0009',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: '#0009',
  },
  counterText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ccc',
  },
  dotActive: {
    backgroundColor: '#1DA1F2',
  },
  imageActionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
  },
  imageActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1DA1F2',
  },
  imageActionText: {
    color: '#1DA1F2',
    fontSize: 14,
    fontWeight: '600',
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
  progressBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  progressCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
    marginBottom: 16,
  },
  progressTrack: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e6eaf0',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: '#1DA1F2',
  },
  progressPct: {
    marginTop: 12,
    fontSize: 24,
    fontWeight: '800',
    color: '#1DA1F2',
    fontVariant: ['tabular-nums'],
  },
  progressHint: {
    marginTop: 4,
    fontSize: 13,
    color: '#888',
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
  trimTimes: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 10,
  },
  trimTimeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
    fontVariant: ['tabular-nums'],
  },
  trimDurationPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#1DA1F2',
  },
  trimDurationPillText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  trimHint: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 4,
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