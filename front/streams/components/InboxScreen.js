import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity, StyleSheet,
  ActivityIndicator, AppState,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
    <TouchableOpacity style={styles.item} onPress={() => onPress(item)} activeOpacity={0.7}>
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
          <Text style={styles.time}>{timeAgo(item.updated_at)}</Text>
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
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
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
    }, [load])
  );

  const openChat = useCallback((conversation) => {
    navigation.navigate('Chat', {
      conversationId: conversation.id,
      otherUser: conversation.other_participant,
    });
  }, [navigation]);

  if (loading && conversations.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.surface, colors.bg]} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <FlatList
        data={conversations}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => <ConversationItem item={item} onPress={openChat} />}
        contentContainerStyle={conversations.length === 0 && styles.emptyContent}
        showsVerticalScrollIndicator={false}
        onRefresh={() => load()}
        refreshing={loading}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl + spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: { width: 40, alignItems: 'flex-start' },
  headerTitle: { ...typography.h2, color: colors.textPrimary },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: colors.bg,
    gap: spacing.sm,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success ?? '#43A047',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  itemBody: { flex: 1 },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  name: { ...typography.label, color: colors.textPrimary, flex: 1 },
  nameBold: { fontWeight: '700' },
  time: { ...typography.caption, color: colors.textMuted },
  itemBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  preview: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  previewBold: { color: colors.textPrimary, fontWeight: '600' },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
    marginLeft: spacing.xs,
  },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  separator: { height: 1, backgroundColor: colors.border, marginLeft: 52 + spacing.md + spacing.sm },
  emptyContent: { flex: 1 },
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
