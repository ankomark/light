/**
 * Church community: a gated, chat-first space for a church.
 *
 * Membership tiers (admin / member / friend) all chat equally; only the admin
 * (creator) moderates — approve/reject join requests, remove members/friends,
 * delete the church. Non-members see a locked hero with "Request to join".
 * Messages carry text, images, documents and voice notes as base64 data URIs
 * (matching the rest of the app's chat).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Image, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, Modal, Pressable, Animated, PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../context/useAuth';
import RotatingBackground from '../components/RotatingBackground';
import {
  fetchChurchCommunity, fetchChurchMessages, sendChurchMessage, deleteChurchMessage,
  requestJoinChurch, fetchChurchMembers, fetchChurchJoinRequests, approveChurchRequest,
  rejectChurchRequest, removeChurchMember, leaveChurch, reactToChurchMessage,
} from '../services/api';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const MAX_ATTACH_BYTES = 8 * 1024 * 1024; // 8MB cap on a single attachment

const ROLE_BADGE = { admin: 'Admin', member: 'Member', friend: 'Friend' };
const REACTIONS = ['❤️', '👍', '🙏', '🎵', '😂', '🔥'];
const SWIPE_TRIGGER = 56; // px of right-swipe needed to fire a reply

const fmtDuration = (s) => {
  const sec = Math.max(0, Math.round(s || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

// A short, type-aware preview of a message (for reply chips / the compose bar).
const previewOf = (m) =>
  m?.content
  || (m?.message_type === 'image' ? 'Photo'
    : m?.message_type === 'audio' ? 'Voice note'
    : m?.message_type === 'file' ? (m?.file_name || 'Document') : '');

/**
 * One chat row with swipe-right-to-reply. Built on PanResponder so it needs no
 * GestureHandlerRootView; it only claims clearly-horizontal right-swipes, so the
 * inverted FlatList keeps its vertical scroll.
 */
