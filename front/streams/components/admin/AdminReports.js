import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchAdminReports, resolveReport, dismissReport, removeReportTarget,
} from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' },
];

// Targets we can soft-remove (users are handled via suspend/ban on the Users tab).
const REMOVABLE = new Set(['post', 'comment', 'track']);

const TargetPreview = ({ target }) => {
  if (!target) return <Text style={styles.targetGone}>Content no longer available</Text>;
  const author = target.author;
  return (
    <View style={styles.targetCard}>
      {author && (
        <View style={styles.targetAuthor}>
          <Image
            source={author.profile_picture ? { uri: author.profile_picture } : DEFAULT_AVATAR}
            defaultSource={DEFAULT_AVATAR}
            style={styles.targetAvatar}
          />
          <Text style={styles.targetAuthorName}>@{author.username}</Text>
          {target.is_removed && <Text style={styles.removedPill}>removed</Text>}
        </View>
      )}
      <Text style={styles.targetBody} numberOfLines={3}>
        {target.caption || target.content || target.title || target.name || `${target.type} #${target.id}`}
      </Text>
    </View>
  );
};

const AdminReports = () => {
  const [filter, setFilter] = useState('pending');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async (status) => {
    setLoading(true);
    try {
      const res = await fetchAdminReports(status);
      setReports(res?.results || (Array.isArray(res) ? res : []));
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(filter); }, [load, filter]));

  const act = async (id, fn) => {
    setBusyId(id);
    try {
      await fn();
      // Drop it from the current (status-filtered) list optimistically.
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch {
      Alert.alert('Error', 'Action failed. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemove = (item) => {
    Alert.alert(
      'Remove content',
      `This hides the reported ${item.content_type} from everyone. You can restore it later from the Content tab.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => act(item.id, () => removeReportTarget(item.id)) },
      ],
    );
  };

  const renderItem = ({ item }) => {
    const busy = busyId === item.id;
    const canRemove = REMOVABLE.has(item.content_type) && !item.target?.is_removed;
    return (
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.reasonPill}><Text style={styles.reasonText}>{item.reason}</Text></View>
          <Text style={styles.metaText}>{item.content_type} #{item.object_id}</Text>
        </View>

        <TargetPreview target={item.target} />

        {item.description ? <Text style={styles.desc}>“{item.description}”</Text> : null}
        <Text style={styles.reporter}>Reported by @{item.reporter?.username || 'unknown'}</Text>

        {busy ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.btnResolve]} onPress={() => act(item.id, () => resolveReport(item.id))}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#0A1628" />
              <Text style={styles.btnTextDark}>Resolve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => act(item.id, () => dismissReport(item.id))}>
              <Text style={styles.btnTextLight}>Dismiss</Text>
            </TouchableOpacity>
            {canRemove && (
              <TouchableOpacity style={[styles.btn, styles.btnRemove]} onPress={() => confirmRemove(item)}>
                <Ionicons name="trash-outline" size={16} color={colors.white} />
                <Text style={styles.btnTextLight}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reports</Text>
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <TouchableOpacity key={f.key} style={[styles.pill, active && styles.pillActive]}
              onPress={() => setFilter(f.key)} activeOpacity={0.85}>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={() => load(filter)}
          refreshing={loading}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="shield-checkmark-outline" size={48} color={colors.textSecondary} />
              <Text style={styles.emptyText}>No {filter} reports</Text>
            </View>
          }
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
  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pill: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  pillTextActive: { color: '#0A1628' },
  list: { padding: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: 'rgba(16,28,46,0.85)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.md, marginBottom: spacing.sm, ...shadows.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  reasonPill: {
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full,
    backgroundColor: 'rgba(224,36,94,0.18)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(224,36,94,0.5)',
  },
  reasonText: { ...typography.caption, color: '#FF6B9A', fontWeight: '700', textTransform: 'capitalize' },
  metaText: { ...typography.caption, color: colors.textMuted },
  targetCard: {
    backgroundColor: 'rgba(10,22,40,0.6)', borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)',
    padding: spacing.sm, marginBottom: spacing.sm,
  },
  targetAuthor: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  targetAvatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surface },
  targetAuthorName: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  removedPill: {
    ...typography.caption, color: colors.error, fontWeight: '700',
    marginLeft: 'auto', textTransform: 'uppercase', fontSize: 10,
  },
  targetBody: { ...typography.caption, color: colors.textSecondary },
  targetGone: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic', marginBottom: spacing.sm },
  desc: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic', marginBottom: spacing.xs },
  reporter: { ...typography.caption, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md,
  },
  btnResolve: { backgroundColor: colors.accent },
  btnGhost: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  btnRemove: { backgroundColor: colors.error, marginLeft: 'auto' },
  btnTextDark: { ...typography.caption, color: '#0A1628', fontWeight: '800' },
  btnTextLight: { ...typography.caption, color: colors.white, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl * 1.5, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary },
});

export default AdminReports;
