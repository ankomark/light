// An organisation's page — a conference, school, publishing house…: who it
// is (logo, verified tick, where, its site), follow it, and its books as a
// shelf of covers. Those who run it edit it and its people from here; an
// invitation to it is answered here too. Kept for offline.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchOrganization, fetchPublications, followOrganization, respondOrgInvite, fetchServicesPage,
} from '../services/api';
import { ServiceTile } from '../components/services/ServicesHome';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { BookGridTile, useBookGrid, GRID_GAP } from '../components/BookGrid';
import { notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

export const ORG_KINDS = ['conference', 'union', 'church', 'school', 'publisher', 'ministry', 'other'];
export const ORG_ICON = {
  conference: 'globe-outline', union: 'git-network-outline', church: 'home-outline', school: 'school-outline',
  publisher: 'library-outline', ministry: 'heart-outline', other: 'business-outline',
};

export const OrgLogo = ({ org, size = 64 }) => (org?.logo ? (
  <Image source={{ uri: org.logo }} style={{ width: size, height: size, borderRadius: size * 0.22, backgroundColor: colors.surface }}
    contentFit="cover" />
) : (
  <View style={[styles.logoFallback, { width: size, height: size, borderRadius: size * 0.22 }]}>
    <Ionicons name={ORG_ICON[org?.kind] || 'business-outline'} size={size * 0.45} color={colors.accent} />
  </View>
));

const OrganizationPage = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const { slug, name } = route.params || {};
  const key = userKey(currentUser?.id, `org:${slug}`);
  const [org, setOrg] = useState(() => peekCache(key)?.org || null);
  const [books, setBooks] = useState(() => peekCache(key)?.books || null);
  const [services, setServices] = useState(() => peekCache(key)?.services || []);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const grid = useBookGrid('large', { insets: (insets.left || 0) + (insets.right || 0) });

  const load = useCallback(async () => {
    setFailed(false);
    const kept = peekCache(key) || await readCache(key);
    if (kept) { setOrg(kept.org); setBooks(kept.books); setServices(kept.services || []); }
    try {
      const [o, b, sv] = await Promise.all([
        fetchOrganization(slug), fetchPublications({ organization: slug }),
        // Its services too (an older server has none): never holding up the page.
        Promise.resolve().then(() => fetchServicesPage({ organization: slug })).catch(() => null),
      ]);
      const rows = b?.results ?? [];
      const svc = sv?.results ?? [];
      setOrg(o);
      setBooks(rows);
      setServices(svc);
      writeCache(key, { org: o, books: rows, services: svc });
    } catch {
      if (!kept) setFailed(true);
    }
  }, [slug, key]);
  useEffect(() => { load(); }, [load]);

  const toggleFollow = async () => {
    if (!isAuthenticated) { navigation.navigate('Login'); return; }
    const next = !org.is_following;
    setOrg((o) => ({ ...o, is_following: next, followers_count: o.followers_count + (next ? 1 : -1) }));
    try {
      const r = await followOrganization(slug, next);
      setOrg((o) => ({ ...o, ...r }));
    } catch {
      setOrg((o) => ({ ...o, is_following: !next, followers_count: o.followers_count + (next ? -1 : 1) }));
    }
  };

  const answer = async (accept) => {
    setBusy(true);
    try { setOrg(await respondOrgInvite(slug, accept)); } catch { notify(t('common.error'), t('org.failed')); }
    setBusy(false);
  };

  const manages = org?.my_role === 'owner' || org?.my_role === 'admin';
  const open = useCallback((b) => navigation.navigate('PublicationDetail', { id: b.id, preview: b }), [navigation]);

  const header = org ? (
    <View style={styles.head}>
      <View style={styles.idRow}>
        <OrgLogo org={org} size={72} />
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={2}>{org.name}</Text>
            {org.is_verified ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} testID="org-verified" /> : null}
          </View>
          <Text style={styles.kind}>{t(`org.kind.${org.kind}`)}{org.location ? ` · ${org.location}` : ''}</Text>
          {org.website ? (
            <TouchableOpacity onPress={() => Linking.openURL(org.website).catch(() => {})} hitSlop={6}>
              <Text style={styles.link} numberOfLines={1}>{org.website.replace(/^https?:\/\//, '')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      {org.description ? <Text style={styles.about}>{org.description}</Text> : null}
      <View style={styles.stats}>
        {[['books_count', 'org.books'], ['followers_count', 'org.followers'], ['members_count', 'org.members']].map(([k, label]) => (
          <View key={k} style={styles.stat}>
            <Text style={styles.statN}>{org[k] ?? 0}</Text>
            <Text style={styles.statLabel}>{t(label)}</Text>
          </View>
        ))}
      </View>
      {org.invited_as ? (
        <View style={styles.invite} testID="org-invite">
          <Text style={styles.inviteText}>{t('org.invitedAs', { role: t(`org.role.${org.invited_as}`) })}</Text>
          <View style={styles.inviteBtns}>
            <TouchableOpacity style={[styles.btn, styles.btnQuiet]} onPress={() => answer(false)} disabled={busy} testID="org-decline">
              <Text style={styles.btnQuietText}>{t('org.decline')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => answer(true)} disabled={busy} testID="org-accept">
              <Text style={styles.btnText}>{t('org.accept')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, org.is_following && styles.btnQuiet]} onPress={toggleFollow} testID="org-follow">
          <Text style={org.is_following ? styles.btnQuietText : styles.btnText}>
            {org.is_following ? t('org.following') : t('org.follow')}
          </Text>
        </TouchableOpacity>
        {org.my_role ? (
          <TouchableOpacity style={[styles.btn, styles.btnQuiet]} testID="org-people"
            onPress={() => navigation.navigate('OrganizationMembers', { slug, name: org.name })}>
            <Text style={styles.btnQuietText}>{t('org.people')}</Text>
          </TouchableOpacity>
        ) : null}
        {manages ? (
          <TouchableOpacity style={[styles.btn, styles.btnQuiet, styles.iconOnly]} testID="org-edit"
            onPress={() => navigation.navigate('OrganizationEdit', { slug })} accessibilityLabel={t('org.edit')}>
            <Ionicons name="create-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
        ) : null}
      </View>
      {services.length ? (
        <View testID="org-services">
          <Text style={styles.section}>{t('org.services')}</Text>
          <FlatList horizontal data={services} keyExtractor={(s) => `svc_${s.id}`} showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}
            renderItem={({ item }) => (
              <ServiceTile item={item} t={t} onOpen={(s) => navigation.navigate('ServiceDetail', { id: s.id, preview: s })} />
            )} />
        </View>
      ) : null}
      <Text style={styles.section}>{t('org.theirBooks')}</Text>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>{org?.name || name || ''}</Text>
        <View style={styles.iconBtn} />
      </View>
      {!org ? (
        <View style={styles.centered}>
          {failed ? (
            <>
              <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
              <Text style={styles.muted}>{t('org.loadFailed')}</Text>
              <TouchableOpacity style={styles.btn} onPress={load} testID="org-retry"><Text style={styles.btnText}>{t('common.retry')}</Text></TouchableOpacity>
            </>
          ) : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : (
        <FlatList
          key={`org-${grid.cols}`}
          data={books || []}
          numColumns={grid.cols}
          columnWrapperStyle={grid.cols > 1 ? styles.row : undefined}
          keyExtractor={(b) => String(b.id)}
          renderItem={({ item }) => <BookGridTile item={item} onOpen={open} t={t} width={grid.tileW} />}
          ListHeaderComponent={header}
          ListEmptyComponent={books ? <Text style={styles.muted}>{t('org.noBooks')}</Text> : <ActivityIndicator color={colors.primary} />}
          contentContainerStyle={styles.list}
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  muted: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginVertical: spacing.lg },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, width: '100%', maxWidth: 1100, alignSelf: 'center' },
  row: { gap: GRID_GAP },
  head: { gap: spacing.md, marginBottom: spacing.md },
  idRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  logoFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { ...typography.h2, color: colors.textPrimary, flexShrink: 1 },
  kind: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  link: { ...typography.caption, color: colors.primary, fontWeight: '700', marginTop: 2 },
  about: { ...typography.body, color: colors.textSecondary, lineHeight: 21 },
  stats: {
    flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.md, paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  stat: { flex: 1, alignItems: 'center' },
  statN: { ...typography.h3, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textMuted },
  invite: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent },
  inviteText: { ...typography.label, color: colors.textPrimary },
  inviteBtns: { flexDirection: 'row', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm + 2,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary,
  },
  btnQuiet: { backgroundColor: 'transparent' },
  iconOnly: { flex: 0, width: 46 },
  btnText: { ...typography.label, color: colors.white, fontWeight: '800' },
  btnQuietText: { ...typography.label, color: colors.primary, fontWeight: '800' },
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm, marginBottom: spacing.sm },
  rail: { gap: spacing.md, paddingRight: spacing.md },
});

export default OrganizationPage;
