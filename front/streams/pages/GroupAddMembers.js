import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, Image, ActivityIndicator,
  StyleSheet, Share, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { searchGroupUsers, addGroupMember, getGroupInviteLink } from '../services/api';
import RotatingBackground from '../components/RotatingBackground';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/user-placeholder.png');

const GroupAddMembers = ({ route, navigation }) => {
  const groupSlug = route?.params?.groupSlug;
  const group = route?.params?.group;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addedIds, setAddedIds] = useState([]);
  const [addingId, setAddingId] = useState(null);

  const [invite, setInvite] = useState(null); // { code, group_name }
  const [loadingInvite, setLoadingInvite] = useState(false);

  // Debounced username search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return undefined; }
    let active = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const data = await searchGroupUsers(groupSlug, q);
        if (active) setResults(Array.isArray(data) ? data : []);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 350);
    return () => { active = false; clearTimeout(t); };
  }, [query, groupSlug]);

  const add = useCallback(async (user) => {
    setAddingId(user.id);
    try {
      await addGroupMember(groupSlug, user.id);
      setAddedIds(prev => [...prev, user.id]);
    } catch (e) {
      Alert.alert('Error', e?.response?.data?.error || 'Could not add this member.');
    } finally {
      setAddingId(null);
    }
  }, [groupSlug]);

  const fetchInvite = useCallback(async (regenerate = false) => {
    setLoadingInvite(true);
    try {
      const res = await getGroupInviteLink(groupSlug, regenerate);
      setInvite(res);
    } catch {
      Alert.alert('Error', 'Could not get an invite link.');
    } finally {
      setLoadingInvite(false);
    }
  }, [groupSlug]);

  const inviteLink = invite?.code ? `streams://join/${invite.code}` : '';

  const shareInvite = useCallback(async () => {
    if (!invite?.code) return;
    const name = group?.name || invite.group_name || 'our group';
    const message =
      `Join "${name}" on Adventist Life.\n\n` +
      `Open the app → Groups → "Join with code" and enter this code:\n${invite.code}\n\n` +
      `Or tap: ${inviteLink}`;
    try { await Share.share({ message }); } catch { /* user cancelled */ }
  }, [invite, group, inviteLink]);

  const renderUser = ({ item }) => {
    const added = addedIds.includes(item.id);
    return (
      <View style={styles.userRow}>
        <Image
          source={item.profile_picture ? { uri: item.profile_picture } : DEFAULT_AVATAR}
          defaultSource={DEFAULT_AVATAR}
          style={styles.userAvatar}
        />
        <Text style={styles.userName} numberOfLines={1}>{item.username}</Text>
        {added ? (
          <View style={styles.addedPill}>
            <Ionicons name="checkmark" size={14} color={colors.success} />
            <Text style={styles.addedText}>Added</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={() => add(item)} disabled={addingId === item.id} activeOpacity={0.85}>
            {addingId === item.id ? (
              <ActivityIndicator size="small" color="#0A1628" />
            ) : (
              <>
                <Ionicons name="person-add" size={15} color="#0A1628" />
                <Text style={styles.addBtnText}>Add</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.72)" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Add members</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{group?.name || 'Group'}</Text>
          </View>
        </View>

        {/* Invite link card */}
        <View style={styles.inviteCard}>
          <View style={styles.inviteHead}>
            <Ionicons name="link" size={18} color={colors.accent} />
            <Text style={styles.inviteTitle}>Invite by link</Text>
          </View>
          {invite?.code ? (
            <>
              <View style={styles.codeBox}>
                <Text style={styles.codeText} numberOfLines={1}>{invite.code}</Text>
              </View>
              <View style={styles.inviteActions}>
                <TouchableOpacity style={styles.shareBtn} onPress={shareInvite} activeOpacity={0.85}>
                  <Ionicons name="share-social" size={16} color="#0A1628" />
                  <Text style={styles.shareBtnText}>Share invite</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.regenBtn} onPress={() => fetchInvite(true)} disabled={loadingInvite} activeOpacity={0.85}>
                  <Ionicons name="refresh" size={16} color={colors.textSecondary} />
                  <Text style={styles.regenText}>Reset</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.inviteHint}>Anyone with this code can join. Reset to revoke old links.</Text>
            </>
          ) : (
            <TouchableOpacity style={styles.getLinkBtn} onPress={() => fetchInvite(false)} disabled={loadingInvite} activeOpacity={0.85}>
              {loadingInvite ? <ActivityIndicator size="small" color={colors.accent} /> : (
                <Text style={styles.getLinkText}>Generate invite link</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search people by username"
            placeholderTextColor={colors.placeholder}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></TouchableOpacity>
          ) : null}
        </View>

        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderUser}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              {searching ? (
                <ActivityIndicator color={colors.accent} />
              ) : query.trim().length >= 2 ? (
                <>
                  <Ionicons name="person-outline" size={44} color={colors.textMuted} />
                  <Text style={styles.emptyText}>No people found</Text>
                </>
              ) : (
                <>
                  <Ionicons name="search-outline" size={44} color={colors.textMuted} />
                  <Text style={styles.emptyText}>Search to add people directly</Text>
                  <Text style={styles.emptySub}>Or share an invite link above</Text>
                </>
              )}
            </View>
          }
        />
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h3, color: colors.textPrimary, fontWeight: '800' },
  subtitle: { ...typography.caption, color: colors.textSecondary },

  inviteCard: {
    margin: spacing.md, padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: 'rgba(16,46,80,0.6)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.3)',
  },
  inviteHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  inviteTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  codeBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(13,35,64,0.85)', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  codeText: { flex: 1, ...typography.body, color: colors.accent, fontWeight: '700' },
  inviteActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.accent, paddingVertical: spacing.sm + 1, borderRadius: radius.md },
  shareBtnText: { color: '#0A1628', fontWeight: '800', fontSize: 13.5 },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 1, borderRadius: radius.md, backgroundColor: 'rgba(18,30,46,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  regenText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  inviteHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  getLinkBtn: { paddingVertical: spacing.sm + 2, borderRadius: radius.md, alignItems: 'center', backgroundColor: 'rgba(244,162,97,0.14)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.5)' },
  getLinkText: { ...typography.button, color: colors.accent, fontWeight: '700' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: 'rgba(13,35,64,0.85)', borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: 0 },

  listContent: { padding: spacing.md, paddingBottom: spacing.xl },
  userRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
    backgroundColor: 'rgba(16,46,80,0.55)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  userAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: 'rgba(244,162,97,0.35)' },
  userName: { flex: 1, ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.accent, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, minWidth: 72, justifyContent: 'center' },
  addBtnText: { color: '#0A1628', fontWeight: '800', fontSize: 13 },
  addedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: 'rgba(67,160,71,0.16)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(67,160,71,0.5)' },
  addedText: { ...typography.caption, color: colors.success, fontWeight: '700' },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: spacing.xs },
  emptyText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  emptySub: { ...typography.caption, color: colors.textMuted },
});

export default GroupAddMembers;
