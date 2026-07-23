import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchAdminAppeals, fetchAdminByUrl, approveAppeal, rejectAppeal } from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';
import { useI18n } from '../../context/I18nContext';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const AdminAppeals = () => {
  const { t } = useI18n();
  const [filter, setFilter] = useState('pending');
  const [appeals, setAppeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);

  const load = useCallback(async (status) => {
    setLoading(true);
    try {
      const res = await fetchAdminAppeals(status);
      setAppeals(res?.results || (Array.isArray(res) ? res : []));
      setNextUrl(res?.next || null);
    } catch {
      setAppeals([]);
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
      setAppeals((prev) => {
        const have = new Set(prev.map((a) => a.id));
        return [...prev, ...(res?.results || []).filter((a) => !have.has(a.id))];
      });
      setNextUrl(res?.next || null);
    } catch {
      // silent — pull-to-refresh recovers
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextUrl]);

  useFocusEffect(useCallback(() => { load(filter); }, [load, filter]));

  const act = async (id, fn) => {
    setBusyId(id);
    try {
      await fn();
      setAppeals((prev) => prev.filter((a) => a.id !== id));
    } catch {
      Alert.alert(t('common.error'), t('admin.actionFailedShort'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmApprove = (item) =>
    Alert.alert(t('appeal.approveTitle'), t('appeal.approveConfirm', { name: item.user?.username }), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve', onPress: () => act(item.id, () => approveAppeal(item.id)) },
    ]);

  const renderItem = ({ item }) => {
    const busy = busyId === item.id;
    return (
      <View style={styles.card}>
        <View style={styles.head}>
          <Image
            source={item.user?.profile_picture ? { uri: item.user.profile_picture } : DEFAULT_AVATAR}
            placeholder={DEFAULT_AVATAR}
            contentFit="cover"
            transition={120}
            style={styles.avatar}
          />
          <Text style={styles.username}>@{item.user?.username || 'unknown'}</Text>
          <Text style={styles.status}>{item.status}</Text>
        </View>
        <Text style={styles.message}>{item.message}</Text>
        {item.review_notes ? <Text style={styles.note}>📝 {item.review_notes}</Text> : null}

        {item.status === 'pending' && (
          busy ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.btnApprove]} onPress={() => confirmApprove(item)}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#0A1628" />
                <Text style={styles.btnTextDark}>{t('appeal.approveLift')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnReject]} onPress={() => act(item.id, () => rejectAppeal(item.id))}>
                <Text style={styles.btnTextLight}>{t('common.reject')}</Text>
              </TouchableOpacity>
            </View>
          )
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('appeal.listTitle')}</Text>
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
          data={appeals}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={() => load(filter)}
          refreshing={loading}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} /> : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="file-tray-outline" size={48} color={colors.textSecondary} />
              <Text style={styles.emptyText}>No {filter} appeals</Text>
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
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.md, marginBottom: spacing.sm, ...shadows.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface },
  username: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flex: 1 },
  status: { ...typography.caption, color: colors.textMuted, textTransform: 'capitalize' },
  message: { ...typography.body, color: colors.textSecondary },
  note: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md,
  },
  btnApprove: { backgroundColor: colors.accent },
  btnReject: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', marginLeft: 'auto',
  },
  btnTextDark: { ...typography.caption, color: '#0A1628', fontWeight: '800' },
  btnTextLight: { ...typography.caption, color: colors.white, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl * 1.5, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary },
});

export default AdminAppeals;
