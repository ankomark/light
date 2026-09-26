import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator,
  StyleSheet, Share,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { searchGroupUsers, addGroupMember, getGroupInviteLink, revokeGroupInvite } from '../services/api';
import RotatingBackground from '../components/RotatingBackground';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { confirmAction, notify } from '../utils/adminConfirm';

const DEFAULT_AVATAR = require('../assets/user-placeholder.png');

const GroupAddMembers = ({ route, navigation }) => {
  const { t } = useI18n();
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
      notify(t('common.error'), e?.response?.data?.error || t('group.add.addFailed'));
    } finally {
      setAddingId(null);
    }
  }, [groupSlug, t]);

  // How long the link lasts, and for how many people (new links; 0 = no limit).
  const [expiresIn, setExpiresIn] = useState(0);
  const [maxUses, setMaxUses] = useState(0);

  const fetchInvite = useCallback(async (regenerate = false, limits = null) => {
    setLoadingInvite(true);
    try {
      const res = await getGroupInviteLink(groupSlug, regenerate, limits || {});
      setInvite(res);
    } catch {
      notify(t('common.error'), t('group.add.linkFailed'));
    } finally {
      setLoadingInvite(false);
    }
  }, [groupSlug, t]);

  // Regenerating breaks every previously-shared link — confirm first.
  const confirmRegenerate = useCallback(() => {
    confirmAction({
      title: t('group.add.regenTitle'), message: t('group.add.regenBody'),
      confirmLabel: t('group.add.regenConfirm'), cancelLabel: t('common.cancel'), destructive: true,
    }).then((ok) => { if (ok) fetchInvite(true, { expires_in_hours: expiresIn, max_uses: maxUses }); });   // web-safe
  }, [t, fetchInvite, expiresIn, maxUses]);

  // A limit applies to the current link at once (the server changes it in place).
  const setLimit = useCallback((kind, value) => {
    if (kind === 'expires') setExpiresIn(value); else setMaxUses(value);
    if (invite?.code) fetchInvite(false, kind === 'expires' ? { expires_in_hours: value } : { max_uses: value });
  }, [invite?.code, fetchInvite]);

  const revoke = useCallback(async () => {
    const ok = await confirmAction({
      title: t('group.add.revokeTitle'), message: t('group.add.revokeBody'),
      confirmLabel: t('group.add.revoke'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    try { await revokeGroupInvite(groupSlug); setInvite(null); }
    catch { notify(t('common.error'), t('group.add.linkFailed')); }
  }, [groupSlug, t]);

  const inviteLink = invite?.code ? `streams://join/${invite.code}` : '';
  const limitNote = invite?.code ? [
    invite.max_uses ? t('group.add.usedOf', { n: invite.uses || 0, max: invite.max_uses }) : null,
    invite.expires_at ? t('group.add.expiresOn', { when: new Date(invite.expires_at).toLocaleString() }) : null,
  ].filter(Boolean).join(' · ') : '';

  const Chips = ({ kind, value, options }) => (
    <View style={styles.chipRow}>
      {options.map(([v, label]) => (
        <TouchableOpacity key={v} onPress={() => setLimit(kind, v)} testID={`limit-${kind}-${v}`}
          style={[styles.chip, value === v && styles.chipOn]} activeOpacity={0.85}>
          <Text style={[styles.chipText, value === v && styles.chipTextOn]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const shareInvite = useCallback(async () => {
    if (!invite?.code) return;
    const name = group?.name || invite.group_name || t('group.add.fallbackName');
    const message = t('group.add.shareMessage', { name, code: invite.code, link: inviteLink });
    try { await Share.share({ message }); } catch { /* user cancelled */ }
  }, [invite, group, inviteLink, t]);

  const renderUser = ({ item }) => {
    const added = addedIds.includes(item.id);
    return (
      <View style={styles.userRow}>
        <Image
          source={item.profile_picture ? { uri: item.profile_picture } : DEFAULT_AVATAR}
          placeholder={DEFAULT_AVATAR}
          contentFit="cover"
          transition={120}
          style={styles.userAvatar}
        />
        <Text style={styles.userName} numberOfLines={1}>{item.username}</Text>
        {added ? (
          <View style={styles.addedPill}>
            <Ionicons name="checkmark" size={14} color={colors.success} />
            <Text style={styles.addedText}>{t('group.add.added')}</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={() => add(item)} disabled={addingId === item.id} activeOpacity={0.85}>
            {addingId === item.id ? (
              <ActivityIndicator size="small" color="#0A1628" />
            ) : (
              <>
                <Ionicons name="person-add" size={15} color="#0A1628" />
                <Text style={styles.addBtnText}>{t('group.add.addBtn')}</Text>
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
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t('group.add.title')}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{group?.name || 'Group'}</Text>
          </View>
        </View>

        {/* Invite link card */}
        <View style={styles.inviteCard}>
          <View style={styles.inviteHead}>
            <Ionicons name="link" size={18} color={colors.accent} />
            <Text style={styles.inviteTitle}>{t('group.add.inviteByLink')}</Text>
          </View>
          {invite?.code ? (
            <>
              <View style={styles.codeBox}>
                <Text style={styles.codeText} numberOfLines={1}>{invite.code}</Text>
              </View>
              <View style={styles.inviteActions}>
                <TouchableOpacity style={styles.shareBtn} onPress={shareInvite} activeOpacity={0.85}>
                  <Ionicons name="share-social" size={16} color="#0A1628" />
                  <Text style={styles.shareBtnText}>{t('group.add.shareInvite')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.regenBtn} onPress={confirmRegenerate} disabled={loadingInvite} activeOpacity={0.85}>
                  <Ionicons name="refresh" size={16} color={colors.textSecondary} />
                  <Text style={styles.regenText}>{t('common.reset')}</Text>
                </TouchableOpacity>
              </View>
              {limitNote ? <Text style={styles.limitNote}>{limitNote}</Text> : null}
              <Text style={styles.inviteHint}>{t('group.add.linkWarning')}</Text>
              <TouchableOpacity onPress={revoke} style={styles.revokeBtn} testID="invite-revoke">
                <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                <Text style={styles.revokeText}>{t('group.add.revoke')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.getLinkBtn} onPress={() => fetchInvite(true, { expires_in_hours: expiresIn, max_uses: maxUses })} disabled={loadingInvite} activeOpacity={0.85}>
              {loadingInvite ? <ActivityIndicator size="small" color={colors.accent} /> : (
                <Text style={styles.getLinkText}>{t('group.add.generateLink')}</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* The link's limits */}
        <View style={styles.limitsCard}>
          <Text style={styles.limitLabel}>{t('group.add.expires')}</Text>
          <Chips kind="expires" value={expiresIn}
            options={[[0, t('group.add.never')], [24, t('group.add.oneDay')], [168, t('group.add.sevenDays')]]} />
          <Text style={styles.limitLabel}>{t('group.add.maxUses')}</Text>
          <Chips kind="uses" value={maxUses}
            options={[[0, t('group.add.unlimited')], [1, '1'], [10, '10'], [100, '100']]} />
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('group.add.searchPlaceholder')}
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
                  <Text style={styles.emptyText}>{t('group.add.noPeople')}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="search-outline" size={44} color={colors.textMuted} />
                  <Text style={styles.emptyText}>{t('group.add.searchHint')}</Text>
                  <Text style={styles.emptySub}>{t('group.add.orShareLink')}</Text>
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
  limitsCard: { marginHorizontal: spacing.md, marginBottom: spacing.sm, gap: 4 },
  limitLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: 4 },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  chipOn: { backgroundColor: 'rgba(244,162,97,0.18)', borderColor: colors.accent },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  chipTextOn: { color: colors.accent },
  limitNote: { ...typography.caption, color: colors.accent, marginTop: spacing.xs },
  revokeBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm, alignSelf: 'flex-start' },
  revokeText: { ...typography.caption, color: colors.error, fontWeight: '700' },
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
