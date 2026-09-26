import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, AppState, Modal,
  ScrollView, Pressable, useWindowDimensions, Animated, PanResponder,
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
import * as Haptics from 'expo-haptics';
import {
  createSound, setAudioModeAsync, requestRecordingPermissionsAsync,
  Recording, VOICE_NOTE_RECORDING_OPTIONS,
} from '../services/audioPlayer';
import { compressImage } from '../services/imageProcessing';
import {
  fetchGroupDetails, fetchGroupPosts, sendGroupMessage, editGroupMessage, markGroupRead,
  leaveGroup, requestJoinGroup, reactToGroupPost, deleteGroupPost, setGroupPostingPolicy,
  pinGroupMessage, unpinGroupMessage, searchGroupMessages, fetchMessageReceipts, setGroupJoinQuestion,
  fetchGroupMessageContext, fetchGroupPostsBefore, fetchGroupPostsAfter, setGroupSlowMode,
  fetchGroupMembers, muteGroup, setGroupMine,
} from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import { createGroupSocket } from '../services/groupSocket';
import { useAuth } from '../context/useAuth';
import RotatingBackground from '../components/RotatingBackground';
import ReportModal from '../components/ReportModal';
import BookClubBanner from '../components/BookClubBanner';
import ChoiceSheet from '../components/ChoiceSheet';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { peekCache, readCache, writeCache } from '../utils/screenCache';
import { confirmAction, notify } from '../utils/adminConfirm';
import {
  mergeMessages, freshPage, cacheableGroupMessages, groupChatKey, replyLabel, isTemp,
  absorb, applyReaction, settle, splitMentions, mentionQuery, insertMention, firstUnreadIndex,
} from '../utils/groupChat';
import { dayLabel, newDay } from '../utils/dmView';
import { nextTempId } from '../utils/chatMessages';
import { announceDM } from '../services/dmSocket';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// react-native-blurhash is a native module: it isn't present in Expo Go, or in
// any build made before it was added. Its import runs a TurboModule lookup that
// throws if the native binary lacks it — so guard the require and treat blurhash
// as an optional enhancement that only turns on once an EAS build includes it.
let Blurhash = null;
try { Blurhash = require('react-native-blurhash').Blurhash; } catch { Blurhash = null; }
// Realtime arrives over the WebSocket; the poll is just a safety net that
// catches anything missed during a reconnect — slow while the socket is up,
// quick while it's down. It asks only for what's newer than we hold.
const POLL_LIVE_MS = 30000;
const POLL_MS = 5000;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const EMOJIS = ['😀','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😜','🤪','🤔','🤭','😎','🥳','😢','😭','😤','😡','🥺','😱','🙏','👍','👎','👏','🙌','🤝','💪','🫶','❤️','🧡','💛','💚','💙','💜','🔥','✨','🎉','💯','✅','🕊️','📖','🎵','☀️','⭐'];
const REACTIONS = ['❤️', '👍', '🙏', '🎵', '😂', '🔥']; // quick-react row
const SWIPE_TRIGGER = 56; // px of right-swipe to fire a reply

// Voice notes recorded mono at a low bitrate — plenty for speech, far smaller
// than HIGH_QUALITY, so they upload and load fast. Format stays .m4a/AAC.
const isData = (uri) => typeof uri === 'string' && uri.startsWith('data:');

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (d) => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + fmtTime(d);
// Slow mode, in words: 10s, 1 min, 5 min.
const slowLabel = (s, t) => (s >= 60 ? t('group.detail.minutes', { n: Math.round(s / 60) }) : t('group.detail.seconds', { n: s }));
const SLOW_CHOICES = [0, 10, 30, 60, 300];

