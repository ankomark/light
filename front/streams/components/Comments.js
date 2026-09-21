import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  FlatList,
  Modal,
  Alert
} from 'react-native';
// expo-image: the comment avatars are the same faces over and over, so a
// real memory+disk cache means they paint from cache instead of re-fetching.
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import { useFocusEffect } from '@react-navigation/native';
import { fetchComments, postComment, getAccessToken } from '../services/api';
import { useAuth } from '../context/useAuth';
import RotatingBackground from './RotatingBackground';
import ScreenVignette from './ScreenVignette';
import { colors } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// Placeholder rows on first (cold) load so the sheet feels instant.
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

const Comments = ({ trackId, initialCount = 0, highlightCommentId, autoOpen = false }) => {
    const { t } = useI18n();
    const kbHeight = useKeyboardHeight(); // float the comment box above the keyboard (edge-to-edge safe)
    const flatListRef = useRef(null);
    const [highlightedComment, setHighlightedComment] = useState(null);
    const [comments, setComments] = useState([]);
    // Starts false: nothing is being fetched until the sheet is opened.
    const [loading, setLoading] = useState(false);
    // Whether this track's comments have ever been fetched — drives both the
    // count shown on the closed button and the stale-while-revalidate reopen.
    const [fetched, setFetched] = useState(false);
    const [newComment, setNewComment] = useState('');
    const [showComments, setShowComments] = useState(autoOpen);
    const { currentUser } = useAuth();

    // Mirrors `comments` so the fetch below can check for a cached list without
    // depending on it (which would re-create the callback on every change).
    // Declared HERE, above its first reader: it used to sit further down, which
    // worked only because nothing read it during render — a temporal-dead-zone
    // trap for the next person to touch this file.
    const commentsRef = useRef([]);

    const fetchCommentData = useCallback(async () => {
        const hadCache = commentsRef.current.length > 0;
        try {
            // Only block the sheet on a true cold load. On reopen we keep the
            // cached list up and refresh behind it.
            if (!hadCache) setLoading(true);
            // The serializer now includes user.profile_picture, so this is a
            // single request — no more per-comment profile lookups (N+1).
            const data = await fetchComments(trackId);
            setComments(Array.isArray(data) ? data : []);
            setFetched(true);
        } catch (error) {
            console.error('Failed to fetch comments:', error);
            if (!hadCache) Alert.alert(t('common.error'), t('comments.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [trackId, t]);

    // Fetch ONLY when the sheet is open.
    //
    // This component is rendered inside every row of the track list, and when
    // closed it draws one thing: a button with a number on it. It used to get
    // that number by downloading the track's entire comment list on mount — so
    // opening the music screen fired one comment request per visible row, plus
    // more as you scrolled. The count comes from the track payload now
    // (`comments_count`), and the list is fetched when someone opens it. The
    // feed's CommentAction was fixed this way already; this is the same fix.
    useEffect(() => {
        if (!showComments) return;
        fetchCommentData();
    }, [showComments, fetchCommentData]);

    useEffect(() => { commentsRef.current = comments; }, [comments]);

    // What the closed button shows: the server's count until we've fetched the
    // list ourselves, then the live length (so a comment just posted counts).
    const displayCount = fetched ? comments.length : (initialCount ?? 0);

    useEffect(() => {
        if (autoOpen) {
            setShowComments(true);
        }
    }, [autoOpen]);

    useFocusEffect(
        React.useCallback(() => {
            if (highlightCommentId && comments.length > 0) {
                const index = comments.findIndex(c => c.id === highlightCommentId);
                if (index !== -1) {
                    setTimeout(() => {
                        flatListRef.current?.scrollToIndex({
                            index,
                            viewOffset: 50,
                            animated: true
                        });
                        setHighlightedComment(highlightCommentId);
                    }, 500);
                }
            }
        }, [comments, highlightCommentId])
    );

    // The input avatar comes from the session's user, not a request. This used
    // to hit /profiles/me/ on mount from every row of the track list — the same
    // response, fetched once per visible track, for one small picture.

    // Optimistic post: the comment appears immediately, reconciles with the
    // server response in place; rolls back on failure.
    const handlePostComment = async () => {
        const content = newComment.trim();
        if (!content) {
            Alert.alert(t('common.error'), t('comments.cannotBeEmpty'));
            return;
        }
        const token = await getAccessToken();
        if (!token) {
            Alert.alert(t('common.error'), t('comments.loginRequired'));
            return;
        }

        const tempId = `temp-${Date.now()}`;
        const optimistic = {
            id: tempId,
            content,
            pending: true,
            user: {
                username: currentUser?.username || 'You',
                profile_picture: currentUser?.profile_picture || null,
            },
        };
        setComments(prev => [...prev, optimistic]);
        setNewComment('');
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 200);

        try {
            const posted = await postComment(trackId, content, token);
            posted.user = {
                ...posted.user,
                profile_picture: currentUser?.profile_picture || null,
            };
            setComments(prev => prev.map(c => (c.id === tempId ? posted : c)));
        } catch (error) {
            console.error('Failed to post comment:', error);
            setComments(prev => prev.filter(c => c.id !== tempId));
            setNewComment(content);
            Alert.alert(t('common.error'), t('comments.postFailed'));
        }
    };

    const toggleComments = () => setShowComments(prev => !prev);

    const handleScrollToIndexFailed = ({ index }) => {
        setTimeout(() => {
            flatListRef.current?.scrollToIndex({ index });
        }, 500);
    };

    return (
        <View style={styles.commentsSection}>
            <TouchableOpacity onPress={toggleComments} style={styles.triggerButton}>
                <Feather name="message-circle" size={18} color="#fff" />
                <Text style={styles.triggerText}>{displayCount}</Text>
            </TouchableOpacity>

            {/* Mounted only while open. This component sits in every row of
                the track list, so an always-mounted Modal per row is a lot of
                view hierarchy for something nobody has opened. */}
            {showComments && (
            <Modal
                visible
                animationType="slide"
                onRequestClose={toggleComments}
            >
                <View style={styles.modalRoot}>
                    {/* Same rotating wallpaper + navy vignette as the feed comments. */}
                    <RotatingBackground intervalMs={60000} scrimColor="transparent" />
                    <ScreenVignette tintRgb="6,16,34" zIndex={1} />

                    <SafeAreaView edges={['top']} style={[styles.content, kbHeight > 0 ? { marginBottom: kbHeight } : null]}>
                        <View style={styles.headerRow}>
                            <Text style={styles.headerTitle}>{t('comments.title')}</Text>
                            <TouchableOpacity
                                onPress={toggleComments}
                                style={styles.closeButton}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Feather name="x" size={24} color={colors.textPrimary} />
                            </TouchableOpacity>
                        </View>

                        {loading && comments.length === 0 ? (
                            <CommentSkeleton />
                        ) : (
                            <FlatList
                                ref={flatListRef}
                                data={comments}
                                keyExtractor={item => item.id.toString()}
                                renderItem={({ item }) => (
                                    <View style={[
                                        styles.commentItem,
                                        item.pending && styles.commentItemPending,
                                        item.id === highlightedComment && styles.highlightedComment,
                                    ]}>
                                        <Image
                                            source={item.user?.profile_picture ? { uri: item.user.profile_picture } : DEFAULT_AVATAR}
                                            placeholder={DEFAULT_AVATAR}
                                            cachePolicy="memory-disk"
                                            contentFit="cover"
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
                                source={currentUser?.profile_picture ? { uri: currentUser.profile_picture } : DEFAULT_AVATAR}
                                placeholder={DEFAULT_AVATAR}
                                cachePolicy="memory-disk"
                                contentFit="cover"
                                style={styles.userAvatar}
                            />
                            <TextInput
                                style={styles.input}
                                value={newComment}
                                onChangeText={setNewComment}
                                placeholder={t('comments.placeholder')}
                                placeholderTextColor={colors.placeholder}
                                multiline
                            />
                            <TouchableOpacity
                                onPress={handlePostComment}
                                style={[styles.postButton, !newComment.trim() && styles.postButtonDisabled]}
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
            )}
        </View>
    );
};

const styles = StyleSheet.create({
  commentsSection: {
    marginTop: 10,
    paddingHorizontal: 10,
  },
  triggerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(12,39,86,0.85)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  triggerText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Dark glass comments sheet over the rotating wallpaper.
  modalRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    zIndex: 2,
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
  highlightedComment: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  pendingIcon: {
    marginLeft: 8,
    alignSelf: 'center',
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

export default Comments;
