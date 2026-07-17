import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, Modal, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/useAuth';
import { isSuperAdmin, hasCapability } from '../../utils/roles';
import {
  fetchAdminUsers, fetchAdminByUrl, suspendUser, unsuspendUser, banUser, unbanUser, warnUser,
  fetchRoles, setUserSuperAdmin, assignUserRole,
} from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

const AdminUsers = () => {
  const { currentUser } = useAuth();
  const superAdmin = isSuperAdmin(currentUser);
  const canManage = hasCapability(currentUser, 'manage_users');
  const canBan = hasCapability(currentUser, 'ban_users');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);
  const [selected, setSelected] = useState(null); // user in the manage sheet
  const [busy, setBusy] = useState(false);
  const [suspendFor, setSuspendFor] = useState(null); // user pending a suspension-duration pick
  const debounceRef = useRef(null);

  const load = useCallback(async (q) => {
    setLoading(true);
    try {
      const res = await fetchAdminUsers(q);
      setUsers(res?.results || (Array.isArray(res) ? res : []));
      setNextUrl(res?.next || null);
    } catch {
      setUsers([]);
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
    load(query.trim());
    if (superAdmin) fetchRoles().then((r) => setRoles(Array.isArray(r) ? r : (r?.results || []))).catch(() => {});
  }, [load]));  // eslint-disable-line react-hooks/exhaustive-deps

  const onChangeQuery = (text) => {
    setQuery(text);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(text.trim()), 400);
  };

  // Run an action, refresh the selected user from the response, keep the list in sync.
  const run = async (fn) => {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await fn(selected.id);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setSelected(updated);
    } catch (e) {
      Alert.alert('Error', e?.response?.data?.error || 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  // A custom duration picker — Android's Alert only renders 3 buttons, so the
  // four duration options + Cancel can't live in an Alert.
  const promptSuspend = () => setSuspendFor(selected);
  const doSuspend = (days) => {
    setSuspendFor(null);
    run((id) => suspendUser(id, '', days));
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
          ? <Text style={[styles.tag, styles.tagRole]}>Super Admin</Text>
          : item.role ? <Text style={[styles.tag, styles.tagRole]}>{item.role.name}</Text> : null}
        {!item.is_active ? <Text style={[styles.tag, styles.tagBan]}>Banned</Text>
          : item.is_currently_suspended ? <Text style={[styles.tag, styles.tagSusp]}>Suspended</Text> : null}
        {item.strikes > 0 ? <Text style={[styles.tag, styles.tagStrike]}>{item.strikes}⚠</Text> : null}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Users</Text>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.placeholder} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search username or email…"
          placeholderTextColor={colors.placeholder}
          value={query}
          onChangeText={onChangeQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={() => load(query.trim())}
          refreshing={loading}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} /> : null}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>No users found</Text></View>}
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
                      {selected.strikes || 0} strike{selected.strikes === 1 ? '' : 's'}
                      {selected.is_currently_suspended
                        ? selected.suspended_until
                          ? ` · suspended until ${new Date(selected.suspended_until).toLocaleDateString()}`
                          : ' · suspended (indefinite)'
                        : ''}
                    </Text>
                  </View>
                </View>

                {busy && <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.sm }} />}

                {canManage && (
                  <SheetBtn icon="alert-circle-outline" label="Warn (add strike)" onPress={() => run((id) => warnUser(id, ''))} disabled={busy} />
                )}
                {canManage && (selected.is_suspended ? (
                  <SheetBtn icon="play-circle-outline" label="Unsuspend" onPress={() => run(unsuspendUser)} disabled={busy} />
                ) : (
                  <SheetBtn icon="pause-circle-outline" label="Suspend…" onPress={promptSuspend} disabled={busy} />
                ))}
                {canBan && (selected.is_active ? (
                  <SheetBtn icon="ban-outline" label="Ban (disable login)" danger onPress={() => run((id) => banUser(id, ''))} disabled={busy} />
                ) : (
                  <SheetBtn icon="checkmark-circle-outline" label="Unban" onPress={() => run(unbanUser)} disabled={busy} />
                ))}

                {/* Role assignment (super-admin only) */}
                {superAdmin && (
                  <View style={styles.roleSection}>
                    <Text style={styles.roleLabel}>Assign role</Text>
                    <View style={styles.roleChips}>
                      <TouchableOpacity
                        style={[styles.roleChip, selected.is_super_admin && styles.roleChipOn]}
                        onPress={() => run((id) => setUserSuperAdmin(id, true))} disabled={busy}>
                        <Text style={[styles.roleChipText, selected.is_super_admin && styles.roleChipTextOn]}>Super Admin</Text>
                      </TouchableOpacity>
                      {roles.map((r) => {
                        const on = !selected.is_super_admin && selected.role?.id === r.id;
                        return (
                          <TouchableOpacity key={r.id}
                            style={[styles.roleChip, on && styles.roleChipOn]}
                            onPress={() => run((id) => assignUserRole(id, r.id))} disabled={busy}>
                            <Text style={[styles.roleChipText, on && styles.roleChipTextOn]}>{r.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity
                        style={[styles.roleChip, !selected.is_super_admin && !selected.role && styles.roleChipOn]}
                        onPress={() => run((id) => (selected.is_super_admin ? setUserSuperAdmin(id, false) : assignUserRole(id, null)))} disabled={busy}>
                        <Text style={[styles.roleChipText, !selected.is_super_admin && !selected.role && styles.roleChipTextOn]}>No access</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <TouchableOpacity style={styles.sheetClose} onPress={() => setSelected(null)} disabled={busy}>
                  <Text style={styles.sheetCloseText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Suspension duration picker (Android-safe; replaces a >3-button Alert) */}
      <Modal visible={!!suspendFor} transparent animationType="fade" onRequestClose={() => setSuspendFor(null)}>
        <TouchableOpacity style={styles.durBackdrop} activeOpacity={1} onPress={() => setSuspendFor(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.durCard}>
            <Text style={styles.durTitle}>Suspend @{suspendFor?.username}</Text>
            <Text style={styles.durSub}>How long should the suspension last?</Text>
            {[
              { label: '1 day', days: 1 },
              { label: '7 days', days: 7 },
              { label: '30 days', days: 30 },
              { label: 'Indefinite', days: 0 },
            ].map((opt) => (
              <TouchableOpacity key={opt.label} style={styles.durBtn} onPress={() => doSuspend(opt.days)} activeOpacity={0.85}>
                <Text style={styles.durBtnText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.durCancel} onPress={() => setSuspendFor(null)}>
              <Text style={styles.durCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const SheetBtn = ({ icon, label, onPress, danger, disabled }) => (
  <TouchableOpacity style={styles.sheetBtn} onPress={onPress} disabled={disabled} activeOpacity={0.85}>
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
