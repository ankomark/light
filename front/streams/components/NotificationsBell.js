import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SectionList,
  Modal, Image, ActivityIndicator, AppState, Pressable,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchNotifications, markNotificationAsRead, checkAuthStatus, fetchUnreadNotificationCount } from '../services/api';
import { addNotificationReceivedListener } from '../services/pushNotifications';
import * as Notifications from 'expo-notifications';
import RotatingBackground from './RotatingBackground';
import ScreenVignette from './ScreenVignette';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const POLL_INTERVAL_MS = 15000;

const TYPE_ICON = {
  like: { name: 'heart', color: '#E0245E' },
  comment: { name: 'chatbubble', color: colors.primary },
  follow: { name: 'person-add', color: '#17BF63' },
  group_join_request: { name: 'people', color: colors.accent },
};

// TikTok-style category filters across the top of the panel.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'like', label: 'Likes' },
  { key: 'comment', label: 'Comments' },
  { key: 'follow', label: 'Follows' },
];

// Sections are rendered in this order; empty ones are dropped.
const SECTION_ORDER = ['Today', 'Yesterday', 'This Week', 'This Month', 'Earlier'];

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Bucket a notification into a TikTok-like time section.
function sectionLabel(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86400000;
  if (d.getTime() >= startOfToday) return 'Today';
  if (d.getTime() >= startOfToday - dayMs) return 'Yesterday';
  if (d.getTime() >= startOfToday - 7 * dayMs) return 'This Week';
  if (d.getTime() >= startOfToday - 30 * dayMs) return 'This Month';
  return 'Earlier';
}

