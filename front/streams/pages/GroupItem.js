import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../constants/theme';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(dateStr).toLocaleDateString();
}

const previewText = (lm) => {
  if (!lm) return 'No messages yet';
  if (lm.message_type === 'system') return lm.content;
  const body = lm.content
    || ({ image: '📷 Photo', file: `📎 ${lm.file_name || 'File'}`, audio: '🎤 Voice note' }[lm.message_type] || 'Message');
  return lm.sender_username ? `${lm.sender_username}: ${body}` : body;
};

const GroupItem = ({ group, onPress, onDelete, onEdit, isCreator }) => {
  const unread = group.unread_count || 0;
  const lm = group.last_message;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.avatarWrap}>
        {group.cover_image ? (
          <Image source={{ uri: group.cover_image }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Ionicons name="people" size={24} color={colors.primary} />
          </View>
        )}
        {group.is_private && (
          <View style={styles.lockBadge}><Ionicons name="lock-closed" size={9} color={colors.white} /></View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={[styles.name, unread > 0 && styles.bold]} numberOfLines={1}>{group.name}</Text>
          <Text style={styles.time}>{timeAgo(lm?.created_at || group.updated_at)}</Text>
        </View>
        <View style={styles.bottomRow}>
          <Text style={[styles.preview, unread > 0 && styles.previewBold]} numberOfLines={1}>
            {previewText(lm)}
          </Text>
          {unread > 0 ? (
            <View style={styles.badge}><Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text></View>
          ) : isCreator ? (
            <View style={styles.actions}>
              <TouchableOpacity onPress={onEdit} hitSlop={8} style={styles.actionBtn}>
                <MaterialIcons name="edit" size={16} color={colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onDelete} hitSlop={8} style={styles.actionBtn}>
                <MaterialIcons name="delete-outline" size={17} color={colors.error} />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, gap: spacing.sm, backgroundColor: colors.bg },
  avatarWrap: { position: 'relative' },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surface },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  lockBadge: { position: 'absolute', bottom: 0, right: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  body: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  name: { ...typography.label, color: colors.textPrimary, flex: 1, fontWeight: '600' },
  bold: { fontWeight: '800' },
  time: { ...typography.caption, color: colors.textMuted, marginLeft: spacing.sm },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  preview: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  previewBold: { color: colors.textPrimary, fontWeight: '600' },
  badge: { backgroundColor: colors.primary, borderRadius: radius.full, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5, marginLeft: spacing.xs },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  actions: { flexDirection: 'row', marginLeft: spacing.sm, gap: spacing.xs },
  actionBtn: { padding: 2 },
});

export default GroupItem;
