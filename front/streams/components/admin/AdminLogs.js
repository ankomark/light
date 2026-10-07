// The audit trail: every admin action, who (by name, kept even when the
// account is gone), to what, why, and from which IP and device. Searchable by
// who acted; and "Check the trail" asks the server whether any entry has been
// changed or taken out since it was written (each is chained to the last).
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, TextInput, TouchableOpacity,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchAdminLogs, fetchAdminByUrl, verifyAdminLog } from '../../services/api';
import { ErrorState, StaleNote } from './AdminKit';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';
import { useI18n } from '../../context/I18nContext';

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
  const { t } = useI18n();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [actor, setActor] = useState('');
  const [check, setCheck] = useState(null);       // null | 'checking' | { ok, first_broken_id, checked }
  const debounce = useRef(null);

  const load = useCallback(async (who = '') => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetchAdminLogs(who ? { actor: who } : {});
      setLogs(res?.results || (Array.isArray(res) ? res : []));
      setNextUrl(res?.next || null);
    } catch {
      setFailed(true);
      setNextUrl(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const onActor = (text) => {
    setActor(text);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(text.trim().replace(/^@/, '')), 400);
  };

  const verify = async () => {
    setCheck('checking');
    try {
      setCheck(await verifyAdminLog());
    } catch {
      setCheck({ error: true });
    }
  };

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

  useFocusEffect(useCallback(() => { load(actor.trim().replace(/^@/, '')); }, [load]));  // eslint-disable-line react-hooks/exhaustive-deps

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
              {item.actor ? `@${item.actor.username}` : item.actor_name ? `@${item.actor_name}` : 'system'}
              {item.target_type ? `  ·  ${item.target_type} #${item.target_id}` : ''}
            </Text>
          </View>
          {item.reason ? <Text style={styles.reason} numberOfLines={2}>{item.reason}</Text> : null}
          {(item.ip || item.user_agent) ? (
            <Text style={styles.device} numberOfLines={1}>
              {[item.ip, item.user_agent].filter(Boolean).join('  ·  ')}
            </Text>
          ) : null}
        </View>
        <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('admin.auditLog')}</Text>
      <View style={styles.tools}>
        <TextInput
          style={styles.search}
          value={actor}
          onChangeText={onActor}
          placeholder={t('adminLogs.byWho')}
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          testID="logs-actor"
        />
        <TouchableOpacity style={styles.checkBtn} onPress={verify} disabled={check === 'checking'} testID="logs-verify">
          {check === 'checking'
            ? <ActivityIndicator size="small" color="#0A1628" />
            : <MaterialCommunityIcons name="shield-check-outline" size={16} color="#0A1628" />}
          <Text style={styles.checkText}>{t('adminLogs.check')}</Text>
        </TouchableOpacity>
      </View>
      {check && check !== 'checking' && (
        <View style={[styles.verdict, check.ok ? styles.verdictOk : styles.verdictBad]} testID="logs-verdict">
          <MaterialCommunityIcons name={check.ok ? 'check-decagram' : 'alert-decagram'} size={18}
            color={check.ok ? '#5FD39A' : '#FF7A6B'} />
          <Text style={styles.verdictText}>
            {check.error ? t('adminLogs.checkFailed')
              : check.ok ? t('adminLogs.intact', { n: check.checked })
                : t('adminLogs.broken', { id: check.first_broken_id })}
          </Text>
        </View>
      )}
      {failed && logs.length > 0 && <StaleNote onRetry={() => load(actor.trim().replace(/^@/, ''))} />}
      {loading && !logs.length ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : failed && !logs.length ? (
        <ErrorState onRetry={() => load(actor.trim().replace(/^@/, ''))} />
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={() => load(actor.trim().replace(/^@/, ''))}
          refreshing={loading}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} /> : null}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>{t('admin.noActions')}</Text></View>}
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
  device: { ...typography.caption, fontSize: 11, color: '#6F829C', marginTop: 3 },
  tools: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  search: {
    flex: 1, height: 42, borderRadius: radius.full, paddingHorizontal: spacing.md, color: colors.textPrimary,
    backgroundColor: 'rgba(13,35,64,0.78)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  checkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, height: 42,
    borderRadius: radius.full, backgroundColor: colors.accent,
  },
  checkText: { color: '#0A1628', fontWeight: '800', fontSize: 13 },
  verdict: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.md, marginTop: spacing.sm,
    padding: spacing.sm, borderRadius: radius.md, borderWidth: 1,
  },
  verdictOk: { borderColor: 'rgba(95,211,154,0.5)', backgroundColor: 'rgba(95,211,154,0.10)' },
  verdictBad: { borderColor: 'rgba(255,122,107,0.6)', backgroundColor: 'rgba(255,122,107,0.12)' },
  verdictText: { ...typography.caption, color: colors.textPrimary, flex: 1 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary },
});

export default AdminLogs;
