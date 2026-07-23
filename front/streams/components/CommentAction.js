import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  FlatList,
  Image,
  Alert
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/useAuth';
import { commentOnPost, fetchSocialPostComments, getAccessToken, API_URL } from '../services/api';
import RotatingBackground from './RotatingBackground';
import ScreenVignette from './ScreenVignette';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

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

const CommentAction = ({ postId, commentCount, flatListRef, autoOpen, onCommentsLoaded, currentUserAvatar, triggerVariant = 'icon' }) => {
  const { t } = useI18n();
  const [comments, setComments] = useState([]);
  const [showComments, setShowComments] = useState(autoOpen || false);
  const [newComment, setNewComment] = useState('');
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const internalFlatListRef = useRef(null);
  const activeFlatListRef = flatListRef || internalFlatListRef;
  const profileFetchedRef = useRef(false);
  const commentsRef = useRef([]);
  const { currentUser } = useAuth();

  // Mirror comments into a ref so async callbacks can read the latest list
  // without being re-created (and going stale) on every change.
  useEffect(() => { commentsRef.current = comments; }, [comments]);

  useEffect(() => {
    if (autoOpen) {
      setShowComments(true);
    }
  }, [autoOpen]);

  useEffect(() => {
    if (comments.length > 0 && onCommentsLoaded) {
      onCommentsLoaded(comments);
    }
  }, [comments]);

  // Stale-while-revalidate: only show the skeleton on a true cold load (no
  // comments cached yet). On reopen we keep showing the cached list and refresh
  // silently in the background, so the sheet never blocks.
  const fetchComments = useCallback(async () => {
    const hadCache = commentsRef.current.length > 0;
    try {
      if (!hadCache) setLoading(true);
      const data = await fetchSocialPostComments(postId);
      setComments(Array.isArray(data) ? data : (data ?? []));
    } catch (error) {
      // Only surface an error if there's nothing to show.
      if (!hadCache) Alert.alert(t('common.error'), t('comments.loadFailed'));
      console.error('Comments fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [postId, t]);

  const fetchUserProfile = async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;

      const response = await fetch(`${API_URL}/profiles/me/`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setUserProfile(data);
    } catch (error) {
      console.error('Profile fetch error:', error);
    }
  };

  // Load comments — and the input avatar — only when the modal is opened. This
  // used to fetch /profiles/me/ on mount for EVERY post in the feed, firing one
  // duplicate request per card and slowing the whole feed.
  useEffect(() => {
    if (!showComments) return;
    fetchComments();
    if (!currentUserAvatar && !profileFetchedRef.current) {
      profileFetchedRef.current = true;
      fetchUserProfile();
    }
  }, [showComments]);

  // Optimistic post: the comment appears at the top instantly (TikTok-style),
  // then we reconcile in place with the server's response — no full reload.
  const handlePostComment = async () => {
    const content = newComment.trim();
    if (!content) {
      Alert.alert(t('common.error'), t('comments.cannotBeEmpty'));
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      content,
      pending: true,
      user: {
        username: currentUser?.username || 'You',
        profile_picture:
          currentUserAvatar || currentUser?.profile_picture || userProfile?.picture || null,
      },
    };

    setComments((prev) => [optimistic, ...prev]);
    setNewComment('');
    requestAnimationFrame(() =>
      activeFlatListRef.current?.scrollToOffset?.({ offset: 0, animated: true })
    );

    try {
      const created = await commentOnPost(postId, content);
      if (created && created.id) {
        // Swap the temp row for the real one in place (keeps its position).
        setComments((prev) =>
          prev.map((c) =>
            c.id === tempId ? { ...created, user: created.user || optimistic.user } : c
          )
        );
      } else {
        // Unknown response shape — reconcile quietly without a blocking spinner.
        fetchComments();
      }
    } catch (error) {
      // Roll back and restore the text so the user can retry.
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setNewComment(content);
      Alert.alert(t('common.error'), t('comments.postFailed'));
      console.error('Comment post error:', error);
    }
  };

  const scrollToComment = (commentId) => {
    if (!commentId || !activeFlatListRef.current) return;
    
    const index = comments.findIndex(c => c.id === commentId);
    if (index >= 0) {
      setTimeout(() => {
        activeFlatListRef.current?.scrollToIndex({
          index,
          viewOffset: 50,
          animated: true
        });
      }, 500);
    }
  };

  const handleScrollToIndexFailed = ({ index }) => {
    setTimeout(() => {
      activeFlatListRef.current?.scrollToIndex({ index });
    }, 500);
  };

  return (
    <>
      {triggerVariant === 'bar' ? (
        // Full-width luxury comments bar (used on the post detail screen). Lifts
        // above the home indicator via the bottom safe-area edge.
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
              {commentCount > 0
                ? `View all ${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`
                : t('comments.beFirst')}
            </Text>
            <Feather name="chevron-right" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </SafeAreaView>
      ) : (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => setShowComments(true)}
        >
          <Feather name="message-circle" size={24} color="#FFF" />
          <Text style={styles.actionText}>{commentCount}</Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={showComments}
        animationType="slide"
        onRequestClose={() => setShowComments(false)}
      >
        <View style={styles.modalRoot}>
          {/* Same rotating wallpaper + navy vignette as the feed, behind a
              dark glass comments sheet. */}
          <RotatingBackground intervalMs={60000} blurIntensity={5} tint="default" scrimColor="transparent" />
          <ScreenVignette tintRgb="6,16,34" zIndex={1} />

          <SafeAreaView edges={['top']} style={styles.content}>
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>{t('comments.title')}</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowComments(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

          {loading && comments.length === 0 ? (
            <CommentSkeleton />
          ) : (
            <FlatList
              ref={activeFlatListRef}
              data={comments}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <View style={[styles.commentItem, item.pending && styles.commentItemPending]}>
                  <Image
                    source={item.user?.profile_picture ? { uri: item.user.profile_picture } : DEFAULT_AVATAR}
                    defaultSource={DEFAULT_AVATAR}
                    style={styles.avatar}
                  />
                  <View style={styles.commentContent}>
                    <Text style={styles.username}>{item.user?.username}</Text>
                    <Text style={styles.commentText}>{item.content}</Text>
                  </View>
                  {item.pending && <Feather name="clock" size={14} color="#999" style={styles.pendingIcon} />}
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>{t('comments.empty')}</Text>
                </View>
              }
              onScrollToIndexFailed={handleScrollToIndexFailed}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={7}
              removeClippedSubviews
              keyboardShouldPersistTaps="handled"
            />
          )}

          <View style={styles.inputContainer}>
            <Image
              source={
                currentUserAvatar || userProfile?.picture
                  ? { uri: currentUserAvatar || userProfile.picture }
                  : DEFAULT_AVATAR
              }
              defaultSource={DEFAULT_AVATAR}
              style={styles.userAvatar}
            />
            <TextInput
              style={styles.input}
              placeholder={t('comments.placeholder')}
              placeholderTextColor={colors.placeholder}
              value={newComment}
              onChangeText={setNewComment}
              multiline
            />
            <TouchableOpacity
              style={[styles.postButton, !newComment.trim() && styles.postButtonDisabled]}
              onPress={handlePostComment}
              disabled={!newComment.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send comment"
            >
              <Feather name="send" size={20} color={colors.white} />
            </TouchableOpacity>
          </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  actionText: {
    fontSize: 14,
    color: '#FFF',
  },
  // Luxury full-width comments bar (post detail).
  commentBarWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(8,20,40,0.6)',
  },
  commentBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    ...shadows.sm,
  },
  commentBarIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(244,162,97,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentBarText: {
    flex: 1,
    ...typography.label,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  // Dark glass comments sheet over the rotating wallpaper.
  modalRoot: {
    flex: 1,
    backgroundColor: colors.bg, // fallback behind the wallpaper
  },
  content: {
    flex: 1,
    zIndex: 2, // above the vignette (zIndex 1)
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.3,
  },
  closeButton: {
    padding: 4,
  },
  commentItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    padding: 12,
    backgroundColor: 'rgba(16,28,46,0.92)',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  commentItemPending: {
    opacity: 0.6,
  },
  pendingIcon: {
    marginLeft: 8,
    alignSelf: 'center',
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    padding: 12,
  },
  skeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: colors.surface,
  },
  commentContent: {
    flex: 1,
  },
  username: {
    fontWeight: '700',
    marginBottom: 4,
    color: colors.textPrimary,
  },
  commentText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 19,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginRight: 8,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
    maxHeight: 110,
  },
  postButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postButtonDisabled: {
    opacity: 0.45,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
});

export default CommentAction;