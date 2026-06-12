import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, Image, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, AppState, Modal,
  ScrollView, Alert, Pressable, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Audio } from 'expo-av';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { fetchMessages, sendMessage, markConversationRead } from '../services/api';
import { useAuth } from '../context/useAuth';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const POLL_MS = 3000;
const { width: SCREEN_W } = Dimensions.get('window');
const MAX_FILE_BYTES = 6 * 1024 * 1024; // 6 MB cap for base64 attachments

const EMOJIS = ['😀','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😜','🤪','🤔','🤭','🫡','😎','🥳','😏','😴','😢','😭','😤','😡','🥺','😱','🤯','🙏','👍','👎','👏','🙌','🤝','💪','🫶','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🔥','✨','🎉','🎊','💯','✅','🕊️','📖','🎵','🎶','☀️','🌙','⭐','🙏🏽'];

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDuration = (s) => {
  const sec = Math.max(0, Math.round(s || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

const ChatScreen = ({ route, navigation }) => {
  const { conversationId, otherUser } = route.params;
  const { currentUser } = useAuth();

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [viewer, setViewer] = useState(null); // full-screen image uri
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [playingId, setPlayingId] = useState(null);

  const listRef = useRef(null);
  const pollRef = useRef(null);
  const appState = useRef(AppState.currentState);
  const lastCountRef = useRef(0);
  const isFocused = useRef(true);
  const recordingRef = useRef(null);
  const recordTimerRef = useRef(null);
  const recordStartRef = useRef(0);
  const soundRef = useRef(null);

  const loadMessages = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchMessages(conversationId);
      if (Array.isArray(data)) {
        setMessages(data);
        if (data.length !== lastCountRef.current) {
          lastCountRef.current = data.length;
          setTimeout(() => listRef.current?.scrollToEnd({ animated: !silent }), 80);
        }
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [conversationId]);

  const markRead = useCallback(() => {
    markConversationRead(conversationId).catch(() => {});
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
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert('Error', 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  }, [conversationId, currentUser]);

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
      if (status !== 'granted') { Alert.alert('Permission required', 'Enable photo access.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7,
      });
      if (res.canceled || !res.assets?.length) return;
      const processed = await manipulateAsync(
        res.assets[0].uri, [{ resize: { width: 1080 } }],
        { compress: 0.6, format: SaveFormat.JPEG, base64: true }
      );
      const uri = `data:image/jpeg;base64,${processed.base64}`;
      sendPayload({ content: '', message_type: 'image', attachment: uri });
    } catch (e) {
      Alert.alert('Error', 'Could not attach image.');
    }
  }, [sendPayload]);

  const attachFile = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const file = res.assets[0];
      if (file.size && file.size > MAX_FILE_BYTES) {
        Alert.alert('File too large', 'Please choose a file under 6 MB.');
        return;
      }
      const b64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
      const mime = file.mimeType || 'application/octet-stream';
      sendPayload({
        content: '', message_type: 'file',
        attachment: `data:${mime};base64,${b64}`, file_name: file.name || 'file',
      });
    } catch (e) {
      Alert.alert('Error', 'Could not attach file.');
    }
  }, [sendPayload]);

  const onAttachPress = useCallback(() => {
    setShowEmoji(false);
    Alert.alert('Attach', 'Choose what to send', [
      { text: 'Photo', onPress: attachImage },
      { text: 'Document', onPress: attachFile },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [attachImage, attachFile]);

  const openFile = useCallback(async (msg) => {
    try {
      const m = /^data:(.*?);base64,(.*)$/.exec(msg.attachment || '');
      if (!m) return;
      const path = `${FileSystem.cacheDirectory}${(msg.file_name || 'file').replace(/[^\w.\-]/g, '_')}`;
      await FileSystem.writeAsStringAsync(path, m[2], { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
      } else {
        Alert.alert('Saved', `File saved to app cache as ${msg.file_name}.`);
      }
    } catch {
      Alert.alert('Error', 'Could not open this file.');
    }
  }, []);

  // ── Voice notes ──
  const startRecording = useCallback(async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission required', 'Enable microphone access to record.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      recordStartRef.current = Date.now();
      setShowEmoji(false);
      setIsRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch {
      Alert.alert('Error', 'Could not start recording.');
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(async (cancel = false) => {
    clearInterval(recordTimerRef.current);
    setIsRecording(false);
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      if (cancel) return;
      const uri = rec.getURI();
      const seconds = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
      if (!uri) return;
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      sendPayload({ message_type: 'audio', attachment: `data:audio/m4a;base64,${b64}`, duration: seconds });
    } catch {
      Alert.alert('Error', 'Could not save the voice note.');
    }
  }, [sendPayload]);

  const playAudio = useCallback(async (msg) => {
    try {
      if (soundRef.current) { await soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
      if (playingId === msg.id) { setPlayingId(null); return; } // toggle off
      const m = /^data:(.*?);base64,(.*)$/.exec(msg.attachment || '');
      if (!m) return;
      const path = `${FileSystem.cacheDirectory}voice_${msg.id}.m4a`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) {
        await FileSystem.writeAsStringAsync(path, m[2], { encoding: FileSystem.EncodingType.Base64 });
      }
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });
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
      Alert.alert('Error', 'Could not play this voice note.');
      setPlayingId(null);
    }
  }, [playingId]);

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
                defaultSource={DEFAULT_AVATAR}
                style={styles.msgAvatar}
              />
            )}
          </View>
        )}
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, type === 'image' && styles.bubbleMedia]}>
          {type === 'image' && item.attachment ? (
            <Pressable onPress={() => setViewer(item.attachment)}>
              <Image source={{ uri: item.attachment }} style={styles.imageMsg} resizeMode="cover" />
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
  }, [currentUser?.id, messages, openFile]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <LinearGradient colors={[colors.surface, colors.bg]} style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Image
            source={otherUser?.profile_picture ? { uri: otherUser.profile_picture } : DEFAULT_AVATAR}
            defaultSource={DEFAULT_AVATAR}
            style={styles.headerAvatar}
          />
          <View style={styles.headerInfo}>
            <Text style={styles.headerName} numberOfLines={1}>{otherUser?.username ?? 'Chat'}</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>

      {loading && messages.length === 0 ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
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
              placeholder="Message…"
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
          <Image source={{ uri: viewer }} style={styles.viewerImage} resizeMode="contain" />
          <View style={styles.viewerClose}><Ionicons name="close" size={28} color={colors.white} /></View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerSafe: { backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  backBtn: { marginRight: spacing.xs },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface },
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
  bubbleOwn: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.card, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextOwn: { color: colors.white },
  bubbleTextOther: { color: colors.textPrimary },
  bubbleTime: { fontSize: 10, marginTop: 3 },
  bubbleTimeOwn: { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  bubbleTimeOther: { color: colors.textMuted },

  imageMsg: { width: SCREEN_W * 0.6, height: SCREEN_W * 0.6, borderRadius: radius.md, backgroundColor: colors.surface },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2, paddingRight: spacing.xs, minWidth: 180 },
  fileIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  fileName: { flex: 1, fontSize: 14, fontWeight: '600' },

  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 160, paddingVertical: 2 },
  audioBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.3)', overflow: 'hidden' },
  audioBarFill: { width: '100%', height: '100%', opacity: 0.8 },
  audioDuration: { fontSize: 12, fontWeight: '600', minWidth: 34, textAlign: 'right' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyText: { ...typography.body, color: colors.textMuted },

  emojiPanel: { height: 220, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm },
  emojiBtn: { width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 26 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.xs,
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
});

export default ChatScreen;
