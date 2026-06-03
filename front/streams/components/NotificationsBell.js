import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  Modal, Image, ActivityIndicator, AppState, Pressable,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { fetchNotifications, markNotificationAsRead, checkAuthStatus } from '../services/api';
import { addNotificationReceivedListener } from '../services/pushNotifications';
import * as Notifications from 'expo-notifications';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import axios from 'axios';
import { API_URL } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const POLL_INTERVAL_MS = 15000;

const TYPE_ICON = {
  like: { name: 'heart', color: '#E0245E' },
  comment: { name: 'chatbubble', color: colors.primary },
  follow: { name: 'person-add', color: '#17BF63' },
  group_join_request: { name: 'people', color: colors.accent },
};

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const NotificationsBell = ({ navigation }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
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

      setNotifications(data);
      const count = data.filter(n => !n.read).length;
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

  const handleNotificationPress = useCallback((item) => {
    handleMarkAsRead(item.id);
    setShowPanel(false);
    if (item.post) {
      navigation.navigate('PostDetail', {
        postId: item.post.id,
        ...(item.related_comment ? { highlightCommentId: item.related_comment } : {}),
      });
    }
  }, [handleMarkAsRead, navigation]);

  const renderItem = useCallback(({ item }) => {
    const icon = TYPE_ICON[item.notification_type] ?? { name: 'notifications', color: colors.primary };
    return (
      <Pressable
        style={[styles.item, !item.read && styles.itemUnread]}
        onPress={() => handleNotificationPress(item)}
        android_ripple={{ color: colors.border }}
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
          <Text style={styles.itemTime}>{timeAgo(item.created_at)}</Text>
        </View>

        {!item.read && <View style={styles.unreadDot} />}
      </Pressable>
    );
  }, [handleNotificationPress]);

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
        <LinearGradient colors={[colors.surface, colors.bg]} style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Notifications</Text>
          <View style={styles.headerActions}>
            {unreadCount > 0 && (
              <TouchableOpacity
                style={styles.markAllBtn}
                onPress={handleMarkAllRead}
                disabled={markingAll}
              >
                {markingAll
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text style={styles.markAllText}>Mark all read</Text>
                }
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setShowPanel(false)} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        <View style={styles.modalBody}>
          {loading && notifications.length === 0 ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={notifications}
              keyExtractor={item => item.id.toString()}
              renderItem={renderItem}
              contentContainerStyle={notifications.length === 0 && styles.emptyContent}
              showsVerticalScrollIndicator={false}
              onRefresh={() => loadNotifications()}
              refreshing={loading}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <MaterialIcons name="notifications-none" size={52} color={colors.textMuted} />
                  <Text style={styles.emptyText}>You're all caught up</Text>
                  <Text style={styles.emptySubtext}>New notifications will appear here</Text>
                </View>
              }
            />
          )}
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
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl + spacing.sm,
    paddingBottom: spacing.md,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.textPrimary,
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
    color: colors.primary,
    ...typography.label,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  modalBody: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
    gap: spacing.sm,
  },
  itemUnread: {
    backgroundColor: colors.card,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
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
    borderColor: colors.bg,
  },
  itemBody: {
    flex: 1,
  },
  itemMessage: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  itemTime: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 3,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  emptyContent: {
    flex: 1,
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
    color: colors.textSecondary,
  },
  emptySubtext: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});

export default NotificationsBell;
