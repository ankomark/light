import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, Modal, TouchableOpacity, Image, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchGroupMembers, removeGroupMember, setGroupAdmin } from '../services/api';
import { useAuth } from '../context/useAuth';
import RotatingBackground from '../components/RotatingBackground';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/user-placeholder.png');

const GroupMemberItem = ({ member, isCreator, canManage, isSelf, onPress }) => (
  <TouchableOpacity
    style={styles.memberItem}
    activeOpacity={canManage && !isSelf ? 0.7 : 1}
    onPress={() => (canManage && !isSelf ? onPress(member) : null)}
  >
    <Image
      source={member.user?.profile?.picture ? { uri: member.user.profile.picture } : DEFAULT_AVATAR}
      defaultSource={DEFAULT_AVATAR}
      style={styles.memberAvatar}
    />
    <View style={styles.memberInfo}>
      <Text style={styles.memberName} numberOfLines={1}>
        {member.user?.username || 'Unknown User'}{isSelf ? ' (You)' : ''}
      </Text>
      <Text style={styles.memberSub}>{isCreator ? 'Group owner' : member.is_admin ? 'Group admin' : 'Member'}</Text>
    </View>
    {isCreator ? (
      <View style={[styles.badge, styles.ownerBadge]}>
        <Ionicons name="star" size={11} color="#0A1628" />
        <Text style={styles.ownerBadgeText}>Owner</Text>
      </View>
    ) : member.is_admin ? (
      <View style={styles.badge}>
        <Ionicons name="shield-checkmark" size={12} color={colors.accent} />
        <Text style={styles.badgeText}>Admin</Text>
      </View>
    ) : null}
    {canManage && !isSelf && (
      <Ionicons name="ellipsis-vertical" size={18} color={colors.textMuted} style={{ marginLeft: spacing.xs }} />
    )}
  </TouchableOpacity>
);

