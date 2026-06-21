/**
 * Choir community: a gated, chat-first space for a choir.
 *
 * Membership tiers (admin / member / friend) all chat equally; only the admin
 * (creator) moderates — approve/reject join requests, remove members/friends,
 * delete the choir. Non-members see a locked hero with "Request to join".
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
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../context/useAuth';
import RotatingBackground from '../components/RotatingBackground';
import {
  fetchChoirCommunity, fetchChoirMessages, sendChoirMessage, deleteChoirMessage,
  requestJoinChoir, fetchChoirMembers, fetchChoirJoinRequests, approveChoirRequest,
  rejectChoirRequest, removeChoirMember, leaveChoir, reactToChoirMessage,
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
const MessageRow = ({ item, currentUser, isAdmin, onReply, onLongPress, onOpenImage, onPlayAudio, onToggleReaction }) => {
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
  const reactions = item.reactions?.summary || [];
  const myReaction = item.reactions?.mine || null;
  const hintOpacity = tx.interpolate({ inputRange: [0, SWIPE_TRIGGER], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <View style={styles.swipeWrap}>
      <Animated.View style={[styles.replyHint, { opacity: hintOpacity, transform: [{ scale: hintOpacity }] }]}>
        <Ionicons name="arrow-undo" size={18} color={colors.accent} />
      </Animated.View>

      <Animated.View style={{ transform: [{ translateX: tx }] }} {...pan.panHandlers}>
        <Pressable onLongPress={() => onLongPress(item)} delayLongPress={280} style={[styles.msgRow, mine && styles.msgRowMine]}>
          {!mine && (
            <Image source={item.sender?.profile_picture ? { uri: item.sender.profile_picture } : DEFAULT_AVATAR}
              defaultSource={DEFAULT_AVATAR} style={styles.msgAvatar} />
          )}
          <View style={styles.bubbleCol}>
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, isImg && styles.bubbleImage]}>
              {!mine && <Text style={styles.msgSender}>{item.sender?.username || 'member'}</Text>}
              {item.reply_to && (
                <View style={styles.replyChip}>
                  <Text style={styles.replyName}>{item.reply_to.sender}</Text>
                  <Text style={styles.replyText} numberOfLines={1}>{previewOf(item.reply_to)}</Text>
                </View>
              )}
              {item.message_type === 'image' && !!item.attachment && (
                <TouchableOpacity activeOpacity={0.9} onPress={() => onOpenImage(item.attachment)}>
                  <Image source={{ uri: item.attachment }} style={styles.msgImage} resizeMode="cover" />
                  <View style={styles.imageExpand}><Ionicons name="expand" size={15} color="#fff" /></View>
                </TouchableOpacity>
              )}
              {item.message_type === 'audio' && !!item.attachment && (
                <TouchableOpacity style={styles.audioRow} onPress={() => onPlayAudio(item.attachment)}>
                  <Ionicons name="play-circle" size={30} color={mine ? '#0A1628' : colors.accent} />
                  <View style={styles.audioBars}><Text style={[styles.audioMeta, mine && styles.audioMetaMine]}>Voice note · {fmtDuration(item.duration)}</Text></View>
                </TouchableOpacity>
              )}
              {item.message_type === 'file' && !!item.attachment && (
                <View style={styles.fileRow}>
                  <MaterialCommunityIcons name="file-document-outline" size={24} color={mine ? '#0A1628' : colors.accent} />
                  <Text style={[styles.fileName, mine && styles.textMine]} numberOfLines={1}>{item.file_name || 'Document'}</Text>
                </View>
              )}
              {!!item.content && <Text style={[styles.msgText, mine && styles.textMine]}>{item.content}</Text>}
              <Text style={[styles.msgTime, mine && styles.timeMine]}>
                {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
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
  const choir = route.params?.choir || {};
  const choirId = route.params?.choirId || choir.id;
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();

  const [community, setCommunity] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
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

  const recordingRef = useRef(null);
  const soundRef = useRef(null);
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
  const loadCommunity = useCallback(async () => {
    try {
      const snap = await fetchChoirCommunity(choirId);
      setCommunity(snap);
      if (snap.is_member) {
        const res = await fetchChoirMessages(choirId, 1);
        const list = res?.results ?? (Array.isArray(res) ? res : []);
        seenIdsRef.current = new Set(list.map((m) => m.id));
        setMessages(list); // newest-first from the API → matches inverted list
        setHasMore(!!res?.next);
        setPage(1);
      }
    } catch (e) {
      // 403 etc. — snapshot still tells us we're not a member
    } finally {
      setLoading(false);
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

  // ── sending ───────────────────────────────────────────────────────────────
  const pushSent = (msg) => {
    seenIdsRef.current.add(msg.id);
    setMessages((prev) => [msg, ...prev]);
  };

  const send = useCallback(async (payload) => {
    setSending(true);
    // Attach (and clear) any active reply so text + media replies both work.
    const reply = replyToRef.current;
    const body = reply ? { ...payload, reply_to: reply.id } : payload;
    if (reply) setReplyTo(null);
    try {
      const msg = await sendChoirMessage(choirId, body);
      pushSent(msg);
    } catch (e) {
      Alert.alert('Choir', e?.response?.data?.error || 'Could not send your message.');
    } finally {
      setSending(false);
    }
  }, [choirId]);

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
    } catch { Alert.alert('Choir', 'Could not start recording.'); }
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
    } catch { Alert.alert('Choir', 'Could not save the recording.'); }
  };


  const playAudio = async (dataUri) => {
    try {
      await soundRef.current?.unloadAsync?.().catch(() => {});
      // Native player may not accept data: URIs — stage to a cache file first.
      const base64 = dataUri.split(',')[1] || '';
      const path = `${FileSystem.cacheDirectory}choir-audio-${Date.now()}.m4a`;
      await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
      const { sound } = await Audio.Sound.createAsync({ uri: path });
      soundRef.current = sound;
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      await sound.playAsync();
    } catch { Alert.alert('Choir', 'Could not play this audio.'); }
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
      Alert.alert('Choir', e?.response?.data?.error || 'Could not send your request.');
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
  const reject = async (r) => {
    try { await rejectChoirRequest(choirId, r.id); setRequests((p) => p.filter((x) => x.id !== r.id)); } catch {}
  };
  const remove = (m) => {
    Alert.alert('Remove', `Remove @${m.user?.username} from the community?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await removeChoirMember(choirId, m.user.id); setMembers((p) => p.filter((x) => x.id !== m.id)); } catch {}
      } },
    ]);
  };
  const onLeave = () => {
    Alert.alert('Leave community', `Leave ${choir.name || 'this choir'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        try { await leaveChoir(choirId); navigation.goBack(); } catch (e) { Alert.alert('Choir', e?.response?.data?.error || 'Could not leave.'); }
      } },
    ]);
  };

  // ── render ────────────────────────────────────────────────────────────────
  const renderMessage = ({ item }) => (
    <MessageRow
      item={item}
      currentUser={currentUser}
      isAdmin={isAdmin}
      onReply={startReply}
      onLongPress={openMenu}
      onOpenImage={setViewerUri}
      onPlayAudio={playAudio}
      onToggleReaction={react}
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
          defaultSource={DEFAULT_AVATAR} style={styles.headerAvatar} />
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
            ListEmptyComponent={<View style={styles.emptyChat}><Text style={styles.emptyChatText}>Say hello 👋</Text></View>}
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
                <TouchableOpacity onPress={sendText} disabled={sending} style={styles.sendBtn}>
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
            <Text style={styles.modalTitle}>{choir.name}</Text>
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
  bubbleMine: { backgroundColor: colors.accent, borderTopRightRadius: 4 },
  bubbleImage: { padding: 3 }, // thin frame around shared images
  bodyLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  msgSender: { ...typography.caption, color: colors.accent, fontWeight: '800', marginBottom: 2 },
  msgText: { ...typography.body, color: colors.textPrimary },
  textMine: { color: '#0A1628' },
  msgTime: { ...typography.caption, color: colors.textMuted, fontSize: 10, alignSelf: 'flex-end', marginTop: 3 },
  timeMine: { color: 'rgba(10,22,40,0.6)' },
  msgImage: { width: 220, height: 220, borderRadius: radius.md, marginBottom: 4, backgroundColor: colors.surface },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4, minWidth: 180 },
  audioBars: { flex: 1 },
  audioMeta: { ...typography.caption, color: colors.textSecondary },
  audioMetaMine: { color: 'rgba(10,22,40,0.7)' },
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

export default ChoirCommunity;