const NotificationsBell = ({ navigation }) => {
  const { t } = useI18n();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState('all');
  const appState = useRef(AppState.currentState);
  const pollRef = useRef(null);
  const pushListenerRef = useRef(null);
  const isMounted = useRef(true);

  const loadNotifications = useCallback(async (silent = false) => {
    try {
      const isAuth = await checkAuthStatus();
      if (!isAuth || !isMounted.current) return;

      if (!silent) setLoading(true);

      const data = await fetchNotifications();
      if (!isMounted.current) return;

      setNotifications(Array.isArray(data) ? data : []);
      // The list is paginated (first page only), so derive the badge from the
      // dedicated unread-count endpoint rather than from the visible items.
      let count;
      try {
        const res = await fetchUnreadNotificationCount();
        count = res?.unread_count ?? (Array.isArray(data) ? data.filter(n => !n.read).length : 0);
      } catch {
        count = Array.isArray(data) ? data.filter(n => !n.read).length : 0;
      }
      if (!isMounted.current) return;
      setUnreadCount(count);
      await Notifications.setBadgeCountAsync(count);
    } catch {
      // Silently ignore — bell should never crash the header
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => loadNotifications(true), POLL_INTERVAL_MS);
  }, [loadNotifications]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Initial load + polling lifecycle
  useEffect(() => {
    isMounted.current = true;
    loadNotifications();
    startPolling();

    // Listen for push notifications received while app is open
    pushListenerRef.current = addNotificationReceivedListener(() => {
      loadNotifications(true);
    });

    // Pause polling when app goes background, resume when foregrounded
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active' && appState.current !== 'active') {
        loadNotifications(true);
        startPolling();
      } else if (nextState !== 'active') {
        stopPolling();
      }
      appState.current = nextState;
    });

    return () => {
      isMounted.current = false;
      stopPolling();
      sub.remove();
      if (pushListenerRef.current) pushListenerRef.current.remove();
    };
  }, [loadNotifications, startPolling, stopPolling]);

  // Refresh immediately when user navigates back to a screen containing the bell
  useFocusEffect(
    useCallback(() => {
      loadNotifications(true);
    }, [loadNotifications])
  );

  const handleMarkAsRead = useCallback(async (id) => {
    try {
      await markNotificationAsRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {
      // ignore
    }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    const unread = notifications.filter(n => !n.read);
    if (!unread.length) return;
    setMarkingAll(true);
    try {
      await Promise.all(unread.map(n => markNotificationAsRead(n.id)));
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
      await Notifications.setBadgeCountAsync(0);
    } catch {
      // ignore
    } finally {
      setMarkingAll(false);
    }
  }, [notifications]);

  // Take the user to the exact thing the notification is about.
  const handleNotificationPress = useCallback((item) => {
    handleMarkAsRead(item.id);
    setShowPanel(false);
    const type = item.notification_type;

    if (item.post) {
      // Comment → open the post, auto-open comments, and scroll to the comment.
      navigation.navigate('PostDetail', {
        postId: item.post.id,
        ...(type === 'comment' && item.related_comment_id
          ? { commentId: item.related_comment_id, shouldOpenComments: true }
          : {}),
      });
    } else if (type === 'follow' && item.sender?.id) {
      navigation.navigate('UserProfile', {
        userId: item.sender.id,
        username: item.sender.username,
      });
    } else if (item.track) {
      navigation.navigate('Tracks');
    }
  }, [handleMarkAsRead, navigation]);

  // Apply the active filter, then bucket into time sections (TikTok-style).
  const sections = useMemo(() => {
    const filtered = notifications.filter(n => {
      if (filter === 'all') return true;
      if (filter === 'follow') {
        return n.notification_type === 'follow' || n.notification_type === 'group_join_request';
      }
      return n.notification_type === filter;
    });

    const groups = {};
    filtered.forEach(n => {
      const label = sectionLabel(n.created_at);
      if (!groups[label]) groups[label] = [];
      groups[label].push(n);
    });

    return SECTION_ORDER
      .filter(label => groups[label]?.length)
      .map(label => ({ title: label, data: groups[label] }));
  }, [notifications, filter]);

  const renderItem = useCallback(({ item }) => {
    const icon = TYPE_ICON[item.notification_type] ?? { name: 'notifications', color: colors.primary };
    return (
      <Pressable
        style={({ pressed }) => [styles.item, !item.read && styles.itemUnread, pressed && styles.itemPressed]}
        onPress={() => handleNotificationPress(item)}
      >
        <View style={styles.avatarWrap}>
          <Image
            source={item.sender?.profile_picture
              ? { uri: item.sender.profile_picture }
              : DEFAULT_AVATAR}
            defaultSource={DEFAULT_AVATAR}
            style={styles.avatar}
          />
          <View style={[styles.typeIcon, { backgroundColor: icon.color }]}>
            <Ionicons name={icon.name} size={10} color="#fff" />
          </View>
        </View>

        <View style={styles.itemBody}>
          <Text style={styles.itemMessage} numberOfLines={2}>{item.message}</Text>
          {item.related_comment ? (
            <Text style={styles.itemSnippet} numberOfLines={1}>“{item.related_comment}”</Text>
          ) : null}
          <Text style={styles.itemTime}>{timeAgo(item.created_at)}</Text>
        </View>

        {!item.read && <View style={styles.unreadDot} />}
      </Pressable>
    );
  }, [handleNotificationPress]);

  const renderSectionHeader = useCallback(({ section }) => (
    <Text style={styles.sectionHeader}>{section.title}</Text>
  ), []);

  return (
    <View>
      {/* Bell icon with badge */}
      <TouchableOpacity
        style={styles.bell}
        onPress={() => { setShowPanel(true); loadNotifications(); }}
        activeOpacity={0.7}
      >
        <Ionicons name="notifications-outline" size={24} color="#fff" />
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Notifications panel */}
      <Modal
        visible={showPanel}
        animationType="slide"
        onRequestClose={() => setShowPanel(false)}
      >
        <View style={styles.modalRoot}>
          {/* Shared luxury backdrop — rotating wallpaper + navy edge vignette. */}
          <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.62)" />
          <ScreenVignette tintRgb="6,16,34" zIndex={1} />

          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('notifications.title')}</Text>
              <View style={styles.headerActions}>
                {unreadCount > 0 && (
                  <TouchableOpacity
                    style={styles.markAllBtn}
                    onPress={handleMarkAllRead}
                    disabled={markingAll}
                  >
                    {markingAll
                      ? <ActivityIndicator size="small" color={colors.accent} />
                      : <Text style={styles.markAllText}>{t('notifications.markAllRead')}</Text>
                    }
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setShowPanel(false)} style={styles.closeBtn}>
                  <Ionicons name="close" size={24} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Filter pills */}
            <View style={styles.filterRow}>
              {FILTERS.map(f => {
                const active = filter === f.key;
                return (
                  <TouchableOpacity
                    key={f.key}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => setFilter(f.key)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>{f.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {loading && notifications.length === 0 ? (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={colors.accent} />
              </View>
            ) : (
              <SectionList
                sections={sections}
                keyExtractor={item => item.id.toString()}
                renderItem={renderItem}
                renderSectionHeader={renderSectionHeader}
                stickySectionHeadersEnabled={false}
                contentContainerStyle={sections.length === 0 ? styles.emptyContent : styles.listContent}
                showsVerticalScrollIndicator={false}
                onRefresh={() => loadNotifications()}
                refreshing={loading}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <MaterialIcons name="notifications-none" size={52} color={colors.textSecondary} />
                    <Text style={styles.emptyText}>{t('notifications.caughtUp')}</Text>
                    <Text style={styles.emptySubtext}>
                      {filter === 'all' ? 'New notifications will appear here' : 'Nothing here under this filter'}
                    </Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  bell: {
    position: 'relative',
    paddingHorizontal: spacing.sm,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: 2,
    backgroundColor: colors.error,
    borderRadius: radius.full,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
  },

  // ── Panel ──────────────────────────────────────────────────────────────
  modalRoot: {
    flex: 1,
    backgroundColor: '#0A1628',
  },
  modalContent: {
    flex: 1,
    zIndex: 2, // above the rotating wallpaper + vignette
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl + spacing.sm,
    paddingBottom: spacing.sm,
  },
  modalTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  markAllBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  markAllText: {
    color: colors.accent,
    ...typography.label,
    fontWeight: '700',
  },
  closeBtn: {
    padding: spacing.xs,
  },

  // ── Filter pills ───────────────────────────────────────────────────────
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  pillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    ...shadows.sm,
  },
  pillText: {
    ...typography.label,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#0A1628',
    fontWeight: '700',
  },

  // ── List ───────────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionHeader: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    gap: spacing.sm,
    ...shadows.sm,
  },
  itemUnread: {
    backgroundColor: 'rgba(23,42,68,0.9)',
    borderColor: 'rgba(244,162,97,0.45)',
  },
  itemPressed: {
    opacity: 0.8,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: 'rgba(232,198,107,0.4)',
  },
  typeIcon: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#0A1628',
  },
  itemBody: {
    flex: 1,
  },
  itemMessage: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  itemSnippet: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  itemTime: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 3,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.accent,
  },
  emptyContent: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyText: {
    ...typography.h3,
    color: colors.textPrimary,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  emptySubtext: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

export default NotificationsBell;