const GroupMembers = (props) => {
  // Works both as a navigation screen (route.params) and as an inline modal (props).
  const groupSlug = props.groupSlug ?? props.route?.params?.groupSlug;
  const group = props.group ?? props.route?.params?.group;
  const isAdmin = props.isAdmin ?? props.route?.params?.isAdmin ?? false;
  const onClose = props.onClose ?? (() => props.navigation?.goBack());
  const { currentUser } = useAuth();
  const creatorId = group?.creator?.id;

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionMember, setActionMember] = useState(null); // member whose action sheet is open
  const [confirmRemove, setConfirmRemove] = useState(null); // member pending removal
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchGroupMembers(groupSlug);
      setMembers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load members:', err);
      setError('Failed to load members. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [groupSlug]);

  useEffect(() => { load(); }, [load]);

  const changeAdmin = useCallback(async (member, makeAdmin) => {
    setActionMember(null);
    setBusy(true);
    try {
      await setGroupAdmin(groupSlug, member.user.id, makeAdmin);
      await load();
    } catch (e) {
      Alert.alert('Error', e?.response?.data?.error || 'Could not update this member.');
    } finally {
      setBusy(false);
    }
  }, [groupSlug, load]);

  const doRemove = useCallback(async (member) => {
    setConfirmRemove(null);
    setBusy(true);
    try {
      await removeGroupMember(groupSlug, member.user.id);
      await load();
    } catch (e) {
      Alert.alert('Error', e?.response?.data?.error || 'Could not remove this member.');
    } finally {
      setBusy(false);
    }
  }, [groupSlug, load]);

  const am = actionMember;
  const amIsCreator = am && am.user?.id === creatorId;

  return (
    <Modal animationType="slide" transparent={false} visible onRequestClose={onClose}>
      <View style={styles.root}>
        <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.72)" />
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title}>Members</Text>
              {!loading && !error && (
                <Text style={styles.subtitle}>
                  {members.length} {members.length === 1 ? 'person' : 'people'}
                  {isAdmin ? '  ·  Tap a member to manage' : ''}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loader}><ActivityIndicator size="large" color={colors.accent} /></View>
          ) : error ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={members}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <GroupMemberItem
                  member={item}
                  isCreator={item.user?.id === creatorId}
                  canManage={isAdmin}
                  isSelf={item.user?.id === currentUser?.id}
                  onPress={setActionMember}
                />
              )}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Ionicons name="people-outline" size={48} color={colors.textMuted} />
                  <Text style={styles.emptyText}>No members yet</Text>
                </View>
              }
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </SafeAreaView>

        {busy && (
          <View style={styles.busyOverlay}><ActivityIndicator size="large" color={colors.accent} /></View>
        )}

        {/* Member action sheet */}
        <Modal visible={!!am} transparent animationType="slide" onRequestClose={() => setActionMember(null)}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setActionMember(null)}>
            <Pressable style={styles.sheetCard}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHead}>
                <Image
                  source={am?.user?.profile?.picture ? { uri: am.user.profile.picture } : DEFAULT_AVATAR}
                  defaultSource={DEFAULT_AVATAR}
                  style={styles.sheetAvatar}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle} numberOfLines={1}>{am?.user?.username || 'Member'}</Text>
                  <Text style={styles.sheetSubtitle}>{amIsCreator ? 'Group owner' : am?.is_admin ? 'Group admin' : 'Member'}</Text>
                </View>
              </View>

              {!am?.is_admin && (
                <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} onPress={() => changeAdmin(am, true)}>
                  <View style={[styles.sheetIcon, styles.sheetIconPhoto]}><Ionicons name="shield-checkmark" size={22} color={colors.accent} /></View>
                  <View style={styles.sheetOptionText}>
                    <Text style={styles.sheetOptionLabel}>Make group admin</Text>
                    <Text style={styles.sheetOptionHint}>Can manage members & settings</Text>
                  </View>
                </TouchableOpacity>
              )}

              {am?.is_admin && !amIsCreator && (
                <TouchableOpacity style={styles.sheetOption} activeOpacity={0.85} onPress={() => changeAdmin(am, false)}>
                  <View style={[styles.sheetIcon, styles.sheetIconFile]}><Ionicons name="remove-circle-outline" size={22} color={colors.primary} /></View>
                  <View style={styles.sheetOptionText}>
                    <Text style={styles.sheetOptionLabel}>Dismiss as admin</Text>
                    <Text style={styles.sheetOptionHint}>Revoke admin privileges</Text>
                  </View>
                </TouchableOpacity>
              )}

              {!amIsCreator && (
                <TouchableOpacity style={[styles.sheetOption, styles.sheetOptionDanger]} activeOpacity={0.85} onPress={() => { const m = am; setActionMember(null); setTimeout(() => setConfirmRemove(m), 220); }}>
                  <View style={[styles.sheetIcon, styles.sheetIconDanger]}><Ionicons name="person-remove-outline" size={22} color={colors.error} /></View>
                  <View style={styles.sheetOptionText}>
                    <Text style={[styles.sheetOptionLabel, { color: colors.error }]}>Remove from group</Text>
                    <Text style={styles.sheetOptionHint}>They'll lose access to this chat</Text>
                  </View>
                </TouchableOpacity>
              )}

              {amIsCreator && (
                <Text style={styles.sheetNote}>The group owner can't be removed or demoted.</Text>
              )}

              <TouchableOpacity style={styles.sheetCancel} activeOpacity={0.85} onPress={() => setActionMember(null)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Remove confirmation */}
        <Modal visible={!!confirmRemove} transparent animationType="fade" onRequestClose={() => setConfirmRemove(null)}>
          <Pressable style={styles.confirmBackdrop} onPress={() => setConfirmRemove(null)}>
            <Pressable style={styles.confirmCard}>
              <View style={styles.confirmIcon}><Ionicons name="person-remove-outline" size={26} color={colors.error} /></View>
              <Text style={styles.confirmTitle} numberOfLines={2}>Remove {confirmRemove?.user?.username}?</Text>
              <Text style={styles.confirmText}>They'll be removed from the group and lose access to its messages.</Text>
              <View style={styles.confirmActions}>
                <TouchableOpacity style={[styles.confirmBtn, styles.confirmCancelBtn]} activeOpacity={0.85} onPress={() => setConfirmRemove(null)}>
                  <Text style={styles.confirmCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.confirmBtn, styles.confirmDangerBtn]} activeOpacity={0.85} onPress={() => doRemove(confirmRemove)}>
                  <Text style={styles.confirmDangerText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
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
  headerTitleWrap: { flex: 1 },
  title: { ...typography.h2, color: colors.textPrimary, fontWeight: '800' },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  closeBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: { marginTop: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.accent },
  retryText: { ...typography.button, color: '#0A1628', fontWeight: '700' },
  listContent: { padding: spacing.md, paddingBottom: spacing.xl },
  memberItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
    backgroundColor: 'rgba(16,46,80,0.55)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)', ...shadows.sm,
  },
  memberAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface,
    borderWidth: 1.5, borderColor: 'rgba(244,162,97,0.35)',
  },
  memberInfo: { flex: 1 },
  memberName: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  memberSub: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full,
    backgroundColor: 'rgba(244,162,97,0.14)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.5)',
  },
  badgeText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  ownerBadge: { backgroundColor: colors.accent, borderColor: colors.accent },
  ownerBadgeText: { ...typography.caption, color: '#0A1628', fontWeight: '800' },

  busyOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },

  // Action sheet (shared luxury styling)
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheetCard: {
    backgroundColor: 'rgba(16,46,80,0.98)', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl + spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.35)', ...shadows.lg,
  },
  sheetHandle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', marginBottom: spacing.md },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  sheetAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: 'rgba(244,162,97,0.4)' },
  sheetTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '700' },
  sheetSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  sheetOption: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(13,35,64,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)', marginBottom: spacing.sm,
  },
  sheetOptionDanger: { borderColor: 'rgba(229,57,53,0.3)' },
  sheetIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  sheetIconPhoto: { backgroundColor: 'rgba(244,162,97,0.16)', borderColor: 'rgba(244,162,97,0.5)' },
  sheetIconFile: { backgroundColor: 'rgba(29,161,242,0.14)', borderColor: 'rgba(29,161,242,0.5)' },
  sheetIconDanger: { backgroundColor: 'rgba(229,57,53,0.14)', borderColor: 'rgba(229,57,53,0.5)' },
  sheetOptionText: { flex: 1 },
  sheetOptionLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  sheetOptionHint: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  sheetNote: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.sm, fontStyle: 'italic' },
  sheetCancel: {
    marginTop: spacing.xs, paddingVertical: spacing.sm + 2, borderRadius: radius.lg, alignItems: 'center',
    backgroundColor: 'rgba(18,30,46,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  sheetCancelText: { ...typography.button, color: colors.textSecondary, fontWeight: '700' },

  // Confirm dialog
  confirmBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  confirmCard: {
    width: '100%', maxWidth: 360, backgroundColor: 'rgba(16,46,80,0.98)', borderRadius: radius.xl,
    padding: spacing.lg, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(229,57,53,0.35)', ...shadows.lg,
  },
  confirmIcon: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(229,57,53,0.14)', borderWidth: 1, borderColor: 'rgba(229,57,53,0.5)', marginBottom: spacing.md,
  },
  confirmTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '800', textAlign: 'center' },
  confirmText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs, lineHeight: 18 },
  confirmActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' },
  confirmBtn: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.lg, alignItems: 'center' },
  confirmCancelBtn: { backgroundColor: 'rgba(18,30,46,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  confirmCancelText: { ...typography.button, color: colors.textSecondary, fontWeight: '700' },
  confirmDangerBtn: { backgroundColor: colors.error },
  confirmDangerText: { ...typography.button, color: colors.white, fontWeight: '800' },
});

export default GroupMembers;
