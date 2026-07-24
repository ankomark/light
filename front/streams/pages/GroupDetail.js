import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, AppState, Modal,
  ScrollView, Alert, Pressable, Dimensions, Animated, PanResponder,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import {
  createSound, setAudioModeAsync, requestRecordingPermissionsAsync,
  Recording, VOICE_NOTE_RECORDING_OPTIONS,
} from '../services/audioPlayer';
import { compressImage } from '../services/imageProcessing';
import {
  fetchGroupDetails, fetchGroupPosts, sendGroupMessage, markGroupRead,
  leaveGroup, requestJoinGroup, reactToGroupPost, deleteGroupPost, setGroupPostingPolicy,
} from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import { createGroupSocket } from '../services/groupSocket';
import { useAuth } from '../context/useAuth';
import RotatingBackground from '../components/RotatingBackground';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
// Realtime arrives over the WebSocket; the poll is now just a safety net that
// catches anything missed during a socket reconnect, so it can be slow.
const POLL_MS = 12000;
const { width: SCREEN_W } = Dimensions.get('window');
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const EMOJIS = ['😀','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😜','🤪','🤔','🤭','😎','🥳','😢','😭','😤','😡','🥺','😱','🙏','👍','👎','👏','🙌','🤝','💪','🫶','❤️','🧡','💛','💚','💙','💜','🔥','✨','🎉','💯','✅','🕊️','📖','🎵','☀️','⭐'];
const REACTIONS = ['❤️', '👍', '🙏', '🎵', '😂', '🔥']; // quick-react row
const SWIPE_TRIGGER = 56; // px of right-swipe to fire a reply

