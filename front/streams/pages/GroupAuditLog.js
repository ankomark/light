import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchGroupAuditLog } from '../services/api';
import RotatingBackground from '../components/RotatingBackground';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/user-placeholder.png');

// Icon per action key; anything unknown falls back to a neutral dot.
const ACTION_ICON = {
  delete_message: { name: 'trash', color: '#E53935' },
  pin: { name: 'pin', color: colors.accent },
  unpin: { name: 'pin-outline', color: colors.textMuted },
  grant_admin: { name: 'shield-checkmark', color: colors.accent },
  revoke_admin: { name: 'shield-outline', color: colors.textMuted },
  grant_moderator: { name: 'ribbon', color: colors.accent },
  revoke_moderator: { name: 'ribbon-outline', color: colors.textMuted },
  remove_member: { name: 'person-remove', color: '#E53935' },
  posting_policy: { name: 'lock-closed', color: colors.primary },
  join_question: { name: 'help-circle', color: colors.primary },
  approve_join: { name: 'checkmark-circle', color: '#17BF63' },
  reject_join: { name: 'close-circle', color: '#E53935' },
};

const fmtWhen = (d) => {
  const dt = new Date(d);
  return dt.toLocaleDateString([], { month: 'short', day: 'numeric' })
    + ' · ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const GroupAuditLog = (props) => {
  const { t } = useI18n();
  const groupSlug = props.groupSlug ?? props.route?.params?.groupSlug;
  const onClose = props.onClose ?? (() => props.navigation?.goBack());

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);

  const load = useCallback(async (pageNum = 1) => {
    try {
      if (pageNum === 1) setLoading(true); else setLoadingMore(true);
      const res = await fetchGroupAuditLog(groupSlug, pageNum);
      const rows = res?.results ?? (Array.isArray(res) ? res : []);
      setItems((prev) => (pageNum === 1 ? rows : [...prev, ...rows]));
      setHasNext(!!res?.next);
      setPage(pageNum);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [groupSlug]);

  useEffect(() => { load(1); }, [load]);

  const renderRow = ({ item }) => {
    const icon = ACTION_ICON[item.action] || { name: 'ellipse', color: colors.textMuted };
    return (
      <View style={styles.row}>
        <View style={[styles.iconWrap, { borderColor: `${icon.color}66` }]}>
          <Ionicons name={icon.name} size={18} color={icon.color} />
        </View>
        <View style={styles.body}>
          <Text style={styles.detail}>{item.detail}</Text>
          <View style={styles.metaRow}>
            <Image
              source={item.actor?.profile_picture ? { uri: item.actor.profile_picture } : DEFAULT_AVATAR}
              placeholder={DEFAULT_AVATAR}
              contentFit="cover"
              transition={100}
              style={styles.metaAvatar}
            />
            <Text style={styles.meta} numberOfLines={1}>{item.actor?.username || '—'} · {fmtWhen(item.created_at)}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <Modal animationType="slide" transparent={false} visible onRequestClose={onClose}>
      <View style={styles.root}>
        <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.8)" />
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('group.audit.title')}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderRow}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              onEndReachedThreshold={0.5}
              onEndReached={() => { if (hasNext && !loadingMore) load(page + 1); }}
              ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} /> : null}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="document-text-outline" size={48} color={colors.textMuted} />
                  <Text style={styles.emptyText}>{t('group.audit.empty')}</Text>
                </View>
              }
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  title: { ...typography.h2, color: colors.textPrimary, fontWeight: '800' },
  closeBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: 'rgba(16,46,80,0.55)', borderRadius: radius.lg, padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  iconWrap: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(13,35,64,0.85)', borderWidth: 1,
  },
  body: { flex: 1 },
  detail: { ...typography.body, color: colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  metaAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.surface },
  meta: { ...typography.caption, color: colors.textMuted, flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});

export default GroupAuditLog;
