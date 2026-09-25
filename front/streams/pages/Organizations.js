// Organisations: the ones you're in (and invitations waiting), start one,
// or find conferences, schools, publishing houses… by name, place or kind.
// Yours are kept for offline.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchOrganizations, fetchOrgInvitations } from '../services/api';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { ORG_KINDS, OrgLogo } from './OrganizationPage';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const OrgRow = ({ org, onOpen, t, note }) => (
  <TouchableOpacity style={styles.row} onPress={() => onOpen(org)} testID={`org-row-${org.slug}`} accessibilityRole="button">
    <OrgLogo org={org} size={46} />
    <View style={styles.flex}>
      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={1}>{org.name}</Text>
        {org.is_verified ? <Ionicons name="checkmark-circle" size={14} color={colors.primary} /> : null}
      </View>
      <Text style={styles.meta} numberOfLines={1}>
        {note || [t(`org.kind.${org.kind}`), org.location, org.books_count != null ? t('org.booksN', { n: org.books_count }) : null]
          .filter(Boolean).join(' · ')}
      </Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
  </TouchableOpacity>
);

const Organizations = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const mineKey = userKey(currentUser?.id, 'orgs:mine');
  const [tab, setTab] = useState(isAuthenticated ? 'mine' : 'find');
  const [mine, setMine] = useState(() => peekCache(mineKey));
  const [invites, setInvites] = useState([]);
  const [found, setFound] = useState(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const request = useRef(0);

  const loadMine = useCallback(async () => {
    if (!isAuthenticated) return;
    const kept = peekCache(mineKey) || await readCache(mineKey);
    if (kept) setMine(kept);
    try {
      const [m, inv] = await Promise.all([fetchOrganizations({ mine: 1 }), fetchOrgInvitations()]);
      setMine(m?.results || []);
      writeCache(mineKey, m?.results || []);
      setInvites(inv?.results || []);
    } catch {
      if (!kept) setMine([]);
    }
  }, [isAuthenticated, mineKey]);
  useEffect(() => { loadMine(); }, [loadMine]);

  useEffect(() => {
    if (tab !== 'find') return undefined;
    const mineReq = ++request.current;
    const h = setTimeout(async () => {
      try {
        const r = await fetchOrganizations({ ...(q.trim() ? { q: q.trim() } : {}), ...(kind ? { kind } : {}) });
        if (mineReq === request.current) setFound(r?.results || []);
      } catch {
        if (mineReq === request.current) setFound((f) => f || []);
      }
    }, q ? 300 : 0);
    return () => clearTimeout(h);
  }, [tab, q, kind]);

  const open = useCallback((o) => navigation.navigate('OrganizationPage', { slug: o.slug, name: o.name }), [navigation]);
  const start = () => (isAuthenticated ? navigation.navigate('OrganizationEdit', {}) : navigation.navigate('Login'));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('org.title')}</Text>
        <TouchableOpacity onPress={start} style={styles.iconBtn} hitSlop={8} testID="orgs-new"
          accessibilityRole="button" accessibilityLabel={t('org.new')}>
          <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>
      <View style={styles.segment}>
        {['mine', 'find'].map((k) => (
          <TouchableOpacity key={k} style={[styles.segItem, tab === k && styles.segOn]} onPress={() => setTab(k)}
            accessibilityRole="tab" accessibilityState={{ selected: tab === k }} testID={`orgs-tab-${k}`}>
            <Text style={[styles.segText, tab === k && styles.segTextOn]}>{t(`org.tab.${k}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'mine' ? (
        <FlatList
          data={mine || []}
          keyExtractor={(o) => o.slug}
          contentContainerStyle={styles.list}
          ListHeaderComponent={invites.length ? (
            <View style={styles.invites}>
              <Text style={styles.label}>{t('org.invitations')}</Text>
              {invites.map((i) => (
                <OrgRow key={i.organization.slug} org={i.organization} onOpen={open} t={t}
                  note={t('org.invitedBy', { name: i.invited_by, role: t(`org.role.${i.role}`) })} />
              ))}
            </View>
          ) : null}
          renderItem={({ item }) => <OrgRow org={item} onOpen={open} t={t} />}
          ListEmptyComponent={mine == null ? <ActivityIndicator color={colors.primary} /> : (
            <View style={styles.empty}>
              <Ionicons name="business-outline" size={44} color={colors.textMuted} />
              <Text style={styles.emptyText}>{isAuthenticated ? t('org.noneMine') : t('org.signIn')}</Text>
              <TouchableOpacity style={styles.btn} onPress={start} testID="orgs-start">
                <Text style={styles.btnText}>{isAuthenticated ? t('org.new') : t('auth.login')}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={found || []}
          keyExtractor={(o) => o.slug}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={(
            <View style={styles.findHead}>
              <View style={styles.search}>
                <Ionicons name="search" size={18} color={colors.placeholder} />
                <TextInput style={styles.searchInput} value={q} onChangeText={setQ} placeholder={t('org.searchPlaceholder')}
                  placeholderTextColor={colors.placeholder} autoCorrect={false} testID="orgs-search" />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kinds}>
                {['', ...ORG_KINDS].map((k) => (
                  <TouchableOpacity key={k || 'all'} style={[styles.chip, kind === k && styles.chipOn]} onPress={() => setKind(k)}
                    testID={`orgs-kind-${k || 'all'}`}>
                    <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{k ? t(`org.kind.${k}`) : t('articles.all')}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          renderItem={({ item }) => <OrgRow org={item} onOpen={open} t={t} />}
          ListEmptyComponent={found == null ? <ActivityIndicator color={colors.primary} /> : (
            <Text style={styles.emptyText}>{t('org.noneFound')}</Text>
          )}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  segment: {
    flexDirection: 'row', margin: spacing.md, marginBottom: 0, padding: 3, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    width: '100%', maxWidth: 640, alignSelf: 'center',
  },
  segItem: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radius.sm },
  segOn: { backgroundColor: colors.primary },
  segText: { ...typography.label, color: colors.textSecondary, fontWeight: '700' },
  segTextOn: { color: colors.white },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, width: '100%', maxWidth: 640, alignSelf: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm + 2, marginBottom: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  invites: { marginBottom: spacing.md, gap: spacing.xs },
  label: { ...typography.caption, color: colors.accent, fontWeight: '800', textTransform: 'uppercase', marginBottom: spacing.xs },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  btnText: { ...typography.label, color: colors.white, fontWeight: '800' },
  findHead: { gap: spacing.sm, marginBottom: spacing.md },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.full,
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: spacing.sm },
  kinds: { gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  chipTextOn: { color: colors.white },
});

export default Organizations;