// Voice notes recorded mono at a low bitrate — plenty for speech, far smaller
// than HIGH_QUALITY, so they upload and load fast. Format stays .m4a/AAC.
const isData = (uri) => typeof uri === 'string' && uri.startsWith('data:');

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDuration = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round((s || 0) % 60)).padStart(2, '0')}`;
const replyLabel = (m, t) => m.content || ({
  image: t('group.preview.photo'), file: t('group.preview.file'), audio: t('group.preview.voiceNote'),
}[m.message_type] || t('group.preview.message'));

/**
 * One chat row: swipe-right-to-reply (PanResponder, no GestureHandlerRootView),
 * WhatsApp-style delivery state (clock → double-tick, or failed/tap-to-retry),
 * an upload spinner over in-flight images, and emoji reactions.
 */
const GroupMessageRow = ({
  item, isOwn, showName, playingId,
  onReply, onLongPress, onOpenImage, onOpenFile, onPlayAudio, onToggleReaction, onRetry,
}) => {
  const { t } = useI18n();
  const tx = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderMove: (_, g) => {
        const x = Math.max(0, Math.min(g.dx, 80));
        tx.setValue(x);
        if (!armed.current && x >= SWIPE_TRIGGER) {
          armed.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } else if (armed.current && x < SWIPE_TRIGGER) {
          armed.current = false;
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx >= SWIPE_TRIGGER) onReply(item);
        armed.current = false;
        Animated.spring(tx, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
      },
      onPanResponderTerminate: () => {
        armed.current = false;
        Animated.spring(tx, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  if (item.message_type === 'system') {
    return <View style={styles.sysRow}><Text style={styles.sysText}>{item.content}</Text></View>;
  }

  const type = item.message_type || 'text';
  const status = item._status; // 'sending' | 'failed' | undefined (delivered)
  const sending = status === 'sending';
  const failed = status === 'failed';
  const reactions = item.reactions?.summary || [];
  const myReaction = item.reactions?.mine || null;
  const hintOpacity = tx.interpolate({ inputRange: [0, SWIPE_TRIGGER], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <View style={styles.swipeWrap}>
      <Animated.View style={[styles.replyHint, { opacity: hintOpacity, transform: [{ scale: hintOpacity }] }]}>
        <Ionicons name="arrow-undo" size={18} color={colors.accent} />
      </Animated.View>

      <Animated.View style={{ transform: [{ translateX: tx }] }} {...pan.panHandlers}>
        <Pressable
          onLongPress={() => onLongPress(item)} delayLongPress={250}
          onPress={failed ? () => onRetry(item) : undefined}
          style={[styles.msgRow, isOwn ? styles.msgRowOwn : styles.msgRowOther]}
        >
          {!isOwn && (
            <View style={styles.avatarPlaceholder}>
              {showName && (
                <Image source={item.user?.profile_picture ? { uri: item.user.profile_picture } : DEFAULT_AVATAR} placeholder={DEFAULT_AVATAR} contentFit="cover" transition={120} style={styles.msgAvatar} />
              )}
            </View>
          )}
          <View style={styles.bubbleCol}>
            <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, type === 'image' && styles.bubbleMedia, sending && styles.bubbleSending]}>
              {showName && <Text style={styles.senderName}>{item.user?.username}</Text>}

              {item.reply_to && (
                <View style={styles.replyQuote}>
                  <Text style={styles.replyQuoteName}>{item.reply_to.sender_username || t('group.preview.reply')}</Text>
                  <Text style={styles.replyQuoteText} numberOfLines={1}>{replyLabel(item.reply_to, t)}</Text>
                </View>
              )}

              {type === 'image' && item.attachment ? (
                <Pressable onPress={() => (sending ? null : onOpenImage(item.attachment))}>
                  <Image source={{ uri: item.attachment }} style={styles.imageMsg} contentFit="cover" transition={150} />
                  {sending && <View style={styles.uploadOverlay}><ActivityIndicator color="#fff" /></View>}
                </Pressable>
              ) : type === 'file' ? (
                <Pressable style={styles.fileRow} onPress={() => onOpenFile(item)} disabled={sending}>
                  <View style={styles.fileIcon}><Ionicons name="document-text" size={22} color={colors.primary} /></View>
                  <Text style={[styles.fileName, isOwn ? styles.txtOwn : styles.txtOther]} numberOfLines={1}>{item.file_name || 'File'}</Text>
                  <Ionicons name="download-outline" size={18} color={isOwn ? 'rgba(255,255,255,0.8)' : colors.textMuted} />
                </Pressable>
              ) : type === 'audio' ? (
                <Pressable style={styles.audioRow} onPress={() => onPlayAudio(item)} disabled={sending}>
                  <Ionicons name={playingId === item.id ? 'pause-circle' : 'play-circle'} size={30} color={isOwn ? colors.white : colors.primary} />
                  <View style={styles.audioBar}><View style={[styles.audioBarFill, { backgroundColor: isOwn ? 'rgba(255,255,255,0.55)' : colors.primary }]} /></View>
                  <Text style={[styles.audioDuration, isOwn ? styles.txtOwn : styles.txtOther]}>{fmtDuration(item.duration)}</Text>
                </Pressable>
              ) : null}

              {!!item.content && (
                <Text style={[styles.bubbleText, isOwn ? styles.txtOwn : styles.txtOther, type === 'image' && { marginTop: spacing.xs }]}>{item.content}</Text>
              )}

              <View style={styles.metaRow}>
                <Text style={[styles.bubbleTime, isOwn ? styles.timeOwn : styles.timeOther]}>{fmtTime(item.created_at)}</Text>
                {isOwn && (
                  failed ? (
                    <View style={styles.statusWrap}>
                      <Ionicons name="alert-circle" size={13} color={colors.error} />
                      <Text style={styles.retryText}>{t('group.detail.tapToRetry')}</Text>
                    </View>
                  ) : sending ? (
                    <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.7)" style={styles.statusIcon} />
                  ) : (
                    <Ionicons name="checkmark-done" size={14} color="rgba(255,255,255,0.75)" style={styles.statusIcon} />
                  )
                )}
              </View>
            </View>

            {reactions.length > 0 && (
              <View style={[styles.reactionsRow, isOwn && styles.reactionsRowOwn]}>
                {reactions.map((r) => (
                  <TouchableOpacity key={r.emoji} activeOpacity={0.8}
                    onPress={() => onToggleReaction(item, r.emoji)}
                    style={[styles.reactionChip, myReaction === r.emoji && styles.reactionChipMine]}>
                    <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                    {r.count > 1 && <Text style={[styles.reactionCount, myReaction === r.emoji && styles.reactionCountMine]}>{r.count}</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
};

const mergeMessages = (a, b) => {
  const map = new Map();
  [...a, ...b].forEach((m) => map.set(String(m.id), m));
  return Array.from(map.values()).sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
};

const GroupDetail = ({ route, navigation }) => {
  const { t } = useI18n();
  const { groupSlug, group: initialGroup } = route.params;
  const { currentUser } = useAuth();

  const [group, setGroup] = useState(initialGroup || null);
  const [isMember, setIsMember] = useState(initialGroup?.is_member || false);
  const [isAdmin, setIsAdmin] = useState(initialGroup?.is_admin || false);
  const [requested, setRequested] = useState(initialGroup?.has_pending_request || false);
  const [messages, setMessages] = useState([]);
  // When we arrive from the list we already have the group object, so we can
  // render the chat shell straight away instead of blocking on a full reload.
  const [loading, setLoading] = useState(!initialGroup);
  const [firstLoad, setFirstLoad] = useState(true); // first posts fetch in flight
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [menuMsg, setMenuMsg] = useState(null); // long-press action menu target
  const [attachSheet, setAttachSheet] = useState(false); // luxury "what to send" sheet
  const [menuSheet, setMenuSheet] = useState(false);      // group options sheet
  const [leaveConfirm, setLeaveConfirm] = useState(false);// leave-group confirm
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [playingId, setPlayingId] = useState(null);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]); // usernames currently typing

  const listRef = useRef(null);
  const pollRef = useRef(null);
  const socketRef = useRef(null);        // realtime chat socket
  const typingTimersRef = useRef({});    // per-user auto-expire timers
  const myTypingRef = useRef({ active: false, idle: null }); // outbound typing throttle
  // Only members may read the chat (public groups included). Mirrored into a ref
  // so the poll/AppState callbacks can gate without re-subscribing.
  const canReadRef = useRef(initialGroup?.is_member || false);
  const appState = useRef(AppState.currentState);
  const pageRef = useRef(1);
  const recordingRef = useRef(null);
  const recordTimerRef = useRef(null);
  const recordStartRef = useRef(0);
  const soundRef = useRef(null);

  // ── Load ──
  const loadPosts = useCallback(async (silent = false) => {
    try {
      const res = await fetchGroupPosts(groupSlug, 1);
      const incoming = (res?.results ?? []).slice().reverse();
      setHasEarlier(!!res?.next);
      setMessages((prev) => {
        // Keep optimistic rows that are still sending or failed so they don't
        // blink out between polls; drop only the ones already confirmed gone.
        const keepTemps = prev.filter((m) => String(m.id).startsWith('temp_') && (m._status === 'sending' || m._status === 'failed'));
        const base = prev.filter((m) => !String(m.id).startsWith('temp_'));
        const merged = mergeMessages([...base, ...keepTemps], incoming);
        if (!silent && merged.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 60);
        return merged;
      });
    } catch { /* ignore */ }
  }, [groupSlug]);

  const loadGroup = useCallback(async () => {
    // Only members can read messages (public groups too). If the list already
    // told us the user is a member, start fetching messages right now — in
    // parallel with the group-details request — so the chat fills in without
    // waiting for two sequential round-trips.
    const canReadNow = !!initialGroup?.is_member;
    const postsPromise = canReadNow ? loadPosts() : null;
    try {
      const g = await fetchGroupDetails(groupSlug);
      setGroup(g);
      setIsMember(g.is_member);
      setIsAdmin(g.is_admin);
      setRequested(!!g.has_pending_request);
      canReadRef.current = !!g.is_member;
      if (!postsPromise && g.is_member) await loadPosts();
    } catch {
      Alert.alert(t('common.error'), t('group.detail.loadFailed'));
    } finally {
      if (postsPromise) await postsPromise.catch(() => {});
      setLoading(false);
      setFirstLoad(false);
    }
  }, [groupSlug, loadPosts, initialGroup, t]);

  const loadEarlier = useCallback(async () => {
    try {
      const next = pageRef.current + 1;
      const res = await fetchGroupPosts(groupSlug, next);
      const older = (res?.results ?? []).slice().reverse();
      if (older.length) { pageRef.current = next; setMessages((prev) => mergeMessages(older, prev)); }
      setHasEarlier(!!res?.next);
    } catch { /* ignore */ }
  }, [groupSlug]);

  const markRead = useCallback(() => { markGroupRead(groupSlug).catch(() => {}); }, [groupSlug]);

  useFocusEffect(
    useCallback(() => {
      loadGroup();
      markRead();
      pollRef.current = setInterval(() => { if (canReadRef.current) loadPosts(true); }, POLL_MS);
      const sub = AppState.addEventListener('change', (n) => {
        if (n === 'active' && appState.current !== 'active' && canReadRef.current) { loadPosts(true); markRead(); }
        appState.current = n;
      });
      return () => { clearInterval(pollRef.current); sub.remove(); markRead(); };
    }, [loadGroup, loadPosts, markRead])
  );

  // ── Realtime socket ──
  // A member connection streams new messages, deletions, and typing. Reads/sends
  // still go through REST; this just makes them land instantly. My own messages
  // are skipped here (the optimistic bubble already shows them).
  const markUserTyping = useCallback((username, isTyping) => {
    clearTimeout(typingTimersRef.current[username]);
    if (isTyping) {
      setTypingUsers((prev) => (prev.includes(username) ? prev : [...prev, username]));
      typingTimersRef.current[username] = setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => u !== username));
      }, 5000);
    } else {
      setTypingUsers((prev) => prev.filter((u) => u !== username));
    }
  }, []);

  useEffect(() => {
    if (!isMember) return undefined;
    const sock = createGroupSocket(groupSlug, {
      onMessage: (msg) => {
        if (msg?.user?.id === currentUser?.id) return; // already shown optimistically
        setMessages((prev) => mergeMessages([msg], prev));
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
      },
      onDeleted: (id) => setMessages((prev) => prev.filter((m) => String(m.id) !== String(id))),
      onTyping: (evt) => {
        if (evt.user_id === currentUser?.id || !evt.username) return;
        markUserTyping(evt.username, evt.is_typing);
      },
    });
    socketRef.current = sock;
    return () => { sock.close(); socketRef.current = null; };
  }, [groupSlug, isMember, currentUser?.id, markUserTyping]);

  // Tell the room I'm typing (once), and stop after a short idle.
  const notifyTyping = useCallback(() => {
    const s = socketRef.current;
    if (!s) return;
    if (!myTypingRef.current.active) { myTypingRef.current.active = true; s.sendTyping(true); }
    clearTimeout(myTypingRef.current.idle);
    myTypingRef.current.idle = setTimeout(() => {
      myTypingRef.current.active = false;
      s.sendTyping(false);
    }, 2500);
  }, []);

  const onChangeText = useCallback((val) => { setText(val); notifyTyping(); }, [notifyTyping]);

  useEffect(() => () => {
    clearInterval(recordTimerRef.current);
    recordingRef.current?.stopAndUnloadAsync?.().catch(() => {});
    soundRef.current?.unloadAsync?.().catch(() => {});
    Object.values(typingTimersRef.current).forEach(clearTimeout);
    clearTimeout(myTypingRef.current.idle);
  }, []);

  // ── Send (optimistic, WhatsApp-style states) ──
  // Show the bubble instantly with a 'sending' clock, then swap in the saved
  // copy (→ delivered double-tick) or flag it 'failed' for a tap-to-retry.
  const deliver = useCallback(async (payload, replyDisplay) => {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const optimistic = {
      id: tempId,
      user: { id: currentUser?.id, username: currentUser?.username, profile_picture: currentUser?.profile_picture },
      content: payload.content || '', message_type: payload.message_type || 'text',
      attachment: payload.attachment || '', file_name: payload.file_name || '', duration: payload.duration,
      reply_to: replyDisplay
        ? { id: replyDisplay.id, content: replyDisplay.content, message_type: replyDisplay.message_type, sender_username: replyDisplay.user?.username || replyDisplay.sender_username }
        : null,
      created_at: new Date().toISOString(), is_owner: true,
      reactions: { summary: [], mine: null },
      _status: 'sending', _payload: payload, _replyDisplay: replyDisplay || null,
    };
    setMessages((prev) => [...prev, optimistic]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    try {
      const saved = await sendGroupMessage(groupSlug, payload);
      // Swap the optimistic row for the saved one, and drop any copy a concurrent
      // poll may have already merged in, so the message can't briefly appear twice.
      setMessages((prev) => prev
        .filter((m) => m.id === tempId || m.id !== saved.id)
        .map((m) => (m.id === tempId ? { ...saved } : m)));
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _status: 'failed' } : m)));
    }
  }, [groupSlug, currentUser]);

  const sendPayload = useCallback((payload) => {
    const rd = replyTo;
    setReplyTo(null);
    deliver(payload, rd);
  }, [deliver, replyTo]);

  // Media send: show the local file instantly, upload it to R2 in the
  // background, then persist the message with just the URL (mirrors DMs).
  const sendMedia = useCallback(async (media, replyDisplay) => {
    const { localUri, uploadType, message_type, file_name = '', duration = null, mimeType } = media;
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const optimistic = {
      id: tempId,
      user: { id: currentUser?.id, username: currentUser?.username, profile_picture: currentUser?.profile_picture },
      content: '', message_type, attachment: localUri, file_name, duration,
      reply_to: replyDisplay
        ? { id: replyDisplay.id, content: replyDisplay.content, message_type: replyDisplay.message_type, sender_username: replyDisplay.user?.username || replyDisplay.sender_username }
        : null,
      created_at: new Date().toISOString(), is_owner: true,
      reactions: { summary: [], mine: null },
      _status: 'sending', _retryMedia: media, _replyDisplay: replyDisplay || null,
    };
    setMessages((prev) => [...prev, optimistic]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    try {
      const uploaded = await uploadMedia({ uri: localUri, name: file_name || `chat_${Date.now()}`, mimeType }, uploadType);
      const saved = await sendGroupMessage(groupSlug, {
        message_type, attachment: uploaded.url, file_name, duration, reply_to_id: replyDisplay?.id,
      });
      // Swap the optimistic row for the saved one, and drop any copy a concurrent
      // poll may have already merged in, so the message can't briefly appear twice.
      setMessages((prev) => prev
        .filter((m) => m.id === tempId || m.id !== saved.id)
        .map((m) => (m.id === tempId ? { ...saved } : m)));
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _status: 'failed' } : m)));
    }
  }, [groupSlug, currentUser]);

  const sendMediaMessage = useCallback((media) => {
    const rd = replyTo;
    setReplyTo(null);
    sendMedia(media, rd);
  }, [sendMedia, replyTo]);

  const retrySend = useCallback((m) => {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    if (m._retryMedia) sendMedia(m._retryMedia, m._replyDisplay);
    else deliver(m._payload, m._replyDisplay);
  }, [deliver, sendMedia]);

  const handleSendText = useCallback(() => {
    const content = text.trim();
    if (!content) return;
    setText(''); setShowEmoji(false);
    sendPayload({ content, message_type: 'text', reply_to_id: replyTo?.id });
  }, [text, sendPayload, replyTo]);

  const attachImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert(t('chat.permissionRequired'), t('chat.permissionPhotos')); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      if (res.canceled || !res.assets?.length) return;
      const p = await compressImage(res.assets[0].uri, { width: 1080, quality: 0.6 });
      sendMediaMessage({ localUri: p.uri, uploadType: 'chat-image', message_type: 'image', mimeType: 'image/jpeg' });
    } catch { Alert.alert(t('common.error'), t('chat.attachImageFailed')); }
  }, [sendMediaMessage, t]);

  const attachFile = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const f = res.assets[0];
      if (f.size && f.size > MAX_FILE_BYTES) { Alert.alert(t('chat.fileTooLargeTitle'), t('group.detail.fileTooLargeBody')); return; }
      sendMediaMessage({
        localUri: f.uri, uploadType: 'chat-file', message_type: 'file',
        file_name: f.name || 'file', mimeType: f.mimeType || 'application/octet-stream',
      });
    } catch { Alert.alert(t('common.error'), t('chat.attachFileFailed')); }
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
        path = msg.attachment; // local file:// (optimistic, still uploading)
      }
      if (!path) return;
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
      else Alert.alert(t('chat.savedTitle'), t('common.savedAs', { name: msg.file_name }));
    } catch { Alert.alert(t('common.error'), t('chat.openFileFailed')); }
  }, [t]);

  // ── Voice ──
  const startRecording = useCallback(async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert(t('chat.permissionRequired'), t('chat.permissionMic')); return; }
      await setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Recording();
      await rec.prepareToRecordAsync(VOICE_NOTE_RECORDING_OPTIONS);
      await rec.startAsync();
      recordingRef.current = rec; recordStartRef.current = Date.now();
      setShowEmoji(false); setIsRecording(true); setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch { Alert.alert(t('common.error'), t('chat.recordFailed')); setIsRecording(false); }
  }, [t]);

  const stopRecording = useCallback(async (cancel = false) => {
    clearInterval(recordTimerRef.current);
    setIsRecording(false);
    const rec = recordingRef.current; recordingRef.current = null;
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
    } catch { Alert.alert(t('common.error'), t('chat.saveVoiceFailed')); }
  }, [sendMediaMessage, t]);

  const playAudio = useCallback(async (msg) => {
    try {
      if (soundRef.current) { await soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
      if (playingId === msg.id) { setPlayingId(null); return; }
      // Legacy base64 → write to a cache file first; R2/local URIs play
      // directly (expo-av streams https).
      let sourceUri = msg.attachment;
      if (isData(msg.attachment)) {
        const m = /^data:(.*?);base64,(.*)$/.exec(msg.attachment || '');
        if (!m) return;
        const path = `${FileSystem.cacheDirectory}gvoice_${msg.id}.m4a`;
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists) await FileSystem.writeAsStringAsync(path, m[2], { encoding: FileSystem.EncodingType.Base64 });
        sourceUri = path;
      }
      if (!sourceUri) return;
      await setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound } = await createSound({ uri: sourceUri }, { shouldPlay: true });
      soundRef.current = sound; setPlayingId(msg.id);
      sound.setOnPlaybackStatusUpdate((st) => { if (st.didJustFinish) { setPlayingId(null); sound.unloadAsync().catch(() => {}); soundRef.current = null; } });
    } catch { Alert.alert(t('common.error'), t('chat.playVoiceFailed')); setPlayingId(null); }
  }, [playingId, t]);

  // ── Group menu (luxury sheet) ──
  const openMenu = useCallback(() => setMenuSheet(true), []);

  const goMembers = useCallback(() => {
    setMenuSheet(false);
    navigation.navigate('GroupMembers', { groupSlug, group, isAdmin });
  }, [navigation, groupSlug, group, isAdmin]);

  const goRequests = useCallback(() => {
    setMenuSheet(false);
    navigation.navigate('GroupJoinRequests', { groupSlug, group });
  }, [navigation, groupSlug, group]);

  const goAddMembers = useCallback(() => {
    setMenuSheet(false);
    navigation.navigate('GroupAddMembers', { groupSlug, group });
  }, [navigation, groupSlug, group]);

  const askLeave = useCallback(() => {
    setMenuSheet(false);
    setTimeout(() => setLeaveConfirm(true), 220);
  }, []);

  const doLeave = useCallback(async () => {
    setLeaveConfirm(false);
    try { await leaveGroup(groupSlug); navigation.goBack(); }
    catch { Alert.alert(t('common.error'), t('group.detail.leaveFailed')); }
  }, [groupSlug, navigation, t]);

  const canLeave = isMember && group?.creator?.id !== currentUser?.id;

  const togglePostingPolicy = useCallback(async () => {
    setMenuSheet(false);
    const next = !group?.only_admins_can_post;
    try {
      const updated = await setGroupPostingPolicy(groupSlug, next);
      setGroup(updated);
    } catch {
      Alert.alert(t('common.error'), t('group.detail.settingFailed'));
    }
  }, [group, groupSlug, t]);

  const join = async () => {
    try {
      await requestJoinGroup(groupSlug, '');
      setRequested(true);
      Alert.alert(t('group.detail.requestSentTitle'), t('group.detail.requestSentBody'));
    } catch (e) {
      // requestJoinGroup rejects with the response body itself ({ error } / { message }).
      const msg = e?.error || e?.response?.data?.error || e?.message || t('group.detail.requestFailed');
      if (/already/i.test(msg)) setRequested(true);
      Alert.alert(t('common.notice'), msg);
    }
  };

  // ── Message actions: react / reply / delete ──
  const startReply = useCallback((m) => {
    setMenuMsg(null);
    setReplyTo(m);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const openMsgMenu = useCallback((m) => {
    if (String(m.id).startsWith('temp_')) return; // not yet saved
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setMenuMsg(m);
  }, []);

  const canDelete = (m) => !!m && (m.user?.id === currentUser?.id || m.is_owner || isAdmin);

  const confirmDelete = useCallback((m) => {
    setMenuMsg(null);
    if (!canDelete(m)) return;
    Alert.alert(t('group.detail.deleteMessageTitle'), t('group.detail.deleteMessageBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: async () => {
        try { await deleteGroupPost(groupSlug, m.id); setMessages((prev) => prev.filter((x) => x.id !== m.id)); }
        catch { Alert.alert(t('common.error'), t('group.detail.deleteMessageFailed')); }
      } },
    ]);
  }, [groupSlug, currentUser, isAdmin, t]);

  // Toggle an emoji reaction; the API returns the post's fresh reaction state.
  const reactToPost = useCallback(async (m, emoji) => {
    setMenuMsg(null);
    if (String(m.id).startsWith('temp_')) return;
    Haptics.selectionAsync().catch(() => {});
    try {
      const updated = await reactToGroupPost(groupSlug, m.id, emoji);
      setMessages((prev) => prev.map((x) => (x.id === updated.id ? { ...x, reactions: updated.reactions } : x)));
    } catch { /* ignore */ }
  }, [groupSlug]);

  // ── Render ──
  const renderMessage = useCallback(({ item, index }) => {
    const isOwn = item.user?.id === currentUser?.id || item.is_owner;
    const prev = messages[index - 1];
    const showName = !isOwn && (!prev || prev.user?.id !== item.user?.id || prev.message_type === 'system');
    return (
      <GroupMessageRow
        item={item}
        isOwn={isOwn}
        showName={showName}
        playingId={playingId}
        onReply={startReply}
        onLongPress={openMsgMenu}
        onOpenImage={setViewer}
        onOpenFile={openFile}
        onPlayAudio={playAudio}
        onToggleReaction={reactToPost}
        onRetry={retrySend}
      />
    );
  }, [currentUser?.id, messages, playingId, openFile, playAudio, startReply, openMsgMenu, reactToPost, retrySend]);

  if (loading) {
    return (
      <View style={styles.root}>
        <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.68)" />
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      </View>
    );
  }

  const adminsOnly = !!group?.only_admins_can_post;
  const canChat = isMember && (!adminsOnly || isAdmin);

  return (
    <View style={styles.root}>
    <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.68)" />
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <LinearGradient colors={['rgba(16,46,80,0.95)', 'rgba(10,22,40,0.80)']} style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerInfo}
            activeOpacity={isMember ? 0.8 : 1}
            onPress={() => isMember && navigation.navigate('GroupMembers', { groupSlug, group, isAdmin })}
          >
            {group?.cover_image ? (
              <Image source={{ uri: group.cover_image }} style={styles.groupAvatar} contentFit="cover" transition={150} />
            ) : (
              <View style={[styles.groupAvatar, styles.groupAvatarFallback]}><Ionicons name="people" size={20} color={colors.primary} /></View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.headerName} numberOfLines={1}>{group?.name ?? 'Group'}</Text>
              <Text style={styles.headerSub} numberOfLines={1}>{t('group.detail.memberCount', { count: group?.member_count ?? 0 })}{group?.is_private ? t('group.detail.privateSuffix') : ''}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={openMenu} style={styles.backBtn}>
            <Ionicons name="ellipsis-vertical" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </LinearGradient>
      </SafeAreaView>

      {isMember ? (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={hasEarlier ? (
            <TouchableOpacity style={styles.earlierBtn} onPress={loadEarlier}><Text style={styles.earlierText}>{t('group.detail.loadEarlier')}</Text></TouchableOpacity>
          ) : null}
          ListEmptyComponent={firstLoad ? (
            <View style={styles.emptyContainer}><ActivityIndicator color={colors.accent} /></View>
          ) : (
            <View style={styles.emptyContainer}><Text style={styles.emptyText}>{t('group.detail.noMessages')}</Text></View>
          )}
        />
      ) : (
        <View style={styles.lockedPreview}>
          <View style={styles.lockedIconWrap}>
            <Ionicons name="lock-closed" size={34} color={colors.textSecondary} />
          </View>
          <Text style={styles.lockedTitle}>{t('group.detail.membersOnlyTitle')}</Text>
          <Text style={styles.lockedBody}>{t('group.detail.membersOnlyBody')}</Text>
          {group?.description ? (
            <Text style={styles.lockedDesc} numberOfLines={4}>{group.description}</Text>
          ) : null}
        </View>
      )}

      {showEmoji && canChat && (
        <View style={styles.emojiPanel}>
          <ScrollView contentContainerStyle={styles.emojiGrid} keyboardShouldPersistTaps="handled">
            {EMOJIS.map((e, i) => (
              <TouchableOpacity key={i} style={styles.emojiBtn} onPress={() => setText((t) => t + e)}><Text style={styles.emojiText}>{e}</Text></TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Reply preview */}
      {replyTo && canChat && (
        <View style={styles.replyBar}>
          <View style={styles.replyAccent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarName}>{t('group.detail.replyingTo', { name: replyTo.user?.username })}</Text>
            <Text style={styles.replyBarText} numberOfLines={1}>{replyLabel(replyTo, t)}</Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}><Ionicons name="close" size={20} color={colors.textMuted} /></TouchableOpacity>
        </View>
      )}

      {typingUsers.length > 0 && (
        <View style={styles.typingBar}>
          <View style={styles.typingDots}>
            <View style={[styles.typingDot, styles.typingDot1]} />
            <View style={[styles.typingDot, styles.typingDot2]} />
            <View style={[styles.typingDot, styles.typingDot3]} />
          </View>
          <Text style={styles.typingText} numberOfLines={1}>
            {typingUsers.length === 1
              ? t('group.detail.typingOne', { name: typingUsers[0] })
              : t('group.detail.typingMany')}
          </Text>
        </View>
      )}

      {canChat ? (
        <View style={styles.inputBar}>
          {isRecording ? (
            <>
              <TouchableOpacity style={styles.iconBtn} onPress={() => stopRecording(true)}><Ionicons name="trash-outline" size={24} color={colors.error} /></TouchableOpacity>
              <View style={styles.recordingInfo}><View style={styles.recDot} /><Text style={styles.recText}>{t('group.detail.recording', { time: fmtDuration(recordSecs) })}</Text></View>
              <TouchableOpacity style={styles.sendBtn} onPress={() => stopRecording(false)}><Ionicons name="send" size={18} color={colors.white} /></TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.iconBtn} onPress={() => setShowEmoji((s) => !s)}><Ionicons name={showEmoji ? 'close' : 'happy-outline'} size={24} color={colors.textSecondary} /></TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={onAttachPress}><Ionicons name="add-circle-outline" size={26} color={colors.textSecondary} /></TouchableOpacity>
              <TextInput style={styles.input} placeholder={t('chat.messagePlaceholder')} placeholderTextColor={colors.placeholder} value={text} onChangeText={onChangeText} onFocus={() => setShowEmoji(false)} multiline maxLength={2000} />
              {text.trim() ? (
                <TouchableOpacity style={styles.sendBtn} onPress={handleSendText}>
                  <Ionicons name="send" size={18} color={colors.white} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.sendBtn} onPress={startRecording}><Ionicons name="mic" size={20} color={colors.white} /></TouchableOpacity>
              )}
            </>
          )}
        </View>
      ) : isMember ? (
        <View style={styles.joinBar}>
          <View style={styles.lockedPill}>
            <Ionicons name="lock-closed" size={16} color={colors.textSecondary} />
            <Text style={styles.lockedText}>{t('group.detail.onlyAdminsSend')}</Text>
          </View>
        </View>
      ) : requested ? (
        <View style={styles.joinBar}>
          <View style={styles.pendingPill}>
            <Ionicons name="time-outline" size={18} color={colors.warning} />
            <Text style={styles.pendingText}>{t('group.detail.waitingApproval')}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.joinBar}>
          <Text style={styles.joinText}>{t('group.detail.notAMember')}</Text>
          <TouchableOpacity style={styles.joinBtn} onPress={join}><Text style={styles.joinBtnText}>{t('group.detail.requestToJoin')}</Text></TouchableOpacity>
        </View>
      )}

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
            <Text style={styles.sheetTitle}>{t('group.detail.shareToGroup')}</Text>
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

      {/* Luxury group options sheet: view members · join requests · leave */}
      <Modal visible={menuSheet} transparent animationType="slide" onRequestClose={() => setMenuSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuSheet(false)}>
          <Pressable style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle} numberOfLines={1}>{group?.name || 'Group'}</Text>
            <Text style={styles.sheetSubtitle}>{t('group.detail.memberCount', { count: group?.member_count ?? 0 })}{group?.is_private ? t('group.detail.privateSuffix') : ''}</Text>

            {isMember && (
              <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} onPress={goMembers}>
                <View style={[styles.sheetIcon, styles.sheetIconFile]}>
                  <Ionicons name="people" size={22} color={colors.primary} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionLabel}>{t('group.detail.viewMembers')}</Text>
                  <Text style={styles.sheetOptionHint}>{t('group.detail.seeEveryone')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            )}

            {isAdmin && (
              <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} onPress={goAddMembers}>
                <View style={[styles.sheetIcon, styles.sheetIconPhoto]}>
                  <Ionicons name="person-add" size={22} color={colors.accent} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionLabel}>{t('group.detail.addMembers')}</Text>
                  <Text style={styles.sheetOptionHint}>{t('group.detail.searchOrInvite')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            )}

            {isAdmin && (
              <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} onPress={goRequests}>
                <View style={[styles.sheetIcon, styles.sheetIconFile]}>
                  <Ionicons name="mail-unread" size={22} color={colors.primary} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionLabel}>{t('group.detail.joinRequests')}</Text>
                  <Text style={styles.sheetOptionHint}>{t('group.detail.reviewRequests')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            )}

            {isAdmin && (
              <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} onPress={togglePostingPolicy}>
                <View style={[styles.sheetIcon, styles.sheetIconFile]}>
                  <Ionicons name={adminsOnly ? 'lock-closed' : 'lock-open'} size={22} color={colors.primary} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionLabel}>{t('group.detail.onlyAdminsMessage')}</Text>
                  <Text style={styles.sheetOptionHint}>{adminsOnly ? t('group.detail.adminsOnlyOn') : t('group.detail.adminsOnlyOff')}</Text>
                </View>
                <View style={[styles.toggle, adminsOnly && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, adminsOnly && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
            )}

            {canLeave && (
              <TouchableOpacity style={[styles.sheetOption, styles.sheetOptionDanger]} activeOpacity={0.85} onPress={askLeave}>
                <View style={[styles.sheetIcon, styles.sheetIconDanger]}>
                  <Ionicons name="exit-outline" size={22} color={colors.error} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={[styles.sheetOptionLabel, { color: colors.error }]}>{t('group.detail.leaveGroup')}</Text>
                  <Text style={styles.sheetOptionHint}>{t('group.detail.leaveWarning')}</Text>
                </View>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.sheetCancel} activeOpacity={0.85} onPress={() => setMenuSheet(false)}>
              <Text style={styles.sheetCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Luxury leave-group confirmation */}
      <Modal visible={leaveConfirm} transparent animationType="fade" onRequestClose={() => setLeaveConfirm(false)}>
        <Pressable style={styles.confirmBackdrop} onPress={() => setLeaveConfirm(false)}>
          <Pressable style={styles.confirmCard}>
            <View style={styles.confirmIcon}><Ionicons name="exit-outline" size={28} color={colors.error} /></View>
            <Text style={styles.confirmTitle} numberOfLines={2}>Leave “{group?.name || 'this group'}”?</Text>
            <Text style={styles.confirmText}>{t('group.detail.leaveBody')}</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmCancelBtn]} activeOpacity={0.85} onPress={() => setLeaveConfirm(false)}>
                <Text style={styles.confirmCancelText}>{t('common.stay')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmLeaveBtn]} activeOpacity={0.85} onPress={doLeave}>
                <Text style={styles.confirmLeaveText}>{t('common.leave')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Long-press action menu: react · reply · delete */}
      <Modal visible={!!menuMsg} transparent animationType="fade" onRequestClose={() => setMenuMsg(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuMsg(null)}>
          <Pressable style={styles.menuCard}>
            <View style={styles.emojiBar}>
              {REACTIONS.map((e) => {
                const active = menuMsg?.reactions?.mine === e;
                return (
                  <TouchableOpacity key={e} onPress={() => reactToPost(menuMsg, e)}
                    style={[styles.emojiQuickBtn, active && styles.emojiQuickActive]} activeOpacity={0.7}>
                    <Text style={styles.emojiQuick}>{e}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.menuItem} onPress={() => startReply(menuMsg)}>
              <Ionicons name="arrow-undo" size={20} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>{t('group.detail.reply')}</Text>
            </TouchableOpacity>
            {canDelete(menuMsg) && (
              <TouchableOpacity style={styles.menuItem} onPress={() => confirmDelete(menuMsg)}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
                <Text style={[styles.menuItemText, { color: colors.error }]}>{t('common.delete')}</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
  headerSafe: { backgroundColor: 'rgba(16,46,80,0.95)' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.xs },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  groupAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card },
  groupAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  headerName: { ...typography.h3, color: colors.textPrimary },
  headerSub: { ...typography.caption, color: colors.textSecondary },

  listContent: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md, flexGrow: 1 },
  earlierBtn: { alignSelf: 'center', backgroundColor: colors.card, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginBottom: spacing.sm },
  earlierText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },

  sysRow: { alignItems: 'center', marginVertical: spacing.xs },
  sysText: { ...typography.caption, color: colors.textMuted, backgroundColor: colors.card, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 4, overflow: 'hidden' },

  msgRow: { flexDirection: 'row', marginVertical: 2, alignItems: 'flex-end' },
  msgRowOwn: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  avatarPlaceholder: { width: 30, marginRight: spacing.xs },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface },
  bubbleCol: { maxWidth: '78%', flexShrink: 1 },
  bubble: { borderRadius: radius.lg, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, ...shadows.sm },
  bubbleMedia: { padding: 2, borderRadius: 8 }, // slim 2px frame, tidy corners
  bubbleSending: { opacity: 0.85 },             // dim while in flight
  bubbleOwn: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.card, borderBottomLeftRadius: 4 },
  senderName: { ...typography.caption, color: colors.accent, fontWeight: '700', marginBottom: 2 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  txtOwn: { color: colors.white },
  txtOther: { color: colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 3, marginTop: 3 },
  bubbleTime: { fontSize: 10 },
  timeOwn: { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  timeOther: { color: colors.textMuted },
  statusIcon: { marginLeft: 1 },
  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  retryText: { fontSize: 10, fontWeight: '700', color: colors.error },

  replyQuote: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: spacing.sm, marginBottom: spacing.xs, opacity: 0.9 },
  replyQuoteName: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  replyQuoteText: { ...typography.caption, color: colors.textSecondary },

  // Swipe-to-reply + reactions + long-press menu
  swipeWrap: { justifyContent: 'center' },
  replyHint: { position: 'absolute', left: 12, alignSelf: 'center', width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(244,162,97,0.16)' },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -6, marginLeft: spacing.xs, alignSelf: 'flex-start' },
  reactionsRowOwn: { alignSelf: 'flex-end', marginRight: spacing.xs, marginLeft: 0 },
  reactionChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.full, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  reactionChipMine: { backgroundColor: 'rgba(244,162,97,0.22)', borderColor: 'rgba(244,162,97,0.6)' },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  reactionCountMine: { color: colors.accent },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  menuCard: { width: '78%', maxWidth: 320, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden', ...shadows.lg },
  emojiBar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  emojiQuickBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  emojiQuickActive: { backgroundColor: 'rgba(244,162,97,0.22)' },
  emojiQuick: { fontSize: 24 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  menuItemText: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },

  imageMsg: { width: SCREEN_W * 0.6, height: SCREEN_W * 0.6, borderRadius: 5, backgroundColor: colors.surface },
  uploadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2, paddingRight: spacing.xs, minWidth: 180 },
  fileIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  fileName: { flex: 1, fontSize: 14, fontWeight: '600' },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 160, paddingVertical: 2 },
  audioBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.3)', overflow: 'hidden' },
  audioBarFill: { width: '100%', height: '100%', opacity: 0.8 },
  audioDuration: { fontSize: 12, fontWeight: '600', minWidth: 34, textAlign: 'right' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyText: { ...typography.body, color: colors.textMuted },

  lockedPreview: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl, gap: spacing.sm },
  lockedIconWrap: {
    width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  lockedTitle: { ...typography.h3, color: colors.textPrimary, textAlign: 'center' },
  lockedBody: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  lockedDesc: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm, fontStyle: 'italic' },

  emojiPanel: { height: 220, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm },
  emojiBtn: { width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 26 },

  replyBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  replyAccent: { width: 3, alignSelf: 'stretch', backgroundColor: colors.accent, borderRadius: 2 },
  replyBarName: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  replyBarText: { ...typography.caption, color: colors.textSecondary },

  typingBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  typingDots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  typingDot1: { opacity: 0.4 },
  typingDot2: { opacity: 0.7 },
  typingDot3: { opacity: 1 },
  typingText: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic', flex: 1 },

  inputBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.xs },
  iconBtn: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  recordingInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.error },
  recText: { ...typography.body, color: colors.textSecondary },
  input: { flex: 1, backgroundColor: colors.inputBg, borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 4, color: colors.textPrimary, fontSize: 15, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', ...shadows.sm },

  joinBar: { padding: spacing.md, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center', gap: spacing.sm },
  joinText: { ...typography.caption, color: colors.textSecondary },
  joinBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm + 2 },
  joinBtnText: { ...typography.button, color: colors.white },
  pendingPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.warning, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  pendingText: { ...typography.label, color: colors.warning, fontWeight: '700' },
  lockedPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  lockedText: { ...typography.label, color: colors.textSecondary, fontWeight: '600' },

  // Toggle (admins-only switch in the options sheet)
  toggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.16)', padding: 3, justifyContent: 'center' },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.white, alignSelf: 'flex-start' },
  toggleKnobOn: { alignSelf: 'flex-end' },

  viewerRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 48, right: 20 },

  // ── Luxury attachment sheet ───────────────────────────────────────────────
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheetCard: {
    backgroundColor: 'rgba(16,46,80,0.98)',
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl + spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.35)',
    ...shadows.lg,
  },
  sheetHandle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', marginBottom: spacing.md },
  sheetTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '700' },
  sheetSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  sheetOption: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(13,35,64,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    marginBottom: spacing.sm,
  },
  sheetIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  sheetIconPhoto: { backgroundColor: 'rgba(244,162,97,0.16)', borderColor: 'rgba(244,162,97,0.5)' },
  sheetIconFile: { backgroundColor: 'rgba(29,161,242,0.14)', borderColor: 'rgba(29,161,242,0.5)' },
  sheetIconDanger: { backgroundColor: 'rgba(229,57,53,0.14)', borderColor: 'rgba(229,57,53,0.5)' },
  sheetOptionDanger: { borderColor: 'rgba(229,57,53,0.3)' },
  sheetOptionText: { flex: 1 },
  sheetOptionLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  sheetOptionHint: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  sheetCancel: {
    marginTop: spacing.xs, paddingVertical: spacing.sm + 2, borderRadius: radius.lg, alignItems: 'center',
    backgroundColor: 'rgba(18,30,46,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  sheetCancelText: { ...typography.button, color: colors.textSecondary, fontWeight: '700' },

  // ── Luxury confirm dialog (leave group) ───────────────────────────────────
  confirmBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  confirmCard: {
    width: '100%', maxWidth: 360, backgroundColor: 'rgba(16,46,80,0.98)', borderRadius: radius.xl,
    padding: spacing.lg, alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(229,57,53,0.35)', ...shadows.lg,
  },
  confirmIcon: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(229,57,53,0.14)', borderWidth: 1, borderColor: 'rgba(229,57,53,0.5)', marginBottom: spacing.md,
  },
  confirmTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '800', textAlign: 'center' },
  confirmText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs, lineHeight: 18 },
  confirmActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' },
  confirmBtn: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.lg, alignItems: 'center' },
  confirmCancelBtn: { backgroundColor: 'rgba(18,30,46,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  confirmCancelText: { ...typography.button, color: colors.textSecondary, fontWeight: '700' },
  confirmLeaveBtn: { backgroundColor: colors.error },
  confirmLeaveText: { ...typography.button, color: colors.white, fontWeight: '800' },
});

export default GroupDetail;
