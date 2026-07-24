import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

function timeAgo(dateStr, t) {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return t('group.preview.now');
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(dateStr).toLocaleDateString();
}

const previewText = (lm, t) => {
  if (!lm) return t('group.preview.noMessages');
  if (lm.message_type === 'system') return lm.content;
  const body = lm.content
    || ({
      image: t('group.preview.photo'),
      file: `📎 ${lm.file_name || t('group.preview.message')}`,
      audio: t('group.preview.voiceNote'),
    }[lm.message_type] || t('group.preview.message'));
  return lm.sender_username ? `${lm.sender_username}: ${body}` : body;
};

const GroupItem = ({ group, onPress, onDelete, onEdit, isCreator }) => {
  const { t } = useI18n();
  const unread = group.unread_count || 0;
  const lm = group.last_message;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.avatarWrap}>
        {group.cover_image ? (
          <Image source={{ uri: group.cover_image }} style={styles.avatar} contentFit="cover" transition={150} />
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
          <Text style={styles.time}>{timeAgo(lm?.created_at || group.updated_at, t)}</Text>
        </View>
        <View style={styles.bottomRow}>
          <Text style={[styles.preview, unread > 0 && styles.previewBold]} numberOfLines={1}>
            {previewText(lm, t)}
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
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, gap: spacing.sm, backgroundColor: 'rgba(16,46,80,0.55)', borderRadius: radius.md, marginBottom: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' },
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
