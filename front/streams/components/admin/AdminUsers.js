import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, Image, Modal, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../context/useAuth';
import { isSuperAdmin } from '../../utils/roles';
import {
  fetchAdminUsers, suspendUser, unsuspendUser, banUser, unbanUser, setUserRole, warnUser,
} from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

const ROLE_LABEL = { moderator: 'Moderator', super_admin: 'Super Admin' };

const AdminUsers = () => {
  const { currentUser } = useAuth();
  const superAdmin = isSuperAdmin(currentUser);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // user in the manage sheet
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef(null);

  const load = useCallback(async (q) => {
    setLoading(true);
    try {
      const res = await fetchAdminUsers(q);
      setUsers(res?.results || (Array.isArray(res) ? res : []));
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(query.trim()); }, [load]));  // eslint-disable-line react-hooks/exhaustive-deps

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

  const promptRole = () => {
    Alert.alert('Set role', `Assign a role to @${selected.username}`, [
      { text: 'Super Admin', onPress: () => run((id) => setUserRole(id, 'super_admin')) },
      { text: 'Moderator', onPress: () => run((id) => setUserRole(id, 'moderator')) },
      { text: 'None', onPress: () => run((id) => setUserRole(id, '')) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const promptSuspend = () => {
    Alert.alert('Suspend user', `How long should @${selected.username} be suspended?`, [
      { text: '1 day', onPress: () => run((id) => suspendUser(id, '', 1)) },
      { text: '7 days', onPress: () => run((id) => suspendUser(id, '', 7)) },
      { text: '30 days', onPress: () => run((id) => suspendUser(id, '', 30)) },
      { text: 'Indefinite', onPress: () => run((id) => suspendUser(id, '', 0)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.row} onPress={() => setSelected(item)} activeOpacity={0.85}>
      <Image
        source={item.profile_picture ? { uri: item.profile_picture } : DEFAULT_AVATAR}
        defaultSource={DEFAULT_AVATAR}
        style={styles.avatar}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.username} numberOfLines={1}>@{item.username}</Text>
        <Text style={styles.email} numberOfLines={1}>{item.email}</Text>
      </View>
      <View style={styles.badges}>
        {item.admin_role ? <Text style={[styles.tag, styles.tagRole]}>{ROLE_LABEL[item.admin_role] || item.admin_role}</Text> : null}
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
                    defaultSource={DEFAULT_AVATAR}
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

                <SheetBtn icon="alert-circle-outline" label="Warn (add strike)" onPress={() => run((id) => warnUser(id, ''))} disabled={busy} />
                {selected.is_suspended ? (
                  <SheetBtn icon="play-circle-outline" label="Unsuspend" onPress={() => run(unsuspendUser)} disabled={busy} />
                ) : (
                  <SheetBtn icon="pause-circle-outline" label="Suspend…" onPress={promptSuspend} disabled={busy} />
                )}
                {selected.is_active ? (
                  <SheetBtn icon="ban-outline" label="Ban (disable login)" danger onPress={() => run((id) => banUser(id, ''))} disabled={busy} />
                ) : (
                  <SheetBtn icon="checkmark-circle-outline" label="Unban" onPress={() => run(unbanUser)} disabled={busy} />
                )}
                {superAdmin && (
                  <SheetBtn icon="shield-outline" label="Set role" onPress={promptRole} disabled={busy} />
                )}

                <TouchableOpacity style={styles.sheetClose} onPress={() => setSelected(null)} disabled={busy}>
                  <Text style={styles.sheetCloseText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
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
});

export default AdminUsers;
