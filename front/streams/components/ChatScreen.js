// A direct-message chat. Opens on the last messages seen (cache), then stays
// live off the DM socket: new messages, edits, deletions, reactions, read
// receipts, typing and whether they're online arrive as they happen; a poll
// catches up behind it (slowly while the socket's up, every 3 s while not).
// Sends are optimistic and carry a client id, so a retry can't land twice;
// a send that fails stays on screen — "Tap to retry" — even across leaving.
// Long-press a message: react, reply, edit (15 min), delete for everyone
// (48 h) or for me, report. The ⋮ menu: search, mute, archive, clear, block.
// A first message from someone they don't follow is a request: accept,
// delete or block.
import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, AppState, Modal,
  ScrollView, Pressable, useWindowDimensions,
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
import {
  fetchMessages, fetchOlderMessages, sendMessage, markConversationRead,
  editMessage, deleteMessage, reactToMessage, setConversationState, fetchPresence,
  searchMessages, blockUser,
} from '../services/api';
import { subscribeDM, isDMOpen, sendDMTyping, announceDM } from '../services/dmSocket';
import { uploadMedia } from '../services/cloudinary';
import { useAuth } from '../context/useAuth';
import { useI18n } from '../context/I18nContext';
import RotatingBackground from './RotatingBackground';
import ChoiceSheet from './ChoiceSheet';
import ReportModal from './ReportModal';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import {
  cacheableMessages, nextTempId, reconcileSent, mergeFullLoad,
  addIncoming, markFailed, markRetrying, patchMessage,
} from '../utils/chatMessages';
import {
  dayLabel, newDay, presenceLine, previewText, canEdit, canDeleteForAll,
  REACTIONS, withReactions, toggleReaction,
} from '../utils/dmView';
import { confirmAction, notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const POLL_MS = 3000;          // no socket: ask often
const POLL_LIVE_MS = 20000;    // the socket tells us; this only catches up
const MAX_FILE_BYTES = 6 * 1024 * 1024; // 6 MB cap for document attachments
const TYPING_EVERY_MS = 3000;  // "typing" at most this often…
const TYPING_IDLE_MS = 4000;   // …and "stopped" after this long without a key

const EMOJIS = ['😀','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😜','🤪','🤔','🤭','🫡','😎','🥳','😏','😴','😢','😭','😤','😡','🥺','😱','🤯','🙏','👍','👎','👏','🙌','🤝','💪','🫶','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🔥','✨','🎉','🎊','💯','✅','🕊️','📖','🎵','🎶','☀️','🌙','⭐','🙏🏽'];

// Insert a small Cloudinary delivery transform so an image bubble loads a light
// thumbnail rather than the full upload. Leaves local (file://) and legacy
// base64 (data:) attachments untouched.
const cldThumb = (url) => {
  if (typeof url !== 'string' || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  if (/\/upload\/[a-z]{1,3}_/.test(url)) return url; // already has a transform
  return url.replace('/upload/', '/upload/c_limit,w_800,q_auto,f_auto/');
};

const isData = (uri) => typeof uri === 'string' && uri.startsWith('data:');

const chatCacheKey = (userId, conversationId) => userKey(userId, `chat:${conversationId}`);

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDuration = (s) => {
  const sec = Math.max(0, Math.round(s || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

// One bubble. Memoised with primitive props, so a new message, a read receipt
// or a keystroke in the composer re-renders only the rows that changed — not
// every bubble on screen.
const MessageRow = memo(({
  item, isOwn, showAvatar, dayText, isPlaying, imgSide, highlighted, replyName, t,
  onOpenImage, onOpenFile, onPlayAudio, onLongPress, onRetry, onReact,
}) => {
  const type = item.message_type || 'text';
  const deleted = !!item.is_deleted;
  const reactions = item.reactions || [];
  return (
    <View>
      {dayText ? (
        <View style={styles.dayWrap}><Text style={styles.dayText}>{dayText}</Text></View>
      ) : null}
      <View style={[styles.msgRow, isOwn ? styles.msgRowOwn : styles.msgRowOther]}>
        {!isOwn && (
          <View style={styles.avatarPlaceholder}>
            {showAvatar && (
              <Image
                source={item.sender?.profile_picture ? { uri: item.sender.profile_picture } : DEFAULT_AVATAR}
                placeholder={DEFAULT_AVATAR} contentFit="cover" cachePolicy="memory-disk" transition={150}
                style={styles.msgAvatar}
              />
            )}
          </View>
        )}
        <View style={[styles.bubbleCol, isOwn ? styles.bubbleColOwn : styles.bubbleColOther]}>
          <Pressable
            onLongPress={() => onLongPress(item)} delayLongPress={300}
            onPress={item.failed ? () => onRetry(item) : undefined}
            testID={`msg-${item.id}`}
            style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther,
              type === 'image' && !deleted && styles.bubbleMedia, item.pending && styles.bubblePending,
              item.failed && styles.bubbleFailed, highlighted && styles.bubbleHighlight]}
          >
            {item.reply_to ? (
              <View style={[styles.quote, isOwn ? styles.quoteOwn : styles.quoteOther]}>
                <Text style={styles.quoteName} numberOfLines={1}>{replyName(item.reply_to)}</Text>
                <Text style={[styles.quoteText, item.reply_to.is_deleted && styles.italic]} numberOfLines={2}>
                  {previewText(t, item.reply_to)}
                </Text>
              </View>
            ) : null}

            {deleted ? (
              <View style={styles.deletedRow}>
                <Ionicons name="ban" size={14} color={isOwn ? 'rgba(255,255,255,0.7)' : colors.textMuted} />
                <Text style={[styles.bubbleText, styles.italic, isOwn ? styles.bubbleTimeOwn : styles.bubbleTimeOther]}>
                  {isOwn ? t('dm.youDeleted') : t('dm.deleted')}
                </Text>
              </View>
            ) : type === 'image' && item.attachment ? (
              <Pressable onPress={() => onOpenImage(item.attachment)} onLongPress={() => onLongPress(item)}>
                <Image source={{ uri: cldThumb(item.attachment) }} style={[styles.imageMsg, { width: imgSide, height: imgSide }]} contentFit="cover" cachePolicy="memory-disk" transition={150} />
              </Pressable>
            ) : type === 'file' ? (
              <Pressable style={styles.fileRow} onPress={() => onOpenFile(item)} onLongPress={() => onLongPress(item)}>
                <View style={styles.fileIcon}><Ionicons name="document-text" size={22} color={colors.primary} /></View>
                <Text style={[styles.fileName, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther]} numberOfLines={1}>
                  {item.file_name || t('dm.file')}
                </Text>
                <Ionicons name="download-outline" size={18} color={isOwn ? 'rgba(255,255,255,0.8)' : colors.textMuted} />
              </Pressable>
            ) : type === 'audio' ? (
              <Pressable style={styles.audioRow} onPress={() => onPlayAudio(item)} onLongPress={() => onLongPress(item)}>
                <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={30} color={isOwn ? colors.white : colors.primary} />
                <View style={styles.audioBar}>
                  <View style={[styles.audioBarFill, { backgroundColor: isOwn ? 'rgba(255,255,255,0.55)' : colors.primary }]} />
                </View>
                <Text style={[styles.audioDuration, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther]}>
                  {fmtDuration(item.duration)}
                </Text>
              </Pressable>
            ) : null}

            {!deleted && !!item.content && (
              <Text selectable style={[styles.bubbleText, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther, type === 'image' && styles.captionGap]}>
                {item.content}
              </Text>
            )}

            {item.failed ? (
              <View style={styles.failedRow}>
                <Ionicons name="alert-circle" size={13} color={colors.error} />
                <Text style={styles.failedText}>{t('dm.tapToRetry')}</Text>
              </View>
            ) : (
              <Text style={[styles.bubbleTime, isOwn ? styles.bubbleTimeOwn : styles.bubbleTimeOther]}>
                {item.edited_at && !deleted ? `${t('dm.edited')} · ` : ''}
                {fmtTime(item.created_at)}{isOwn ? (item.pending ? ' ◷' : item.read ? ' ✓✓' : ' ✓') : ''}
              </Text>
            )}
          </Pressable>

          {reactions.length > 0 && !deleted ? (
            <View style={[styles.reactions, isOwn ? styles.reactionsOwn : styles.reactionsOther]}>
              {reactions.map((r) => (
                <TouchableOpacity key={r.emoji} onPress={() => onReact(item, r.emoji)}
                  style={[styles.reactionChip, r.mine && styles.reactionChipMine]}
                  accessibilityLabel={`${r.emoji} ${r.count}`} testID={`reaction-${item.id}-${r.emoji}`}>
                  <Text style={styles.reactionText}>{r.emoji}{r.count > 1 ? ` ${r.count}` : ''}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
});
MessageRow.displayName = 'MessageRow';

const ChatScreen = ({ route, navigation }) => {
  const { conversationId, otherUser, draft = '' } = route.params;
  const { currentUser } = useAuth();
  const meId = currentUser?.id;
  const { t } = useI18n();
  const { width: winW } = useWindowDimensions();
  const imgSide = Math.min(winW * 0.6, 360);  // chat image bubble: 60% of the window, capped on wide screens
  const kbHeight = useKeyboardHeight(); // float the composer above the keyboard (edge-to-edge safe)
  const otherName = otherUser?.username ?? t('dm.chat');

  const cacheKey = chatCacheKey(meId, conversationId);
  // Open on the last messages we saw in this chat — straight from memory when
  // this session has them, from disk otherwise (below) — and refresh behind.
  const [messages, setMessages] = useState(() => peekCache(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => !peekCache(cacheKey));
  const [sending, setSending] = useState(false);
  // A message started elsewhere (e.g. from a service's page), ready to edit — never sent for them.
  const [text, setText] = useState(draft);
  const [showEmoji, setShowEmoji] = useState(false);
  const [viewer, setViewer] = useState(null); // full-screen image uri
  const [attachSheet, setAttachSheet] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [playingId, setPlayingId] = useState(null);
  // This person's side of the chat.
  const [isRequest, setIsRequest] = useState(!!route.params.isRequest);
  const [muted, setMuted] = useState(!!route.params.muted);
  const [archived, setArchived] = useState(!!route.params.archived);
  // The other person, live.
  const [presence, setPresence] = useState({ online: false, lastSeen: null });
  const [otherTyping, setOtherTyping] = useState(false);
  // Composer modes and sheets.
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [actionsFor, setActionsFor] = useState(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [reportId, setReportId] = useState(null);
  // In-chat search.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState(null);
  const [highlight, setHighlight] = useState(null);

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const pollRef = useRef(null);
  const liveRef = useRef(isDMOpen());
  const appState = useRef(AppState.currentState);
  const lastCountRef = useRef(0);
  const lastIdRef = useRef(0); // highest server message id we hold (for incremental polls)
  const oldestIdRef = useRef(0);        // lowest id held (for scroll-up history)
  const hasMoreOlderRef = useRef(true); // false once we've reached the start
  const loadingOlderRef = useRef(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const isFocused = useRef(true);
  const isRequestRef = useRef(isRequest);
  const messagesRef = useRef(messages);
  const recordingRef = useRef(null);
  const recordTimerRef = useRef(null);
  const recordStartRef = useRef(0);
  const soundRef = useRef(null);
  const typingOut = useRef({ sentAt: 0, stop: null });
  const typingIn = useRef(null);
  const readSoon = useRef(null);
  // playAudio reads this instead of the state, so it stays a stable callback
  // and toggling playback re-renders only the two affected bubbles.
  const playingIdRef = useRef(null);
  useEffect(() => { playingIdRef.current = playingId; }, [playingId]);
  useEffect(() => { isRequestRef.current = isRequest; }, [isRequest]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Cold start: the disk copy, if the network hasn't answered first.
  useEffect(() => {
    let cancelled = false;
    readCache(cacheKey).then((cached) => {
      if (cancelled || !Array.isArray(cached) || !cached.length) return;
      setMessages((prev) => (prev.length ? prev : cached));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  // Keep the cache current with whatever is on screen (debounced — a burst of
  // polls and sends becomes one write). Failed texts go with it: the outbox.
  useEffect(() => {
    if (!messages.length) return undefined;
    const handle = setTimeout(() => writeCache(cacheKey, cacheableMessages(messages)), 400);
    return () => clearTimeout(handle);
  }, [messages, cacheKey]);

  // Highest numeric (server-assigned) id in a list, ignoring optimistic temps.
  const maxNumericId = (arr) =>
    arr.reduce((mx, m) => (typeof m.id === 'number' && m.id > mx ? m.id : mx), 0);

  // Lowest numeric id in a list (0 if none), for paging older history.
  const minNumericId = (arr) =>
    arr.reduce((mn, m) => (typeof m.id === 'number' && (mn === 0 || m.id < mn) ? m.id : mn), 0);

  const scrollToEndSoon = (animated = true) => setTimeout(() => listRef.current?.scrollToEnd({ animated }), 80);

  const loadMessages = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);

      // Full load on first open (or if a prior load never succeeded); after that,
      // polls fetch only new messages + read-receipt updates.
      if (!silent || lastIdRef.current === 0) {
        const data = await fetchMessages(conversationId);
        if (Array.isArray(data)) {
          // Keep bubbles still sending (or failed): they aren't on the server.
          setMessages((prev) => mergeFullLoad(prev, data));
          lastIdRef.current = maxNumericId(data);
          oldestIdRef.current = minNumericId(data);
          hasMoreOlderRef.current = data.length >= 100;  // a full page implies older exist
          if (data.length !== lastCountRef.current) {
            lastCountRef.current = data.length;
            scrollToEndSoon(!silent);
          }
        }
        return;
      }

      const res = await fetchMessages(conversationId, lastIdRef.current);
      const incoming = res?.messages ?? [];
      const readIds = res?.read_ids ?? [];
      if (!incoming.length && !readIds.length) return;

      setMessages((prev) => {
        let merged = prev;
        incoming.forEach((m) => { merged = addIncoming(merged, m); });
        if (readIds.length) {
          const rset = new Set(readIds);
          merged = merged.map((m) => (rset.has(m.id) && !m.read ? { ...m, read: true } : m));
        }
        return merged;
      });

      if (incoming.length) {
        lastIdRef.current = Math.max(lastIdRef.current, maxNumericId(incoming));
        scrollToEndSoon();
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [conversationId]);

  // Read — but a request stays unread (and unseen by its sender) until accepted.
  const markRead = useCallback(() => {
    if (isRequestRef.current) return;
    markConversationRead(conversationId).catch(() => {});
    announceDM({ type: 'read', conversation_id: conversationId, reader_id: meId });
  }, [conversationId, meId]);

  const loadPresence = useCallback(() => {
    fetchPresence(conversationId)
      .then((r) => { if (r) setPresence({ online: !!r.online, lastSeen: r.last_seen || null }); })
      .catch(() => {});
  }, [conversationId]);

  // Load a page of older messages when the user scrolls to the top.
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

  const startPoll = useCallback(() => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadMessages(true), liveRef.current ? POLL_LIVE_MS : POLL_MS);
  }, [loadMessages]);

  useFocusEffect(
    useCallback(() => {
      isFocused.current = true;
      loadMessages();
      markRead();
      loadPresence();
      startPoll();
      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'active' && appState.current !== 'active' && isFocused.current) {
          loadMessages(true); markRead(); loadPresence();
          startPoll();
        }
        if (next !== 'active') { clearInterval(pollRef.current); pollRef.current = null; }
        appState.current = next;
      });
      return () => { isFocused.current = false; clearInterval(pollRef.current); pollRef.current = null; sub.remove(); };
    }, [loadMessages, markRead, loadPresence, startPoll])
  );

  // Live: this chat's events, and the other person's presence.
  useEffect(() => {
    const unsub = subscribeDM((e) => {
      if (e.type === 'status') {
        liveRef.current = e.open;
        if (isFocused.current && pollRef.current) startPoll();
        if (e.open) { loadMessages(true); loadPresence(); }
        return;
      }
      if (e.type === 'presence') {
        if (e.user_id === otherUser?.id) {
          setPresence((p) => ({ online: !!e.online, lastSeen: e.online ? p.lastSeen : new Date().toISOString() }));
          if (!e.online) setOtherTyping(false);
        }
        return;
      }
      if (e.conversation_id !== conversationId) return;
      switch (e.type) {
        case 'message': {
          const m = e.message;
          if (!m) return;
          setMessages((prev) => addIncoming(prev, m));
          if (typeof m.id === 'number') lastIdRef.current = Math.max(lastIdRef.current, m.id);
          if (m.sender?.id !== meId) {
            setOtherTyping(false);
            // Read at once while they're looking (one call for a burst).
            if (isFocused.current && appState.current === 'active') {
              clearTimeout(readSoon.current);
              readSoon.current = setTimeout(markRead, 500);
            }
          }
          scrollToEndSoon();
          break;
        }
        case 'edited':
          if (e.message) setMessages((prev) => patchMessage(prev, e.message.id, { content: e.message.content, edited_at: e.message.edited_at }));
          break;
        case 'deleted':
          setMessages((prev) => patchMessage(prev, e.id, { is_deleted: true, content: '', attachment: '', file_name: '', reactions: [] }));
          break;
        case 'reaction':
          setMessages((prev) => patchMessage(prev, e.message_id, (m) => withReactions(m, e.reactions, meId)));
          break;
        case 'read':
          if (e.reader_id !== meId) {
            setMessages((prev) => prev.map((m) => (m.sender?.id === meId && typeof m.id === 'number' && !m.read ? { ...m, read: true } : m)));
          }
          break;
        case 'typing':
          if (e.user_id !== meId) {
            clearTimeout(typingIn.current);
            setOtherTyping(!!e.is_typing);
            // A lost "stopped typing" can't leave it on.
            if (e.is_typing) typingIn.current = setTimeout(() => setOtherTyping(false), 6000);
          }
          break;
        default: break;
      }
    });
    return () => { unsub(); clearTimeout(typingIn.current); clearTimeout(readSoon.current); };
  }, [conversationId, meId, otherUser?.id, loadMessages, loadPresence, markRead, startPoll]);

  // ── Typing, out ──
  const stopTyping = useCallback(() => {
    clearTimeout(typingOut.current.stop);
    if (typingOut.current.sentAt) {
      sendDMTyping(conversationId, false);
      typingOut.current.sentAt = 0;
    }
  }, [conversationId]);

  const onChangeText = useCallback((v) => {
    setText(v);
    if (editing) return;
    const now = Date.now();
    if (v.trim() && now - typingOut.current.sentAt > TYPING_EVERY_MS) {
      if (sendDMTyping(conversationId, true)) typingOut.current.sentAt = now;
    }
    clearTimeout(typingOut.current.stop);
    typingOut.current.stop = setTimeout(stopTyping, TYPING_IDLE_MS);
  }, [conversationId, editing, stopTyping]);

  useEffect(() => () => stopTyping(), [stopTyping]);

  // ── Sending ──
  // One delivery, first try or retry: the payload carries the bubble's client
  // id, so the server keeps one message however many times it's asked.
  const deliver = useCallback(async (tempId, makePayload) => {
    try {
      const payload = await makePayload();
      const saved = await sendMessage(conversationId, payload);
      setMessages((prev) => reconcileSent(prev, tempId, saved));
      if (typeof saved?.id === 'number') lastIdRef.current = Math.max(lastIdRef.current, saved.id);
      if (isRequestRef.current) setIsRequest(false);   // answering is accepting
      return true;
    } catch (e) {
      setMessages((prev) => markFailed(prev, tempId));
      if (e?.response?.status === 403) notify(t('dm.cantMessage'));
      return false;
    }
  }, [conversationId, t]);

  const optimisticBase = useCallback((tempId, extra) => ({
    id: tempId,
    client_id: tempId,
    sender: { id: meId, username: currentUser?.username, profile_picture: null },
    content: '',
    message_type: 'text',
    attachment: '',
    file_name: '',
    read: false,
    pending: true,
    reactions: [],
    created_at: new Date().toISOString(),
    ...extra,
  }), [meId, currentUser?.username]);

  const replyPreview = (m) => (m ? {
    id: m.id, sender_id: m.sender?.id, content: (m.content || '').slice(0, 120), message_type: m.message_type, is_deleted: !!m.is_deleted,
  } : null);

  // Text: no `sending` lock — each message carries its own temp id, so three
  // quick messages are three bubbles in flight, not one and a disabled button.
  const sendText = useCallback((content, reply) => {
    const tempId = nextTempId();
    const payload = { content, message_type: 'text', client_id: tempId, ...(reply ? { reply_to: reply.id } : {}) };
    setMessages((prev) => [...prev, optimisticBase(tempId, { content, reply_to: replyPreview(reply), _payload: payload })]);
    scrollToEndSoon();
    return deliver(tempId, () => payload);
  }, [deliver, optimisticBase]);

  // Media: show the local file at once, upload it in the background, then
  // send the message with just the URL.
  const sendMediaMessage = useCallback(async (media) => {
    const { localUri, message_type, file_name = '', duration = null } = media;
    const tempId = nextTempId();
    const reply = replyTo;
    setReplyTo(null);
    setMessages((prev) => [...prev, optimisticBase(tempId, {
      message_type, attachment: localUri, file_name, duration, reply_to: replyPreview(reply),
      _media: { ...media, reply_to: reply?.id || null },
    })]);
    setSending(true);
    scrollToEndSoon();
    await deliver(tempId, () => uploadMediaPayload(tempId, { ...media, reply_to: reply?.id || null }));
    setSending(false);
  }, [deliver, optimisticBase, replyTo]);

  const uploadMediaPayload = async (tempId, { localUri, uploadType, message_type, file_name = '', duration = null, mimeType, reply_to }) => {
    const uploaded = await uploadMedia({ uri: localUri, name: file_name || `chat_${Date.now()}`, mimeType }, uploadType);
    return { message_type, attachment: uploaded.url, file_name, duration, client_id: tempId, ...(reply_to ? { reply_to } : {}) };
  };

  const retry = useCallback((m) => {
    if (!m?.failed) return;
    setMessages((prev) => markRetrying(prev, m.id));
    if (m._media) deliver(m.id, () => uploadMediaPayload(m.id, m._media));
    else if (m._payload) deliver(m.id, () => m._payload);
    else deliver(m.id, () => ({ content: m.content, message_type: 'text', client_id: m.client_id || m.id }));
  }, [deliver]);

  const saveEdit = useCallback(async () => {
    const m = editing;
    const content = text.trim();
    setEditing(null);
    setText('');
    if (!m || !content || content === m.content) return;
    setMessages((prev) => patchMessage(prev, m.id, { content, edited_at: new Date().toISOString() }));
    try {
      const saved = await editMessage(conversationId, m.id, content);
      if (saved?.id) setMessages((prev) => patchMessage(prev, m.id, { content: saved.content, edited_at: saved.edited_at }));
    } catch (e) {
      setMessages((prev) => patchMessage(prev, m.id, { content: m.content, edited_at: m.edited_at || null }));
      notify(e?.response?.data?.code === 'too_late' ? t('dm.editTooLate') : t('dm.editFailed'));
    }
  }, [editing, text, conversationId, t]);

  const handleSend = useCallback(() => {
    if (editing) { saveEdit(); return; }
    const content = text.trim();
    if (!content) return;
    setText('');
    setShowEmoji(false);
    stopTyping();
    const reply = replyTo;
    setReplyTo(null);
    sendText(content, reply);
  }, [editing, saveEdit, text, stopTyping, replyTo, sendText]);

  // ── A message's actions ──
  const react = useCallback(async (m, emoji) => {
    if (typeof m.id !== 'number' || m.is_deleted) return;
    const before = m.reactions || [];
    setMessages((prev) => patchMessage(prev, m.id, { reactions: toggleReaction(before, emoji) }));
    try {
      const r = await reactToMessage(conversationId, m.id, emoji);
      if (Array.isArray(r?.reactions)) setMessages((prev) => patchMessage(prev, m.id, { reactions: r.reactions }));
    } catch {
      setMessages((prev) => patchMessage(prev, m.id, { reactions: before }));
      notify(t('dm.actionFailed'));
    }
  }, [conversationId, t]);

  const removeMessage = useCallback(async (m, scope) => {
    if (typeof m.id !== 'number') {   // a failed bubble: just let it go
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      return;
    }
    const ok = await confirmAction({
      title: scope === 'everyone' ? t('dm.deleteForEveryone') : t('dm.deleteForMe'),
      message: scope === 'everyone' ? t('dm.deleteForEveryoneBody') : t('dm.deleteForMeBody'),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    const before = messagesRef.current;
    setMessages((prev) => (scope === 'everyone'
      ? patchMessage(prev, m.id, { is_deleted: true, content: '', attachment: '', file_name: '', reactions: [] })
      : prev.filter((x) => x.id !== m.id)));
    try {
      await deleteMessage(conversationId, m.id, scope);
    } catch (e) {
      setMessages(before);
      notify(e?.response?.data?.code === 'too_late' ? t('dm.deleteTooLate') : t('dm.actionFailed'));
    }
  }, [conversationId, t]);

  const startReply = useCallback((m) => {
    setEditing(null);
    setReplyTo(m);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const startEdit = useCallback((m) => {
    setReplyTo(null);
    setEditing(m);
    setText(m.content || '');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const cancelComposerMode = useCallback(() => {
    if (editing) setText('');
    setEditing(null);
    setReplyTo(null);
  }, [editing]);

  const replyName = useCallback((r) => (r?.sender_id === meId ? t('dm.you') : otherName), [meId, otherName, t]);

  // ── The chat's own actions (the ⋮ menu, the request banner) ──
  const changeState = useCallback(async (changes) => {
    try {
      await setConversationState(conversationId, changes);
      announceDM({ type: 'state', conversation_id: conversationId });
      return true;
    } catch {
      notify(t('dm.actionFailed'));
      return false;
    }
  }, [conversationId, t]);

  const acceptRequest = useCallback(async () => {
    if (await changeState({ accepted: true })) {
      setIsRequest(false);
      isRequestRef.current = false;
      markRead();
    }
  }, [changeState, markRead]);

  const deleteChat = useCallback(async () => {
    const ok = await confirmAction({ title: t('dm.deleteChatTitle'), message: t('dm.deleteChatBody'),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), destructive: true });
    if (!ok) return;
    if (await changeState({ clear: true })) {
      writeCache(cacheKey, []);
      navigation.goBack();
    }
  }, [changeState, cacheKey, navigation, t]);

  const clearChat = useCallback(async () => {
    const ok = await confirmAction({ title: t('dm.clearTitle'), message: t('dm.clearBody'),
      confirmLabel: t('dm.clear'), cancelLabel: t('common.cancel'), destructive: true });
    if (!ok) return;
    if (await changeState({ clear: true })) {
      setMessages([]);
      writeCache(cacheKey, []);
      hasMoreOlderRef.current = false;
    }
  }, [changeState, cacheKey, t]);

  const block = useCallback(async () => {
    if (!otherUser?.id) return;
    const ok = await confirmAction({ title: t('dm.blockTitle', { name: otherName }), message: t('dm.blockBody'),
      confirmLabel: t('dm.block'), cancelLabel: t('common.cancel'), destructive: true });
    if (!ok) return;
    try {
      await blockUser(otherUser.id);
      announceDM({ type: 'state', conversation_id: conversationId });
      writeCache(cacheKey, []);
      navigation.goBack();
    } catch {
      notify(t('dm.actionFailed'));
    }
  }, [otherUser?.id, otherName, conversationId, cacheKey, navigation, t]);

  // ── In-chat search ──
  useEffect(() => {
    const q = searchQ.trim();
    if (!searchOpen || !q) { setResults(null); return undefined; }
    let cancelled = false;
    const id = setTimeout(() => {
      searchMessages(conversationId, q)
        .then((r) => { if (!cancelled) setResults(Array.isArray(r) ? r : []); })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 350);
    return () => { cancelled = true; clearTimeout(id); };
  }, [searchQ, searchOpen, conversationId]);

  const closeSearch = useCallback(() => { setSearchOpen(false); setSearchQ(''); setResults(null); }, []);

  const jumpTo = useCallback((m) => {
    closeSearch();
    const index = messagesRef.current.findIndex((x) => x.id === m.id);
    if (index < 0) { notify(t('dm.notLoaded')); return; }
    setHighlight(m.id);
    setTimeout(() => {
      try { listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }); } catch { /* the fallback below */ }
    }, 120);
    setTimeout(() => setHighlight(null), 2500);
  }, [closeSearch, t]);

  const onScrollToIndexFailed = useCallback(({ index, averageItemLength }) => {
    listRef.current?.scrollToOffset({ offset: Math.max(0, index * (averageItemLength || 60)), animated: true });
  }, []);

  // ── Attachments ──
  const attachImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { notify(t('chat.permissionRequired'), t('chat.permissionPhotos')); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7,
      });
      if (res.canceled || !res.assets?.length) return;
      // Compress on-device first (smaller upload). No base64 — we upload the
      // file and store only the URL.
      const processed = await compressImage(res.assets[0].uri, { width: 1080, quality: 0.6 });
      sendMediaMessage({
        localUri: processed.uri, uploadType: 'chat-image',
        message_type: 'image', mimeType: 'image/jpeg',
      });
    } catch {
      notify(t('common.error'), t('chat.attachImageFailed'));
    }
  }, [sendMediaMessage, t]);

  const attachFile = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const file = res.assets[0];
      if (file.size && file.size > MAX_FILE_BYTES) {
        notify(t('chat.fileTooLargeTitle'), t('chat.fileTooLargeBody'));
        return;
      }
      sendMediaMessage({
        localUri: file.uri, uploadType: 'chat-file', message_type: 'file',
        file_name: file.name || 'file', mimeType: file.mimeType || 'application/octet-stream',
      });
    } catch {
      notify(t('common.error'), t('chat.attachFileFailed'));
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
        notify(t('chat.savedTitle'), t('chat.savedBody', { name: msg.file_name }));
      }
    } catch {
      notify(t('common.error'), t('chat.openFileFailed'));
    }
  }, [t]);

  // ── Voice notes ──
  const startRecording = useCallback(async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { notify(t('chat.permissionRequired'), t('chat.permissionMic')); return; }
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
      notify(t('common.error'), t('chat.recordFailed'));
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
      notify(t('common.error'), t('chat.saveVoiceFailed'));
    }
  }, [sendMediaMessage, t]);

  const playAudio = useCallback(async (msg) => {
    try {
      if (soundRef.current) { await soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
      if (playingIdRef.current === msg.id) { setPlayingId(null); return; } // toggle off
      // Legacy base64 → write to a cache file first; URLs and local URIs play directly.
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
      // Another sound started (only one plays at a time): this note is done.
      sound.setOnFocusLost(() => {
        setPlayingId(null);
        sound.unloadAsync().catch(() => {});
        if (soundRef.current === sound) soundRef.current = null;
      });
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.didJustFinish) {
          setPlayingId(null);
          sound.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
      });
    } catch {
      notify(t('common.error'), t('chat.playVoiceFailed'));
      setPlayingId(null);
    }
  }, [t]);

  // Cleanup audio on unmount.
  useEffect(() => () => {
    clearInterval(recordTimerRef.current);
    recordingRef.current?.stopAndUnloadAsync?.().catch(() => {});
    soundRef.current?.unloadAsync?.().catch(() => {});
  }, []);

  const renderMessage = useCallback(({ item, index }) => {
    const isOwn = item.sender?.id === meId;
    const prev = messages[index - 1];
    return (
      <MessageRow
        item={item}
        isOwn={isOwn}
        showAvatar={!isOwn && (index === 0 || prev?.sender?.id !== item.sender?.id)}
        dayText={newDay(prev, item) ? dayLabel(t, item.created_at) : null}
        isPlaying={playingId === item.id}
        imgSide={imgSide}
        highlighted={highlight === item.id}
        replyName={replyName}
        t={t}
        onOpenImage={setViewer}
        onOpenFile={openFile}
        onPlayAudio={playAudio}
        onLongPress={setActionsFor}
        onRetry={retry}
        onReact={react}
      />
    );
  }, [meId, messages, playingId, imgSide, highlight, replyName, t, openFile, playAudio, retry, react]);

  const keyExtractor = useCallback((item) => String(item.id), []);
  // Don't yank the view to the bottom while we're prepending history.
  const onContentSizeChange = useCallback(() => {
    if (!loadingOlderRef.current && !highlight) listRef.current?.scrollToEnd({ animated: false });
  }, [highlight]);
  // Load older history when the user scrolls near the top.
  const onScroll = useCallback((e) => {
    if (e.nativeEvent.contentOffset.y <= 48) loadOlder();
  }, [loadOlder]);

  // The long-press sheet's rows, for this message.
  const a = actionsFor;
  const aSent = a && typeof a.id === 'number';
  const aOwn = a && a.sender?.id === meId;
  const actionRows = !a ? [] : a.failed ? [
    { key: 'retry', icon: 'refresh', label: t('dm.retry'), onPress: () => retry(a) },
    { key: 'discard', icon: 'trash-outline', label: t('dm.discard'), destructive: true, onPress: () => removeMessage(a, 'me') },
  ] : [
    ...(aSent && !a.is_deleted ? [{ key: 'reply', icon: 'arrow-undo-outline', label: t('dm.reply'), onPress: () => startReply(a) }] : []),
    ...(canEdit(a, meId) ? [{ key: 'edit', icon: 'create-outline', label: t('dm.edit'), onPress: () => startEdit(a) }] : []),
    ...(canDeleteForAll(a, meId) ? [{ key: 'delall', icon: 'trash-outline', label: t('dm.deleteForEveryone'), destructive: true, onPress: () => removeMessage(a, 'everyone') }] : []),
    ...(aSent ? [{ key: 'delme', icon: 'eye-off-outline', label: t('dm.deleteForMe'), destructive: true, onPress: () => removeMessage(a, 'me') }] : []),
    ...(aSent && !aOwn && !a.is_deleted ? [{ key: 'report', icon: 'flag-outline', label: t('dm.report'), destructive: true, onPress: () => setReportId(a.id) }] : []),
  ];
  const chooseAction = (row) => {
    setActionsFor(null);
    setTimeout(() => row.onPress(), 180);
  };

  const headerOptions = [
    { key: 'search', icon: 'search', label: t('dm.searchInChat'), onPress: () => setSearchOpen(true) },
    { key: 'mute', icon: muted ? 'notifications' : 'notifications-off', label: muted ? t('dm.unmute') : t('dm.mute'),
      onPress: async () => { const next = !muted; setMuted(next); if (!(await changeState({ muted: next }))) setMuted(!next); } },
    ...(isRequest ? [] : [{ key: 'archive', icon: archived ? 'unarchive' : 'archive', label: archived ? t('dm.unarchive') : t('dm.archive'),
      onPress: async () => { const next = !archived; setArchived(next); if (!(await changeState({ archived: next }))) setArchived(!next); } }]),
    { key: 'clear', icon: 'delete-sweep', label: t('dm.clearChat'), destructive: true, onPress: clearChat },
    ...(otherUser?.id ? [{ key: 'block', icon: 'block', label: t('dm.block'), destructive: true, onPress: block }] : []),
  ];

  const status = presenceLine(t, { ...presence, typing: otherTyping });

  return (
    <View style={styles.root}>
    <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.7)" />
    <View style={[styles.container, kbHeight > 0 ? { marginBottom: kbHeight } : null]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.headerSafe}>
        <LinearGradient colors={['rgba(16,46,80,0.95)', 'rgba(10,22,40,0.80)']} style={styles.header}>
          <TouchableOpacity onPress={() => (searchOpen ? closeSearch() : navigation.goBack())} style={styles.backBtn}
            hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          {searchOpen ? (
            <TextInput value={searchQ} onChangeText={setSearchQ} autoFocus placeholder={t('dm.searchInChat')}
              placeholderTextColor={colors.placeholder} style={styles.searchInput} returnKeyType="search"
              testID="chat-search" />
          ) : (
            <>
              <View>
                <Image
                  source={otherUser?.profile_picture ? { uri: otherUser.profile_picture } : DEFAULT_AVATAR}
                  placeholder={DEFAULT_AVATAR} contentFit="cover" transition={150} style={styles.headerAvatar}
                />
                {presence.online ? <View style={styles.headerDot} /> : null}
              </View>
              <View style={styles.headerInfo}>
                <Text style={styles.headerName} numberOfLines={1}>{otherName}</Text>
                {status ? (
                  <Text style={[styles.headerStatus, (otherTyping || presence.online) && styles.headerStatusLive]}
                    numberOfLines={1} testID="chat-presence">{status}</Text>
                ) : null}
              </View>
              {muted ? <Ionicons name="notifications-off" size={16} color={colors.textMuted} /> : null}
              <TouchableOpacity onPress={() => setHeaderMenu(true)} style={styles.menuBtn} hitSlop={8}
                accessibilityRole="button" accessibilityLabel={t('dm.chatOptions')} testID="chat-menu">
                <Ionicons name="ellipsis-vertical" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </>
          )}
        </LinearGradient>
      </SafeAreaView>

      {isRequest && !searchOpen ? (
        <View style={styles.requestBanner} testID="request-banner">
          <Text style={styles.requestTitle}>{t('dm.requestTitle', { name: otherName })}</Text>
          <Text style={styles.requestBody}>{t('dm.requestBody')}</Text>
          <View style={styles.requestActions}>
            <TouchableOpacity style={styles.requestBtn} onPress={block} testID="request-block">
              <Text style={[styles.requestBtnText, styles.dangerText]}>{t('dm.block')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.requestBtn} onPress={deleteChat} testID="request-delete">
              <Text style={[styles.requestBtnText, styles.dangerText]}>{t('common.delete')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.requestBtn, styles.requestAccept]} onPress={acceptRequest} testID="request-accept">
              <Text style={[styles.requestBtnText, styles.acceptText]}>{t('dm.accept')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {searchOpen ? (
        <FlatList
          data={results || []}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.searchList}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.searchRow} onPress={() => jumpTo(item)} testID={`search-hit-${item.id}`}>
              <Text style={styles.searchWho}>
                {item.sender?.id === meId ? t('dm.you') : otherName} · {dayLabel(t, item.created_at)} {fmtTime(item.created_at)}
              </Text>
              <Text style={styles.searchText} numberOfLines={3}>{item.content}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.searchEmpty}>
              {!searchQ.trim() ? t('dm.searchHint') : results === null ? t('dm.searching') : t('dm.noResults')}
            </Text>
          }
        />
      ) : loading && messages.length === 0 ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={keyExtractor}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={onContentSizeChange}
          onScroll={onScroll}
          onScrollToIndexFailed={onScrollToIndexFailed}
          scrollEventThrottle={64}
          maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
          ListHeaderComponent={
            loadingOlder ? <ActivityIndicator size="small" color={colors.primary} style={styles.olderSpinner} /> : null
          }
          ListFooterComponent={otherTyping ? (
            <View style={styles.typingBubble} testID="typing-bubble">
              <Text style={styles.typingText}>{t('dm.typing')}</Text>
            </View>
          ) : null}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{t('dm.sayHello', { name: otherName })}</Text>
            </View>
          }
        />
      )}

      {/* Emoji panel */}
      {showEmoji && !searchOpen && (
        <View style={styles.emojiPanel}>
          <ScrollView contentContainerStyle={styles.emojiGrid} keyboardShouldPersistTaps="handled">
            {EMOJIS.map((e, i) => (
              <TouchableOpacity key={i} style={styles.emojiBtn} onPress={() => setText((v) => v + e)}>
                <Text style={styles.emojiText}>{e}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Replying to / editing */}
      {(replyTo || editing) && !searchOpen ? (
        <View style={styles.contextBar} testID="composer-context">
          <Ionicons name={editing ? 'create-outline' : 'arrow-undo-outline'} size={18} color={colors.accent} />
          <View style={styles.contextBody}>
            <Text style={styles.contextTitle} numberOfLines={1}>
              {editing ? t('dm.editing') : t('dm.replyingTo', { name: replyTo.sender?.id === meId ? t('dm.you') : otherName })}
            </Text>
            <Text style={styles.contextText} numberOfLines={1}>{previewText(t, editing || replyTo)}</Text>
          </View>
          <TouchableOpacity onPress={cancelComposerMode} hitSlop={10} accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Input bar */}
      {!searchOpen ? (
      <SafeAreaView edges={kbHeight > 0 ? ['left', 'right'] : ['left', 'right', 'bottom']} style={styles.inputSafe}>
      <View style={styles.inputBar}>
        {isRecording ? (
          <>
            <TouchableOpacity style={styles.iconBtn} onPress={() => stopRecording(true)} accessibilityLabel={t('common.cancel')}>
              <Ionicons name="trash-outline" size={24} color={colors.error} />
            </TouchableOpacity>
            <View style={styles.recordingInfo}>
              <View style={styles.recDot} />
              <Text style={styles.recText}>{t('dm.recording', { time: fmtDuration(recordSecs) })}</Text>
            </View>
            <TouchableOpacity style={styles.sendBtn} onPress={() => stopRecording(false)} activeOpacity={0.8} accessibilityLabel={t('dm.send')}>
              <Ionicons name="send" size={18} color={colors.white} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            {!editing ? (
              <>
                <TouchableOpacity style={styles.iconBtn} onPress={() => setShowEmoji((s) => !s)} accessibilityLabel={t('dm.emoji')}>
                  <Ionicons name={showEmoji ? 'close' : 'happy-outline'} size={24} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={onAttachPress} disabled={sending} accessibilityLabel={t('dm.attach')}>
                  <Ionicons name="add-circle-outline" size={26} color={colors.textSecondary} />
                </TouchableOpacity>
              </>
            ) : null}
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={t('chat.messagePlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={text}
              onChangeText={onChangeText}
              onFocus={() => setShowEmoji(false)}
              onBlur={stopTyping}
              multiline
              maxLength={5000}
              testID="chat-input"
            />
            {text.trim() || editing ? (
              <TouchableOpacity style={styles.sendBtn} onPress={handleSend} activeOpacity={0.8}
                accessibilityLabel={editing ? t('dm.saveEdit') : t('dm.send')} testID="chat-send">
                <Ionicons name={editing ? 'checkmark' : 'send'} size={editing ? 22 : 18} color={colors.white} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.sendBtn} onPress={startRecording} disabled={sending} activeOpacity={0.8}
                accessibilityLabel={t('dm.recordVoice')}>
                <Ionicons name="mic" size={20} color={colors.white} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
      </SafeAreaView>
      ) : null}

      {/* Full-screen image viewer */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={styles.viewerRoot} onPress={() => setViewer(null)}>
          <Image source={{ uri: viewer }} style={styles.viewerImage} contentFit="contain" transition={150} />
          <View style={styles.viewerClose}><Ionicons name="close" size={28} color={colors.white} /></View>
        </Pressable>
      </Modal>

      {/* A message's actions: react, reply, edit, delete, report */}
      <Modal visible={!!actionsFor} transparent animationType="fade" onRequestClose={() => setActionsFor(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionsFor(null)}>
          <Pressable style={styles.actionsCard} testID="message-actions">
            {aSent && !a?.is_deleted ? (
              <View style={styles.reactRow}>
                {REACTIONS.map((e) => {
                  const mine = (a.reactions || []).some((r) => r.mine && r.emoji === e);
                  return (
                    <TouchableOpacity key={e} style={[styles.reactBtn, mine && styles.reactBtnMine]}
                      onPress={() => { setActionsFor(null); react(a, e); }} accessibilityLabel={e} testID={`react-${e}`}>
                      <Text style={styles.reactEmoji}>{e}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
            {actionRows.map((row) => (
              <TouchableOpacity key={row.key} style={styles.actionRow} onPress={() => chooseAction(row)} testID={`action-${row.key}`}>
                <Ionicons name={row.icon} size={20} color={row.destructive ? colors.error : colors.textPrimary} />
                <Text style={[styles.actionText, row.destructive && styles.dangerText]}>{row.label}</Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <ChoiceSheet visible={headerMenu} title={otherName} options={headerOptions}
        onClose={() => setHeaderMenu(false)} cancelLabel={t('common.cancel')} />

      <ReportModal visible={!!reportId} onClose={() => setReportId(null)} contentType="message" objectId={reportId} />

      {/* Attachment sheet: choose what to send */}
      <Modal visible={attachSheet} transparent animationType="slide" onRequestClose={() => setAttachSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setAttachSheet(false)}>
          <Pressable style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('dm.sendTo', { name: otherName })}</Text>
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
  italic: { fontStyle: 'italic' },
  dangerText: { color: colors.error },
  headerSafe: { backgroundColor: 'rgba(16,46,80,0.95)' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, minHeight: 56 },
  backBtn: { marginRight: spacing.xs },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: 'rgba(244,162,97,0.4)' },
  headerDot: {
    position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.success, borderWidth: 2, borderColor: '#102E50',
  },
  headerInfo: { flex: 1 },
  headerName: { ...typography.h3, color: colors.textPrimary },
  headerStatus: { ...typography.caption, color: colors.textMuted },
  headerStatusLive: { color: colors.success },
  menuBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16, paddingVertical: spacing.xs },

  requestBanner: {
    margin: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: 'rgba(16,46,80,0.92)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.5)',
  },
  requestTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '800' },
  requestBody: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  requestActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  requestBtn: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.full,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  requestAccept: { backgroundColor: colors.accent, borderColor: colors.accent },
  requestBtnText: { ...typography.label, fontWeight: '700' },
  acceptText: { color: '#0A1628' },

  listContent: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md, flexGrow: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
  olderSpinner: { marginVertical: 10 },
  dayWrap: { alignItems: 'center', marginVertical: spacing.sm },
  dayText: {
    ...typography.caption, color: colors.textSecondary, fontWeight: '700', overflow: 'hidden',
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full, backgroundColor: 'rgba(16,46,80,0.8)',
  },
  msgRow: { flexDirection: 'row', marginVertical: 2, alignItems: 'flex-end' },
  msgRowOwn: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  avatarPlaceholder: { width: 30, marginRight: spacing.xs },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface },
  bubbleCol: { maxWidth: '78%' },
  bubbleColOwn: { alignItems: 'flex-end' },
  bubbleColOther: { alignItems: 'flex-start' },
  bubble: { borderRadius: radius.lg, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, ...shadows.sm },
  bubbleMedia: { padding: 4 },
  bubblePending: { opacity: 0.75 },
  bubbleFailed: { borderWidth: 1, borderColor: colors.error },
  bubbleHighlight: { borderWidth: 2, borderColor: colors.accent },
  bubbleOwn: { backgroundColor: '#15407A', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: 'rgba(18,30,46,0.92)', borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)' },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextOwn: { color: colors.white },
  bubbleTextOther: { color: colors.textPrimary },
  captionGap: { marginTop: spacing.xs },
  bubbleTime: { fontSize: 10, marginTop: 3 },
  bubbleTimeOwn: { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  bubbleTimeOther: { color: colors.textMuted },
  deletedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, alignSelf: 'flex-end' },
  failedText: { fontSize: 11, color: colors.error, fontWeight: '700' },
  quote: { borderLeftWidth: 3, paddingLeft: spacing.xs, paddingVertical: 2, marginBottom: 4, borderRadius: 4 },
  quoteOwn: { borderLeftColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.08)' },
  quoteOther: { borderLeftColor: colors.accent, backgroundColor: 'rgba(244,162,97,0.08)' },
  quoteName: { fontSize: 12, fontWeight: '800', color: colors.accent },
  quoteText: { fontSize: 13, color: colors.textSecondary },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -4, marginBottom: 2 },
  reactionsOwn: { justifyContent: 'flex-end', marginRight: 6 },
  reactionsOther: { marginLeft: 6 },
  reactionChip: {
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.full, backgroundColor: 'rgba(16,46,80,0.95)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  reactionChipMine: { borderColor: colors.accent },
  reactionText: { fontSize: 13, color: colors.textPrimary },
  typingBubble: {
    alignSelf: 'flex-start', marginLeft: 34, marginTop: 4, paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: radius.lg, backgroundColor: 'rgba(18,30,46,0.92)',
  },
  typingText: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic' },

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

  searchList: { padding: spacing.md, width: '100%', maxWidth: 900, alignSelf: 'center' },
  searchRow: {
    padding: spacing.sm, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: 'rgba(16,46,80,0.85)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  searchWho: { ...typography.caption, color: colors.textMuted, marginBottom: 2 },
  searchText: { ...typography.body, color: colors.textPrimary },
  searchEmpty: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },

  emojiPanel: { height: 220, backgroundColor: 'rgba(16,46,80,0.97)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm },
  emojiBtn: { width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 26 },

  contextBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    backgroundColor: 'rgba(16,46,80,0.97)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)',
  },
  contextBody: { flex: 1 },
  contextTitle: { ...typography.caption, color: colors.accent, fontWeight: '800' },
  contextText: { ...typography.caption, color: colors.textSecondary },

  inputSafe: { backgroundColor: 'rgba(16,46,80,0.95)' },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', gap: spacing.xs,
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

  viewerRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 48, right: 20 },

  actionsCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.xl, alignSelf: 'center', width: '100%', maxWidth: 420,
    backgroundColor: 'rgba(16,46,80,0.98)', borderRadius: radius.xl, padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.35)', ...shadows.lg,
  },
  reactRow: {
    flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.xs, marginBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  reactBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  reactBtnMine: { backgroundColor: 'rgba(244,162,97,0.25)' },
  reactEmoji: { fontSize: 26 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm },
  actionText: { ...typography.body, color: colors.textPrimary },

  // ── Attachment sheet ──
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