const MessageRow = ({ item, currentUser, isAdmin, playingId, onReply, onLongPress, onOpenImage, onOpenFile, onPlayAudio, onToggleReaction, onRetry }) => {
  const tx = useRef(new Animated.Value(0)).current;
  const armed = useRef(false); // crossed the trigger threshold this gesture

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
    return <View style={styles.systemRow}><Text style={styles.systemText}>{item.content}</Text></View>;
  }

  const mine = item.sender?.id === currentUser?.id || item.sender?.username === currentUser?.username;
  const isImg = item.message_type === 'image' && !!item.attachment;
  const status = item._status; // 'sending' | 'failed' | undefined (= delivered)
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
          onLongPress={() => onLongPress(item)} delayLongPress={280}
          onPress={failed ? () => onRetry(item) : undefined}
          style={[styles.msgRow, mine && styles.msgRowMine]}
        >
          {!mine && (
            <Image source={item.sender?.profile_picture ? { uri: item.sender.profile_picture } : DEFAULT_AVATAR}
              defaultSource={DEFAULT_AVATAR} style={styles.msgAvatar} />
          )}
          <View style={styles.bubbleCol}>
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, isImg && styles.bubbleImage, sending && styles.bubbleSending]}>
              {!mine && <Text style={styles.msgSender}>{item.sender?.username || 'member'}</Text>}
              {item.reply_to && (
                <View style={styles.replyChip}>
                  <Text style={styles.replyName}>{item.reply_to.sender}</Text>
                  <Text style={styles.replyText} numberOfLines={1}>{previewOf(item.reply_to)}</Text>
                </View>
              )}
              {item.message_type === 'image' && !!item.attachment && (
                <TouchableOpacity activeOpacity={0.9} onPress={() => (sending ? null : onOpenImage(item.attachment))}>
                  <Image source={{ uri: item.attachment }} style={styles.msgImage} resizeMode="cover" />
                  {sending ? (
                    <View style={styles.uploadOverlay}><ActivityIndicator color="#fff" /></View>
                  ) : (
                    <View style={styles.imageExpand}><Ionicons name="expand" size={15} color="#fff" /></View>
                  )}
                </TouchableOpacity>
              )}
              {item.message_type === 'audio' && !!item.attachment && (
                <TouchableOpacity style={styles.audioRow} onPress={() => onPlayAudio(item)} disabled={sending}>
                  <Ionicons name={playingId === item.id ? 'pause-circle' : 'play-circle'} size={30} color={mine ? '#FFFFFF' : colors.accent} />
                  <View style={styles.audioBars}><Text style={[styles.audioMeta, mine && styles.audioMetaMine]}>Voice note · {fmtDuration(item.duration)}</Text></View>
                </TouchableOpacity>
              )}
              {item.message_type === 'file' && !!item.attachment && (
                <TouchableOpacity style={styles.fileRow} onPress={() => (sending ? null : onOpenFile(item))} disabled={sending} activeOpacity={0.8}>
                  <MaterialCommunityIcons name="file-document-outline" size={24} color={mine ? '#FFFFFF' : colors.accent} />
                  <Text style={[styles.fileName, mine && styles.textMine]} numberOfLines={1}>{item.file_name || 'Document'}</Text>
                  <Ionicons name="download-outline" size={18} color={mine ? 'rgba(255,255,255,0.85)' : colors.textMuted} />
                </TouchableOpacity>
              )}
              {!!item.content && <Text style={[styles.msgText, mine && styles.textMine]}>{item.content}</Text>}
              <View style={styles.metaRow}>
                <Text style={[styles.msgTime, mine && styles.timeMine]}>
                  {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                {mine && (
                  failed ? (
                    <View style={styles.statusWrap}>
                      <Ionicons name="alert-circle" size={13} color={colors.error} />
                      <Text style={styles.retryText}>Tap to retry</Text>
                    </View>
                  ) : sending ? (
                    <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.6)" style={styles.statusIcon} />
                  ) : (
                    <Ionicons name="checkmark-done" size={14} color="rgba(255,255,255,0.7)" style={styles.statusIcon} />
                  )
                )}
              </View>
            </View>

            {reactions.length > 0 && (
              <View style={[styles.reactionsRow, mine && styles.reactionsRowMine]}>
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

const ChurchCommunity = ({ navigation, route }) => {
  const church = route.params?.church || {};
  const churchId = route.params?.churchId || church.id;
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();

  const [community, setCommunity] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [showManage, setShowManage] = useState(false);
  const [requests, setRequests] = useState([]);
  const [members, setMembers] = useState([]);
  const [showAttach, setShowAttach] = useState(false);
  const [viewerUri, setViewerUri] = useState(null); // full-screen image viewer
  const [replyTo, setReplyTo] = useState(null);     // message being replied to
  const [menuMsg, setMenuMsg] = useState(null);     // message for the long-press action menu
  const [playingId, setPlayingId] = useState(null); // id of the voice note currently playing
  const [messagesLoading, setMessagesLoading] = useState(true); // first page of chat still loading

  const recordingRef = useRef(null);
  const soundRef = useRef(null);
  const loadedIdRef = useRef(null); // id of the voice note currently loaded into soundRef
  const pollRef = useRef(null);
  const seenIdsRef = useRef(new Set());
  const replyToRef = useRef(null);
  useEffect(() => { replyToRef.current = replyTo; }, [replyTo]);

  // Attachment tray slide/fade animation (mounted only while visible/exiting).
  const [trayMounted, setTrayMounted] = useState(false);
  const trayAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (showAttach) {
      setTrayMounted(true);
      Animated.timing(trayAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else if (trayMounted) {
      Animated.timing(trayAnim, { toValue: 0, duration: 160, useNativeDriver: true })
        .start(({ finished }) => { if (finished) setTrayMounted(false); });
    }
  }, [showAttach]); // eslint-disable-line react-hooks/exhaustive-deps

  const isMember = !!community?.is_member;
  const isAdmin = !!community?.is_admin;

  // ── load community snapshot + first page of messages ──────────────────────
  // Fire both at once and reveal the screen the moment the (small, fast)
  // snapshot lands — the heavier message page then streams into the chat area,
  // so opening the community no longer waits on the whole payload. The messages
  // request 403s for non-members, which we swallow.
  const loadCommunity = useCallback(async () => {
    const snapP = fetchChurchCommunity(churchId);
    const msgsP = fetchChurchMessages(churchId, 1).catch(() => null);
    try {
      const snap = await snapP;
      setCommunity(snap);
      setLoading(false); // show the shell (chat or locked hero) immediately
      if (snap.is_member) {
        const res = await msgsP;
        const list = res?.results ?? (Array.isArray(res) ? res : []);
        seenIdsRef.current = new Set(list.map((m) => m.id));
        setMessages(list); // newest-first from the API → matches inverted list
        setHasMore(!!res?.next);
        setPage(1);
      }
    } catch (e) {
      setLoading(false); // snapshot failed — still drop the spinner
    } finally {
      setMessagesLoading(false);
    }
  }, [churchId]);

  useEffect(() => { loadCommunity(); }, [loadCommunity]);

  // ── poll for new messages (no websockets) ─────────────────────────────────
  useEffect(() => {
    if (!isMember) return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetchChurchMessages(churchId, 1);
        const list = res?.results ?? [];
        const fresh = list.filter((m) => !seenIdsRef.current.has(m.id));
        if (fresh.length) {
          fresh.forEach((m) => seenIdsRef.current.add(m.id));
          setMessages((prev) => [...fresh, ...prev]);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [isMember, churchId]);

  useEffect(() => () => { soundRef.current?.unloadAsync?.().catch(() => {}); }, []);

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await fetchChurchMessages(churchId, next);
      const list = res?.results ?? [];
      list.forEach((m) => seenIdsRef.current.add(m.id));
      setMessages((prev) => [...prev, ...list]); // older append to the (inverted) tail
      setHasMore(!!res?.next);
      setPage(next);
    } catch {} finally { setLoadingMore(false); }
  }, [churchId, page, hasMore, loadingMore]);

  // ── sending (optimistic, WhatsApp-style) ──────────────────────────────────
  // Show the message instantly with a 'sending' status, then swap in the saved
  // server copy (→ delivered tick) or flag it 'failed' for a tap-to-retry.
  const deliver = useCallback(async (body, display) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tempMsg = {
      id: tempId,
      sender: { id: currentUser?.id, username: currentUser?.username, profile_picture: currentUser?.profile_picture },
      content: display.content || '',
      message_type: display.message_type,
      attachment: display.attachment || '',
      file_name: display.file_name || '',
      duration: display.duration,
      reply_to: display.reply_to || null,
      created_at: new Date().toISOString(),
      reactions: { summary: [], mine: null },
      _status: 'sending',
      _body: body,
      _display: display,
    };
    setMessages((prev) => [tempMsg, ...prev]);
    try {
      const msg = await sendChurchMessage(churchId, body);
      seenIdsRef.current.add(msg.id);
      setMessages((prev) => {
        // If the 5s poll already inserted the saved copy mid-flight, just drop
        // the temp instead of leaving two rows with the same id.
        if (prev.some((m) => m.id === msg.id && m.id !== tempId)) {
          return prev.filter((m) => m.id !== tempId);
        }
        return prev.map((m) => (m.id === tempId ? { ...msg, _status: 'sent' } : m));
      });
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _status: 'failed' } : m)));
    }
  }, [churchId, currentUser]);

  const send = useCallback((payload) => {
    // Resolve (and clear) any active reply, then build the body + the optimistic
    // display copy so the pending bubble looks identical to the delivered one.
    const reply = replyToRef.current;
    const body = reply ? { ...payload, reply_to: reply.id } : payload;
    const display = {
      message_type: payload.message_type,
      content: payload.content,
      attachment: payload.attachment,
      file_name: payload.file_name,
      duration: payload.duration,
      reply_to: reply
        ? { id: reply.id, sender: reply.sender?.username, message_type: reply.message_type, content: previewOf(reply) }
        : null,
    };
    if (reply) setReplyTo(null);
    deliver(body, display);
  }, [deliver]);

  const retrySend = useCallback((m) => {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    deliver(m._body, m._display);
  }, [deliver]);

  const sendText = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    send({ message_type: 'text', content: t });
  };

  const tooBig = (bytes) => {
    if (bytes && bytes > MAX_ATTACH_BYTES) {
      Alert.alert('Too large', 'Please pick a file under 8 MB.');
      return true;
    }
    return false;
  };

  const attachImage = async () => {
    setShowAttach(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Enable photo access to share images.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
    });
    if (res.canceled || !res.assets?.length) return;
    const out = await manipulateAsync(res.assets[0].uri, [{ resize: { width: 1280 } }],
      { compress: 0.6, format: SaveFormat.JPEG, base64: true });
    send({ message_type: 'image', attachment: `data:image/jpeg;base64,${out.base64}` });
  };

  const attachDocument = async (audioOnly = false) => {
    setShowAttach(false);
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true, type: audioOnly ? 'audio/*' : '*/*',
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    if (tooBig(a.size)) return;
    const base64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
    const mime = a.mimeType || 'application/octet-stream';
    const isAudioFile = mime.startsWith('audio/');
    send({
      message_type: isAudioFile ? 'audio' : 'file',
      attachment: `data:${mime};base64,${base64}`,
      file_name: a.name || 'file',
    });
  };

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Enable microphone access to record.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = rec;
      setRecording(true);
    } catch { Alert.alert('Church', 'Could not start recording.'); }
  };

  const stopRecording = async (cancel = false) => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    if (!rec) return;
    try {
      const st = await rec.stopAndUnloadAsync().then(() => rec.getStatusAsync()).catch(() => null);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      if (cancel || !uri) return;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      send({
        message_type: 'audio', attachment: `data:audio/m4a;base64,${base64}`,
        file_name: 'voice-note.m4a', duration: (st?.durationMillis || 0) / 1000,
      });
    } catch { Alert.alert('Church', 'Could not save the recording.'); }
  };


  const playAudio = async (msg) => {
    try {
      // Same clip already loaded → toggle pause / resume (don't reload & restart).
      if (soundRef.current && loadedIdRef.current === msg.id) {
        const st = await soundRef.current.getStatusAsync();
        if (st.isLoaded && st.isPlaying) {
          await soundRef.current.pauseAsync();
          setPlayingId(null);
        } else {
          await soundRef.current.playAsync();
          setPlayingId(msg.id);
        }
        return;
      }
      // A different clip → drop the old sound and load this one.
      if (soundRef.current) { await soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; loadedIdRef.current = null; }
      // Native player may not accept data: URIs — stage to a cache file first.
      const base64 = (msg.attachment || '').split(',')[1] || '';
      const path = `${FileSystem.cacheDirectory}church-audio-${msg.id}.m4a`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });
      soundRef.current = sound;
      loadedIdRef.current = msg.id;
      setPlayingId(msg.id);
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) {
          setPlayingId(null);
          sound.setPositionAsync(0).catch(() => {}); // rewind so the next tap plays from the start
        }
      });
    } catch { Alert.alert('Church', 'Could not play this audio.'); }
  };

  // Open/share a document (or any non-image file, incl. a picture sent "as
  // document"): decode the base64 data URI to a cache file and hand it to the
  // OS share/preview sheet — the file row had no tap handler before.
  const openFile = async (msg) => {
    const m = /^data:(.*?);base64,(.*)$/.exec(msg.attachment || '');
    if (!m) { Alert.alert('Church', 'This file is unavailable.'); return; }
    // A picture sent "as document" → just preview it in the in-app viewer.
    if ((m[1] || '').startsWith('image/')) { setViewerUri(msg.attachment); return; }
    try {
      const safeName = (msg.file_name || 'file').replace(/[^\w.\-]/g, '_');
      const path = `${FileSystem.cacheDirectory}${safeName}`;
      await FileSystem.writeAsStringAsync(path, m[2], { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: m[1] || undefined });
      else Alert.alert('Saved', `Saved as ${msg.file_name || 'file'}.`);
    } catch { Alert.alert('Church', 'Could not open this file.'); }
  };

  // Long-press opens an action menu (react / reply / delete).
  const openMenu = (m) => {
    if (m.message_type === 'system') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setMenuMsg(m);
  };

  const startReply = (m) => {
    setMenuMsg(null);
    setReplyTo(m);
    Haptics.selectionAsync().catch(() => {});
  };

  const canModerate = (m) =>
    m?.sender?.id === currentUser?.id || m?.sender?.username === currentUser?.username || isAdmin;

  const confirmDelete = (m) => {
    setMenuMsg(null);
    if (!canModerate(m)) return;
    Alert.alert('Message', 'Delete this message?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteChurchMessage(churchId, m.id); setMessages((p) => p.filter((x) => x.id !== m.id)); } catch {}
      } },
    ]);
  };

  // Toggle an emoji reaction; the API returns the message's fresh reaction state.
  const react = async (m, emoji) => {
    setMenuMsg(null);
    Haptics.selectionAsync().catch(() => {});
    try {
      const updated = await reactToChurchMessage(churchId, m.id, emoji);
      setMessages((prev) => prev.map((x) => (x.id === updated.id ? { ...x, reactions: updated.reactions } : x)));
    } catch {}
  };

  // ── membership actions ──────────────────────────────────────────────────--
  const onRequestJoin = async () => {
    try {
      await requestJoinChurch(churchId);
      setCommunity((c) => ({ ...c, has_pending_request: true }));
    } catch (e) {
      Alert.alert('Church', e?.response?.data?.error || 'Could not send your request.');
    }
  };

  const openManage = async () => {
    setShowManage(true);
    try {
      const [reqs, mem] = await Promise.all([
        isAdmin ? fetchChurchJoinRequests(churchId) : Promise.resolve([]),
        fetchChurchMembers(churchId),
      ]);
      setRequests(reqs || []);
      setMembers(mem || []);
    } catch {}
  };

  const approve = async (r) => {
    try { await approveChurchRequest(churchId, r.id); setRequests((p) => p.filter((x) => x.id !== r.id)); fetchChurchMembers(churchId).then(setMembers).catch(() => {}); } catch {}
  };
  const reject = async (r) => {
    try { await rejectChurchRequest(churchId, r.id); setRequests((p) => p.filter((x) => x.id !== r.id)); } catch {}
  };
  const remove = (m) => {
    Alert.alert('Remove', `Remove @${m.user?.username} from the community?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await removeChurchMember(churchId, m.user.id); setMembers((p) => p.filter((x) => x.id !== m.id)); } catch {}
      } },
    ]);
  };
  const onLeave = () => {
    Alert.alert('Leave community', `Leave ${church.name || 'this church'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        try { await leaveChurch(churchId); navigation.goBack(); } catch (e) { Alert.alert('Church', e?.response?.data?.error || 'Could not leave.'); }
      } },
    ]);
  };

  // ── render ────────────────────────────────────────────────────────────────
  const renderMessage = ({ item }) => (
    <MessageRow
      item={item}
      currentUser={currentUser}
      isAdmin={isAdmin}
      playingId={playingId}
      onReply={startReply}
      onLongPress={openMenu}
      onOpenImage={setViewerUri}
      onOpenFile={openFile}
      onPlayAudio={playAudio}
      onToggleReaction={react}
      onRetry={retrySend}
    />
  );

  return (
    <View style={styles.root}>
      <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.68)" />
      <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <LinearGradient colors={['rgba(16,46,80,0.95)', 'rgba(10,22,40,0.80)']} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Image source={church.image ? { uri: church.image } : DEFAULT_AVATAR}
          defaultSource={DEFAULT_AVATAR} style={styles.headerAvatar} />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName} numberOfLines={1}>{church.name || 'Church'}</Text>
          <Text style={styles.headerSub}>
            <Ionicons name="people" size={12} color={colors.textSecondary} /> {community?.members_count ?? 0} in community
            {community?.role ? `  ·  ${ROLE_BADGE[community.role]}` : ''}
          </Text>
        </View>
        {isMember && (
          <TouchableOpacity onPress={openManage} hitSlop={10} style={styles.headerBtn}>
            <Ionicons name={isAdmin ? 'shield-checkmark' : 'people-circle-outline'} size={24} color={colors.accent} />
            {isAdmin && community?.has_requests ? <View style={styles.dot} /> : null}
          </TouchableOpacity>
        )}
      </LinearGradient>

      {loading ? (
        <View style={styles.bodyLoading}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : !isMember ? (
        // Locked hero for outsiders
        <View style={styles.locked}>
          <View style={styles.lockBadge}><MaterialCommunityIcons name="account-music" size={40} color={colors.accent} /></View>
          <Text style={styles.lockTitle}>{church.name || 'This church'} community</Text>
          <Text style={styles.lockText}>
            Become a friend of this church to join the conversation — chat, share photos, documents and voice notes with members.
          </Text>
          {community?.has_pending_request ? (
            <View style={styles.pendingPill}><Ionicons name="time-outline" size={16} color={colors.warning} /><Text style={styles.pendingText}>Request pending</Text></View>
          ) : (
            <TouchableOpacity style={styles.joinBtn} onPress={onRequestJoin} activeOpacity={0.9}>
              <Ionicons name="hand-left-outline" size={18} color="#0A1628" />
              <Text style={styles.joinBtnText}>Request to join</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 8}>
          <FlatList
            data={messages}
            keyExtractor={(m) => String(m.id)}
            renderItem={renderMessage}
            inverted
            contentContainerStyle={styles.chatContent}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.4}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={9}
            removeClippedSubviews
            ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} /> : null}
            ListEmptyComponent={
              messagesLoading
                ? <View style={styles.emptyChat}><ActivityIndicator color={colors.accent} /></View>
                : <View style={styles.emptyChat}><Text style={styles.emptyChatText}>Say hello 👋</Text></View>
            }
          />

          {/* Icon-only attachment tray (animated in/out) */}
          {!recording && trayMounted && (
            <Animated.View
              style={[styles.attachTray, {
                opacity: trayAnim,
                transform: [{ translateY: trayAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                  { scale: trayAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
              }]}
            >
              <TouchableOpacity style={styles.attachIcon} onPress={attachImage}>
                <Ionicons name="image" size={24} color={colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachIcon} onPress={() => attachDocument(false)}>
                <Ionicons name="document-text" size={24} color={colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachIcon} onPress={() => attachDocument(true)}>
                <Ionicons name="musical-notes" size={24} color={colors.accent} />
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Reply compose bar */}
          {replyTo && !recording && (
            <View style={styles.replyBar}>
              <View style={styles.replyBarAccent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.replyBarName} numberOfLines={1}>
                  Replying to {replyTo.sender?.username || 'member'}
                </Text>
                <Text style={styles.replyBarText} numberOfLines={1}>{previewOf(replyTo)}</Text>
              </View>
              <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}

          {recording ? (
            <View style={styles.recordBar}>
              <View style={styles.recDot} />
              <Text style={styles.recText}>Recording… release to send</Text>
              <TouchableOpacity onPress={() => stopRecording(true)} style={styles.recCancel}><Text style={styles.recCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => stopRecording(false)} style={styles.recSend}><Ionicons name="send" size={18} color="#0A1628" /></TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.inputBar, { paddingBottom: insets.bottom || spacing.sm }]}>
              <TouchableOpacity onPress={() => setShowAttach((s) => !s)} hitSlop={8} style={styles.iconBtn}>
                <Ionicons name={showAttach ? 'close-circle' : 'add-circle'} size={28} color={colors.accent} />
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Message…"
                placeholderTextColor={colors.placeholder}
                multiline
              />
              {draft.trim() ? (
                <TouchableOpacity onPress={sendText} style={styles.sendBtn}>
                  <Ionicons name="send" size={18} color="#0A1628" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onLongPress={startRecording} onPress={() => Alert.alert('Voice note', 'Press and hold the mic to record.')} style={styles.micBtn}>
                  <Ionicons name="mic" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </KeyboardAvoidingView>
      )}

      {/* Manage modal */}
      <Modal visible={showManage} animationType="slide" onRequestClose={() => setShowManage(false)} statusBarTranslucent>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.modalBar}>
            <TouchableOpacity onPress={() => setShowManage(false)} hitSlop={10}><Ionicons name="close" size={24} color={colors.textPrimary} /></TouchableOpacity>
            <Text style={styles.modalTitle}>{church.name}</Text>
            <View style={{ width: 24 }} />
          </View>
          <FlatList
            data={members}
            keyExtractor={(m) => String(m.id)}
            ListHeaderComponent={
              isAdmin && requests.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Requests to join</Text>
                  {requests.map((r) => (
                    <View key={r.id} style={styles.memberRow}>
                      <Image source={r.user?.profile_picture ? { uri: r.user.profile_picture } : DEFAULT_AVATAR} defaultSource={DEFAULT_AVATAR} style={styles.memberAvatar} />
                      <Text style={styles.memberName} numberOfLines={1}>@{r.user?.username}</Text>
                      <TouchableOpacity style={[styles.smallBtn, styles.approveBtn]} onPress={() => approve(r)}><Text style={styles.approveText}>Approve</Text></TouchableOpacity>
                      <TouchableOpacity style={[styles.smallBtn, styles.rejectBtn]} onPress={() => reject(r)}><Text style={styles.rejectText}>Decline</Text></TouchableOpacity>
                    </View>
                  ))}
                  <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Members</Text>
                </View>
              ) : <Text style={[styles.sectionLabel, { paddingHorizontal: spacing.md, paddingTop: spacing.md }]}>Members</Text>
            }
            renderItem={({ item: m }) => (
              <View style={styles.memberRow}>
                <Image source={m.user?.profile_picture ? { uri: m.user.profile_picture } : DEFAULT_AVATAR} defaultSource={DEFAULT_AVATAR} style={styles.memberAvatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName} numberOfLines={1}>@{m.user?.username}</Text>
                  <Text style={styles.memberRole}>{ROLE_BADGE[m.role] || m.role}</Text>
                </View>
                {isAdmin && m.role !== 'admin' && (
                  <TouchableOpacity style={[styles.smallBtn, styles.rejectBtn]} onPress={() => remove(m)}><Text style={styles.rejectText}>Remove</Text></TouchableOpacity>
                )}
              </View>
            )}
            ListFooterComponent={
              !isAdmin ? (
                <TouchableOpacity style={styles.leaveBtn} onPress={onLeave}><Text style={styles.leaveText}>Leave community</Text></TouchableOpacity>
              ) : null
            }
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          />
        </SafeAreaView>
      </Modal>
      </SafeAreaView>

      {/* Long-press action menu: react · reply · delete */}
      <Modal visible={!!menuMsg} transparent animationType="fade" onRequestClose={() => setMenuMsg(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuMsg(null)}>
          <Pressable style={styles.menuCard}>
            <View style={styles.emojiBar}>
              {REACTIONS.map((e) => {
                const active = menuMsg?.reactions?.mine === e;
                return (
                  <TouchableOpacity key={e} onPress={() => react(menuMsg, e)}
                    style={[styles.emojiBtn, active && styles.emojiBtnActive]} activeOpacity={0.7}>
                    <Text style={styles.emojiBig}>{e}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.menuItem} onPress={() => startReply(menuMsg)}>
              <Ionicons name="arrow-undo" size={20} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>Reply</Text>
            </TouchableOpacity>
            {canModerate(menuMsg) && (
              <TouchableOpacity style={styles.menuItem} onPress={() => confirmDelete(menuMsg)}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
                <Text style={[styles.menuItemText, { color: colors.error }]}>Delete</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Full-screen image viewer */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <View style={styles.viewer}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerUri(null)} hitSlop={12}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {!!viewerUri && <Image source={{ uri: viewerUri }} style={styles.viewerImg} resizeMode="contain" />}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628' },
  container: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },

  // Icon attachment tray + full-screen image viewer
  attachTray: {
    flexDirection: 'row', gap: spacing.md, justifyContent: 'center',
    paddingVertical: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.xs,
    backgroundColor: 'rgba(16,46,80,0.92)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.4)', ...shadows.md,
  },
  attachIcon: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(244,162,97,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.3)',
  },
  imageExpand: {
    position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '85%' },
  viewerClose: { position: 'absolute', top: 48, right: 20, zIndex: 2, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface },
  headerName: { ...typography.h3, color: colors.textPrimary },
  headerSub: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 8, right: 8, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.error },

  // Locked
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  lockBadge: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(244,162,97,0.12)', borderWidth: 1, borderColor: 'rgba(244,162,97,0.4)' },
  lockTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  lockText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  joinBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.accent, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm + 4, borderRadius: radius.full, marginTop: spacing.sm, ...shadows.md },
  joinBtnText: { ...typography.button, color: '#0A1628', fontWeight: '800' },
  pendingPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: 'rgba(251,140,0,0.12)', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, marginTop: spacing.sm },
  pendingText: { ...typography.label, color: colors.warning, fontWeight: '700' },

  // Chat
  chatContent: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md, gap: spacing.xs },
  emptyChat: { alignItems: 'center', paddingVertical: spacing.xxl, transform: [{ scaleY: -1 }] },
  emptyChatText: { ...typography.body, color: colors.textMuted },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, maxWidth: '85%', alignSelf: 'flex-start' },
  msgRowMine: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface },
  bubble: { borderRadius: radius.lg, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm, maxWidth: '100%' },
  bubbleOther: { backgroundColor: 'rgba(18,30,46,0.92)', borderTopLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  bubbleMine: { backgroundColor: '#15407A', borderTopRightRadius: 4 }, // royal sapphire
  bubbleImage: { padding: 2, borderRadius: 7 }, // slim 2px frame, tidy corners
  bubbleSending: { opacity: 0.85 },             // dim while the message is in flight
  bodyLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  msgSender: { ...typography.caption, color: colors.accent, fontWeight: '800', marginBottom: 2 },
  msgText: { ...typography.body, color: colors.textPrimary },
  textMine: { color: '#FFFFFF' },
  metaRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 3, marginTop: 3 },
  msgTime: { ...typography.caption, color: colors.textMuted, fontSize: 10 },
  timeMine: { color: 'rgba(255,255,255,0.65)' },
  statusIcon: { marginLeft: 1 },
  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  retryText: { ...typography.caption, color: colors.error, fontSize: 10, fontWeight: '700' },
  uploadOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 4, borderRadius: 5,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)',
  },
  msgImage: { width: 220, height: 220, borderRadius: 5, marginBottom: 4, backgroundColor: colors.surface },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4, minWidth: 180 },
  audioBars: { flex: 1 },
  audioMeta: { ...typography.caption, color: colors.textSecondary },
  audioMetaMine: { color: 'rgba(255,255,255,0.75)' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4, minWidth: 160 },
  fileName: { ...typography.label, color: colors.textPrimary, flex: 1 },
  replyChip: { borderLeftWidth: 3, borderLeftColor: 'rgba(0,0,0,0.25)', paddingLeft: spacing.sm, marginBottom: 4, opacity: 0.9 },
  replyName: { ...typography.caption, fontWeight: '800', color: colors.primary },
  replyText: { ...typography.caption, color: colors.textSecondary },

  // Swipe-to-reply + reactions
  swipeWrap: { justifyContent: 'center' },
  bubbleCol: { flexShrink: 1 },
  replyHint: {
    position: 'absolute', left: 12, alignSelf: 'center',
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(244,162,97,0.16)',
  },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -6, marginLeft: spacing.xs, alignSelf: 'flex-start' },
  reactionsRowMine: { alignSelf: 'flex-end', marginRight: spacing.xs, marginLeft: 0 },
  reactionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: radius.full, backgroundColor: 'rgba(18,30,46,0.95)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  reactionChipMine: { backgroundColor: 'rgba(244,162,97,0.22)', borderColor: 'rgba(244,162,97,0.6)' },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', fontSize: 11 },
  reactionCountMine: { color: colors.accent },

  systemRow: { alignItems: 'center', paddingVertical: spacing.xs, transform: [{ scaleY: -1 }] },
  systemText: { ...typography.caption, color: colors.textMuted, backgroundColor: colors.card, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.full, overflow: 'hidden' },

  // Reply compose bar
  replyBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.sm, marginBottom: spacing.xs,
    paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.sm, borderRadius: radius.md,
    backgroundColor: 'rgba(16,46,80,0.92)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.4)',
  },
  replyBarAccent: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.accent },
  replyBarName: { ...typography.caption, color: colors.accent, fontWeight: '800' },
  replyBarText: { ...typography.caption, color: colors.textSecondary },

  // Long-press action menu
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  menuCard: { width: '78%', maxWidth: 320, backgroundColor: '#12233B', borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', overflow: 'hidden', ...shadows.lg },
  emojiBar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.10)' },
  emojiBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  emojiBtnActive: { backgroundColor: 'rgba(244,162,97,0.22)' },
  emojiBig: { fontSize: 24 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  menuItemText: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },

  // Input
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(16,46,80,0.95)' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, maxHeight: 120, color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  micBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  recordBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.error },
  recText: { ...typography.label, color: colors.textPrimary, flex: 1 },
  recCancel: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  recCancelText: { ...typography.label, color: colors.textSecondary },
  recSend: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },

  // Manage modal
  modalBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  modalTitle: { ...typography.h3, color: colors.textPrimary },
  section: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  sectionLabel: { ...typography.label, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.sm },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  memberAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface },
  memberName: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
  memberRole: { ...typography.caption, color: colors.textMuted },
  smallBtn: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.md },
  approveBtn: { backgroundColor: colors.accent },
  approveText: { ...typography.caption, color: '#0A1628', fontWeight: '800' },
  rejectBtn: { backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rejectText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  leaveBtn: { margin: spacing.lg, paddingVertical: spacing.sm + 2, borderRadius: radius.md, alignItems: 'center', backgroundColor: 'rgba(229,57,53,0.12)', borderWidth: 1, borderColor: 'rgba(229,57,53,0.4)' },
  leaveText: { ...typography.button, color: colors.error, fontWeight: '700' },
});

export default ChurchCommunity;
