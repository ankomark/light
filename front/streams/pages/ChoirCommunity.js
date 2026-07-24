/**
 * Choir community: a gated, chat-first space for a choir.
 *
 * Membership tiers (admin / member / friend) all chat equally; only the admin
 * (creator) moderates — approve/reject join requests, remove members/friends,
 * delete the choir. Non-members see a locked hero with "Request to join".
 * Messages carry text; images, documents and voice notes upload to R2 and the
 * message stores the URL (older base64 messages still render).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform, Modal, Pressable, Animated, PanResponder, Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../services/imageProcessing';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  createSound, setAudioModeAsync, requestRecordingPermissionsAsync,
  createRecording, VOICE_NOTE_RECORDING_OPTIONS,
} from '../services/audioPlayer';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../context/useAuth';
import RotatingBackground from '../components/RotatingBackground';
import { uploadMedia } from '../services/cloudinary';
import {
  fetchChoirCommunity, fetchChoirMessages, sendChoirMessage, deleteChoirMessage,
  requestJoinChoir, fetchChoirMembers, fetchChoirJoinRequests, approveChoirRequest,
  rejectChoirRequest, removeChoirMember, leaveChoir, reactToChoirMessage,
  searchChoirUsers, addChoirMember, setChoirMemberRole, setChoirPostingPolicy,
} from '../services/api';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const MAX_ATTACH_BYTES = 8 * 1024 * 1024; // 8MB cap on a single attachment

const isData = (uri) => typeof uri === 'string' && uri.startsWith('data:');

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
  const { t } = useI18n();
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
              placeholder={DEFAULT_AVATAR} contentFit="cover" transition={120} style={styles.msgAvatar} />
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
                  <Image source={{ uri: item.attachment }} style={styles.msgImage} contentFit="cover" transition={150} />
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
                      <Text style={styles.retryText}>{t('community.tapToRetry')}</Text>
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

const ChoirCommunity = ({ navigation, route }) => {
  const { t } = useI18n();
  const choir = route.params?.choir || {};
  const choirId = route.params?.choirId || choir.id;
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
  const [showAdd, setShowAdd] = useState(false);     // add-members search modal
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [addBusyId, setAddBusyId] = useState(null);  // user id currently being added
  const [policyBusy, setPolicyBusy] = useState(false);
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
  const onlyAdmins = !!community?.only_admins_can_post;
  const creatorId = community?.created_by_id;
  const canPost = isAdmin || !onlyAdmins; // members can't post when the chat is admin-locked

  // ── load community snapshot + first page of messages ──────────────────────
  // Fire both at once and reveal the screen the moment the (small, fast)
  // snapshot lands — the heavier message page then streams into the chat area,
  // so opening the community no longer waits on the whole payload. The messages
  // request 403s for non-members, which we swallow.
  const loadCommunity = useCallback(async () => {
    const snapP = fetchChoirCommunity(choirId);
    const msgsP = fetchChoirMessages(choirId, 1).catch(() => null);
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
  }, [choirId]);

  useEffect(() => { loadCommunity(); }, [loadCommunity]);

  // ── poll for new messages (no websockets) ─────────────────────────────────
  useEffect(() => {
    if (!isMember) return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetchChoirMessages(choirId, 1);
        const list = res?.results ?? [];
        const fresh = list.filter((m) => !seenIdsRef.current.has(m.id));
        if (fresh.length) {
          fresh.forEach((m) => seenIdsRef.current.add(m.id));
          setMessages((prev) => [...fresh, ...prev]);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [isMember, choirId]);

  useEffect(() => () => { soundRef.current?.unloadAsync?.().catch(() => {}); }, []);

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await fetchChoirMessages(choirId, next);
      const list = res?.results ?? [];
      list.forEach((m) => seenIdsRef.current.add(m.id));
      setMessages((prev) => [...prev, ...list]); // older append to the (inverted) tail
      setHasMore(!!res?.next);
      setPage(next);
    } catch {} finally { setLoadingMore(false); }
  }, [choirId, page, hasMore, loadingMore]);

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
      const msg = await sendChoirMessage(choirId, body);
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
  }, [choirId, currentUser]);

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

  // Media send: show the local file instantly, upload to R2 in the background,
  // then persist the message with just the URL (mirrors DMs).
  const sendMedia = useCallback(async (media) => {
    const { localUri, uploadType, message_type, file_name = '', duration = null, mimeType } = media;
    const reply = replyToRef.current;
    if (reply) setReplyTo(null);
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const replyDisplay = reply
      ? { id: reply.id, sender: reply.sender?.username, message_type: reply.message_type, content: previewOf(reply) }
      : null;
    const tempMsg = {
      id: tempId,
      sender: { id: currentUser?.id, username: currentUser?.username, profile_picture: currentUser?.profile_picture },
      content: '', message_type, attachment: localUri, file_name, duration,
      reply_to: replyDisplay, created_at: new Date().toISOString(),
      reactions: { summary: [], mine: null },
      _status: 'sending', _retryMedia: media,
    };
    setMessages((prev) => [tempMsg, ...prev]);
    try {
      const uploaded = await uploadMedia({ uri: localUri, name: file_name || `chat_${Date.now()}`, mimeType }, uploadType);
      const body = {
        message_type, attachment: uploaded.url, file_name, duration,
        ...(reply ? { reply_to: reply.id } : {}),
      };
      const msg = await sendChoirMessage(choirId, body);
      seenIdsRef.current.add(msg.id);
      setMessages((prev) => (prev.some((m) => m.id === msg.id && m.id !== tempId)
        ? prev.filter((m) => m.id !== tempId)
        : prev.map((m) => (m.id === tempId ? { ...msg, _status: 'sent' } : m))));
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _status: 'failed' } : m)));
    }
  }, [choirId, currentUser]);

  const retrySend = useCallback((m) => {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    if (m._retryMedia) sendMedia(m._retryMedia);
    else deliver(m._body, m._display);
  }, [deliver, sendMedia]);

  const sendText = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    send({ message_type: 'text', content: t });
  };

  const tooBig = (bytes) => {
    if (bytes && bytes > MAX_ATTACH_BYTES) {
      Alert.alert(t('community.tooLargeTitle'), t('community.tooLargeBody'));
      return true;
    }
    return false;
  };

  const attachImage = async () => {
    setShowAttach(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert(t('community.permissionNeeded'), t('community.permissionPhotos')); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8,
    });
    if (res.canceled || !res.assets?.length) return;
    const out = await compressImage(res.assets[0].uri, { width: 1280, quality: 0.6 });
    sendMedia({ localUri: out.uri, uploadType: 'chat-image', message_type: 'image', mimeType: 'image/jpeg' });
  };

  const attachDocument = async (audioOnly = false) => {
    setShowAttach(false);
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true, type: audioOnly ? 'audio/*' : '*/*',
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    if (tooBig(a.size)) return;
    const mime = a.mimeType || 'application/octet-stream';
    const isAudioFile = mime.startsWith('audio/');
    sendMedia({
      localUri: a.uri,
      uploadType: isAudioFile ? 'chat-audio' : 'chat-file',
      message_type: isAudioFile ? 'audio' : 'file',
      file_name: a.name || 'file',
      mimeType: mime,
    });
  };

  const startRecording = async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert(t('community.permissionNeeded'), t('community.permissionMic')); return; }
      await setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await createRecording(VOICE_NOTE_RECORDING_OPTIONS);
      recordingRef.current = rec;
      setRecording(true);
    } catch { Alert.alert(t('community.choir'), t('community.startRecordingFailed')); }
  };

  const stopRecording = async (cancel = false) => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    if (!rec) return;
    try {
      const st = await rec.stopAndUnloadAsync().then(() => rec.getStatusAsync()).catch(() => null);
      await setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      if (cancel || !uri) return;
      sendMedia({
        localUri: uri, uploadType: 'chat-audio', message_type: 'audio',
        file_name: 'voice-note.m4a', duration: (st?.durationMillis || 0) / 1000,
        mimeType: 'audio/m4a',
      });
    } catch { Alert.alert(t('community.choir'), t('community.saveRecordingFailed')); }
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
      // Legacy base64 → stage to a cache file first; Cloudinary/local URIs play
      // directly (expo-av streams https).
      let sourceUri = msg.attachment;
      if (isData(msg.attachment)) {
        const base64 = (msg.attachment || '').split(',')[1] || '';
        const path = `${FileSystem.cacheDirectory}choir-audio-${msg.id}.m4a`;
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists) await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
        sourceUri = path;
      }
      if (!sourceUri) return;
      await setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound } = await createSound({ uri: sourceUri }, { shouldPlay: true });
      soundRef.current = sound;
      loadedIdRef.current = msg.id;
      setPlayingId(msg.id);
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) {
          setPlayingId(null);
          sound.setPositionAsync(0).catch(() => {}); // rewind so the next tap plays from the start
        }
      });
    } catch { Alert.alert(t('community.choir'), t('community.playAudioFailed')); }
  };

  // Open/share a document (or any non-image file, incl. a picture sent "as
  // document"): decode the base64 data URI to a cache file and hand it to the
  // OS share/preview sheet — the file row had no tap handler before.
  const openFile = async (msg) => {
    const att = msg.attachment || '';
    const safeName = (msg.file_name || 'file').replace(/[^\w.\-]/g, '_');
    try {
      if (isData(att)) {
        const m = /^data:(.*?);base64,(.*)$/.exec(att);
        if (!m) { Alert.alert(t('community.choir'), t('community.fileUnavailable')); return; }
        if ((m[1] || '').startsWith('image/')) { setViewerUri(att); return; }
        const path = `${FileSystem.cacheDirectory}${safeName}`;
        await FileSystem.writeAsStringAsync(path, m[2], { encoding: FileSystem.EncodingType.Base64 });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: m[1] || undefined });
        else Alert.alert(t('chat.savedTitle'), t('common.savedAs', { name: msg.file_name || 'file' }));
        return;
      }
      if (att.startsWith('http')) {
        if (msg.message_type === 'image') { setViewerUri(att); return; }
        const path = `${FileSystem.cacheDirectory}${safeName}`;
        const dl = await FileSystem.downloadAsync(att, path);
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dl.uri);
        else Alert.alert(t('chat.savedTitle'), t('common.savedAs', { name: msg.file_name || 'file' }));
      }
    } catch { Alert.alert(t('community.choir'), t('community.openFileFailed')); }
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
    Alert.alert(t('group.detail.deleteMessageTitle'), t('group.detail.deleteMessageBody'), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteChoirMessage(choirId, m.id); setMessages((p) => p.filter((x) => x.id !== m.id)); } catch {}
      } },
    ]);
  };

  // Toggle an emoji reaction; the API returns the message's fresh reaction state.
  const react = async (m, emoji) => {
    setMenuMsg(null);
    Haptics.selectionAsync().catch(() => {});
    try {
      const updated = await reactToChoirMessage(choirId, m.id, emoji);
      setMessages((prev) => prev.map((x) => (x.id === updated.id ? { ...x, reactions: updated.reactions } : x)));
    } catch {}
  };

  // ── membership actions ──────────────────────────────────────────────────--
  const onRequestJoin = async () => {
    try {
      await requestJoinChoir(choirId);
      setCommunity((c) => ({ ...c, has_pending_request: true }));
    } catch (e) {
      Alert.alert(t('community.choir'), e?.response?.data?.error || t('community.requestFailed'));
    }
  };

  const openManage = async () => {
    setShowManage(true);
    try {
      const [reqs, mem] = await Promise.all([
        isAdmin ? fetchChoirJoinRequests(choirId) : Promise.resolve([]),
        fetchChoirMembers(choirId),
      ]);
      setRequests(reqs || []);
      setMembers(mem || []);
    } catch {}
  };

  const approve = async (r) => {
    try { await approveChoirRequest(choirId, r.id); setRequests((p) => p.filter((x) => x.id !== r.id)); fetchChoirMembers(choirId).then(setMembers).catch(() => {}); } catch {}
  };
  const reject = (r) => {
    Alert.alert(t('community.rejectTitle'), t('community.rejectConfirm', { name: r.user?.username }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.reject'), style: 'destructive', onPress: async () => {
        try { await rejectChoirRequest(choirId, r.id); setRequests((p) => p.filter((x) => x.id !== r.id)); } catch {}
      } },
    ]);
  };
  const remove = (m) => {
    Alert.alert(t('community.removeTitle'), t('community.removeConfirm', { name: m.user?.username }), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await removeChoirMember(choirId, m.user.id); setMembers((p) => p.filter((x) => x.id !== m.id)); } catch {}
      } },
    ]);
  };

  // Promote a member to admin, or dismiss an admin back to a member (optimistic).
  const toggleAdmin = (m) => {
    const nextRole = m.role === 'admin' ? 'member' : 'admin';
    setMembers((p) => p.map((x) => (x.id === m.id ? { ...x, role: nextRole } : x)));
    setChoirMemberRole(choirId, m.user.id, nextRole).catch(() => {
      setMembers((p) => p.map((x) => (x.id === m.id ? { ...x, role: m.role } : x)));
      Alert.alert(t('community.choir'), t('community.roleFailed'));
    });
  };

  // WhatsApp-style "Only admins can send messages" lock (admin only).
  const togglePosting = async (value) => {
    setPolicyBusy(true);
    setCommunity((c) => ({ ...c, only_admins_can_post: value }));
    try {
      await setChoirPostingPolicy(choirId, value);
    } catch {
      setCommunity((c) => ({ ...c, only_admins_can_post: !value }));
      Alert.alert(t('community.choir'), t('community.settingFailed'));
    } finally { setPolicyBusy(false); }
  };

  // ── add members (admin search) ───────────────────────────────────────────--
  const openAdd = () => { setAddQuery(''); setAddResults([]); setShowAdd(true); };
  const runSearch = useCallback(async (text) => {
    setAddQuery(text);
    if (text.trim().length < 2) { setAddResults([]); return; }
    try {
      const res = await searchChoirUsers(choirId, text.trim());
      setAddResults(Array.isArray(res) ? res : []);
    } catch { setAddResults([]); }
  }, [choirId]);
  const addMember = async (u) => {
    setAddBusyId(u.id);
    try {
      await addChoirMember(choirId, u.id);
      setAddResults((p) => p.filter((x) => x.id !== u.id));
      fetchChoirMembers(choirId).then(setMembers).catch(() => {});
      setCommunity((c) => ({ ...c, members_count: (c?.members_count || 0) + 1 }));
    } catch (e) {
      Alert.alert(t('community.choir'), e?.response?.data?.error || t('community.addPersonFailed'));
    } finally { setAddBusyId(null); }
  };
  const onLeave = () => {
    Alert.alert(t('community.leaveTitle'), t('community.leaveConfirm', { name: choir.name || t('community.thisChoir') }), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        try { await leaveChoir(choirId); navigation.goBack(); } catch (e) { Alert.alert(t('community.choir'), e?.response?.data?.error || t('community.leaveFailed')); }
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
        <Image source={choir.profile_image ? { uri: choir.profile_image } : DEFAULT_AVATAR}
          placeholder={DEFAULT_AVATAR} contentFit="cover" transition={120} style={styles.headerAvatar} />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName} numberOfLines={1}>{choir.name || 'Choir'}</Text>
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
          <Text style={styles.lockTitle}>{choir.name || 'This choir'} community</Text>
          <Text style={styles.lockText}>
            Become a friend of this choir to join the conversation — chat, share photos, documents and voice notes with members.
          </Text>
          {community?.has_pending_request ? (
            <View style={styles.pendingPill}><Ionicons name="time-outline" size={16} color={colors.warning} /><Text style={styles.pendingText}>{t('community.requestPending')}</Text></View>
          ) : (
            <TouchableOpacity style={styles.joinBtn} onPress={onRequestJoin} activeOpacity={0.9}>
              <Ionicons name="hand-left-outline" size={18} color="#0A1628" />
              <Text style={styles.joinBtnText}>{t('community.requestToJoin')}</Text>
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

          {!canPost ? (
            <View style={[styles.lockedBar, { paddingBottom: insets.bottom || spacing.sm }]}>
              <Ionicons name="lock-closed" size={15} color={colors.textMuted} />
              <Text style={styles.lockedBarText}>{t('community.onlyAdminsSend')}</Text>
            </View>
          ) : recording ? (
            <View style={styles.recordBar}>
              <View style={styles.recDot} />
              <Text style={styles.recText}>{t('community.recording')}</Text>
              <TouchableOpacity onPress={() => stopRecording(true)} style={styles.recCancel}><Text style={styles.recCancelText}>{t('common.cancel')}</Text></TouchableOpacity>
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
                placeholder={t('chat.messagePlaceholder')}
                placeholderTextColor={colors.placeholder}
                multiline
              />
              {draft.trim() ? (
                <TouchableOpacity onPress={sendText} style={styles.sendBtn}>
                  <Ionicons name="send" size={18} color="#0A1628" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onLongPress={startRecording} onPress={() => Alert.alert(t('community.voiceNoteTitle'), t('community.voiceNoteHint'))} style={styles.micBtn}>
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
            <Text style={styles.modalTitle}>{choir.name}</Text>
            <View style={{ width: 24 }} />
          </View>
          <FlatList
            data={members}
            keyExtractor={(m) => String(m.id)}
            ListHeaderComponent={
              <View>
                {isAdmin && (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>{t('community.adminControls')}</Text>
                    <View style={styles.policyRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.policyTitle}>{t('community.onlyAdminsSend')}</Text>
                        <Text style={styles.policySub}>{t('community.readOnly')}</Text>
                      </View>
                      <Switch
                        value={onlyAdmins}
                        onValueChange={togglePosting}
                        disabled={policyBusy}
                        trackColor={{ true: colors.accent, false: colors.border }}
                        thumbColor="#fff"
                      />
                    </View>
                    <TouchableOpacity style={styles.addBtn} onPress={openAdd} activeOpacity={0.85}>
                      <Ionicons name="person-add" size={18} color="#0A1628" />
                      <Text style={styles.addBtnText}>{t('community.addMembers')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {isAdmin && requests.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>{t('community.requestsToJoin')}</Text>
                    {requests.map((r) => (
                      <View key={r.id} style={styles.memberRow}>
                        <Image source={r.user?.profile_picture ? { uri: r.user.profile_picture } : DEFAULT_AVATAR} placeholder={DEFAULT_AVATAR} contentFit="cover" transition={120} style={styles.memberAvatar} />
                        <Text style={styles.memberName} numberOfLines={1}>@{r.user?.username}</Text>
                        <TouchableOpacity style={[styles.smallBtn, styles.approveBtn]} onPress={() => approve(r)}><Text style={styles.approveText}>{t('community.approve')}</Text></TouchableOpacity>
                        <TouchableOpacity style={[styles.smallBtn, styles.rejectBtn]} onPress={() => reject(r)}><Text style={styles.rejectText}>{t('community.decline')}</Text></TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                <Text style={[styles.sectionLabel, { paddingHorizontal: spacing.md, paddingTop: spacing.md }]}>{t('community.members')}</Text>
              </View>
            }
            renderItem={({ item: m }) => {
              const isCreator = m.user?.id === creatorId;
              return (
                <View style={styles.memberRow}>
                  <Image source={m.user?.profile_picture ? { uri: m.user.profile_picture } : DEFAULT_AVATAR} placeholder={DEFAULT_AVATAR} contentFit="cover" transition={120} style={styles.memberAvatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName} numberOfLines={1}>@{m.user?.username}</Text>
                    <Text style={styles.memberRole}>{isCreator ? 'Creator' : (ROLE_BADGE[m.role] || m.role)}</Text>
                  </View>
                  {isAdmin && !isCreator && (
                    <>
                      <TouchableOpacity
                        style={[styles.smallBtn, m.role === 'admin' ? styles.rejectBtn : styles.approveBtn]}
                        onPress={() => toggleAdmin(m)}
                      >
                        <Text style={m.role === 'admin' ? styles.rejectText : styles.approveText}>
                          {m.role === 'admin' ? 'Dismiss' : 'Make admin'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.smallBtn, styles.rejectBtn]} onPress={() => remove(m)}>
                        <Text style={styles.rejectText}>{t('common.remove')}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              );
            }}
            ListFooterComponent={
              !isAdmin ? (
                <TouchableOpacity style={styles.leaveBtn} onPress={onLeave}><Text style={styles.leaveText}>{t('community.leave')}</Text></TouchableOpacity>
              ) : null
            }
            contentContainerStyle={{ paddingBottom: spacing.xl }}
          />
        </SafeAreaView>
      </Modal>

      {/* Add-members search modal (admin) */}
      <Modal visible={showAdd} animationType="slide" onRequestClose={() => setShowAdd(false)} statusBarTranslucent>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.modalBar}>
            <TouchableOpacity onPress={() => setShowAdd(false)} hitSlop={10}><Ionicons name="close" size={24} color={colors.textPrimary} /></TouchableOpacity>
            <Text style={styles.modalTitle}>{t('community.addMembers')}</Text>
            <View style={{ width: 24 }} />
          </View>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={addQuery}
              onChangeText={runSearch}
              placeholder={t('community.searchPlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <FlatList
            data={addResults}
            keyExtractor={(u) => String(u.id)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: u }) => (
              <View style={styles.memberRow}>
                <Image source={u.profile_picture ? { uri: u.profile_picture } : DEFAULT_AVATAR} placeholder={DEFAULT_AVATAR} contentFit="cover" transition={120} style={styles.memberAvatar} />
                <Text style={[styles.memberName, { flex: 1 }]} numberOfLines={1}>@{u.username}</Text>
                <TouchableOpacity style={[styles.smallBtn, styles.approveBtn]} onPress={() => addMember(u)} disabled={addBusyId === u.id}>
                  {addBusyId === u.id ? <ActivityIndicator size="small" color="#0A1628" /> : <Text style={styles.approveText}>Add</Text>}
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.addHint}>
                {addQuery.trim().length < 2 ? t('community.typeTwoLetters') : t('community.noMatchingPeople')}
              </Text>
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
              <Text style={styles.menuItemText}>{t('community.reply')}</Text>
            </TouchableOpacity>
            {canModerate(menuMsg) && (
              <TouchableOpacity style={styles.menuItem} onPress={() => confirmDelete(menuMsg)}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
                <Text style={[styles.menuItemText, { color: colors.error }]}>{t('common.delete')}</Text>
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
          {!!viewerUri && <Image source={{ uri: viewerUri }} style={styles.viewerImg} contentFit="contain" transition={150} />}
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

  // Admin controls (manage modal)
  policyRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(18,30,46,0.7)', borderRadius: radius.md, padding: spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, marginBottom: spacing.sm,
  },
  policyTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  policySub: { ...typography.caption, color: colors.textMuted, marginTop: 1 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm + 2,
  },
  addBtnText: { ...typography.button, color: '#0A1628', fontWeight: '800' },

  // Locked composer (only-admins-can-post)
  lockedBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingTop: spacing.md, paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(16,46,80,0.95)',
  },
  lockedBarText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },

  // Add-members search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, height: 46, borderRadius: radius.lg,
    backgroundColor: colors.inputBg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  addHint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', padding: spacing.xl },
});

export default ChoirCommunity;
