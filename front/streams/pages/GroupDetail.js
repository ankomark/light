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
import {
  fetchGroupDetails, fetchGroupPosts, sendGroupMessage, markGroupRead,
  leaveGroup, requestJoinGroup,
} from '../services/api';
import { useAuth } from '../context/useAuth';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const POLL_MS = 4000;
const { width: SCREEN_W } = Dimensions.get('window');
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const EMOJIS = ['😀','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😜','🤪','🤔','🤭','😎','🥳','😢','😭','😤','😡','🥺','😱','🙏','👍','👎','👏','🙌','🤝','💪','🫶','❤️','🧡','💛','💚','💙','💜','🔥','✨','🎉','💯','✅','🕊️','📖','🎵','☀️','⭐'];

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDuration = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round((s || 0) % 60)).padStart(2, '0')}`;
const replyLabel = (m) => m.content || ({ image: '📷 Photo', file: '📎 File', audio: '🎤 Voice note' }[m.message_type] || 'Message');

const mergeMessages = (a, b) => {
  const map = new Map();
  [...a, ...b].forEach((m) => map.set(String(m.id), m));
  return Array.from(map.values()).sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
};

const GroupDetail = ({ route, navigation }) => {
  const { groupSlug, group: initialGroup } = route.params;
  const { currentUser } = useAuth();

  const [group, setGroup] = useState(initialGroup || null);
  const [isMember, setIsMember] = useState(initialGroup?.is_member || false);
  const [isAdmin, setIsAdmin] = useState(initialGroup?.is_admin || false);
  const [requested, setRequested] = useState(initialGroup?.has_pending_request || false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [playingId, setPlayingId] = useState(null);
  const [hasEarlier, setHasEarlier] = useState(false);

  const listRef = useRef(null);
  const pollRef = useRef(null);
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
        const merged = mergeMessages(prev.filter((m) => !String(m.id).startsWith('temp_')), incoming);
        if (!silent && merged.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 60);
        return merged;
      });
    } catch { /* ignore */ }
  }, [groupSlug]);

  const loadGroup = useCallback(async () => {
    try {
      const g = await fetchGroupDetails(groupSlug);
      setGroup(g);
      setIsMember(g.is_member);
      setIsAdmin(g.is_admin);
      setRequested(!!g.has_pending_request);
      if (g.is_member || !g.is_private) await loadPosts();
    } catch {
      Alert.alert('Error', 'Could not load this group.');
    } finally {
      setLoading(false);
    }
  }, [groupSlug, loadPosts]);

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
      pollRef.current = setInterval(() => { loadPosts(true); }, POLL_MS);
      const sub = AppState.addEventListener('change', (n) => {
        if (n === 'active' && appState.current !== 'active') { loadPosts(true); markRead(); }
        appState.current = n;
      });
      return () => { clearInterval(pollRef.current); sub.remove(); markRead(); };
    }, [loadGroup, loadPosts, markRead])
  );

  useEffect(() => () => {
    clearInterval(recordTimerRef.current);
    recordingRef.current?.stopAndUnloadAsync?.().catch(() => {});
    soundRef.current?.unloadAsync?.().catch(() => {});
  }, []);

  // ── Send ──
  const sendPayload = useCallback(async (payload) => {
    const tempId = `temp_${Date.now()}`;
    const optimistic = {
      id: tempId,
      user: { id: currentUser?.id, username: currentUser?.username, profile_picture: currentUser?.profile_picture },
      content: payload.content || '', message_type: payload.message_type || 'text',
      attachment: payload.attachment || '', file_name: payload.file_name || '', duration: payload.duration,
      reply_to: replyTo ? { id: replyTo.id, content: replyTo.content, message_type: replyTo.message_type, sender_username: replyTo.user?.username } : null,
      created_at: new Date().toISOString(), is_owner: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setReplyTo(null);
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    try {
      const saved = await sendGroupMessage(groupSlug, payload);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? saved : m)));
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert('Error', 'Message could not be sent.');
    } finally { setSending(false); }
  }, [groupSlug, currentUser, replyTo]);

  const handleSendText = useCallback(() => {
    const content = text.trim();
    if (!content || sending) return;
    setText(''); setShowEmoji(false);
    sendPayload({ content, message_type: 'text', reply_to_id: replyTo?.id });
  }, [text, sending, sendPayload, replyTo]);

  const attachImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission required', 'Enable photo access.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      if (res.canceled || !res.assets?.length) return;
      const p = await manipulateAsync(res.assets[0].uri, [{ resize: { width: 1080 } }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
      sendPayload({ message_type: 'image', attachment: `data:image/jpeg;base64,${p.base64}`, reply_to_id: replyTo?.id });
    } catch { Alert.alert('Error', 'Could not attach image.'); }
  }, [sendPayload, replyTo]);

  const attachFile = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const f = res.assets[0];
      if (f.size && f.size > MAX_FILE_BYTES) { Alert.alert('File too large', 'Choose a file under 6 MB.'); return; }
      const b64 = await FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 });
      sendPayload({ message_type: 'file', attachment: `data:${f.mimeType || 'application/octet-stream'};base64,${b64}`, file_name: f.name || 'file', reply_to_id: replyTo?.id });
    } catch { Alert.alert('Error', 'Could not attach file.'); }
  }, [sendPayload, replyTo]);

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
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
      else Alert.alert('Saved', `Saved as ${msg.file_name}.`);
    } catch { Alert.alert('Error', 'Could not open this file.'); }
  }, []);

  // ── Voice ──
  const startRecording = useCallback(async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission required', 'Enable microphone access.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec; recordStartRef.current = Date.now();
      setShowEmoji(false); setIsRecording(true); setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch { Alert.alert('Error', 'Could not start recording.'); setIsRecording(false); }
  }, []);

  const stopRecording = useCallback(async (cancel = false) => {
    clearInterval(recordTimerRef.current);
    setIsRecording(false);
    const rec = recordingRef.current; recordingRef.current = null;
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      if (cancel) return;
      const uri = rec.getURI();
      const seconds = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
      if (!uri) return;
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      sendPayload({ message_type: 'audio', attachment: `data:audio/m4a;base64,${b64}`, duration: seconds, reply_to_id: replyTo?.id });
    } catch { Alert.alert('Error', 'Could not save the voice note.'); }
  }, [sendPayload, replyTo]);

  const playAudio = useCallback(async (msg) => {
    try {
      if (soundRef.current) { await soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
      if (playingId === msg.id) { setPlayingId(null); return; }
      const m = /^data:(.*?);base64,(.*)$/.exec(msg.attachment || '');
      if (!m) return;
      const path = `${FileSystem.cacheDirectory}gvoice_${msg.id}.m4a`;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) await FileSystem.writeAsStringAsync(path, m[2], { encoding: FileSystem.EncodingType.Base64 });
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      const { sound } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });
      soundRef.current = sound; setPlayingId(msg.id);
      sound.setOnPlaybackStatusUpdate((st) => { if (st.didJustFinish) { setPlayingId(null); sound.unloadAsync().catch(() => {}); soundRef.current = null; } });
    } catch { Alert.alert('Error', 'Could not play this voice note.'); setPlayingId(null); }
  }, [playingId]);

  // ── Group menu ──
  const openMenu = useCallback(() => {
    const opts = [];
    // Only members can view the member list.
    if (isMember) {
      opts.push({ text: 'View members', onPress: () => navigation.navigate('GroupMembers', { groupSlug, group, isAdmin }) });
    }
    if (isAdmin) opts.push({ text: 'Join requests', onPress: () => navigation.navigate('GroupJoinRequests', { groupSlug, group }) });
    if (isMember && group?.creator?.id !== currentUser?.id) {
      opts.push({ text: 'Leave group', style: 'destructive', onPress: confirmLeave });
    }
    opts.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(group?.name || 'Group', null, opts);
  }, [navigation, groupSlug, group, isAdmin, isMember, currentUser]);

  const confirmLeave = () => {
    Alert.alert('Leave group', `Leave "${group?.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        try { await leaveGroup(groupSlug); navigation.goBack(); }
        catch { Alert.alert('Error', 'Could not leave the group.'); }
      } },
    ]);
  };

  const join = async () => {
    try {
      await requestJoinGroup(groupSlug, '');
      setRequested(true);
      Alert.alert('Request sent', 'The group admins will review your request.');
    } catch (e) {
      const msg = e?.response?.data?.error || 'Could not send request.';
      if (/already/i.test(msg)) setRequested(true);
      Alert.alert('Notice', msg);
    }
  };

  // ── Render ──
  const renderMessage = useCallback(({ item, index }) => {
    if (item.message_type === 'system') {
      return <View style={styles.sysRow}><Text style={styles.sysText}>{item.content}</Text></View>;
    }
    const isOwn = item.user?.id === currentUser?.id || item.is_owner;
    const prev = messages[index - 1];
    const showName = !isOwn && (!prev || prev.user?.id !== item.user?.id || prev.message_type === 'system');
    const type = item.message_type || 'text';

    return (
      <Pressable
        onLongPress={() => setReplyTo(item)}
        delayLongPress={250}
        style={[styles.msgRow, isOwn ? styles.msgRowOwn : styles.msgRowOther]}
      >
        {!isOwn && (
          <View style={styles.avatarPlaceholder}>
            {showName && (
              <Image source={item.user?.profile_picture ? { uri: item.user.profile_picture } : DEFAULT_AVATAR} defaultSource={DEFAULT_AVATAR} style={styles.msgAvatar} />
            )}
          </View>
        )}
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, type === 'image' && styles.bubbleMedia]}>
          {showName && <Text style={styles.senderName}>{item.user?.username}</Text>}

          {item.reply_to && (
            <View style={styles.replyQuote}>
              <Text style={styles.replyQuoteName}>{item.reply_to.sender_username || 'Reply'}</Text>
              <Text style={styles.replyQuoteText} numberOfLines={1}>{replyLabel(item.reply_to)}</Text>
            </View>
          )}

          {type === 'image' && item.attachment ? (
            <Pressable onPress={() => setViewer(item.attachment)}>
              <Image source={{ uri: item.attachment }} style={styles.imageMsg} resizeMode="cover" />
            </Pressable>
          ) : type === 'file' ? (
            <Pressable style={styles.fileRow} onPress={() => openFile(item)}>
              <View style={styles.fileIcon}><Ionicons name="document-text" size={22} color={colors.primary} /></View>
              <Text style={[styles.fileName, isOwn ? styles.txtOwn : styles.txtOther]} numberOfLines={1}>{item.file_name || 'File'}</Text>
              <Ionicons name="download-outline" size={18} color={isOwn ? 'rgba(255,255,255,0.8)' : colors.textMuted} />
            </Pressable>
          ) : type === 'audio' ? (
            <Pressable style={styles.audioRow} onPress={() => playAudio(item)}>
              <Ionicons name={playingId === item.id ? 'pause-circle' : 'play-circle'} size={30} color={isOwn ? colors.white : colors.primary} />
              <View style={styles.audioBar}><View style={[styles.audioBarFill, { backgroundColor: isOwn ? 'rgba(255,255,255,0.55)' : colors.primary }]} /></View>
              <Text style={[styles.audioDuration, isOwn ? styles.txtOwn : styles.txtOther]}>{fmtDuration(item.duration)}</Text>
            </Pressable>
          ) : null}

          {!!item.content && (
            <Text style={[styles.bubbleText, isOwn ? styles.txtOwn : styles.txtOther, type === 'image' && { marginTop: spacing.xs }]}>{item.content}</Text>
          )}
          <Text style={[styles.bubbleTime, isOwn ? styles.timeOwn : styles.timeOther]}>{fmtTime(item.created_at)}</Text>
        </View>
      </Pressable>
    );
  }, [currentUser?.id, messages, playingId, openFile, playAudio]);

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  const canChat = isMember;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <LinearGradient colors={[colors.surface, colors.bg]} style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerInfo}
            activeOpacity={isMember ? 0.8 : 1}
            onPress={() => isMember && navigation.navigate('GroupMembers', { groupSlug, group, isAdmin })}
          >
            <View style={styles.groupAvatar}><Ionicons name="people" size={20} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerName} numberOfLines={1}>{group?.name ?? 'Group'}</Text>
              <Text style={styles.headerSub} numberOfLines={1}>{group?.member_count ?? 0} members{group?.is_private ? ' · Private' : ''}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={openMenu} style={styles.backBtn}>
            <Ionicons name="ellipsis-vertical" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </LinearGradient>
      </SafeAreaView>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderMessage}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListHeaderComponent={hasEarlier ? (
          <TouchableOpacity style={styles.earlierBtn} onPress={loadEarlier}><Text style={styles.earlierText}>Load earlier messages</Text></TouchableOpacity>
        ) : null}
        ListEmptyComponent={<View style={styles.emptyContainer}><Text style={styles.emptyText}>No messages yet. Say hello 👋</Text></View>}
      />

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
            <Text style={styles.replyBarName}>Replying to {replyTo.user?.username}</Text>
            <Text style={styles.replyBarText} numberOfLines={1}>{replyLabel(replyTo)}</Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}><Ionicons name="close" size={20} color={colors.textMuted} /></TouchableOpacity>
        </View>
      )}

      {canChat ? (
        <View style={styles.inputBar}>
          {isRecording ? (
            <>
              <TouchableOpacity style={styles.iconBtn} onPress={() => stopRecording(true)}><Ionicons name="trash-outline" size={24} color={colors.error} /></TouchableOpacity>
              <View style={styles.recordingInfo}><View style={styles.recDot} /><Text style={styles.recText}>Recording… {fmtDuration(recordSecs)}</Text></View>
              <TouchableOpacity style={styles.sendBtn} onPress={() => stopRecording(false)}><Ionicons name="send" size={18} color={colors.white} /></TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.iconBtn} onPress={() => setShowEmoji((s) => !s)}><Ionicons name={showEmoji ? 'close' : 'happy-outline'} size={24} color={colors.textSecondary} /></TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={onAttachPress} disabled={sending}><Ionicons name="add-circle-outline" size={26} color={colors.textSecondary} /></TouchableOpacity>
              <TextInput style={styles.input} placeholder="Message…" placeholderTextColor={colors.placeholder} value={text} onChangeText={setText} onFocus={() => setShowEmoji(false)} multiline maxLength={2000} />
              {text.trim() ? (
                <TouchableOpacity style={[styles.sendBtn, sending && styles.sendBtnDisabled]} onPress={handleSendText} disabled={sending}>
                  {sending ? <ActivityIndicator size="small" color={colors.white} /> : <Ionicons name="send" size={18} color={colors.white} />}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.sendBtn} onPress={startRecording} disabled={sending}><Ionicons name="mic" size={20} color={colors.white} /></TouchableOpacity>
              )}
            </>
          )}
        </View>
      ) : requested ? (
        <View style={styles.joinBar}>
          <View style={styles.pendingPill}>
            <Ionicons name="time-outline" size={18} color={colors.warning} />
            <Text style={styles.pendingText}>Waiting for approval</Text>
          </View>
        </View>
      ) : (
        <View style={styles.joinBar}>
          <Text style={styles.joinText}>You're not a member of this group.</Text>
          <TouchableOpacity style={styles.joinBtn} onPress={join}><Text style={styles.joinBtnText}>Request to Join</Text></TouchableOpacity>
        </View>
      )}

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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  headerSafe: { backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.xs },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  groupAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
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
  bubble: { maxWidth: '78%', borderRadius: radius.lg, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, ...shadows.sm },
  bubbleMedia: { padding: 4 },
  bubbleOwn: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.card, borderBottomLeftRadius: 4 },
  senderName: { ...typography.caption, color: colors.accent, fontWeight: '700', marginBottom: 2 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  txtOwn: { color: colors.white },
  txtOther: { color: colors.textPrimary },
  bubbleTime: { fontSize: 10, marginTop: 3 },
  timeOwn: { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  timeOther: { color: colors.textMuted },

  replyQuote: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: spacing.sm, marginBottom: spacing.xs, opacity: 0.9 },
  replyQuoteName: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  replyQuoteText: { ...typography.caption, color: colors.textSecondary },

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

  replyBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  replyAccent: { width: 3, alignSelf: 'stretch', backgroundColor: colors.accent, borderRadius: 2 },
  replyBarName: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  replyBarText: { ...typography.caption, color: colors.textSecondary },

  inputBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.xs },
  iconBtn: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  recordingInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.error },
  recText: { ...typography.body, color: colors.textSecondary },
  input: { flex: 1, backgroundColor: colors.inputBg, borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 4, color: colors.textPrimary, fontSize: 15, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', ...shadows.sm },
  sendBtnDisabled: { opacity: 0.4 },

  joinBar: { padding: spacing.md, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center', gap: spacing.sm },
  joinText: { ...typography.caption, color: colors.textSecondary },
  joinBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm + 2 },
  joinBtnText: { ...typography.button, color: colors.white },
  pendingPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.full, borderWidth: 1, borderColor: colors.warning, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  pendingText: { ...typography.label, color: colors.warning, fontWeight: '700' },

  viewerRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 48, right: 20 },
});

export default GroupDetail;
