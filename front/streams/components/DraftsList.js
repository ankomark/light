// The user's saved drafts: a thumbnail, the start of the caption and when it
// was saved. Tap to keep editing; the trash icon deletes (after a confirm).
import React from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../constants/theme';

const when = (ts) => {
  const d = new Date(ts);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const DraftsList = ({ drafts, onOpen, onDelete, t }) => (
  <FlatList
    data={drafts}
    keyExtractor={(d) => d.id}
    contentContainerStyle={styles.list}
    ListEmptyComponent={
      <View style={styles.empty}>
        <Feather name="file-text" size={36} color={colors.textMuted} />
        <Text style={styles.emptyText}>{t('create.post.noDrafts')}</Text>
      </View>
    }
    renderItem={({ item }) => (
      <TouchableOpacity style={styles.row} onPress={() => onOpen(item)} activeOpacity={0.85}>
        <View style={styles.thumb}>
          {item.thumbUri ? (
            <Image source={{ uri: item.thumbUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Feather name={item.contentType === 'video' ? 'video' : 'image'} size={20} color={colors.textMuted} />
          )}
        </View>
        <View style={styles.body}>
          <Text style={styles.caption} numberOfLines={2}>
            {item.caption || (item.contentType === 'video' ? t('create.post.video') : t('create.post.photo'))}
          </Text>
          <Text style={styles.meta}>{when(item.savedAt)}</Text>
        </View>
        <TouchableOpacity
          hitSlop={10}
          style={styles.trash}
          onPress={() => Alert.alert(t('create.post.deleteDraftTitle'), '', [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('create.post.discard'), style: 'destructive', onPress: () => onDelete(item) },
          ])}
        >
          <Feather name="trash-2" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </TouchableOpacity>
    )}
  />
);

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, marginBottom: spacing.sm,
    borderRadius: radius.lg, backgroundColor: 'rgba(14,30,52,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  thumb: {
    width: 56, height: 72, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1 },
  caption: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  trash: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});

export default DraftsList;