const fmtDuration = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round((s || 0) % 60)).padStart(2, '0')}`;

/**
 * One chat row: swipe-right-to-reply (PanResponder, no GestureHandlerRootView),
 * WhatsApp-style delivery state (clock → double-tick, or failed/tap-to-retry),
 * an upload spinner over in-flight images, and emoji reactions.
 * Memoised on primitive props and stable callbacks: a new message, a poll or
 * a keystroke re-renders only the rows that changed, not the whole chat.
 */
const GroupMessageRow = memo(({
  item, isOwn, showName, isPlaying,
  onReply, onLongPress, onOpenImage, onOpenFile, onPlayAudio, onToggleReaction, onRetry, onDoubleTap, highlighted,
}) => {
  const { t } = useI18n();
  const { width: winW } = useWindowDimensions();
  const imgSide = winW * 0.6;  // chat image bubble, 60% of the live window width
  const lastTapRef = useRef(0);
  const burst = useRef(new Animated.Value(0)).current; // double-tap ❤️ pop
  // Natural aspect ratio for image bubbles, learned on load (clamped so extreme
  // panoramas/columns stay sensible). Until known, a square placeholder shows.
  const [imgRatio, setImgRatio] = React.useState(null);
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

  const onTap = () => {
    if (failed) { onRetry(item); return; }
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      // Only animate a burst when adding the heart (not when toggling it off).
      if (myReaction !== '❤️') {
        burst.setValue(0);
        Animated.sequence([
          Animated.spring(burst, { toValue: 1, friction: 4, useNativeDriver: true }),
          Animated.timing(burst, { toValue: 0, duration: 350, delay: 250, useNativeDriver: true }),
        ]).start();
      }
      onDoubleTap?.(item);
    } else {
      lastTapRef.current = now;
    }
  };

  return (
    <View style={styles.swipeWrap}>
      <Animated.View style={[styles.replyHint, { opacity: hintOpacity, transform: [{ scale: hintOpacity }] }]}>
        <Ionicons name="arrow-undo" size={18} color={colors.accent} />
      </Animated.View>

      <Animated.View style={{ transform: [{ translateX: tx }] }} {...pan.panHandlers}>
        <Pressable
          onLongPress={() => onLongPress(item)} delayLongPress={250}
          onPress={onTap}
          style={[styles.msgRow, isOwn ? styles.msgRowOwn : styles.msgRowOther, highlighted && styles.msgRowHighlight]}
        >
          {!isOwn && (
            <View style={styles.avatarPlaceholder}>
              {showName && (
                <Image source={item.user?.profile_picture ? { uri: item.user.profile_picture } : DEFAULT_AVATAR} placeholder={DEFAULT_AVATAR} contentFit="cover" transition={120} style={styles.msgAvatar} />
              )}
            </View>
          )}
          <View style={styles.bubbleCol}>
            <Animated.Text
              pointerEvents="none"
              style={[styles.burstHeart, {
                opacity: burst,
                transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.6] }) }],
              }]}
            >❤️</Animated.Text>
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
                  <Image
                    source={{ uri: item.attachment }}
                    style={[styles.imageMsg, { width: imgSide, height: imgSide }, imgRatio ? { aspectRatio: imgRatio, height: undefined } : null]}
                    contentFit="cover"
                    transition={200}
                    placeholder={item.attachment_blurhash ? { blurhash: item.attachment_blurhash } : undefined}
                    placeholderContentFit="cover"
                    onLoad={(e) => {
                      const s = e?.source;
                      if (s?.width && s?.height) setImgRatio(Math.max(0.62, Math.min(1.9, s.width / s.height)));
                    }}
                  />
                  {sending && <View style={styles.uploadOverlay}><ActivityIndicator color="#fff" /></View>}
                </Pressable>
              ) : type === 'file' ? (
                <Pressable style={styles.fileRow} onPress={() => onOpenFile(item)} disabled={sending}>
                  <View style={styles.fileIcon}><Ionicons name="document-text" size={22} color={colors.primary} /></View>
                  <Text style={[styles.fileName, isOwn ? styles.txtOwn : styles.txtOther]} numberOfLines={1}>{item.file_name || t('group.preview.message')}</Text>
                  <Ionicons name="download-outline" size={18} color={isOwn ? 'rgba(255,255,255,0.8)' : colors.textMuted} />
                </Pressable>
              ) : type === 'audio' ? (
                <Pressable style={styles.audioRow} onPress={() => onPlayAudio(item)} disabled={sending}>
                  <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={30} color={isOwn ? colors.white : colors.primary} />
                  <View style={styles.audioBar}><View style={[styles.audioBarFill, { backgroundColor: isOwn ? 'rgba(255,255,255,0.55)' : colors.primary }]} /></View>
                  <Text style={[styles.audioDuration, isOwn ? styles.txtOwn : styles.txtOther]}>{fmtDuration(item.duration)}</Text>
                </Pressable>
              ) : null}

              {!!item.content && (
                <Text style={[styles.bubbleText, isOwn ? styles.txtOwn : styles.txtOther, type === 'image' && { marginTop: spacing.xs }]}>
                  {splitMentions(item.content).map((part, i) => (part.mention
                    ? <Text key={i} style={styles.mention}>{part.text}</Text>
                    : part.text))}
                </Text>
              )}

              <View style={styles.metaRow}>
                {item.edited_at && (
                  <Text style={[styles.bubbleTime, isOwn ? styles.timeOwn : styles.timeOther]}>{t('group.detail.editedLabel')} · </Text>
                )}
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
});
GroupMessageRow.displayName = 'GroupMessageRow';

/** The category-specific fields a community carries (conference, genre, ...).
 *  Driven by the category's field_schema, so a user-created kind renders its
 *  own fields with no code here. */
const CommunityDetails = ({ group, styles }) => {
  const schema = group?.category_detail?.field_schema || [];
  const rows = schema
    .map((f) => ({ label: f.label, value: group?.details?.[f.key] }))
    .filter((r) => r.value !== undefined && r.value !== null && String(r.value).trim() !== '');
  if (!rows.length) return null;
  return (
    <View style={styles.detailBlock}>
      {rows.map((r) => (
        <View style={styles.detailRow} key={r.label}>
          <Text style={styles.detailLabel}>{r.label}</Text>
          <Text style={styles.detailValue} numberOfLines={2}>{String(r.value)}</Text>
        </View>
      ))}
    </View>
  );
};

const GroupDetail = ({ route, navigation }) => {
  const { t } = useI18n();
  const { groupSlug, group: initialGroup } = route.params;
  const { currentUser } = useAuth();
  const kbHeight = useKeyboardHeight(); // float the composer above the keyboard (edge-to-edge safe)

  // Open on the last chat we saw here — the group and its newest messages —
  // straight from memory when this session has them, from disk otherwise
  // (below); the network then refreshes it in place instead of a spinner.
  const cacheKey = groupChatKey(currentUser?.id, groupSlug);
  const cached = peekCache(cacheKey);
  const seed = initialGroup || cached?.group || null;
  const [group, setGroup] = useState(seed);
  const [isMember, setIsMember] = useState(seed?.is_member || false);
  const [isAdmin, setIsAdmin] = useState(seed?.is_admin || false);
  const [isModerator, setIsModerator] = useState(seed?.is_moderator || false);
  const [requested, setRequested] = useState(seed?.has_pending_request || false);
  const [messages, setMessages] = useState(() => cached?.messages ?? []);
  // With the group in hand (from the list or the cache) the chat shell renders
  // at once instead of blocking on a full reload.
  const [loading, setLoading] = useState(!seed);
  const [firstLoad, setFirstLoad] = useState(() => !cached?.messages?.length); // nothing to show yet
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [menuMsg, setMenuMsg] = useState(null); // long-press action menu target
  const [editingMsg, setEditingMsg] = useState(null); // message being edited
  const [attachSheet, setAttachSheet] = useState(false); // luxury "what to send" sheet
  const [menuSheet, setMenuSheet] = useState(false);      // group options sheet
  const [leaveConfirm, setLeaveConfirm] = useState(false);// leave-group confirm
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [playingId, setPlayingId] = useState(null);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]); // usernames currently typing
  const [onlineIds, setOnlineIds] = useState([]);     // user ids currently connected (older servers)
  const [onlineCount, setOnlineCount] = useState(null); // how many are here (the server counts)
  const [showJump, setShowJump] = useState(false);    // "jump to newest" FAB
  const [viewingHistory, setViewingHistory] = useState(false); // showing a search-context window, not live
  const [highlightId, setHighlightId] = useState(null); // message to briefly flash after a jump
  const [pinnedMsg, setPinnedMsg] = useState(seed?.pinned_message || null);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);
  const [receipts, setReceipts] = useState(null); // { loading, count, readers } | null
  const [joinAnswer, setJoinAnswer] = useState(null); // string when the join-question modal is open
  const [jqEditor, setJqEditor] = useState(null);     // string when the admin join-question editor is open
  const [reportMsg, setReportMsg] = useState(null);   // message being reported
  const [slowSheet, setSlowSheet] = useState(false);   // admin: slow mode choices
  const [notifySheet, setNotifySheet] = useState(false); // my notifications for this group
  const [unreadId, setUnreadId] = useState(null);      // where "unread messages" starts
  const [mentionHits, setMentionHits] = useState([]);  // members matching the @name being typed

  const listRef = useRef(null);
  const atBottomRef = useRef(true);      // is the chat scrolled to the newest message?
  const viewingHistoryRef = useRef(false); // mirrors viewingHistory for socket callbacks
  const highlightTimerRef = useRef(null);
  const messagesRef = useRef([]);          // latest messages, for cursor callbacks
  const hasNewerRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const pollRef = useRef(null);
  const socketRef = useRef(null);        // realtime chat socket
  const typingTimersRef = useRef({});    // per-user auto-expire timers
  const myTypingRef = useRef({ active: false, idle: null }); // outbound typing throttle
  // Only members may read the chat (public groups included). Mirrored into a ref
  // so the poll/AppState callbacks can gate without re-subscribing.
  const canReadRef = useRef(seed?.is_member || false);
  const appState = useRef(AppState.currentState);
  const pageRef = useRef(1);
  const freshRef = useRef(false);        // has a first page come from the server yet?
  // When I'd last read it, as of opening (marking read moves it on the server).
  const lastReadRef = useRef(seed?.my_settings?.last_read_at || null);
  const liveRef = useRef(false);         // is the socket up (so the poll can be slow)?
  const playingIdRef = useRef(null);
  useEffect(() => { playingIdRef.current = playingId; }, [playingId]);
  const meIdRef = useRef(currentUser?.id);
  const groupRef = useRef(seed);
  const slowSecondsRef = useRef(seed?.slow_mode_seconds || 0);
  useEffect(() => { groupRef.current = group; slowSecondsRef.current = group?.slow_mode_seconds || 0; }, [group]);

  // Cold start: the disk copy, if the network hasn't answered first.
  useEffect(() => {
    if (cached) return undefined;
    let cancelled = false;
    readCache(cacheKey).then((disk) => {
      if (cancelled || !disk) return;
      if (disk.group) {
        setGroup((g) => g || disk.group);
        if (!initialGroup) {
          setIsMember(!!disk.group.is_member); setIsAdmin(!!disk.group.is_admin);
          setIsModerator(!!disk.group.is_moderator); canReadRef.current = !!disk.group.is_member;
          setPinnedMsg((p) => p || disk.group.pinned_message || null);
        }
        setLoading(false);
      }
      if (Array.isArray(disk.messages) && disk.messages.length && !freshRef.current) {
        setMessages((prev) => (prev.length ? prev : disk.messages));
        setFirstLoad(false);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 60);
      }
    });
    return () => { cancelled = true; };
  }, [cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const recordingRef = useRef(null);
  const recordTimerRef = useRef(null);
  const recordStartRef = useRef(0);
  const soundRef = useRef(null);

  // ── Load ──
  const loadPosts = useCallback(async (silent = false) => {
    try {
      // After the first page, a poll asks only for what's newer than the
      // newest message held — a few rows, not the page of 30 every time.
      const newest = [...messagesRef.current].reverse().find((m) => !isTemp(m) && typeof m.id === 'number');
      if (silent && freshRef.current && newest) {
        const res = await fetchGroupPostsAfter(groupSlug, newest.id);
        const newer = res?.results ?? [];
        if (!canReadRef.current) return undefined;
        if (res?.has_more) { freshRef.current = false; return loadPosts(true); } // far behind: take the newest page
        if (newer.length) {
          setMessages((prev) => mergeMessages(prev, newer));
          if (atBottomRef.current) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
        }
        return undefined;
      }
      const res = await fetchGroupPosts(groupSlug, 1);
      // Removed (or left) while this was in flight: what it brought isn't theirs to see.
      if (!canReadRef.current) return undefined;
      const incoming = (res?.results ?? []).slice().reverse();
      setHasEarlier(!!res?.next);
      hasNewerRef.current = false; // this is the live newest page
      const first = !freshRef.current;
      freshRef.current = true;
      setMessages((prev) => {
        // The first page replaces what the cache painted (a message deleted
        // while away goes); after that, pages merge. Sending / failed bubbles
        // always stay.
        const merged = first ? freshPage(prev, incoming) : mergeMessages(prev, incoming);
        // Opening on something new: a line where it starts, and (if it's more
        // than a screenful up) the chat opens there rather than at the end.
        const idx = first ? firstUnreadIndex(merged, lastReadRef.current, meIdRef.current) : -1;
        if (idx >= 0) {
          setUnreadId(merged[idx].id);
          if (merged.length - idx > 6) {
            atBottomRef.current = false;
            setTimeout(() => {
              try { listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.1, animated: false }); } catch { /* best effort */ }
            }, 120);
            return merged;
          }
        }
        if (!silent && merged.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 60);
        return merged;
      });
    } catch { /* ignore */ }
    return undefined;
  }, [groupSlug]);

  // Keep the cache current with what's on screen (debounced: a burst of
  // messages is one write). Not while showing a search's window of history.
  useEffect(() => {
    if (!group || viewingHistory) return undefined;
    const handle = setTimeout(() => writeCache(cacheKey, {
      group, messages: isMember ? cacheableGroupMessages(messages) : [],
    }), 500);
    return () => clearTimeout(handle);
  }, [messages, group, isMember, viewingHistory, cacheKey]);

  const loadGroup = useCallback(async () => {
    // Only members can read messages (public groups too). If the list already
    // told us the user is a member, start fetching messages right now — in
    // parallel with the group-details request — so the chat fills in without
    // waiting for two sequential round-trips.
    const canReadNow = !!canReadRef.current;
    const postsPromise = canReadNow ? loadPosts(messagesRef.current.length > 0) : null;
    try {
      const g = await fetchGroupDetails(groupSlug);
      setGroup(g);
      setIsMember(g.is_member);
      setIsAdmin(g.is_admin);
      setIsModerator(g.is_moderator);
      setRequested(!!g.has_pending_request);
      setPinnedMsg(g.pinned_message || null);
      canReadRef.current = !!g.is_member;
      // No longer a member (removed, or left elsewhere): the cached chat goes.
      if (!g.is_member) setMessages([]);
      if (!postsPromise && g.is_member) await loadPosts();
    } catch {
      // With something on screen (the list's copy, or the cache), keep it and
      // say nothing — the poll catches up. Only an empty screen is worth a word.
      if (!initialGroup && !groupRef.current) notify(t('common.error'), t('group.detail.loadFailed'));
    } finally {
      if (postsPromise) await postsPromise.catch(() => {});
      setLoading(false);
      setFirstLoad(false);
    }
  }, [groupSlug, loadPosts, initialGroup, t]);

  // Cursor loads from the ends of the loaded window (works from a search-context
  // window too, unlike page numbers).
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current) return;
    const oldest = messagesRef.current[0];
    if (!oldest || String(oldest.id).startsWith('temp_')) return;
    loadingOlderRef.current = true;
    try {
      const res = await fetchGroupPostsBefore(groupSlug, oldest.id);
      const older = (res?.results ?? []).slice().reverse(); // was newest-first → ascending
      if (older.length) setMessages((prev) => mergeMessages(older, prev));
      setHasEarlier(!!res?.has_more);
    } catch { /* ignore */ } finally { loadingOlderRef.current = false; }
  }, [groupSlug]);

  const loadNewer = useCallback(async () => {
    if (loadingNewerRef.current || !hasNewerRef.current) return;
    const arr = messagesRef.current;
    const newest = arr[arr.length - 1];
    if (!newest || String(newest.id).startsWith('temp_')) return;
    loadingNewerRef.current = true;
    try {
      const res = await fetchGroupPostsAfter(groupSlug, newest.id);
      const newer = res?.results ?? []; // already ascending
      // Don't let the content-size auto-scroll yank past the batch we just added.
      if (newer.length) { atBottomRef.current = false; setMessages((prev) => mergeMessages(newer, prev)); }
      const more = !!res?.has_more;
      hasNewerRef.current = more;
      if (!more) { viewingHistoryRef.current = false; setViewingHistory(false); } // caught up to live
    } catch { /* ignore */ } finally { loadingNewerRef.current = false; }
  }, [groupSlug]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Read — and tell this device's badge and list at once.
  const markRead = useCallback(() => {
    if (!canReadRef.current) return;
    markGroupRead(groupSlug).catch(() => {});
    announceDM({ type: 'group_read', group_slug: groupSlug });
    // So the cached copy knows too (the "unread" line on the next open).
    const now = new Date().toISOString();
    setGroup((g) => (g ? { ...g, unread_count: 0, my_settings: { ...(g.my_settings || {}), last_read_at: now } } : g));
  }, [groupSlug]);

  // The safety-net poll: slow while the socket is up, quick while it's down,
  // and not at all in the background.
  const startPoll = useCallback(() => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (canReadRef.current && !viewingHistoryRef.current && appState.current === 'active') loadPosts(true);
    }, liveRef.current ? POLL_LIVE_MS : POLL_MS);
  }, [loadPosts]);

  useFocusEffect(
    useCallback(() => {
      loadGroup();
      markRead();
      startPoll();
      const sub = AppState.addEventListener('change', (n) => {
        if (n === 'active' && appState.current !== 'active' && canReadRef.current && !viewingHistoryRef.current) { loadPosts(true); markRead(); }
        appState.current = n;
      });
      return () => { clearInterval(pollRef.current); pollRef.current = null; sub.remove(); markRead(); };
    }, [loadGroup, loadPosts, markRead, startPoll])
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
        // While viewing a search-context window, don't splice live messages into
        // the historical window (it would leave a gap); they're there on return.
        if (viewingHistoryRef.current) return;
        // Mine (from here or another device) takes its bubble's place by client id.
        setMessages((prev) => absorb(prev, msg));
        // Only jump to the newest if they were already at the bottom — don't yank
        // someone out of scrolled-up history.
        if (atBottomRef.current) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
      },
      // An edit updates the message in place — never scroll, and never inject a
      // message that isn't already loaded (an edit of off-screen history).
      onEdited: (msg) => setMessages((prev) => (
        prev.some((m) => String(m.id) === String(msg.id)) ? mergeMessages([msg], prev) : prev
      )),
      onDeleted: (id) => setMessages((prev) => prev.filter((m) => String(m.id) !== String(id))),
      onTyping: (evt) => {
        if (evt.user_id === currentUser?.id || !evt.username) return;
        markUserTyping(evt.username, evt.is_typing);
      },
      onPinned: (evt) => setPinnedMsg(evt.pinned || null),
      // Reactions, members, settings, who's here (songs/group_live.py).
      onEvent: (evt) => {
        switch (evt.type) {
          case 'reaction':
            setMessages((prev) => applyReaction(prev, evt, currentUser?.id));
            break;
          case 'online_count':
            setOnlineCount(evt.count || 0);
            break;
          case 'members':
            if (evt.member_count != null) setGroup((g) => (g ? { ...g, member_count: evt.member_count } : g));
            if (evt.event === 'role' && evt.user_id === currentUser?.id) {
              setIsAdmin(!!evt.is_admin);
              setIsModerator(!!evt.is_moderator || !!evt.is_admin);
            }
            break;
          case 'member_removed':
            if (evt.user_id === currentUser?.id) {
              // Removed: the chat goes now, not at the next reload.
              canReadRef.current = false;
              setIsMember(false); setIsAdmin(false); setIsModerator(false);
              setMessages([]);
              notify(t('group.detail.removedTitle'), t('group.detail.removedBody'));
            }
            break;
          case 'member_left':
            // I left (from another device): this one stops showing the chat.
            if (evt.user_id === currentUser?.id) {
              canReadRef.current = false;
              setIsMember(false); setIsAdmin(false); setIsModerator(false);
              setMessages([]);
            }
            break;
          case 'group_deleted':
            canReadRef.current = false;
            setMessages([]);
            writeCache(cacheKey, null);
            notify(t('group.detail.deletedTitle'), t('group.detail.deletedBody'));
            navigation.goBack();
            break;
          case 'group_updated':
            setGroup((g) => (g ? { ...g, ...(evt.group || {}) } : g));
            break;
          default: break;
        }
      },
      onPresence: (evt) => {
        if (evt.count != null) setOnlineCount(evt.count);
        if (!evt.user_id) return;
        setOnlineIds((prev) => (
          evt.event === 'online'
            ? (prev.includes(evt.user_id) ? prev : [...prev, evt.user_id])
            : prev.filter((id) => id !== evt.user_id)
        ));
      },
      onStatus: (s) => {
        liveRef.current = s === 'open';
        if (s === 'closed') { setOnlineIds([]); setOnlineCount(null); } // stale on disconnect
        // Back online: catch up on anything sent while the socket was down.
        else if (canReadRef.current && !viewingHistoryRef.current) loadPosts(true);
        if (pollRef.current) startPoll();
      },
    });
    socketRef.current = sock;
    return () => { sock.close(); socketRef.current = null; liveRef.current = false; };
  }, [groupSlug, isMember, currentUser?.id, markUserTyping, loadPosts, startPoll, t, cacheKey, navigation]);

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

  // @name being typed: the members it could be (after a pause).
  const mentionQ = mentionQuery(text);
  useEffect(() => {
    if (mentionQ == null || !isMember) { setMentionHits([]); return undefined; }
    let cancelled = false;
    const id = setTimeout(() => {
      fetchGroupMembers(groupSlug, { q: mentionQ })
        .then((res) => {
          if (cancelled) return;
          const rows = (res?.results ?? []).map((m) => m.user).filter((u) => u && u.id !== currentUser?.id);
          setMentionHits(rows.slice(0, 6));
        })
        .catch(() => { if (!cancelled) setMentionHits([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [mentionQ, groupSlug, isMember, currentUser?.id]);

  const pickMention = useCallback((u) => {
    setText((v) => insertMention(v, u.username));
    setMentionHits([]);
  }, []);

  useEffect(() => () => {
    clearInterval(recordTimerRef.current);
    recordingRef.current?.stopAndUnloadAsync?.().catch(() => {});
    soundRef.current?.unloadAsync?.().catch(() => {});
    Object.values(typingTimersRef.current).forEach(clearTimeout);
    clearTimeout(myTypingRef.current.idle);
    clearTimeout(searchTimerRef.current);
    clearTimeout(highlightTimerRef.current);
  }, []);

  // ── Send (optimistic, WhatsApp-style states) ──
  // Show the bubble instantly with a 'sending' clock, then swap in the saved
  // copy (→ delivered double-tick) or flag it 'failed' for a tap-to-retry.
  // The bubble: new, or (a retry) the failed one sending again, in its place.
  const putBubble = useCallback((tempId, fields, replyDisplay, retrying) => {
    if (retrying) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _status: 'sending' } : m)));
      return;
    }
    setMessages((prev) => [...prev, {
      id: tempId,
      client_id: tempId,
      user: { id: currentUser?.id, username: currentUser?.username, profile_picture: currentUser?.profile_picture },
      reply_to: replyDisplay
        ? { id: replyDisplay.id, content: replyDisplay.content, message_type: replyDisplay.message_type, sender_username: replyDisplay.user?.username || replyDisplay.sender_username }
        : null,
      created_at: new Date().toISOString(), is_owner: true,
      reactions: { summary: [], mine: null },
      _status: 'sending', _replyDisplay: replyDisplay || null,
      ...fields,
    }]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
  }, [currentUser]);

  // Every send carries the bubble's id as its client id, so a retry — or a
  // send that did land though the answer was lost — is one message, never two.
  const deliver = useCallback(async (payload, replyDisplay, retryId = null) => {
    const tempId = retryId || nextTempId();
    const body = { ...payload, client_id: tempId };
    putBubble(tempId, {
      content: payload.content || '', message_type: payload.message_type || 'text',
      attachment: payload.attachment || '', file_name: payload.file_name || '', duration: payload.duration,
      _payload: payload,
    }, replyDisplay, !!retryId);
    try {
      const saved = await sendGroupMessage(groupSlug, body);
      setMessages((prev) => settle(prev, tempId, saved));
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _status: 'failed' } : m)));
      const code = e?.response?.status;
      if (code === 403) notify(t('common.error'), e?.response?.data?.detail || t('group.detail.cantPost'));
      else if (code === 429) notify(t('group.detail.slowMode'), t('group.detail.slowModeHint', { time: slowLabel(slowSecondsRef.current || 0, t) }));
    }
  }, [groupSlug, putBubble, t]);

  const sendPayload = useCallback((payload) => {
    const rd = replyTo;
    setReplyTo(null);
    deliver(payload, rd);
  }, [deliver, replyTo]);

  // Media send: show the local file instantly, upload it to R2 in the
  // background, then persist the message with just the URL (mirrors DMs).
  const sendMedia = useCallback(async (media, replyDisplay, retryId = null) => {
    const { localUri, uploadType, message_type, file_name = '', duration = null, mimeType, blurhash = '' } = media;
    const tempId = retryId || nextTempId();
    putBubble(tempId, {
      content: '', message_type, attachment: localUri, attachment_blurhash: blurhash, file_name, duration,
      _retryMedia: media,
    }, replyDisplay, !!retryId);
    try {
      const uploaded = await uploadMedia({ uri: localUri, name: file_name || `chat_${Date.now()}`, mimeType }, uploadType);
      const saved = await sendGroupMessage(groupSlug, {
        message_type, attachment: uploaded.url, attachment_blurhash: blurhash,
        file_name, duration, reply_to_id: replyDisplay?.id, client_id: tempId,
      });
      setMessages((prev) => settle(prev, tempId, saved));
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _status: 'failed' } : m)));
    }
  }, [groupSlug, putBubble]);

  const sendMediaMessage = useCallback((media) => {
    const rd = replyTo;
    setReplyTo(null);
    sendMedia(media, rd);
  }, [sendMedia, replyTo]);

  // Same bubble, same client id — the server keeps one message however many
  // times it's asked.
  const retrySend = useCallback((m) => {
    if (m._retryMedia) sendMedia(m._retryMedia, m._replyDisplay, m.id);
    else deliver(m._payload, m._replyDisplay, m.id);
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
      if (status !== 'granted') { notify(t('chat.permissionRequired'), t('chat.permissionPhotos')); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      if (res.canceled || !res.assets?.length) return;
      const p = await compressImage(res.assets[0].uri, { width: 1080, quality: 0.6 });
      // Encode a BlurHash so every viewer gets a colour-matched blur placeholder
      // while the real image downloads. Optional — a failure just skips it.
      let blurhash = '';
      if (Blurhash) {
        try { blurhash = await Blurhash.encode(p.uri, 4, 3); } catch { /* placeholder is optional */ }
      }
      sendMediaMessage({ localUri: p.uri, uploadType: 'chat-image', message_type: 'image', mimeType: 'image/jpeg', blurhash });
    } catch { notify(t('common.error'), t('chat.attachImageFailed')); }
  }, [sendMediaMessage, t]);

  const attachFile = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const f = res.assets[0];
      if (f.size && f.size > MAX_FILE_BYTES) { notify(t('chat.fileTooLargeTitle'), t('group.detail.fileTooLargeBody')); return; }
      sendMediaMessage({
        localUri: f.uri, uploadType: 'chat-file', message_type: 'file',
        file_name: f.name || 'file', mimeType: f.mimeType || 'application/octet-stream',
      });
    } catch { notify(t('common.error'), t('chat.attachFileFailed')); }
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
      else notify(t('chat.savedTitle'), t('common.savedAs', { name: msg.file_name }));
    } catch { notify(t('common.error'), t('chat.openFileFailed')); }
  }, [t]);

  // ── Voice ──
  const startRecording = useCallback(async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { notify(t('chat.permissionRequired'), t('chat.permissionMic')); return; }
      await setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Recording();
      await rec.prepareToRecordAsync(VOICE_NOTE_RECORDING_OPTIONS);
      await rec.startAsync();
      recordingRef.current = rec; recordStartRef.current = Date.now();
      setShowEmoji(false); setIsRecording(true); setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch { notify(t('common.error'), t('chat.recordFailed')); setIsRecording(false); }
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
    } catch { notify(t('common.error'), t('chat.saveVoiceFailed')); }
  }, [sendMediaMessage, t]);

  const playAudio = useCallback(async (msg) => {
    try {
      if (soundRef.current) { await soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
      if (playingIdRef.current === msg.id) { setPlayingId(null); return; }
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
      // Another sound started (only one plays at a time): this note is done.
      sound.setOnFocusLost(() => { setPlayingId(null); sound.unloadAsync().catch(() => {}); if (soundRef.current === sound) soundRef.current = null; });
      sound.setOnPlaybackStatusUpdate((st) => { if (st.didJustFinish) { setPlayingId(null); sound.unloadAsync().catch(() => {}); soundRef.current = null; } });
    } catch { notify(t('common.error'), t('chat.playVoiceFailed')); setPlayingId(null); }
  }, [t]);

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

  const goMedia = useCallback(() => {
    setMenuSheet(false);
    navigation.navigate('GroupMedia', { groupSlug, group });
  }, [navigation, groupSlug, group]);

  const goAuditLog = useCallback(() => {
    setMenuSheet(false);
    navigation.navigate('GroupAuditLog', { groupSlug, group });
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
    catch { notify(t('common.error'), t('group.detail.leaveFailed')); }
  }, [groupSlug, navigation, t]);

  const canLeave = isMember && group?.creator?.id !== currentUser?.id;

  const togglePostingPolicy = useCallback(async () => {
    setMenuSheet(false);
    const next = !group?.only_admins_can_post;
    try {
      const updated = await setGroupPostingPolicy(groupSlug, next);
      setGroup(updated);
    } catch {
      notify(t('common.error'), t('group.detail.settingFailed'));
    }
  }, [group, groupSlug, t]);

  const submitJoin = async (answer) => {
    try {
      await requestJoinGroup(groupSlug, answer || '');
      setRequested(true);
      notify(t('group.detail.requestSentTitle'), t('group.detail.requestSentBody'));
    } catch (e) {
      // requestJoinGroup rejects with the response body itself ({ error } / { message }).
      const msg = e?.error || e?.response?.data?.error || e?.message || t('group.detail.requestFailed');
      if (/already/i.test(msg)) setRequested(true);
      notify(t('common.notice'), msg);
    }
  };

  const join = () => {
    // If the group asks a question, collect the answer first; else request straight away.
    if (group?.join_question) setJoinAnswer('');
    else submitJoin('');
  };

  const saveJoinQuestion = useCallback(async () => {
    const q = (jqEditor || '').trim();
    setJqEditor(null);
    try {
      const updated = await setGroupJoinQuestion(groupSlug, q);
      setGroup((g) => ({ ...(g || {}), join_question: updated?.join_question ?? q }));
    } catch { notify(t('common.error'), t('group.detail.saveFailed')); }
  }, [jqEditor, groupSlug, t]);

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

  const canModerate = isAdmin || isModerator;
  const canDelete = (m) => !!m && (m.user?.id === currentUser?.id || m.is_owner || canModerate);
  // Only your own, already-saved, text messages can be edited.
  const canEdit = (m) => !!m && m.message_type === 'text'
    && (m.user?.id === currentUser?.id || m.is_owner)
    && !String(m.id).startsWith('temp_') && m._status !== 'failed';

  const startEdit = useCallback((m) => {
    setMenuMsg(null);
    setReplyTo(null);
    setEditingMsg(m);
    setText(m.content || '');
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const cancelEdit = useCallback(() => { setEditingMsg(null); setText(''); }, []);

  const jumpToMessage = useCallback((id) => {
    const idx = messages.findIndex((m) => String(m.id) === String(id));
    if (idx >= 0) {
      try { listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.35 }); } catch { /* best effort */ }
    }
  }, [messages]);

  const openSearch = useCallback(() => { setMenuSheet(false); setSearchMode(true); }, []);
  const closeSearch = useCallback(() => {
    setSearchMode(false); setSearchQuery(''); setSearchResults([]);
    clearTimeout(searchTimerRef.current);
  }, []);

  const onSearchChange = useCallback((val) => {
    setSearchQuery(val);
    clearTimeout(searchTimerRef.current);
    const q = val.trim();
    if (q.length < 2) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchGroupMessages(groupSlug, q);
        setSearchResults(res?.results ?? (Array.isArray(res) ? res : []));
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 350);
  }, [groupSlug]);

  const flashMessage = useCallback((id) => {
    clearTimeout(highlightTimerRef.current);
    setHighlightId(id);
    highlightTimerRef.current = setTimeout(() => setHighlightId(null), 1800);
  }, []);

  const enterHistory = useCallback((on) => { viewingHistoryRef.current = on; setViewingHistory(on); }, []);

  // Return from a search-context window to the live newest messages.
  const resetToLatest = useCallback(async () => {
    try {
      const res = await fetchGroupPosts(groupSlug, 1);
      const rows = (res?.results ?? []).slice().reverse();
      atBottomRef.current = true;
      setMessages(rows);
      setHasEarlier(!!res?.next);
      hasNewerRef.current = false;
      pageRef.current = 1;
      enterHistory(false);
      setShowJump(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 80);
    } catch { /* ignore */ }
  }, [groupSlug, enterHistory]);

  const onJumpNewest = useCallback(() => {
    if (viewingHistoryRef.current) resetToLatest();
    else listRef.current?.scrollToEnd({ animated: true });
  }, [resetToLatest]);

  const onTapResult = useCallback(async (m) => {
    closeSearch();
    // Already loaded → just scroll to it.
    if (messages.some((x) => String(x.id) === String(m.id))) {
      setTimeout(() => { jumpToMessage(m.id); flashMessage(m.id); }, 150);
      return;
    }
    // Otherwise load a window of context around it and jump there.
    try {
      const res = await fetchGroupMessageContext(groupSlug, m.id);
      const rows = res?.results ?? [];
      if (!rows.length) { setTimeout(() => jumpToMessage(m.id), 150); return; }
      atBottomRef.current = false;  // stop the content-size auto-scroll from fighting the jump
      setMessages(rows);            // server returns them ascending
      enterHistory(!!res?.has_newer);
      setShowJump(true);
      setHasEarlier(!!res?.has_earlier);   // cursor "load earlier" works from here
      hasNewerRef.current = !!res?.has_newer;
      setTimeout(() => { jumpToMessage(m.id); flashMessage(m.id); }, 320);
    } catch { /* ignore */ }
  }, [messages, groupSlug, closeSearch, jumpToMessage, flashMessage, enterHistory]);

  const showReceipts = useCallback(async (m) => {
    setMenuMsg(null);
    setReceipts({ loading: true, count: 0, readers: [] });
    try {
      const res = await fetchMessageReceipts(groupSlug, m.id);
      setReceipts({ loading: false, count: res?.count ?? 0, readers: res?.readers ?? [] });
    } catch {
      setReceipts({ loading: false, count: 0, readers: [] });
    }
  }, [groupSlug]);

  const pinMessage = useCallback(async (m) => {
    setMenuMsg(null);
    const prev = pinnedMsg;
    try { setPinnedMsg(await pinGroupMessage(groupSlug, m.id)); }
    catch { setPinnedMsg(prev); notify(t('common.error'), t('group.detail.pinFailed')); }
  }, [groupSlug, pinnedMsg, t]);

  const unpinMessage = useCallback(async () => {
    setMenuMsg(null);
    const prev = pinnedMsg;
    if (!prev) return;
    setPinnedMsg(null);
    try { await unpinGroupMessage(groupSlug, prev.id); }
    catch { setPinnedMsg(prev); notify(t('common.error'), t('group.detail.pinFailed')); }
  }, [groupSlug, pinnedMsg, t]);

  const saveEdit = useCallback(async () => {
    const m = editingMsg;
    const content = text.trim();
    if (!m) return;
    if (!content || content === m.content) { cancelEdit(); return; }
    setEditingMsg(null); setText('');
    // Optimistic: show the new text with an "edited" stamp immediately.
    const stamp = new Date().toISOString();
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, content, edited_at: stamp } : x)));
    try {
      const saved = await editGroupMessage(groupSlug, m.id, content);
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...saved } : x)));
    } catch {
      // Roll back to the original text on failure.
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, content: m.content, edited_at: m.edited_at || null } : x)));
      notify(t('common.error'), t('group.detail.editFailed'));
    }
  }, [editingMsg, text, groupSlug, cancelEdit, t]);

  // Web-safe: Alert's buttons never fire on web, so deleting did nothing there.
  const confirmDelete = useCallback(async (m) => {
    setMenuMsg(null);
    if (!canDelete(m)) return;
    const ok = await confirmAction({
      title: t('group.detail.deleteMessageTitle'), message: t('group.detail.deleteMessageBody'),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    try {
      await deleteGroupPost(groupSlug, m.id);
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      // Clear the pinned banner locally too (don't just wait on the WS event).
      setPinnedMsg((p) => (p && String(p.id) === String(m.id) ? null : p));
    } catch { notify(t('common.error'), t('group.detail.deleteMessageFailed')); }
  }, [groupSlug, currentUser, isAdmin, isModerator, t]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const heartReact = useCallback((m) => reactToPost(m, '❤️'), [reactToPost]);

  // My side of the group (optimistic; put back if the server says no).
  const changeMine = useCallback(async (changes) => {
    const before = groupRef.current;
    setGroup((g) => (g ? { ...g, my_settings: { ...(g.my_settings || {}), ...(changes.notify ? { notify: changes.notify } : {}), ...('archived' in changes ? { archived: changes.archived } : {}) } } : g));
    try { await setGroupMine(groupSlug, changes); }
    catch { setGroup(before); notify(t('common.error'), t('group.detail.settingFailed')); }
  }, [groupSlug, t]);

  const changeMute = useCallback(async (hours) => {
    const before = groupRef.current;
    try {
      const r = await muteGroup(groupSlug, hours);
      setGroup((g) => (g ? { ...g, muted_until: r?.muted_until || null } : g));
    } catch { setGroup(before); notify(t('common.error'), t('group.detail.settingFailed')); }
  }, [groupSlug, t]);

  // ── Render ──
  const renderMessage = useCallback(({ item, index }) => {
    const isOwn = item.user?.id === currentUser?.id || item.is_owner;
    const prev = messages[index - 1];
    const showName = !isOwn && (!prev || prev.user?.id !== item.user?.id || prev.message_type === 'system');
    const day = newDay(prev, item) ? dayLabel(t, item.created_at) : null;
    const unread = unreadId != null && String(item.id) === String(unreadId);
    return (
      <>
      {day ? <View style={styles.dayWrap}><Text style={styles.dayText}>{day}</Text></View> : null}
      {unread ? (
        <View style={styles.unreadLine} testID="unread-line">
          <Text style={styles.unreadText}>{t('group.detail.unreadMessages')}</Text>
        </View>
      ) : null}
      <GroupMessageRow
        item={item}
        isOwn={isOwn}
        showName={showName}
        isPlaying={playingId === item.id}
        highlighted={String(item.id) === String(highlightId)}
        onReply={startReply}
        onLongPress={openMsgMenu}
        onDoubleTap={heartReact}
        onOpenImage={setViewer}
        onOpenFile={openFile}
        onPlayAudio={playAudio}
        onToggleReaction={reactToPost}
        onRetry={retrySend}
      />
      </>
    );
  }, [currentUser?.id, messages, playingId, highlightId, unreadId, t, openFile, playAudio, startReply, openMsgMenu, reactToPost, heartReact, retrySend]);

  const keyExtractor = useCallback((item) => String(item.id), []);
  const onScrollToIndexFailed = useCallback(({ averageItemLength, index }) => {
    listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: true });
  }, []);
  const onListScroll = useCallback((e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
    atBottomRef.current = atBottom;
    const shouldShow = !atBottom || viewingHistoryRef.current;
    setShowJump((prev) => (prev === shouldShow ? prev : shouldShow));
  }, []);
  const onListContentSize = useCallback(() => {
    if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
  }, []);

  if (loading) {
    return (
      <View style={styles.root}>
        <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.68)" />
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      </View>
    );
  }

  const mutedUntil = group?.muted_until || null;
  const archived = !!group?.my_settings?.archived;
  const notifyLevel = group?.my_settings?.notify || 'all';
  const notifySummary = mutedUntil
    ? (new Date(mutedUntil).getFullYear() > 9000 ? t('group.detail.mutedAlways')
      : t('group.detail.mutedUntil', { when: new Date(mutedUntil).toLocaleString() }))
    : notifyLevel === 'mentions' ? t('group.detail.mentionsOnly') : t('group.detail.allMessages');
  const adminsOnly = !!group?.only_admins_can_post;
  const slowSeconds = group?.slow_mode_seconds || 0;
  const canChat = isMember && (!adminsOnly || isAdmin);
  // Others here: the server's count (me excluded), or — from an older server — the roster.
  const othersOnline = onlineCount != null
    ? Math.max(0, onlineCount - 1)
    : onlineIds.filter((id) => id !== currentUser?.id).length;

  return (
    <View style={styles.root}>
    <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.68)" />
    <View style={[styles.container, kbHeight > 0 ? { marginBottom: kbHeight } : null]}>
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
              <View style={styles.headerNameRow}>
                <Text style={styles.headerName} numberOfLines={1}>{group?.name ?? t('group.add.fallbackName')}</Text>
                {mutedUntil ? <Ionicons name="notifications-off" size={14} color={colors.textMuted} testID="header-muted" /> : null}
              </View>
              {othersOnline > 0 ? (
                <View style={styles.headerSubRow}>
                  <View style={styles.onlineDot} />
                  <Text style={styles.headerOnline} numberOfLines={1}>{t('group.detail.onlineCount', { count: othersOnline })}</Text>
                </View>
              ) : (
                <Text style={styles.headerSub} numberOfLines={1}>{t('group.detail.memberCount', { count: group?.member_count ?? 0 })}{group?.is_private ? t('group.detail.privateSuffix') : ''}</Text>
              )}
            </View>
          </TouchableOpacity>
          {isMember && (
            <TouchableOpacity onPress={openSearch} style={styles.backBtn}>
              <Ionicons name="search" size={21} color={colors.textPrimary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={openMenu} style={styles.backBtn} testID="group-menu" accessibilityLabel={t('group.detail.options')}>
            <Ionicons name="ellipsis-vertical" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </LinearGradient>
      </SafeAreaView>

      {/* In-chat search overlay */}
      {searchMode && (
        <View style={styles.searchOverlay}>
          <SafeAreaView edges={['top']} style={styles.headerSafe}>
            <View style={styles.searchHeader}>
              <TouchableOpacity onPress={closeSearch} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
              <TextInput
                style={styles.searchInput}
                placeholder={t('group.detail.searchPlaceholder')}
                placeholderTextColor={colors.placeholder}
                value={searchQuery}
                onChangeText={onSearchChange}
                autoFocus
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => onSearchChange('')} style={styles.backBtn}>
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          </SafeAreaView>
          {searching ? (
            <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => String(item.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.searchResult} activeOpacity={0.8} onPress={() => onTapResult(item)}>
                  <Text style={styles.searchResultName}>{item.user?.username}</Text>
                  <Text style={styles.searchResultText} numberOfLines={2}>{item.content}</Text>
                  <Text style={styles.searchResultTime}>{fmtDate(item.created_at)}</Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.searchList}
              ListEmptyComponent={
                searchQuery.trim().length >= 2 ? (
                  <Text style={styles.searchEmpty}>{t('group.detail.searchNone')}</Text>
                ) : null
              }
            />
          )}
        </View>
      )}

      {/* A book club's group: its book and plan are one tap away. */}
      <BookClubBanner groupSlug={groupSlug} navigation={navigation} />

      {isMember && pinnedMsg && (
        <TouchableOpacity style={styles.pinnedBar} activeOpacity={0.85} onPress={() => jumpToMessage(pinnedMsg.id)}>
          <Ionicons name="pin" size={16} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.pinnedTitle}>{t('group.detail.pinnedMessage')}</Text>
            <Text style={styles.pinnedText} numberOfLines={1}>{replyLabel(pinnedMsg, t)}</Text>
          </View>
          {canModerate && (
            <TouchableOpacity onPress={unpinMessage} hitSlop={8}><Ionicons name="close" size={18} color={colors.textMuted} /></TouchableOpacity>
          )}
        </TouchableOpacity>
      )}

      {isMember ? (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={keyExtractor}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          maxToRenderPerBatch={12}
          windowSize={11}
          onScrollToIndexFailed={onScrollToIndexFailed}
          onScroll={onListScroll}
          scrollEventThrottle={100}
          onContentSizeChange={onListContentSize}
          onEndReachedThreshold={0.15}
          onEndReached={loadNewer}
          ListHeaderComponent={hasEarlier ? (
            <TouchableOpacity style={styles.earlierBtn} onPress={loadOlder}><Text style={styles.earlierText}>{t('group.detail.loadEarlier')}</Text></TouchableOpacity>
          ) : null}
          ListEmptyComponent={firstLoad ? (
            <View style={styles.emptyContainer}><ActivityIndicator color={colors.accent} /></View>
          ) : group?.kind === 'community' ? (
            <View style={styles.emptyContainer}>
              <View style={styles.welcomeIcon}>
                <Ionicons
                  name={group?.category_detail?.icon || 'people'}
                  size={26}
                  color={colors.accent}
                />
              </View>
              <Text style={styles.welcomeTitle}>
                {t('community.detail.welcomeTitle', { name: group?.name || '' })}
              </Text>
              <Text style={styles.emptyText}>
                {t(group?.is_private
                  ? 'community.detail.welcomeBodyPrivate'
                  : 'community.detail.welcomeBodyPublic')}
              </Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}><Text style={styles.emptyText}>{t('group.detail.noMessages')}</Text></View>
          )}
        />
      ) : (
        <View style={styles.lockedPreview}>
          <View style={styles.lockedIconWrap}>
            <Ionicons name="lock-closed" size={34} color={colors.textSecondary} />
          </View>
          <Text style={styles.lockedTitle}>
            {group?.kind === 'community' && !group?.is_private
              ? t('community.detail.welcomeTitle', { name: group?.name || '' })
              : t('group.detail.membersOnlyTitle')}
          </Text>
          <Text style={styles.lockedBody}>
            {group?.kind === 'community'
              ? t(group?.is_private
                ? 'community.detail.joinBodyPrivate'
                : 'community.detail.joinBodyPublic')
              : t('group.detail.membersOnlyBody')}
          </Text>
          {group?.description ? (
            <Text style={styles.lockedDesc} numberOfLines={4}>{group.description}</Text>
          ) : null}
          <CommunityDetails group={group} styles={styles} />
        </View>
      )}

      {isMember && showJump && (
        <TouchableOpacity style={styles.jumpFab} onPress={onJumpNewest} activeOpacity={0.85}>
          <Ionicons name={viewingHistory ? 'arrow-down' : 'chevron-down'} size={22} color={colors.white} />
        </TouchableOpacity>
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

      {/* Edit banner */}
      {editingMsg && canChat && (
        <View style={styles.replyBar}>
          <View style={styles.replyAccent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarName}>{t('group.detail.editingMessage')}</Text>
            <Text style={styles.replyBarText} numberOfLines={1}>{editingMsg.content}</Text>
          </View>
          <TouchableOpacity onPress={cancelEdit} hitSlop={8}><Ionicons name="close" size={20} color={colors.textMuted} /></TouchableOpacity>
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

      {canChat && mentionHits.length > 0 ? (
        <ScrollView horizontal keyboardShouldPersistTaps="always" style={styles.mentionBar}
          contentContainerStyle={styles.mentionBarInner} showsHorizontalScrollIndicator={false}>
          {mentionHits.map((u) => (
            <TouchableOpacity key={u.id} style={styles.mentionChip} onPress={() => pickMention(u)} testID={`mention-${u.username}`}>
              <Text style={styles.mentionChipText}>@{u.username}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      {canChat && slowSeconds > 0 && !(isAdmin || isModerator) ? (
        <Text style={styles.slowHint} testID="slow-hint">{t('group.detail.slowModeHint', { time: slowLabel(slowSeconds, t) })}</Text>
      ) : null}
      {/* Off the home indicator (the keyboard, when up, already lifts it). */}
      <SafeAreaView edges={kbHeight > 0 ? ['left', 'right'] : ['left', 'right', 'bottom']} style={styles.bottomSafe}>
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
              <TouchableOpacity style={styles.iconBtn} onPress={() => setShowEmoji((s) => !s)} accessibilityLabel={t('dm.emoji')}><Ionicons name={showEmoji ? 'close' : 'happy-outline'} size={24} color={colors.textSecondary} /></TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={onAttachPress} accessibilityLabel={t('dm.attach')}><Ionicons name="add-circle-outline" size={26} color={colors.textSecondary} /></TouchableOpacity>
              <TextInput style={styles.input} placeholder={t('chat.messagePlaceholder')} placeholderTextColor={colors.placeholder} value={text} onChangeText={onChangeText} onFocus={() => setShowEmoji(false)} multiline maxLength={2000} />
              {editingMsg ? (
                <TouchableOpacity style={styles.sendBtn} onPress={saveEdit} accessibilityLabel={t('dm.saveEdit')}>
                  <Ionicons name="checkmark" size={20} color={colors.white} />
                </TouchableOpacity>
              ) : text.trim() ? (
                <TouchableOpacity style={styles.sendBtn} onPress={handleSendText} testID="group-send" accessibilityLabel={t('dm.send')}>
                  <Ionicons name="send" size={18} color={colors.white} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.sendBtn} onPress={startRecording} accessibilityLabel={t('dm.recordVoice')}><Ionicons name="mic" size={20} color={colors.white} /></TouchableOpacity>
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
      </SafeAreaView>

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
            <Text style={styles.sheetTitle} numberOfLines={1}>{group?.name || t('group.add.fallbackName')}</Text>
            <Text style={styles.sheetSubtitle}>{t('group.detail.memberCount', { count: group?.member_count ?? 0 })}{group?.is_private ? t('group.detail.privateSuffix') : ''}</Text>
            {!!group?.category_detail && (
              <View style={styles.categoryBadge}>
                <Ionicons name={group.category_detail.icon || 'people'} size={12} color={colors.accent} />
                <Text style={styles.categoryBadgeText}>{group.category_detail.name}</Text>
              </View>
            )}
            <CommunityDetails group={group} styles={styles} />

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

            {isMember && (
              <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} onPress={goMedia}>
                <View style={[styles.sheetIcon, styles.sheetIconPhoto]}>
                  <Ionicons name="images" size={22} color={colors.accent} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionLabel}>{t('group.detail.sharedMedia')}</Text>
                  <Text style={styles.sheetOptionHint}>{t('group.detail.sharedMediaHint')}</Text>
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
              <TouchableOpacity
                style={styles.sheetOption}
                activeOpacity={0.85}
                onPress={() => { setMenuSheet(false); setJqEditor(group?.join_question || ''); }}
              >
                <View style={[styles.sheetIcon, styles.sheetIconFile]}>
                  <Ionicons name="help-circle" size={22} color={colors.primary} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionLabel}>{t('group.detail.joinQuestion')}</Text>
                  <Text style={styles.sheetOptionHint} numberOfLines={1}>{group?.join_question || t('group.detail.joinQuestionHint')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            )}

            {canModerate && (
              <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} onPress={goAuditLog}>
                <View style={[styles.sheetIcon, styles.sheetIconFile]}>
                  <Ionicons name="document-text" size={22} color={colors.primary} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionLabel}>{t('group.detail.auditLog')}</Text>
                  <Text style={styles.sheetOptionHint}>{t('group.detail.auditLogHint')}</Text>
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

            {isAdmin && (
              <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} testID="slow-mode-option"
                onPress={() => { setMenuSheet(false); setTimeout(() => setSlowSheet(true), 220); }}>
                <View style={[styles.sheetIcon, styles.sheetIconFile]}>
                  <Ionicons name="timer-outline" size={22} color={colors.primary} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionLabel}>{t('group.detail.slowMode')}</Text>
                  <Text style={styles.sheetOptionHint}>{slowSeconds ? t('group.detail.slowModeEvery', { time: slowLabel(slowSeconds, t) }) : t('group.detail.slowModeOff')}</Text>
                </View>
              </TouchableOpacity>
            )}

            {isMember && (
              <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} testID="notify-option"
                onPress={() => { setMenuSheet(false); setTimeout(() => setNotifySheet(true), 220); }}>
                <View style={[styles.sheetIcon, styles.sheetIconFile]}>
                  <Ionicons name={mutedUntil ? 'notifications-off' : 'notifications'} size={22} color={colors.primary} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionLabel}>{t('group.detail.notifications')}</Text>
                  <Text style={styles.sheetOptionHint}>{notifySummary}</Text>
                </View>
              </TouchableOpacity>
            )}

            {isMember && (
              <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} testID="archive-option"
                onPress={() => { setMenuSheet(false); changeMine({ archived: !archived }); }}>
                <View style={[styles.sheetIcon, styles.sheetIconFile]}>
                  <Ionicons name={archived ? 'archive' : 'archive-outline'} size={22} color={colors.primary} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionLabel}>{archived ? t('group.detail.unarchive') : t('group.detail.archive')}</Text>
                  <Text style={styles.sheetOptionHint}>{t('group.detail.archiveHint')}</Text>
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
            {canEdit(menuMsg) && (
              <TouchableOpacity style={styles.menuItem} onPress={() => startEdit(menuMsg)}>
                <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
                <Text style={styles.menuItemText}>{t('group.detail.edit')}</Text>
              </TouchableOpacity>
            )}
            {canModerate && menuMsg && !String(menuMsg.id).startsWith('temp_') && (
              pinnedMsg && String(pinnedMsg.id) === String(menuMsg.id) ? (
                <TouchableOpacity style={styles.menuItem} onPress={unpinMessage}>
                  <Ionicons name="remove-circle-outline" size={20} color={colors.textPrimary} />
                  <Text style={styles.menuItemText}>{t('group.detail.unpin')}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.menuItem} onPress={() => pinMessage(menuMsg)}>
                  <Ionicons name="pin-outline" size={20} color={colors.textPrimary} />
                  <Text style={styles.menuItemText}>{t('group.detail.pin')}</Text>
                </TouchableOpacity>
              )
            )}
            {menuMsg && menuMsg.user?.id === currentUser?.id
              && !String(menuMsg.id).startsWith('temp_') && menuMsg._status !== 'failed' && (
              <TouchableOpacity style={styles.menuItem} onPress={() => showReceipts(menuMsg)}>
                <Ionicons name="checkmark-done" size={20} color={colors.textPrimary} />
                <Text style={styles.menuItemText}>{t('group.detail.messageInfo')}</Text>
              </TouchableOpacity>
            )}
            {menuMsg && menuMsg.user?.id !== currentUser?.id && menuMsg.message_type !== 'system'
              && !String(menuMsg.id).startsWith('temp_') && (
              <TouchableOpacity style={styles.menuItem} onPress={() => { const m = menuMsg; setMenuMsg(null); setReportMsg(m); }}>
                <Ionicons name="flag-outline" size={20} color={colors.error} />
                <Text style={[styles.menuItemText, { color: colors.error }]}>{t('group.detail.reportMessage')}</Text>
              </TouchableOpacity>
            )}
            {canDelete(menuMsg) && (
              <TouchableOpacity style={styles.menuItem} onPress={() => confirmDelete(menuMsg)}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
                <Text style={[styles.menuItemText, { color: colors.error }]}>{t('common.delete')}</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Message info: who has seen this message */}
      <Modal visible={!!receipts} transparent animationType="slide" onRequestClose={() => setReceipts(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setReceipts(null)}>
          <Pressable style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('group.detail.messageInfo')}</Text>
            {receipts?.loading ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.lg }} />
            ) : (
              <>
                <Text style={styles.receiptCount}>{t('group.detail.seenBy', { count: receipts?.count ?? 0 })}</Text>
                <View style={styles.receiptList}>
                  {(receipts?.readers ?? []).map((r) => (
                    <View key={r.user?.id} style={styles.receiptRow}>
                      <Image
                        source={r.user?.profile?.picture ? { uri: r.user.profile.picture } : DEFAULT_AVATAR}
                        placeholder={DEFAULT_AVATAR}
                        contentFit="cover"
                        transition={120}
                        style={styles.receiptAvatar}
                      />
                      <Text style={styles.receiptName} numberOfLines={1}>{r.user?.username}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Join-question answer (shown to a requester when the group asks one) */}
      <Modal visible={joinAnswer !== null} transparent animationType="slide" onRequestClose={() => setJoinAnswer(null)} statusBarTranslucent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setJoinAnswer(null)}>
          <Pressable style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{group?.join_question}</Text>
            <TextInput
              style={styles.promptInput}
              placeholder={t('group.detail.answerPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={joinAnswer || ''}
              onChangeText={setJoinAnswer}
              multiline
              maxLength={500}
              autoFocus
            />
            <View style={styles.promptActions}>
              <TouchableOpacity style={[styles.promptBtn, styles.promptCancel]} onPress={() => setJoinAnswer(null)}>
                <Text style={styles.promptCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.promptBtn, styles.promptSave, !joinAnswer?.trim() && styles.promptDisabled]}
                disabled={!joinAnswer?.trim()}
                onPress={() => { const a = joinAnswer; setJoinAnswer(null); submitJoin(a); }}
              >
                <Text style={styles.promptSaveText}>{t('group.detail.requestToJoin')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <ChoiceSheet
        visible={notifySheet}
        title={t('group.detail.notifications')}
        subtitle={notifySummary}
        onClose={() => setNotifySheet(false)}
        cancelLabel={t('common.cancel')}
        options={[
          { key: 'all', icon: 'notifications', label: t('group.detail.allMessages') + (notifyLevel === 'all' && !mutedUntil ? '  ✓' : ''), onPress: () => { changeMine({ notify: 'all' }); if (mutedUntil) changeMute(0); } },
          { key: 'mentions', icon: 'alternate-email', label: t('group.detail.mentionsOnly') + (notifyLevel === 'mentions' && !mutedUntil ? '  ✓' : ''), onPress: () => changeMine({ notify: 'mentions' }) },
          { key: 'mute8', icon: 'notifications-paused', label: t('group.detail.mute8h'), onPress: () => changeMute(8) },
          { key: 'mute168', icon: 'notifications-paused', label: t('group.detail.muteWeek'), onPress: () => changeMute(168) },
          { key: 'muteAlways', icon: 'notifications-off', label: t('group.detail.muteAlways'), onPress: () => changeMute('always') },
          ...(mutedUntil ? [{ key: 'unmute', icon: 'notifications-active', label: t('group.detail.unmute'), onPress: () => changeMute(0) }] : []),
        ]}
      />
      <ChoiceSheet
        visible={slowSheet}
        title={t('group.detail.slowMode')}
        subtitle={t('group.detail.slowModeSub')}
        onClose={() => setSlowSheet(false)}
        cancelLabel={t('common.cancel')}
        options={SLOW_CHOICES.map((sec) => ({
          key: String(sec), icon: sec ? 'timer' : 'timer-off',
          label: (sec ? slowLabel(sec, t) : t('group.detail.slowModeOff')) + (sec === slowSeconds ? '  ✓' : ''),
          onPress: async () => {
            try { const g = await setGroupSlowMode(groupSlug, sec); if (g) setGroup(g); }
            catch { notify(t('common.error'), t('group.detail.settingFailed')); }
          },
        }))}
      />
      <ReportModal
        visible={!!reportMsg}
        onClose={() => setReportMsg(null)}
        contentType="grouppost"
        objectId={reportMsg?.id}
        title={t('group.detail.reportMessageTitle')}
      />

      {/* Admin: set/clear the join question */}
      <Modal visible={jqEditor !== null} transparent animationType="slide" onRequestClose={() => setJqEditor(null)} statusBarTranslucent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setJqEditor(null)}>
          <Pressable style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('group.detail.joinQuestion')}</Text>
            <Text style={styles.sheetSubtitle}>{t('group.detail.joinQuestionEditorHint')}</Text>
            <TextInput
              style={styles.promptInput}
              placeholder={t('group.detail.joinQuestionPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={jqEditor || ''}
              onChangeText={setJqEditor}
              maxLength={200}
              autoFocus
            />
            <View style={styles.promptActions}>
              <TouchableOpacity style={[styles.promptBtn, styles.promptCancel]} onPress={() => setJqEditor(null)}>
                <Text style={styles.promptCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.promptBtn, styles.promptSave]} onPress={saveJoinQuestion}>
                <Text style={styles.promptSaveText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bottomSafe: { backgroundColor: 'rgba(16,46,80,0.95)' },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mention: { color: colors.accent, fontWeight: '700' },
  mentionBar: { maxHeight: 44, backgroundColor: 'rgba(16,46,80,0.95)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  mentionBarInner: { paddingHorizontal: spacing.sm, paddingVertical: 6, gap: spacing.xs },
  mentionChip: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.full, backgroundColor: 'rgba(244,162,97,0.16)', borderWidth: 1, borderColor: 'rgba(244,162,97,0.5)' },
  mentionChipText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  dayWrap: { alignItems: 'center', marginVertical: spacing.sm },
  dayText: { fontSize: 12, color: colors.textSecondary, fontWeight: '700', overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full, backgroundColor: 'rgba(16,46,80,0.8)' },
  unreadLine: { alignItems: 'center', marginVertical: spacing.sm, paddingVertical: 4, backgroundColor: 'rgba(244,162,97,0.14)', borderRadius: radius.md },
  unreadText: { fontSize: 12, color: colors.accent, fontWeight: '800' },
  slowHint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: 4, backgroundColor: 'rgba(16,46,80,0.9)' },
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
  headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#25D366' },
  headerOnline: { ...typography.caption, color: '#25D366', fontWeight: '700' },

  listContent: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md, flexGrow: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
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
  burstHeart: { position: 'absolute', alignSelf: 'center', top: '30%', fontSize: 40, zIndex: 5 },
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

  imageMsg: { borderRadius: 5, backgroundColor: colors.surface },  // width/height inline (reactive)
  uploadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2, paddingRight: spacing.xs, minWidth: 180 },
  fileIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  fileName: { flex: 1, fontSize: 14, fontWeight: '600' },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 160, paddingVertical: 2 },
  audioBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.3)', overflow: 'hidden' },
  audioBarFill: { width: '100%', height: '100%', opacity: 0.8 },
  audioDuration: { fontSize: 12, fontWeight: '600', minWidth: 34, textAlign: 'right' },

  emptyContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingTop: 80, paddingHorizontal: spacing.xl,
  },
  // Capped so the welcome copy stays a readable column on a tablet or in
  // landscape instead of running the full width of the screen.
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center', maxWidth: 340 },

  jumpFab: {
    position: 'absolute', right: spacing.md, bottom: 76, zIndex: 30,
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', ...shadows.lg,
  },
  msgRowHighlight: { backgroundColor: 'rgba(244,162,97,0.22)', borderRadius: radius.md },
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

  pinnedBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  pinnedTitle: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  pinnedText: { ...typography.caption, color: colors.textSecondary },

  searchOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0A1628', zIndex: 20 },
  searchHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16, paddingVertical: spacing.xs },
  searchList: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  searchResult: {
    backgroundColor: 'rgba(16,46,80,0.55)', borderRadius: radius.md, padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  searchResultName: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  searchResultText: { ...typography.body, color: colors.textPrimary, marginTop: 2 },
  searchResultTime: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
  searchEmpty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },

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
  receiptCount: { ...typography.caption, color: colors.accent, fontWeight: '700', marginTop: spacing.xs, marginBottom: spacing.sm },
  receiptList: { gap: spacing.sm, maxHeight: 320 },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  receiptAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(244,162,97,0.35)' },
  receiptName: { ...typography.body, color: colors.textPrimary, flex: 1 },

  promptInput: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, marginTop: spacing.sm,
    color: colors.textPrimary, backgroundColor: 'rgba(13,35,64,0.85)', fontSize: 15, minHeight: 48,
  },
  promptActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  promptBtn: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.md, alignItems: 'center' },
  promptCancel: { backgroundColor: 'rgba(18,30,46,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  promptCancelText: { ...typography.button, color: colors.textSecondary, fontWeight: '700' },
  promptSave: { backgroundColor: colors.accent },
  promptSaveText: { ...typography.button, color: '#0A1628', fontWeight: '800' },
  promptDisabled: { opacity: 0.5 },
  welcomeIcon: {
    width: 52, height: 52, borderRadius: 26, marginBottom: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(244,162,97,0.12)',
  },
  welcomeTitle: {
    fontSize: 16, fontWeight: '800', color: colors.textPrimary,
    marginBottom: 4, textAlign: 'center', maxWidth: 340,
  },
  categoryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'center',
    marginTop: 6, paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999,
    backgroundColor: 'rgba(244,162,97,0.14)',
  },
  categoryBadgeText: { fontSize: 11, fontWeight: '800', color: colors.accent },
  detailBlock: { marginTop: 10, gap: 4, alignSelf: 'stretch' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  detailValue: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, flexShrink: 1, textAlign: 'right' },
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
