// A post's (or a track's) comments: the trigger and the full-screen sheet.
// Pass `postId` for a post or `trackId` for a track — same section for both.
//
// TikTok-style comment section:
//   - a heart with a count on every comment; long-press for other reactions
//   - Reply, with threads under each comment ("View 3 replies")
//   - @mentions and #hashtags in comments are tappable, with autocomplete
//     while typing, and an emoji bar above the box
//   - opened from a notification, it scrolls to that exact comment (opening
//     its thread if it's a reply) and flashes it
// Everything the user does lands instantly and reconciles with the server
// behind the scenes; a failure rolls back and says so.
import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet, FlatList, Alert, Pressable,
} from 'react-native';
// expo-image: commenters' faces repeat across posts; the shared memory+disk
// cache paints them instantly instead of re-downloading per sheet.
import { Image } from 'expo-image';
import { Feather, Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import { useAuth } from '../context/useAuth';
import { commentApi } from '../services/commentApi';
import { peekCache, writeCache } from '../utils/screenCache';
import {
  buildRows, toggleReaction, updateComment, addReply, mergeReplies, REACTIONS, LIKE, EMPTY_REACTIONS,
} from '../utils/commentThreads';
import { useTokenSuggestions, useForcedSelection, SuggestionList } from './MentionSuggestions';
import RichCaption from './RichCaption';
import BottomSheet from './BottomSheet';
import formatCount from '../utils/formatCount';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const QUICK_EMOJIS = ['❤️', '😂', '🔥', '👏', '😍', '🙏', '😮', '🙌'];
const HIGHLIGHT_MS = 2500;

const timeAgo = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

// Lightweight placeholder rows shown only on the very first load (no cache yet),
// so the sheet feels instant instead of blocking on a "Loading..." message.
const CommentSkeleton = () => (
  <View style={{ paddingTop: 4 }}>
    {[0, 1, 2, 3, 4].map((i) => (
      <View key={i} style={styles.skeletonRow}>
        <View style={styles.skeletonAvatar} />
        <View style={{ flex: 1 }}>
          <View style={[styles.skeletonLine, { width: '35%' }]} />
          <View style={[styles.skeletonLine, { width: '80%', marginTop: 6 }]} />
        </View>
      </View>
    ))}
  </View>
);

// Top-level comments, kept for this session. The feed recycles its cards, so a
// component-local list was lost the moment a post scrolled away. Memory only:
// one key per post/track would grow disk storage without bound.
const rememberComments = (key, list) =>
  writeCache(key, list.filter((c) => !c.pending), { persist: false });

const CommentRow = memo(({ comment, depth, highlighted, onReply, onHeart, onReact, onLink, t }) => {
  const r = comment.reactions || EMPTY_REACTIONS;
  const mine = r.mine;
  const others = r.top.filter((e) => e !== LIKE);
  return (
    <Pressable
      onLongPress={() => !comment.pending && onReact(comment)}
      delayLongPress={280}
      style={[styles.row, depth > 0 && styles.rowReply, comment.pending && styles.pending, highlighted && styles.highlighted]}
    >
      <Image
        source={comment.user?.profile_picture ? { uri: comment.user.profile_picture } : DEFAULT_AVATAR}
        placeholder={DEFAULT_AVATAR}
        cachePolicy="memory-disk"
        contentFit="cover"
        style={depth > 0 ? styles.avatarSmall : styles.avatar}
      />
      <View style={styles.body}>
        <Text style={styles.username} numberOfLines={1}>
          {comment.user?.username}
          {depth > 0 && comment.reply_to?.username && comment.reply_to.username !== comment.user?.username ? (
            <Text style={styles.replyTo}>{'  ▸ '}{comment.reply_to.username}</Text>
          ) : null}
        </Text>
        <RichCaption style={styles.text} text={comment.content} onLinkPress={onLink} />
        <View style={styles.meta}>
          <Text style={styles.metaText}>{comment.pending ? t('upload.posting') : timeAgo(comment.created_at)}</Text>
          {!comment.pending && (
            <TouchableOpacity onPress={() => onReply(comment)} hitSlop={8}>
              <Text style={styles.replyBtn}>{t('comments.reply')}</Text>
            </TouchableOpacity>
          )}
          {others.length > 0 && <Text style={styles.reactionChips}>{others.join('')}</Text>}
        </View>
      </View>
      <TouchableOpacity
        style={styles.heart}
        onPress={() => !comment.pending && onHeart(comment)}
        onLongPress={() => !comment.pending && onReact(comment)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('comments.like')}
      >
        {mine && mine !== LIKE ? (
          <Text style={styles.mineEmoji}>{mine}</Text>
        ) : (
          <Ionicons name={mine ? 'heart' : 'heart-outline'} size={18} color={mine ? '#FE2C55' : colors.textMuted} />
        )}
        {r.total > 0 && <Text style={[styles.heartCount, mine && styles.heartCountMine]}>{formatCount(r.total)}</Text>}
      </TouchableOpacity>
    </Pressable>
  );
});
CommentRow.displayName = 'CommentRow';

const MoreRow = memo(({ row, onToggle, t }) => {
  const label = row.label === 'hide'
    ? t('comments.hide')
    : row.label === 'more'
      ? t('comments.viewMore')
      : row.remaining === 1 ? t('comments.viewReply') : t('comments.viewReplies', { count: row.remaining });
  return (
    <TouchableOpacity style={styles.moreRow} onPress={() => onToggle(row)} hitSlop={6}>
      <View style={styles.moreLine} />
      <Text style={styles.moreText}>{label}</Text>
      <Feather name={row.label === 'hide' ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
    </TouchableOpacity>
  );
});
MoreRow.displayName = 'MoreRow';

const CommentAction = ({
  postId, trackId, commentCount, flatListRef, autoOpen, onCommentsLoaded, onCommentPosted,
  currentUserAvatar, commentsEnabled = true, triggerVariant = 'icon', highlightCommentId = null,
}) => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const kbHeight = useKeyboardHeight(); // float the comment box above the keyboard (edge-to-edge safe)
  const api = useMemo(
    () => (trackId != null ? commentApi('track', trackId) : commentApi('post', postId)),
    [postId, trackId],
  );
  const [comments, setComments] = useState(() => peekCache(api.cacheKey) ?? []);
  // Reply threads: { [topCommentId]: { items, open, hasMore, page, loading } }
  const [threads, setThreads] = useState({});
  const [showComments, setShowComments] = useState(autoOpen || false);
  const [text, setText] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [forcedSelection, setCaret] = useForcedSelection();
  const [replyTarget, setReplyTarget] = useState(null);
  const [pickerFor, setPickerFor] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const internalListRef = useRef(null);
  const listRef = flatListRef || internalListRef;
  const inputRef = useRef(null);
  const commentsRef = useRef(comments);
  const threadsRef = useRef(threads);
  const highlightDoneRef = useRef(null);
  const { currentUser } = useAuth();
  const myAvatar = currentUserAvatar || currentUser?.profile_picture || null;

  // Comments posted from here that the `commentCount` prop doesn't include
  // yet, so the button ticks up the moment you post (and back if it fails).
  // Reset whenever the parent hands us a fresh count, which already has them.
  const [added, setAdded] = useState(0);
  useEffect(() => { setAdded(0); }, [commentCount]);
  const shownCount = (commentCount || 0) + added;
  const shownCountRef = useRef(shownCount);
  useEffect(() => { shownCountRef.current = shownCount; }, [shownCount]);

  useEffect(() => { commentsRef.current = comments; }, [comments]);
  useEffect(() => { threadsRef.current = threads; }, [threads]);
  useEffect(() => { if (autoOpen) setShowComments(true); }, [autoOpen]);
  useEffect(() => {
    if (comments.length > 0 && onCommentsLoaded) onCommentsLoaded(comments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments]);

  const rows = useMemo(() => buildRows(comments, threads), [comments, threads]);

  // Stale-while-revalidate: the skeleton only on a true cold load.
  const fetchComments = useCallback(async () => {
    const hadCache = commentsRef.current.length > 0;
    try {
      if (!hadCache) setLoading(true);
      const data = await api.list();
      const list = Array.isArray(data) ? data : (data ?? []);
      // Keep a comment that's mid-post; the fetch can't know about it yet.
      setComments((prev) => [...prev.filter((c) => c.pending), ...list]);
      rememberComments(api.cacheKey, list);
    } catch (error) {
      if (!hadCache) Alert.alert(t('common.error'), t('comments.loadFailed'));
      console.error('Comments fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [api, t]);

  useEffect(() => {
    if (!showComments) return;
    fetchComments();
  }, [showComments, fetchComments]);

  // ── threads ──
  const loadReplies = useCallback(async (parentId, page = 1) => {
    setThreads((prev) => ({ ...prev, [parentId]: { items: [], hasMore: false, ...prev[parentId], open: true, loading: true } }));
    try {
      const res = await api.replies(parentId, page);
      const pageItems = res?.results ?? (Array.isArray(res) ? res : []);
      setThreads((prev) => {
        const th = prev[parentId] || { items: [] };
        return {
          ...prev,
          [parentId]: { ...th, open: true, loading: false, page, hasMore: !!res?.next, items: mergeReplies(th.items, pageItems) },
        };
      });
      return pageItems;
    } catch {
      setThreads((prev) => ({ ...prev, [parentId]: { ...prev[parentId], loading: false } }));
      return [];
    }
  }, [api]);

  const toggleThread = useCallback((row) => {
    const id = row.parent.id;
    const th = threadsRef.current[id];
    if (row.label === 'hide') {
      setThreads((prev) => ({ ...prev, [id]: { ...prev[id], open: false } }));
    } else if (row.label === 'more') {
      if (!th?.loading) loadReplies(id, (th?.page || 1) + 1);
    } else if (th?.items?.length && !th.hasMore && th.items.length >= (row.parent.replies_count || 0)) {
      setThreads((prev) => ({ ...prev, [id]: { ...prev[id], open: true } }));
    } else {
      loadReplies(id, 1);
    }
  }, [loadReplies]);

  // ── reactions ──
  const react = useCallback(async (comment, emoji) => {
    setPickerFor(null);
    const before = comment.reactions || EMPTY_REACTIONS;
    const apply = (reactions) => {
      const out = updateComment(commentsRef.current, threadsRef.current, comment.id, (c) => ({ ...c, reactions }));
      setComments(out.comments);
      setThreads(out.threads);
    };
    apply(toggleReaction(before, emoji));
    try {
      const res = await api.react(comment.id, emoji);
      if (res?.reactions) apply(res.reactions);
    } catch {
      apply(before);
    }
  }, [api]);
  const onHeart = useCallback((comment) => react(comment, LIKE), [react]);
  const onReact = useCallback((comment) => setPickerFor(comment), []);

  // ── replying ──
  const onReply = useCallback((comment) => {
    setReplyTarget(comment);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // A tag or name tapped inside a comment: close the sheet first, or the
  // profile/tag page would open underneath it.
  const onLink = useCallback((type, value) => {
    setShowComments(false);
    setTimeout(() => {
      if (type === 'hashtag') navigation.navigate('Hashtag', { tag: value });
      else navigation.navigate('UserProfile', { username: value });
    }, 250);
  }, [navigation]);

  // ── the box ──
  const { token, items, loading: suggesting, pick, visible: suggestionsVisible } =
    useTokenSuggestions(text, selection.end);
  const applyText = (next) => {
    if (!next) return;
    setText(next.text);
    setSelection({ start: next.cursor, end: next.cursor });
    setCaret(next.cursor);
  };
  const insertEmoji = (emoji) => {
    const at = selection.end ?? text.length;
    applyText({ text: text.slice(0, at) + emoji + text.slice(at), cursor: at + emoji.length });
  };

  const handleSend = async () => {
    const content = text.trim();
    if (!content) return;
    const target = replyTarget;
    const parentId = target ? (target.parent || target.id) : null;
    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      content,
      pending: true,
      parent: parentId,
      reply_to: target ? target.user : null,
      replies_count: 0,
      reactions: EMPTY_REACTIONS,
      created_at: new Date().toISOString(),
      user: { id: currentUser?.id, username: currentUser?.username || 'You', profile_picture: myAvatar },
    };

    if (parentId) {
      const out = addReply(commentsRef.current, threadsRef.current, parentId, optimistic);
      setComments(out.comments);
      setThreads(out.threads);
    } else {
      setComments((prev) => [optimistic, ...prev]);
      requestAnimationFrame(() => listRef.current?.scrollToOffset?.({ offset: 0, animated: true }));
    }
    setAdded((n) => n + 1);
    setText('');
    setReplyTarget(null);

    try {
      const created = await api.create(content, target ? target.id : null);
      const real = { reactions: EMPTY_REACTIONS, replies_count: 0, ...created, user: created?.user || optimistic.user };
      const out = updateComment(commentsRef.current, threadsRef.current, tempId, () => real);
      setComments(out.comments);
      setThreads(out.threads);
      if (!parentId) rememberComments(api.cacheKey, out.comments);
      onCommentPosted?.(shownCountRef.current);
    } catch (error) {
      // Roll back and restore the text so the user can retry.
      if (parentId) {
        setThreads((prev) => ({ ...prev, [parentId]: { ...prev[parentId], items: prev[parentId].items.filter((r) => r.id !== tempId) } }));
        setComments((prev) => prev.map((c) => (c.id === parentId ? { ...c, replies_count: Math.max(0, (c.replies_count || 1) - 1) } : c)));
      } else {
        setComments((prev) => prev.filter((c) => c.id !== tempId));
      }
      setAdded((n) => Math.max(0, n - 1));
      setText(content);
      setReplyTarget(target);
      // 403 = the author turned comments off after this sheet opened.
      Alert.alert(t('common.error'),
        error?.response?.status === 403 ? t('comments.turnedOff') : t('comments.postFailed'));
    }
  };

  // ── opened from a notification: bring that comment into view ──
  useEffect(() => {
    if (!showComments || !highlightCommentId || loading) return;
    if (highlightDoneRef.current === highlightCommentId) return;
    const id = Number(highlightCommentId);
    const topLevel = commentsRef.current.find((c) => c.id === id);
    highlightDoneRef.current = highlightCommentId;
    if (topLevel) {
      setHighlightedId(id);
      return;
    }
    (async () => {
      try {
        const target = await api.get(id);
        if (!target) return;
        if (!target.parent) {
          // A top comment beyond the first page: bring it to the top.
          setComments((prev) => (prev.some((c) => c.id === id) ? prev : [target, ...prev]));
        } else {
          if (!commentsRef.current.some((c) => c.id === target.parent)) {
            const parent = await api.get(target.parent);
            if (parent) setComments((prev) => [parent, ...prev.filter((c) => c.id !== parent.id)]);
          }
          // Open the thread, paging a little way in if the reply is deep.
          for (let page = 1; page <= 5; page += 1) {
            const got = await loadReplies(target.parent, page);
            if (got.some((r) => r.id === id) || !threadsRef.current[target.parent]?.hasMore) break;
          }
        }
        setHighlightedId(id);
      } catch {
        // deleted or hidden — the sheet just opens normally
      }
    })();
  }, [showComments, highlightCommentId, loading, loadReplies, api]);

  useEffect(() => {
    if (!highlightedId) return undefined;
    const index = rows.findIndex((r) => r.type === 'comment' && r.comment.id === highlightedId);
    if (index >= 0) {
      setTimeout(() => listRef.current?.scrollToIndex?.({ index, viewPosition: 0.3, animated: true }), 350);
    }
    const clear = setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
    return () => clearTimeout(clear);
    // Only when a new comment is highlighted, not on every row change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedId]);

  const handleScrollToIndexFailed = ({ index }) => {
    setTimeout(() => listRef.current?.scrollToIndex?.({ index, viewPosition: 0.3 }), 500);
  };

  const renderRow = useCallback(({ item }) => (item.type === 'more' ? (
    <MoreRow row={item} onToggle={toggleThread} t={t} />
  ) : (
    <CommentRow
      comment={item.comment}
      depth={item.depth}
      highlighted={item.comment.id === highlightedId}
      onReply={onReply}
      onHeart={onHeart}
      onReact={onReact}
      onLink={onLink}
      t={t}
    />
  )), [toggleThread, highlightedId, onReply, onHeart, onReact, onLink, t]);

  const postsLabel = useCallback((n) => t('sound.uses', { count: n }), [t]);

  return (
    <>
      {triggerVariant === 'bar' ? (
        // Full-width comments bar (the post detail screen), lifted above the
        // home indicator via the bottom safe-area edge.
        <SafeAreaView edges={['bottom']} style={styles.commentBarWrap}>
          <TouchableOpacity
            style={styles.commentBar}
            onPress={() => setShowComments(true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="View comments"
          >
            <View style={styles.commentBarIcon}>
              <Feather name="message-circle" size={18} color={colors.accent} />
            </View>
            <Text style={styles.commentBarText} numberOfLines={1}>
              {shownCount > 0
                ? `View all ${shownCount} ${shownCount === 1 ? 'comment' : 'comments'}`
                : t('comments.beFirst')}
            </Text>
            <Feather name="chevron-right" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </SafeAreaView>
      ) : triggerVariant === 'compact' ? (
        // The small icon + count used in a track row's action bar.
        <TouchableOpacity style={styles.compactButton} onPress={() => setShowComments(true)} hitSlop={8}>
          <Feather name="message-circle" size={18} color={colors.textSecondary} />
          <Text style={styles.compactText}>{formatCount(shownCount)}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.actionButton} onPress={() => setShowComments(true)}>
          <Feather name="message-circle" size={24} color="#FFF" />
          <Text style={styles.actionText}>{shownCount}</Text>
        </TouchableOpacity>
      )}

      {/* TikTok-style: a sheet over the lower part of the screen, the post
          still visible above it. Swipe down, tap above it, or press back. */}
      <BottomSheet
        visible={showComments}
        onClose={() => setShowComments(false)}
        keyboardHeight={kbHeight}
        header={(
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>
              {shownCount > 0 ? t('comments.titleCount', { count: formatCount(shownCount) }) : t('comments.title')}
            </Text>
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowComments(false)} hitSlop={8}>
              <Feather name="x" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
        overlay={pickerFor ? (
          // Reaction picker (long-press a comment or its heart)
          <Pressable style={styles.pickerBackdrop} onPress={() => setPickerFor(null)}>
            <View style={styles.picker}>
              <Text style={styles.pickerTitle} numberOfLines={1}>
                {t('comments.reactTo', { name: pickerFor.user?.username || '' })}
              </Text>
              <View style={styles.pickerRow}>
                {REACTIONS.map((e) => (
                  <TouchableOpacity
                    key={e}
                    style={[styles.pickerBtn, pickerFor.reactions?.mine === e && styles.pickerBtnActive]}
                    onPress={() => react(pickerFor, e)}
                  >
                    <Text style={styles.pickerEmoji}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </Pressable>
        ) : null}
      >
            {loading && comments.length === 0 ? (
              <CommentSkeleton />
            ) : (
              <FlatList
                ref={listRef}
                style={styles.list}
                data={rows}
                keyExtractor={(r) => r.key}
                renderItem={renderRow}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Ionicons name="chatbubbles-outline" size={40} color={colors.textMuted} />
                    <Text style={styles.emptyText}>{t('comments.empty')}</Text>
                  </View>
                }
                onScrollToIndexFailed={handleScrollToIndexFailed}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={9}
                keyboardShouldPersistTaps="handled"
              />
            )}

            {!commentsEnabled ? (
              // The author switched comments off: existing ones stay readable,
              // there's just nowhere to add a new one.
              <View style={styles.closedNotice}>
                <Feather name="slash" size={16} color={colors.textMuted} />
                <Text style={styles.closedText}>{t('comments.turnedOff')}</Text>
              </View>
            ) : (
              <View style={styles.composer}>
                {suggestionsVisible && (
                  <SuggestionList
                    style={styles.suggestions}
                    token={token}
                    items={items}
                    loading={suggesting}
                    postsLabel={postsLabel}
                    onPick={(v) => applyText(pick(v))}
                  />
                )}
                {replyTarget && (
                  <View style={styles.replyBanner}>
                    <Text style={styles.replyBannerText} numberOfLines={1}>
                      {t('comments.replyingTo', { name: replyTarget.user?.username || '' })}
                    </Text>
                    <TouchableOpacity onPress={() => setReplyTarget(null)} hitSlop={10}>
                      <Feather name="x" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                )}
                <View style={styles.emojiBar}>
                  {QUICK_EMOJIS.map((e) => (
                    <TouchableOpacity key={e} onPress={() => insertEmoji(e)} hitSlop={4} style={styles.emojiBtn}>
                      <Text style={styles.emoji}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.inputContainer}>
                  <Image
                    source={myAvatar ? { uri: myAvatar } : DEFAULT_AVATAR}
                    placeholder={DEFAULT_AVATAR}
                    cachePolicy="memory-disk"
                    contentFit="cover"
                    style={styles.userAvatar}
                  />
                  <TextInput
                    ref={inputRef}
                    style={styles.input}
                    placeholder={replyTarget
                      ? t('comments.replyPlaceholder', { name: replyTarget.user?.username || '' })
                      : t('comments.placeholder')}
                    placeholderTextColor={colors.placeholder}
                    value={text}
                    onChangeText={setText}
                    onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
                    selection={forcedSelection}
                    multiline
                    maxLength={2200}
                    autoCorrect={!token}
                    autoCapitalize={token ? 'none' : 'sentences'}
                  />
                  <TouchableOpacity
                    style={[styles.postButton, !text.trim() && styles.postButtonDisabled]}
                    onPress={handleSend}
                    disabled={!text.trim()}
                    accessibilityRole="button"
                    accessibilityLabel="Send comment"
                  >
                    <Feather name="send" size={19} color={colors.white} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
      </BottomSheet>
    </>
  );
};

const styles = StyleSheet.create({
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
  actionText: { fontSize: 14, color: '#FFF' },
  compactButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6, paddingVertical: 4 },
  compactText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  commentBarWrap: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(8,20,40,0.6)',
  },
  commentBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginVertical: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
    ...shadows.sm,
  },
  commentBarIcon: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(244,162,97,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  commentBarText: { flex: 1, ...typography.label, color: colors.textSecondary, fontWeight: '600' },

  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingTop: 8, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  closeButton: { position: 'absolute', right: spacing.md, padding: 4 },
  list: { flex: 1 },

  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: spacing.md },
  rowReply: { paddingLeft: spacing.md + 44, paddingVertical: 8 },
  pending: { opacity: 0.6 },
  highlighted: { backgroundColor: 'rgba(29,161,242,0.16)' },
  avatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10, backgroundColor: colors.surface },
  avatarSmall: { width: 26, height: 26, borderRadius: 13, marginRight: 8, backgroundColor: colors.surface },
  body: { flex: 1 },
  username: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: 2 },
  replyTo: { color: colors.textMuted, fontWeight: '600' },
  text: { color: colors.textPrimary, fontSize: 14.5, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 5 },
  metaText: { color: colors.textMuted, fontSize: 12 },
  replyBtn: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  reactionChips: { fontSize: 12 },
  heart: { alignItems: 'center', minWidth: 34, paddingLeft: 8, paddingTop: 2 },
  mineEmoji: { fontSize: 17 },
  heartCount: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  heartCountMine: { color: colors.textPrimary, fontWeight: '700' },

  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: spacing.md + 46, paddingVertical: 6 },
  moreLine: { width: 22, height: StyleSheet.hairlineWidth, backgroundColor: colors.textMuted },
  moreText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },

  skeletonRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, padding: 12 },
  skeletonAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 12, backgroundColor: 'rgba(255,255,255,0.10)' },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.10)' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: spacing.sm },
  emptyText: { color: colors.textSecondary, fontSize: 15 },

  composer: {
    paddingHorizontal: spacing.md, paddingTop: 6, paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(8,18,34,0.85)',
  },
  suggestions: { marginBottom: 6 },
  replyBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.sm, paddingVertical: 6, marginBottom: 6, borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  replyBannerText: { flex: 1, color: colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  emojiBar: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, marginBottom: 4 },
  emojiBtn: { paddingHorizontal: 2 },
  emoji: { fontSize: 24 },
  inputContainer: { flexDirection: 'row', alignItems: 'center' },
  userAvatar: { width: 34, height: 34, borderRadius: 17, marginRight: 10, backgroundColor: colors.surface },
  input: {
    flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 9, marginRight: 8, fontSize: 14, color: colors.textPrimary,
    backgroundColor: colors.inputBg, maxHeight: 110,
  },
  postButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  postButtonDisabled: { opacity: 0.45 },
  closedNotice: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)',
  },
  closedText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },

  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', alignItems: 'center', padding: spacing.lg,
  },
  picker: {
    width: '100%', maxWidth: 380, borderRadius: radius.xl, padding: spacing.md,
    backgroundColor: 'rgba(14,30,52,0.98)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    ...shadows.lg,
  },
  pickerTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: spacing.sm },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  pickerBtn: { padding: 6, borderRadius: 22 },
  pickerBtnActive: { backgroundColor: 'rgba(29,161,242,0.25)' },
  pickerEmoji: { fontSize: 30 },
});

export default CommentAction;
