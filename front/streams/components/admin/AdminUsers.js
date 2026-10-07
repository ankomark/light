import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchAdminUsers, fetchAdminByUrl, suspendUser, unsuspendUser, banUser, unbanUser, warnUser, clearUserProfile,
  fetchRoles, setUserSuperAdmin, assignUserRole, resetAdminTwoFactor, fetchUserHistory,
} from '../../services/api';
import { useAdminMe, useReasonSheet, ErrorState, StaleNote } from './AdminKit';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';
import { useI18n } from '../../context/I18nContext';
import { adminMemo } from '../../utils/adminSession';
import { notify, confirmAction } from '../../utils/adminConfirm';

// Who to show: everyone, or one kind (the server filters).
const STATES = ['', 'admins', 'suspended', 'banned', 'warned'];

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

const AdminUsers = () => {
  const { t } = useI18n();
  const { can, superAdmin } = useAdminMe();
  const canManage = can('manage_users');
  const canBan = can('ban_users');
  const [reasonSheet, askReason] = useReasonSheet();
  const [state, setState] = useState('');
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);       // only the newest search's answer is shown
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState(() => adminMemo.get('users::')?.results || []);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(() => !adminMemo.get('users::'));
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);
  const [selected, setSelected] = useState(null); // user in the manage sheet
  const [busy, setBusy] = useState(false);
  const [suspendFor, setSuspendFor] = useState(null); // user pending a suspension-duration pick
  const [history, setHistory] = useState(null);       // { forId, data } | { forId, loading } | { forId, failed }
  const debounceRef = useRef(null);

  const load = useCallback(async (q, st = '') => {
    const mine = ++latest.current;
    const key = `users:${q || ''}:${st || ''}`;
    const hit = adminMemo.get(key);
    if (hit) { setUsers(hit.results); setNextUrl(hit.next); }
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetchAdminUsers(q, '', st);
      if (mine !== latest.current) return;   // a newer search has answered
      const rows = res?.results || (Array.isArray(res) ? res : []);
      setUsers(rows);
      setNextUrl(res?.next || null);
      if (!q) adminMemo.set(key, { results: rows, next: res?.next || null });
    } catch {
      if (mine !== latest.current) return;
      setFailed(true);
      setNextUrl(null);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !nextUrl) return;
    setLoadingMore(true);
    try {
      const res = await fetchAdminByUrl(nextUrl);
      setUsers((prev) => {
        const have = new Set(prev.map((u) => u.id));
        return [...prev, ...(res?.results || []).filter((u) => !have.has(u.id))];
      });
      setNextUrl(res?.next || null);
    } catch {
      // silent — pull-to-refresh recovers
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextUrl]);

  useFocusEffect(useCallback(() => {
    load(query.trim(), state);
    if (superAdmin) fetchRoles().then((r) => setRoles(Array.isArray(r) ? r : (r?.results || []))).catch(() => {});
  }, [load]));  // eslint-disable-line react-hooks/exhaustive-deps

  const onChangeQuery = (text) => {
    setQuery(text);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(text.trim(), state), 400);
  };
  const pickState = (st) => { setState(st); load(query.trim(), st); };

  // Run an action, refresh the selected user from the response, keep the list in sync.
  const run = async (fn) => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await fn(selected.id);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setSelected(updated);
    } catch (e) {
      notify(t('common.error'), e?.response?.data?.error || e?.data?.error || t('admin.actionFailedShort'));
    } finally {
      setBusy(false);
    }
  };

  // Acting on someone asks why: they are told, and the audit log keeps it.
  const withReason = async (titleKey, confirmKey, destructive, fn) => {
    const reason = await askReason({
      title: t(titleKey, { name: selected.username }),
      confirmLabel: t(confirmKey),
      destructive,
    });
    if (reason) run((id) => fn(id, reason));
  };

  // A role is a lot of power: said plainly before it is given or taken.
  const changeRole = async (label, fn) => {
    const ok = await confirmAction({
      title: t('adminUsers.roleTitle', { name: selected.username }),
      message: t('adminUsers.roleBody', { role: label }),
      confirmLabel: t('adminUsers.roleConfirm'),
    });
    if (ok) run(fn);
  };

  const showHistory = async () => {
    const forId = selected.id;
    setHistory({ forId, loading: true });
    try {
      setHistory({ forId, data: await fetchUserHistory(forId) });
    } catch {
      setHistory({ forId, failed: true });
    }
  };

  const resetTwoStep = async () => {
    const ok = await confirmAction({
      title: t('adminUsers.reset2faTitle', { name: selected.username }),
      message: t('adminUsers.reset2faBody'),
      confirmLabel: t('adminUsers.reset2faConfirm'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await resetAdminTwoFactor(selected.id);
      const updated = { ...selected, two_factor_enabled: false };
      setSelected(updated);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (e) {
      notify(t('common.error'), e?.data?.error || t('admin.actionFailedShort'));
    } finally {
      setBusy(false);
    }
  };

  // A custom duration picker — Android's Alert only renders 3 buttons, so the
  // four duration options + Cancel can't live in an Alert.
  const promptSuspend = () => setSuspendFor(selected);
  const doSuspend = async (days) => {
    setSuspendFor(null);
    const reason = await askReason({
      title: t('adminUsers.suspendTitle', { name: selected.username }),
      confirmLabel: t('adminUsers.suspendConfirm'),
      destructive: true,
    });
    if (reason) run((id) => suspendUser(id, reason, days));
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.row} onPress={() => setSelected(item)} activeOpacity={0.85}>
      <Image
        source={item.profile_picture ? { uri: item.profile_picture } : DEFAULT_AVATAR}
        placeholder={DEFAULT_AVATAR}
        contentFit="cover"
        transition={120}
        style={styles.avatar}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.username} numberOfLines={1}>@{item.username}</Text>
        <Text style={styles.email} numberOfLines={1}>{item.email}</Text>
      </View>
      <View style={styles.badges}>
        {item.is_super_admin
          ? <Text style={[styles.tag, styles.tagRole]}>{t('admin.superAdmin')}</Text>
          : item.role ? <Text style={[styles.tag, styles.tagRole]}>{item.role.name}</Text> : null}
        {!item.is_active ? <Text style={[styles.tag, styles.tagBan]}>{t('admin.banned')}</Text>
          : item.is_currently_suspended ? <Text style={[styles.tag, styles.tagSusp]}>{t('admin.suspended')}</Text> : null}
        {item.strikes > 0 ? <Text style={[styles.tag, styles.tagStrike]}>{item.strikes}⚠</Text> : null}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('admin.users')}</Text>
      <View style={styles.stateRow}>
        {STATES.map((st) => (
          <TouchableOpacity key={st || 'all'} style={[styles.stateChip, state === st && styles.stateChipOn]}
                            onPress={() => pickState(st)} testID={`users-filter-${st || 'all'}`}>
            <Text style={[styles.stateText, state === st && styles.stateTextOn]}>{t(`adminUsers.filter.${st || 'all'}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.placeholder} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('admin.userSearchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          value={query}
          onChangeText={onChangeQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {failed && users.length > 0 && <StaleNote onRetry={() => load(query.trim(), state)} />}
      {loading && !users.length ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : failed && !users.length ? (
        <ErrorState onRetry={() => load(query.trim(), state)} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={() => load(query.trim(), state)}
          refreshing={loading}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} /> : null}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>{t('admin.noUsers')}</Text></View>}
        />
      )}

      {/* Manage sheet */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => !busy && setSelected(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            {selected && (
              <>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHead}>
                  <Image
                    source={selected.profile_picture ? { uri: selected.profile_picture } : DEFAULT_AVATAR}
                    placeholder={DEFAULT_AVATAR}
                    contentFit="cover"
                    transition={120}
                    style={styles.sheetAvatar}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetName}>@{selected.username}</Text>
                    <Text style={styles.sheetEmail}>{selected.email}</Text>
                    <Text style={styles.sheetMeta}>
                      {t('adminUsers.strikes', { n: selected.strikes || 0 })}
                      {selected.is_currently_suspended
                        ? selected.suspended_until
                          ? ` · ${t('adminUsers.suspendedUntil', { date: new Date(selected.suspended_until).toLocaleDateString() })}`
                          : ` · ${t('adminUsers.suspendedIndefinitely')}`
                        : ''}
                    </Text>
                  </View>
                </View>

                {busy && <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.sm }} />}

                {history?.forId === selected.id && history.data ? (
                  <View style={styles.history} testID="users-history">
                    <Text style={styles.historyLine}>
                      {t('adminUsers.historyReports', { n: history.data.reports_against.total, p: history.data.reports_against.pending })}
                    </Text>
                    <Text style={styles.historyLine}>
                      {t('adminUsers.historyMore', { made: history.data.reports_made, devices: history.data.devices_signed_in, posts: history.data.posts })}
                    </Text>
                    {history.data.admin_actions.slice(0, 5).map((a) => (
                      <Text key={a.id} style={styles.historyAction} numberOfLines={2}>
                        {new Date(a.created_at).toLocaleDateString()} · {a.action.replace(/_/g, ' ')} · @{a.by}{a.reason ? ` — ${a.reason}` : ''}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <SheetBtn icon="time-outline" label={history?.forId === selected.id && history.failed ? t('adminKit.loadFailed') : t('adminUsers.history')}
                    onPress={showHistory} disabled={busy || (history?.forId === selected.id && history.loading)} testID="users-history-open" />
                )}

                {selected.can_act === false && (
                  <Text style={styles.rankNote} testID="users-rank-note">{t('adminUsers.rankNote')}</Text>
                )}
                {selected.profile_text && (selected.profile_text.display_name || selected.profile_text.bio
                  || selected.profile_text.website) ? (
                  <View style={styles.history} testID="users-profile-text">
                    <Text style={styles.historyLine}>{t('adminUsers.profileText')}</Text>
                    {[selected.profile_text.display_name, selected.profile_text.bio, selected.profile_text.website]
                      .filter(Boolean).map((line, i) => (
                        <Text key={i} style={styles.historyAction} numberOfLines={3}>{line}</Text>
                      ))}
                  </View>
                ) : null}
                {selected.can_act !== false && canManage && (
                  <SheetBtn icon="trash-outline" label={t('adminUsers.clearProfile')} testID="users-clear-profile"
                    onPress={() => withReason('adminUsers.clearProfileTitle', 'adminUsers.clearProfileConfirm', true,
                      (id, reason) => clearUserProfile(id, reason))} disabled={busy} />
                )}
                {selected.can_act !== false && canManage && (
                  <SheetBtn icon="alert-circle-outline" label={t('adminUsers.warn')} testID="users-warn"
                    onPress={() => withReason('adminUsers.warnTitle', 'adminUsers.warnConfirm', false, warnUser)} disabled={busy} />
                )}
                {selected.can_act !== false && canManage && (selected.is_suspended ? (
                  <SheetBtn icon="play-circle-outline" label={t('adminUsers.unsuspend')} onPress={() => run(unsuspendUser)} disabled={busy} />
                ) : (
                  <SheetBtn icon="pause-circle-outline" label={t('adminUsers.suspend')} onPress={promptSuspend} disabled={busy} testID="users-suspend" />
                ))}
                {selected.can_act !== false && canBan && (selected.is_active ? (
                  <SheetBtn icon="ban-outline" label={t('adminUsers.ban')} danger testID="users-ban"
                    onPress={() => withReason('adminUsers.banTitle', 'adminUsers.banConfirm', true, banUser)} disabled={busy} />
                ) : (
                  <SheetBtn icon="checkmark-circle-outline" label={t('adminUsers.unban')} onPress={() => run(unbanUser)} disabled={busy} />
                ))}
                {superAdmin && selected.two_factor_enabled && (
                  <SheetBtn icon="key-outline" label={t('adminUsers.reset2fa')} onPress={resetTwoStep} disabled={busy} testID="users-reset-2fa" />
                )}

                {/* Role assignment (super-admin only) */}
                {superAdmin && (
                  <View style={styles.roleSection}>
                    <Text style={styles.roleLabel}>{t('admin.assignRole')}</Text>
                    <View style={styles.roleChips}>
                      <TouchableOpacity
                        style={[styles.roleChip, selected.is_super_admin && styles.roleChipOn]}
                        onPress={() => !selected.is_super_admin && changeRole(t('admin.superAdmin'), (id) => setUserSuperAdmin(id, true))}
                        disabled={busy} testID="users-role-super">
                        <Text style={[styles.roleChipText, selected.is_super_admin && styles.roleChipTextOn]}>{t('admin.superAdmin')}</Text>
                      </TouchableOpacity>
                      {roles.map((r) => {
                        const on = !selected.is_super_admin && selected.role?.id === r.id;
                        return (
                          <TouchableOpacity key={r.id}
                            style={[styles.roleChip, on && styles.roleChipOn]}
                            onPress={() => !on && changeRole(r.name, (id) => assignUserRole(id, r.id))}
                            disabled={busy} testID={`users-role-${r.id}`}>
                            <Text style={[styles.roleChipText, on && styles.roleChipTextOn]}>{r.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity
                        style={[styles.roleChip, !selected.is_super_admin && !selected.role && styles.roleChipOn]}
                        onPress={() => (selected.is_super_admin || selected.role) && changeRole(t('admin.noAccess'),
                          (id) => (selected.is_super_admin ? setUserSuperAdmin(id, false) : assignUserRole(id, null)))}
                        disabled={busy} testID="users-role-none">
                        <Text style={[styles.roleChipText, !selected.is_super_admin && !selected.role && styles.roleChipTextOn]}>{t('admin.noAccess')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <TouchableOpacity style={styles.sheetClose} onPress={() => setSelected(null)} disabled={busy}>
                  <Text style={styles.sheetCloseText}>{t('admin.close')}</Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {reasonSheet}

      {/* Suspension duration picker (Android-safe; replaces a >3-button Alert) */}
      <Modal visible={!!suspendFor} transparent animationType="fade" onRequestClose={() => setSuspendFor(null)}>
        <TouchableOpacity style={styles.durBackdrop} activeOpacity={1} onPress={() => setSuspendFor(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.durCard}>
            <Text style={styles.durTitle}>{t('adminUsers.suspendTitle', { name: suspendFor?.username })}</Text>
            <Text style={styles.durSub}>{t('admin.suspensionLength')}</Text>
            {[
              { label: t('adminUsers.days', { n: 1 }), days: 1 },
              { label: t('adminUsers.days', { n: 7 }), days: 7 },
              { label: t('adminUsers.days', { n: 30 }), days: 30 },
              { label: t('adminUsers.indefinite'), days: 0 },
            ].map((opt) => (
              <TouchableOpacity key={opt.label} style={styles.durBtn} onPress={() => doSuspend(opt.days)} activeOpacity={0.85}>
                <Text style={styles.durBtnText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.durCancel} onPress={() => setSuspendFor(null)}>
              <Text style={styles.durCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const SheetBtn = ({ icon, label, onPress, danger, disabled, testID }) => (
  <TouchableOpacity style={styles.sheetBtn} onPress={onPress} disabled={disabled} activeOpacity={0.85} testID={testID}>
    <Ionicons name={icon} size={20} color={danger ? colors.error : colors.accent} />
    <Text style={[styles.sheetBtnText, danger && { color: colors.error }]}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: {
    ...typography.h1, color: colors.textPrimary, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: 'rgba(13,35,64,0.78)', borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    marginHorizontal: spacing.md, marginVertical: spacing.sm, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  stateChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: 'rgba(16,28,46,0.82)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  stateChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  stateText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  stateTextOn: { color: '#0A1628' },
  rankNote: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic', paddingVertical: spacing.sm },
  history: { gap: 4, padding: spacing.sm, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.04)' },
  historyLine: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  historyAction: { ...typography.caption, color: colors.textSecondary },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(16,28,46,0.82)', borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.sm + 2, marginBottom: spacing.sm,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface },
  username: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  email: { ...typography.caption, color: colors.textMuted, marginTop: 1 },
  badges: { alignItems: 'flex-end', gap: 4 },
  tag: { ...typography.caption, fontSize: 10, fontWeight: '800', overflow: 'hidden',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, textTransform: 'uppercase' },
  tagRole: { color: '#0A1628', backgroundColor: colors.accent },
  tagSusp: { color: colors.white, backgroundColor: colors.warning },
  tagBan: { color: colors.white, backgroundColor: colors.error },
  tagStrike: { color: colors.white, backgroundColor: 'rgba(229,57,53,0.7)' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#0E2038', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.xs,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: spacing.sm },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sheetAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface },
  sheetName: { ...typography.h3, color: colors.textPrimary },
  sheetEmail: { ...typography.caption, color: colors.textMuted, marginTop: 1 },
  sheetMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  sheetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  sheetBtnText: { ...typography.label, color: colors.textPrimary, fontWeight: '600' },
  sheetClose: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  sheetCloseText: { ...typography.label, color: colors.textSecondary, fontWeight: '700' },
  roleSection: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  roleLabel: {
    ...typography.caption, color: colors.accent, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.sm,
  },
  roleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  roleChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  roleChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  roleChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  roleChipTextOn: { color: '#0A1628' },

  durBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  durCard: {
    width: '100%', maxWidth: 340, backgroundColor: '#0E2038', borderRadius: radius.xl, padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  durTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '800', textAlign: 'center' },
  durSub: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: 2, marginBottom: spacing.sm },
  durBtn: {
    paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  durBtnText: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  durCancel: { paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xs },
  durCancelText: { ...typography.label, color: colors.textSecondary, fontWeight: '700' },
});

export default AdminUsers;
