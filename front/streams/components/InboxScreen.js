import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity, StyleSheet,
  ActivityIndicator, AppState, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchConversations } from '../services/api';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const previewText = (last) => {
  if (!last) return 'No messages yet';
  if (last.content) return last.content;
  switch (last.message_type) {
    case 'image': return '📷 Photo';
    case 'file': return `📎 ${last.file_name || 'File'}`;
    case 'audio': return '🎤 Voice note';
    default: return 'Message';
  }
};

const ConversationItem = ({ item, onPress }) => {
  const other = item.other_participant;
  const last = item.last_message;
  const hasUnread = item.unread_count > 0;

  return (
    <TouchableOpacity style={styles.item} onPress={() => onPress(item)} activeOpacity={0.8}>
      <View style={styles.avatarWrap}>
        <Image
          source={other?.profile_picture ? { uri: other.profile_picture } : DEFAULT_AVATAR}
          defaultSource={DEFAULT_AVATAR}
          style={styles.avatar}
        />
        {hasUnread && <View style={styles.onlineDot} />}
      </View>

      <View style={styles.itemBody}>
        <View style={styles.itemTop}>
          <Text style={[styles.name, hasUnread && styles.nameBold]} numberOfLines={1}>
            {other?.username ?? 'Unknown'}
          </Text>
          <Text style={[styles.time, hasUnread && styles.timeUnread]}>{timeAgo(item.updated_at)}</Text>
        </View>
        <View style={styles.itemBottom}>
          <Text
            style={[styles.preview, hasUnread && styles.previewBold]}
            numberOfLines={1}
          >
            {previewText(last)}
          </Text>
          {hasUnread && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.unread_count > 9 ? '9+' : item.unread_count}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const InboxScreen = ({ navigation }) => {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const appState = useRef(AppState.currentState);
  const pollRef = useRef(null);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchConversations();
      setConversations(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(conversations.length > 0); // keep the list visible while refreshing on re-focus
      pollRef.current = setInterval(() => load(true), 15000);

      const sub = AppState.addEventListener('change', next => {
        if (next === 'active' && appState.current !== 'active') load(true);
        if (next !== 'active') {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        appState.current = next;
      });

      return () => {
        clearInterval(pollRef.current);
        sub.remove();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const openChat = useCallback((conversation) => {
    navigation.navigate('Chat', {
      conversationId: conversation.id,
      otherUser: conversation.other_participant,
    });
  }, [navigation]);

  if (loading && conversations.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Ionicons name="chatbubble-ellipses" size={18} color={colors.accent} />
        <Text style={styles.headerTitle}>Messages</Text>
        {conversations.length > 0 && (
          <View style={styles.countPill}><Text style={styles.countText}>{conversations.length}</Text></View>
        )}
      </View>

      <FlatList
        data={conversations}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => <ConversationItem item={item} onPress={openChat} />}
        contentContainerStyle={[styles.listContent, conversations.length === 0 && styles.emptyContent]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" colors={[colors.accent]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptySubtext}>
              Follow someone and tap their profile to send a message
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
  titleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  headerTitle: { ...typography.h2, color: colors.textPrimary, fontWeight: '800' },
  countPill: {
    marginLeft: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full,
    backgroundColor: 'rgba(244,162,97,0.16)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.5)',
  },
  countText: { ...typography.caption, color: colors.accent, fontWeight: '800' },

  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm,
    gap: spacing.sm,
    backgroundColor: 'rgba(16,46,80,0.55)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    ...shadows.sm,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: 'rgba(244,162,97,0.3)',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#102E50',
  },
  itemBody: { flex: 1 },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  name: { ...typography.label, color: colors.textPrimary, flex: 1, fontWeight: '600' },
  nameBold: { fontWeight: '800' },
  time: { ...typography.caption, color: colors.textMuted },
  timeUnread: { color: colors.accent, fontWeight: '700' },
  itemBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  preview: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  previewBold: { color: colors.textPrimary, fontWeight: '600' },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
    marginLeft: spacing.xs,
  },
  badgeText: { color: '#0A1628', fontSize: 11, fontWeight: '800' },
  emptyContent: { flexGrow: 1 },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyTitle: { ...typography.h3, color: colors.textSecondary },
  emptySubtext: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});

export default InboxScreen;
