import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchAdminLogs, fetchAdminByUrl } from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

// Icon + tint per action family, so the log scans quickly.
const ACTION_META = (action = '') => {
  if (action.startsWith('remove')) return { icon: 'trash-can-outline', tint: colors.error };
  if (action.startsWith('restore')) return { icon: 'backup-restore', tint: '#2ECC71' };
  if (action.includes('ban')) return { icon: 'cancel', tint: colors.error };
  if (action.includes('suspend')) return { icon: 'account-off-outline', tint: colors.warning };
  if (action.includes('warn')) return { icon: 'alert-outline', tint: colors.warning };
  if (action.includes('role')) return { icon: 'shield-account-outline', tint: colors.accent };
  if (action.includes('report')) return { icon: 'flag-outline', tint: colors.primary };
  return { icon: 'history', tint: colors.textSecondary };
};

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const AdminLogs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdminLogs();
      setLogs(res?.results || (Array.isArray(res) ? res : []));
      setNextUrl(res?.next || null);
    } catch {
      setLogs([]);
      setNextUrl(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !nextUrl) return;
    setLoadingMore(true);
    try {
      const res = await fetchAdminByUrl(nextUrl);
      setLogs((prev) => {
        const have = new Set(prev.map((l) => l.id));
        return [...prev, ...(res?.results || []).filter((l) => !have.has(l.id))];
      });
      setNextUrl(res?.next || null);
    } catch {
      // silent — pull-to-refresh recovers
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextUrl]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const renderItem = ({ item }) => {
    const meta = ACTION_META(item.action);
    const label = (item.action || '').replace(/_/g, ' ');
    return (
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: `${meta.tint}22` }]}>
          <MaterialCommunityIcons name={meta.icon} size={18} color={meta.tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.action}>{label}</Text>
          <View style={styles.metaRow}>
            <Image
              source={item.actor?.profile_picture ? { uri: item.actor.profile_picture } : DEFAULT_AVATAR}
              placeholder={DEFAULT_AVATAR}
              contentFit="cover"
              transition={120}
              style={styles.actorAvatar}
            />
            <Text style={styles.actor} numberOfLines={1}>
              {item.actor ? `@${item.actor.username}` : 'system'}
              {item.target_type ? `  ·  ${item.target_type} #${item.target_id}` : ''}
            </Text>
          </View>
          {item.reason ? <Text style={styles.reason} numberOfLines={2}>{item.reason}</Text> : null}
        </View>
        <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Audit Log</Text>
      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={load}
          refreshing={loading}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} /> : null}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>No actions logged yet</Text></View>}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: {
    ...typography.h1, color: colors.textPrimary, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  list: { padding: spacing.md, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: 'rgba(16,28,46,0.82)', borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.sm + 2, marginBottom: spacing.sm, ...shadows.sm,
  },
  icon: {
    width: 36, height: 36, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  action: { ...typography.label, color: colors.textPrimary, fontWeight: '700', textTransform: 'capitalize' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 3 },
  actorAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.surface },
  actor: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  reason: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic', marginTop: 3 },
  time: { ...typography.caption, color: colors.textMuted },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary },
});

export default AdminLogs;
