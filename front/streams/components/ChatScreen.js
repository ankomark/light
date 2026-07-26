import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, AppState, Modal,
  ScrollView, Alert, Pressable, useWindowDimensions,
} from 'react-native';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  createSound, setAudioModeAsync, requestRecordingPermissionsAsync,
  Recording, VOICE_NOTE_RECORDING_OPTIONS,
} from '../services/audioPlayer';
import { compressImage } from '../services/imageProcessing';
import { fetchMessages, fetchOlderMessages, sendMessage, markConversationRead } from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import { useAuth } from '../context/useAuth';
import { useI18n } from '../context/I18nContext';
import RotatingBackground from './RotatingBackground';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const POLL_MS = 3000;
const MAX_FILE_BYTES = 6 * 1024 * 1024; // 6 MB cap for document attachments

const EMOJIS = ['😀','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😜','🤪','🤔','🤭','🫡','😎','🥳','😏','😴','😢','😭','😤','😡','🥺','😱','🤯','🙏','👍','👎','👏','🙌','🤝','💪','🫶','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🔥','✨','🎉','🎊','💯','✅','🕊️','📖','🎵','🎶','☀️','🌙','⭐','🙏🏽'];

// Voice notes recorded mono at a low bitrate — plenty for speech, a fraction of
// HIGH_QUALITY's size, so they upload and load fast. Format stays .m4a/AAC.
// Insert a small Cloudinary delivery transform so an image bubble loads a light
// thumbnail rather than the full upload. Leaves local (file://) and legacy
// base64 (data:) attachments untouched.
const cldThumb = (url) => {
  if (typeof url !== 'string' || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  if (/\/upload\/[a-z]{1,3}_/.test(url)) return url; // already has a transform
  return url.replace('/upload/', '/upload/c_limit,w_800,q_auto,f_auto/');
};

const isData = (uri) => typeof uri === 'string' && uri.startsWith('data:');

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDuration = (s) => {
  const sec = Math.max(0, Math.round(s || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

const ChatScreen = ({ route, navigation }) => {
  const { conversationId, otherUser } = route.params;
  const { currentUser } = useAuth();
  const { t } = useI18n();
  const { width: winW } = useWindowDimensions();
  const imgSide = winW * 0.6;  // chat image bubble, 60% of the live window width
  const kbHeight = useKeyboardHeight(); // float the composer above the keyboard (edge-to-edge safe)

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [viewer, setViewer] = useState(null); // full-screen image uri
  const [attachSheet, setAttachSheet] = useState(false); // luxury "what to send" sheet
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [playingId, setPlayingId] = useState(null);

  const listRef = useRef(null);
  const pollRef = useRef(null);
  const appState = useRef(AppState.currentState);
  const lastCountRef = useRef(0);
  const lastIdRef = useRef(0); // highest server message id we hold (for incremental polls)
  const oldestIdRef = useRef(0);        // lowest id held (for scroll-up history)
  const hasMoreOlderRef = useRef(true); // false once we've reached the start
  const loadingOlderRef = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const isFocused = useRef(true);
  const recordingRef = useRef(null);
  const recordTimerRef = useRef(null);
  const recordStartRef = useRef(0);
  const soundRef = useRef(null);

  // Highest numeric (server-assigned) id in a list, ignoring optimistic temps.
  const maxNumericId = (arr) =>
    arr.reduce((mx, m) => (typeof m.id === 'number' && m.id > mx ? m.id : mx), 0);

  // Lowest numeric id in a list (0 if none), for paging older history.
  const minNumericId = (arr) =>
    arr.reduce((mn, m) => (typeof m.id === 'number' && (mn === 0 || m.id < mn) ? m.id : mn), 0);

  const loadMessages = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);

      // Full load on first open (or if a prior load never succeeded); after that,
      // polls fetch only new messages + read-receipt updates — so we don't
      // re-download the whole list (and its base64 attachments) every few seconds.
      if (!silent || lastIdRef.current === 0) {
        const data = await fetchMessages(conversationId);
        if (Array.isArray(data)) {
          setMessages(data);
          lastIdRef.current = maxNumericId(data);
          oldestIdRef.current = minNumericId(data);
          hasMoreOlderRef.current = data.length >= 100;  // a full page implies older exist
          if (data.length !== lastCountRef.current) {
            lastCountRef.current = data.length;
            setTimeout(() => listRef.current?.scrollToEnd({ animated: !silent }), 80);
          }
        }
        return;
      }

      const res = await fetchMessages(conversationId, lastIdRef.current);
      const incoming = res?.messages ?? [];
      const readIds = res?.read_ids ?? [];
      if (!incoming.length && !readIds.length) return;

      setMessages((prev) => {
        const have = new Set(prev.map((m) => m.id));
        const merged = incoming.length
          ? [...prev, ...incoming.filter((m) => !have.has(m.id))]
          : prev.slice();
        if (readIds.length) {
          const rset = new Set(readIds);
          for (let i = 0; i < merged.length; i++) {
            if (rset.has(merged[i].id) && !merged[i].read) merged[i] = { ...merged[i], read: true };
          }
        }
        return merged;
      });

      if (incoming.length) {
        lastIdRef.current = Math.max(lastIdRef.current, maxNumericId(incoming));
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [conversationId]);

  const markRead = useCallback(() => {
    markConversationRead(conversationId).catch(() => {});
  }, [conversationId]);

  // Load a page of older messages when the user scrolls to the top. Prepended;
  // the list's maintainVisibleContentPosition keeps the view from jumping, and
  // the auto-scroll-to-end is suppressed while this runs.
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreOlderRef.current || !oldestIdRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const older = await fetchOlderMessages(conversationId, oldestIdRef.current);
      if (Array.isArray(older) && older.length) {
        setMessages((prev) => {
          const have = new Set(prev.map((m) => m.id));
          const fresh = older.filter((m) => !have.has(m.id));
          return fresh.length ? [...fresh, ...prev] : prev;
        });
        oldestIdRef.current = minNumericId(older) || oldestIdRef.current;
        hasMoreOlderRef.current = older.length >= 30;  // matches the server page size
      } else {
        hasMoreOlderRef.current = false;
      }
    } catch {
      // ignore — user can retry by scrolling
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId]);

  useFocusEffect(
    useCallback(() => {
      isFocused.current = true;
      loadMessages();
      markRead();
      pollRef.current = setInterval(() => loadMessages(true), POLL_MS);
      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'active' && appState.current !== 'active' && isFocused.current) {
          loadMessages(true); markRead();
          pollRef.current = setInterval(() => loadMessages(true), POLL_MS);
        }
        if (next !== 'active') { clearInterval(pollRef.current); pollRef.current = null; }
        appState.current = next;
      });
      return () => { isFocused.current = false; clearInterval(pollRef.current); sub.remove(); };
    }, [loadMessages, markRead])
  );

  // Generic send with optimistic insert.
  const sendPayload = useCallback(async (payload, optimisticExtra = {}) => {
    const tempId = `temp_${Date.now()}`;
    const optimistic = {
      id: tempId,
      sender: { id: currentUser?.id, username: currentUser?.username, profile_picture: null },
      content: payload.content || '',
      message_type: payload.message_type || 'text',
      attachment: payload.attachment || '',
      file_name: payload.file_name || '',
      read: false,
      created_at: new Date().toISOString(),
      ...optimisticExtra,
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      const saved = await sendMessage(conversationId, payload);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? saved : m)));
      if (typeof saved?.id === 'number') {
        lastIdRef.current = Math.max(lastIdRef.current, saved.id);
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert(t('common.error'), t('chat.sendFailed'));
    } finally {
      setSending(false);
    }
  }, [conversationId, currentUser, t]);

  // Media send: show the local file instantly (optimistic), upload it to
  // Cloudinary in the background, then persist the message with just the URL.
  const sendMediaMessage = useCallback(async ({ localUri, uploadType, message_type, file_name = '', duration = null, mimeType }) => {
    const tempId = `temp_${Date.now()}`;
    const optimistic = {
      id: tempId,
      sender: { id: currentUser?.id, username: currentUser?.username, profile_picture: null },
      content: '',
      message_type,
      attachment: localUri, // local preview while uploading (file:// or content://)
      file_name,
      duration,
      read: false,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      const uploaded = await uploadMedia(
        { uri: localUri, name: file_name || `chat_${Date.now()}`, mimeType },
        uploadType,
      );
      const saved = await sendMessage(conversationId, {
        message_type,
        attachment: uploaded.url,
        file_name,
        duration,
      });
      setMessages((prev) => prev.map((m) => (m.id === tempId ? saved : m)));
      if (typeof saved?.id === 'number') {
        lastIdRef.current = Math.max(lastIdRef.current, saved.id);
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert(t('common.error'), t('chat.attachmentFailed'));
    } finally {
      setSending(false);
    }
  }, [conversationId, currentUser, t]);

  const handleSendText = useCallback(() => {
    const content = text.trim();
    if (!content || sending) return;
    setText('');
    setShowEmoji(false);
    sendPayload({ content, message_type: 'text' });
  }, [text, sending, sendPayload]);

  const attachImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert(t('chat.permissionRequired'), t('chat.permissionPhotos')); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7,
      });
      if (res.canceled || !res.assets?.length) return;
      // Compress on-device first (smaller upload); Cloudinary compresses again
      // on ingest. No base64 — we upload the file and store only the URL.
      const processed = await compressImage(res.assets[0].uri, { width: 1080, quality: 0.6 });
      sendMediaMessage({
        localUri: processed.uri, uploadType: 'chat-image',
        message_type: 'image', mimeType: 'image/jpeg',
      });
    } catch (e) {
      Alert.alert(t('common.error'), t('chat.attachImageFailed'));
    }
  }, [sendMediaMessage, t]);

  const attachFile = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const file = res.assets[0];
      if (file.size && file.size > MAX_FILE_BYTES) {
        Alert.alert(t('chat.fileTooLargeTitle'), t('chat.fileTooLargeBody'));
        return;
      }
      sendMediaMessage({
        localUri: file.uri, uploadType: 'chat-file', message_type: 'file',
        file_name: file.name || 'file', mimeType: file.mimeType || 'application/octet-stream',
      });
    } catch (e) {
      Alert.alert(t('common.error'), t('chat.attachFileFailed'));
    }
  }, [sendMediaMessage, t]);

  const onAttachPress = useCallback(() => {
    setShowEmoji(false);
    setAttachSheet(true);
  }, []);

  // Dismiss the sheet first, then fire the picker so the two don't fight over
  // the screen on Android.
  const pickFromSheet = useCallback((fn) => {
    setAttachSheet(false);
    setTimeout(fn, 220);
  }, []);

  const openFile = useCallback(async (msg) => {
    try {
      const safeName = (msg.file_name || 'file').replace(/[^\w.\-]/g, '_');
      const dest = `${FileSystem.cacheDirectory}${safeName}`;
      let path;
      if (isData(msg.attachment)) {
        const m = /^data:(.*?);base64,(.*)$/.exec(msg.attachment || '');
        if (!m) return;
        await FileSystem.writeAsStringAsync(dest, m[2], { encoding: FileSystem.EncodingType.Base64 });
        path = dest;
      } else if (typeof msg.attachment === 'string' && msg.attachment.startsWith('http')) {
        const dl = await FileSystem.downloadAsync(msg.attachment, dest);
        path = dl.uri;
      } else {
        path = msg.attachment; // local file:// from an optimistic, still-uploading message
      }
      if (!path) return;
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
      } else {
        Alert.alert(t('chat.savedTitle'), t('chat.savedBody', { name: msg.file_name }));
      }
    } catch {
      Alert.alert(t('common.error'), t('chat.openFileFailed'));
    }
  }, [t]);

  // ── Voice notes ──
  const startRecording = useCallback(async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert(t('chat.permissionRequired'), t('chat.permissionMic')); return; }
      await setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Recording();
      await rec.prepareToRecordAsync(VOICE_NOTE_RECORDING_OPTIONS);
      await rec.startAsync();
      recordingRef.current = rec;
      recordStartRef.current = Date.now();
      setShowEmoji(false);
      setIsRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch {
      Alert.alert(t('common.error'), t('chat.recordFailed'));
      setIsRecording(false);
    }
  }, [t]);

  const stopRecording = useCallback(async (cancel = false) => {
    clearInterval(recordTimerRef.current);
    setIsRecording(false);
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      await setAudioModeAsync({ allowsRecordingIOS: false });
      if (cancel) return;
      const uri = rec.getURI();
      const seconds = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
      if (!uri) return;
      sendMediaMessage({
        localUri: uri, uploadType: 'chat-audio', message_type: 'audio',
        duration: seconds, mimeType: 'audio/m4a',
      });
    } catch {
      Alert.alert(t('common.error'), t('chat.saveVoiceFailed'));
    }
  }, [sendMediaMessage, t]);

  const playAudio = useCallback(async (msg) => {
    try {
      if (soundRef.current) { await soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
      if (playingId === msg.id) { setPlayingId(null); return; } // toggle off
      // Legacy base64 → write to a cache file first; Cloudinary/local URIs play
      // directly (expo-av streams https).
      let sourceUri = msg.attachment;
      if (isData(msg.attachment)) {
        const m = /^data:(.*?);base64,(.*)$/.exec(msg.attachment || '');
        if (!m) return;
        const path = `${FileSystem.cacheDirectory}voice_${msg.id}.m4a`;
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists) {
          await FileSystem.writeAsStringAsync(path, m[2], { encoding: FileSystem.EncodingType.Base64 });
        }
        sourceUri = path;
      }
      if (!sourceUri) return;
      await setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound } = await createSound({ uri: sourceUri }, { shouldPlay: true });
      soundRef.current = sound;
      setPlayingId(msg.id);
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.didJustFinish) {
          setPlayingId(null);
          sound.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
      });
    } catch {
      Alert.alert(t('common.error'), t('chat.playVoiceFailed'));
      setPlayingId(null);
    }
  }, [playingId, t]);

  // Cleanup audio on unmount.
  useEffect(() => () => {
    clearInterval(recordTimerRef.current);
    recordingRef.current?.stopAndUnloadAsync?.().catch(() => {});
    soundRef.current?.unloadAsync?.().catch(() => {});
  }, []);

  const renderMessage = useCallback(({ item, index }) => {
    const isOwn = item.sender?.id === currentUser?.id;
    const showAvatar = !isOwn && (index === 0 || messages[index - 1]?.sender?.id !== item.sender?.id);
    const type = item.message_type || 'text';

    return (
      <View style={[styles.msgRow, isOwn ? styles.msgRowOwn : styles.msgRowOther]}>
        {!isOwn && (
          <View style={styles.avatarPlaceholder}>
            {showAvatar && (
              <Image
                source={item.sender?.profile_picture ? { uri: item.sender.profile_picture } : DEFAULT_AVATAR}
                placeholder={DEFAULT_AVATAR}
                contentFit="cover"
                transition={150}
                style={styles.msgAvatar}
              />
            )}
          </View>
        )}
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, type === 'image' && styles.bubbleMedia]}>
          {type === 'image' && item.attachment ? (
            <Pressable onPress={() => setViewer(item.attachment)}>
              <Image source={{ uri: cldThumb(item.attachment) }} style={[styles.imageMsg, { width: imgSide, height: imgSide }]} contentFit="cover" transition={150} />
            </Pressable>
          ) : type === 'file' ? (
            <Pressable style={styles.fileRow} onPress={() => openFile(item)}>
              <View style={styles.fileIcon}><Ionicons name="document-text" size={22} color={colors.primary} /></View>
              <Text style={[styles.fileName, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther]} numberOfLines={1}>
                {item.file_name || 'File'}
              </Text>
              <Ionicons name="download-outline" size={18} color={isOwn ? 'rgba(255,255,255,0.8)' : colors.textMuted} />
            </Pressable>
          ) : type === 'audio' ? (
            <Pressable style={styles.audioRow} onPress={() => playAudio(item)}>
              <Ionicons
                name={playingId === item.id ? 'pause-circle' : 'play-circle'}
                size={30}
                color={isOwn ? colors.white : colors.primary}
              />
              <View style={styles.audioBar}>
                <View style={[styles.audioBarFill, { backgroundColor: isOwn ? 'rgba(255,255,255,0.55)' : colors.primary }]} />
              </View>
              <Text style={[styles.audioDuration, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther]}>
                {fmtDuration(item.duration)}
              </Text>
            </Pressable>
          ) : null}

          {!!item.content && (
            <Text style={[styles.bubbleText, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther, type === 'image' && { marginTop: spacing.xs }]}>
              {item.content}
            </Text>
          )}

          <Text style={[styles.bubbleTime, isOwn ? styles.bubbleTimeOwn : styles.bubbleTimeOther]}>
            {fmtTime(item.created_at)}{isOwn ? (item.read ? ' ✓✓' : ' ✓') : ''}
          </Text>
        </View>
      </View>
    );
  }, [currentUser?.id, messages, openFile, imgSide]);

  return (
    <View style={styles.root}>
    <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.7)" />
    <View style={[styles.container, kbHeight > 0 ? { marginBottom: kbHeight } : null]}>
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <LinearGradient colors={['rgba(16,46,80,0.95)', 'rgba(10,22,40,0.80)']} style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Image
            source={otherUser?.profile_picture ? { uri: otherUser.profile_picture } : DEFAULT_AVATAR}
            placeholder={DEFAULT_AVATAR}
            contentFit="cover"
            transition={150}
            style={styles.headerAvatar}
          />
          <View style={styles.headerInfo}>
            <Text style={styles.headerName} numberOfLines={1}>{otherUser?.username ?? 'Chat'}</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>

      {loading && messages.length === 0 ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          // Don't yank the view to the bottom while we're prepending history.
          onContentSizeChange={() => { if (!loadingOlderRef.current) listRef.current?.scrollToEnd({ animated: false }); }}
          // Load older history when the user scrolls near the top.
          onScroll={(e) => { if (e.nativeEvent.contentOffset.y <= 48) loadOlder(); }}
          scrollEventThrottle={64}
          maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
          ListHeaderComponent={
            loadingOlder
              ? <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 10 }} />
              : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Say hello to {otherUser?.username} 👋</Text>
            </View>
          }
        />
      )}

      {/* Emoji panel */}
      {showEmoji && (
        <View style={styles.emojiPanel}>
          <ScrollView contentContainerStyle={styles.emojiGrid} keyboardShouldPersistTaps="handled">
            {EMOJIS.map((e, i) => (
              <TouchableOpacity key={i} style={styles.emojiBtn} onPress={() => setText((t) => t + e)}>
                <Text style={styles.emojiText}>{e}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Input bar */}
      <View style={styles.inputBar}>
        {isRecording ? (
          <>
            <TouchableOpacity style={styles.iconBtn} onPress={() => stopRecording(true)}>
              <Ionicons name="trash-outline" size={24} color={colors.error} />
            </TouchableOpacity>
            <View style={styles.recordingInfo}>
              <View style={styles.recDot} />
              <Text style={styles.recText}>Recording… {fmtDuration(recordSecs)}</Text>
            </View>
            <TouchableOpacity style={styles.sendBtn} onPress={() => stopRecording(false)} activeOpacity={0.8}>
              <Ionicons name="send" size={18} color={colors.white} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setShowEmoji((s) => !s)}>
              <Ionicons name={showEmoji ? 'close' : 'happy-outline'} size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={onAttachPress} disabled={sending}>
              <Ionicons name="add-circle-outline" size={26} color={colors.textSecondary} />
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              placeholder={t('chat.messagePlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={text}
              onChangeText={setText}
              onFocus={() => setShowEmoji(false)}
              multiline
              maxLength={2000}
            />
            {text.trim() ? (
              <TouchableOpacity
                style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
                onPress={handleSendText}
                disabled={sending}
                activeOpacity={0.8}
              >
                {sending ? <ActivityIndicator size="small" color={colors.white} /> : <Ionicons name="send" size={18} color={colors.white} />}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.sendBtn} onPress={startRecording} disabled={sending} activeOpacity={0.8}>
                <Ionicons name="mic" size={20} color={colors.white} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* Full-screen image viewer */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={styles.viewerRoot} onPress={() => setViewer(null)}>
          <Image source={{ uri: viewer }} style={styles.viewerImage} contentFit="contain" transition={150} />
          <View style={styles.viewerClose}><Ionicons name="close" size={28} color={colors.white} /></View>
        </Pressable>
      </Modal>

      {/* Luxury attachment sheet: choose what to send */}
      <Modal visible={attachSheet} transparent animationType="slide" onRequestClose={() => setAttachSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setAttachSheet(false)}>
          <Pressable style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Send to {otherUser?.username ?? 'chat'}</Text>
            <Text style={styles.sheetSubtitle}>{t('chat.chooseWhatToSend')}</Text>

            <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} onPress={() => pickFromSheet(attachImage)}>
              <View style={[styles.sheetIcon, styles.sheetIconPhoto]}>
                <Ionicons name="image" size={24} color={colors.accent} />
              </View>
              <View style={styles.sheetOptionText}>
                <Text style={styles.sheetOptionLabel}>{t('chat.photo')}</Text>
                <Text style={styles.sheetOptionHint}>{t('chat.photoSub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} onPress={() => pickFromSheet(attachFile)}>
              <View style={[styles.sheetIcon, styles.sheetIconFile]}>
                <Ionicons name="document-text" size={24} color={colors.primary} />
              </View>
              <View style={styles.sheetOptionText}>
                <Text style={styles.sheetOptionLabel}>{t('chat.document')}</Text>
                <Text style={styles.sheetOptionHint}>{t('chat.documentSub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetCancel} activeOpacity={0.85} onPress={() => setAttachSheet(false)}>
              <Text style={styles.sheetCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
  headerSafe: { backgroundColor: 'rgba(16,46,80,0.95)' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  backBtn: { marginRight: spacing.xs },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: 'rgba(244,162,97,0.4)' },
  headerInfo: { flex: 1 },
  headerName: { ...typography.h3, color: colors.textPrimary },

  listContent: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md, flexGrow: 1 },
  msgRow: { flexDirection: 'row', marginVertical: 2, alignItems: 'flex-end' },
  msgRowOwn: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  avatarPlaceholder: { width: 30, marginRight: spacing.xs },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface },
  bubble: { maxWidth: '78%', borderRadius: radius.lg, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, ...shadows.sm },
  bubbleMedia: { padding: 4 },
  bubbleOwn: { backgroundColor: '#15407A', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: 'rgba(18,30,46,0.92)', borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)' },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextOwn: { color: colors.white },
  bubbleTextOther: { color: colors.textPrimary },
  bubbleTime: { fontSize: 10, marginTop: 3 },
  bubbleTimeOwn: { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  bubbleTimeOther: { color: colors.textMuted },

  imageMsg: { borderRadius: radius.md, backgroundColor: colors.surface },  // width/height inline (reactive)
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2, paddingRight: spacing.xs, minWidth: 180 },
  fileIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  fileName: { flex: 1, fontSize: 14, fontWeight: '600' },

  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 160, paddingVertical: 2 },
  audioBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.3)', overflow: 'hidden' },
  audioBarFill: { width: '100%', height: '100%', opacity: 0.8 },
  audioDuration: { fontSize: 12, fontWeight: '600', minWidth: 34, textAlign: 'right' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyText: { ...typography.body, color: colors.textMuted },

  emojiPanel: { height: 220, backgroundColor: 'rgba(16,46,80,0.97)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm },
  emojiBtn: { width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 26 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    backgroundColor: 'rgba(16,46,80,0.95)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', gap: spacing.xs,
  },
  iconBtn: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  recordingInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.error },
  recText: { ...typography.body, color: colors.textSecondary },
  input: {
    flex: 1, backgroundColor: colors.inputBg, borderRadius: radius.xl,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 4,
    color: colors.textPrimary, fontSize: 15, maxHeight: 100, borderWidth: 1, borderColor: colors.border,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', ...shadows.sm },
  sendBtnDisabled: { opacity: 0.4 },

  viewerRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 48, right: 20 },

  // ── Luxury attachment sheet ───────────────────────────────────────────────
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheetCard: {
    backgroundColor: 'rgba(16,46,80,0.98)',
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl + spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.35)', ...shadows.lg,
  },
  sheetHandle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', marginBottom: spacing.md },
  sheetTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '700' },
  sheetSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  sheetOption: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(13,35,64,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)', marginBottom: spacing.sm,
  },
  sheetIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  sheetIconPhoto: { backgroundColor: 'rgba(244,162,97,0.16)', borderColor: 'rgba(244,162,97,0.5)' },
  sheetIconFile: { backgroundColor: 'rgba(29,161,242,0.14)', borderColor: 'rgba(29,161,242,0.5)' },
  sheetOptionText: { flex: 1 },
  sheetOptionLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  sheetOptionHint: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  sheetCancel: {
    marginTop: spacing.xs, paddingVertical: spacing.sm + 2, borderRadius: radius.lg, alignItems: 'center',
    backgroundColor: 'rgba(18,30,46,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  sheetCancelText: { ...typography.button, color: colors.textSecondary, fontWeight: '700' },
});

export default ChatScreen;
