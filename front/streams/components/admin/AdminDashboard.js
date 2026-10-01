import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchAdminDashboard, endAdminSession } from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { peekCache, writeCache, userKey } from '../../utils/screenCache';
import { clearAdminSession } from '../../utils/adminSession';
import { useAdminMe } from './AdminKit';
import useGridColumns from '../../utils/useGridColumns';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';
import { useI18n } from '../../context/I18nContext';

const StatCard = ({ icon, set: Set = Ionicons, label, value, tint, width }) => (
  <View style={[styles.statCard, { width }]}>
    <View style={[styles.statIcon, { backgroundColor: `${tint}22` }]}>
      <Set name={icon} size={20} color={tint} />
    </View>
    <Text style={styles.statValue}>{value ?? 0}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const QuickLink = ({ icon, label, sub, onPress, badge }) => (
  <TouchableOpacity style={styles.linkCard} onPress={onPress} activeOpacity={0.85}>
    <View style={styles.linkIcon}>
      <MaterialCommunityIcons name={icon} size={22} color={colors.accent} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.linkLabel}>{label}</Text>
      <Text style={styles.linkSub}>{sub}</Text>
    </View>
    {badge > 0 ? (
      <View style={styles.badge}><Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text></View>
    ) : (
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    )}
  </TouchableOpacity>
);

const AdminDashboard = ({ navigation }) => {
  const { t: tr } = useI18n();
  const { currentUser } = useAuth();
  const { can, superAdmin } = useAdminMe();
  // Opens on the last copy (this admin's own), refreshed behind it.
  const cacheKey = userKey(currentUser?.id, 'admin:dashboard');
  const [data, setData] = useState(() => peekCache(cacheKey));
  const [loading, setLoading] = useState(!data);
  const [err, setErr] = useState(null);
  // Responsive stat grid: 2 cards per row on a phone, more on tablets / landscape.
  const { tileSize: cardW } = useGridColumns({
    target: 150, min: 2, max: 4, horizontalPadding: spacing.md * 2, gap: spacing.sm,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminDashboard();
      setData(res);
      writeCache(cacheKey, res, { persist: false });
      setErr(null);
    } catch (e) {
      // Surface the reason instead of silently showing zeros. A 403 means the
      // account isn't a platform admin (super_admin / moderator / has capabilities).
      const status = e?.response?.status;
      setErr(status
        ? tr('admin.dashboardLoadFailedStatus', { status })
        : (e?.message || tr('admin.dashboardLoadFailed')));
    } finally {
      setLoading(false);
    }
  }, [tr, cacheKey]);

  // Leave the admin tools: the admin session ends here and on the server.
  const signOutOfAdmin = async () => {
    try { await endAdminSession(); } catch { /* it ends on its own soon */ }
    await clearAdminSession();
    navigation.navigate('Home');
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && !data) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>;
  }

  const t = data?.totals || {};
  const s = data?.signups || {};
  const r = data?.reports || {};
  const m = data?.moderation || {};
  const ap = data?.appeals || {};

  // Each tool shown only to whom the server says may use it (useAdminMe:
  // the server's word when the admin area opened, not the phone's profile).
  const canAnalytics = can('view_analytics');
  const canReports = can('handle_reports');
  const canAppeals = can('manage_appeals');
  const canUsers = can('manage_users') || can('ban_users');
  const canContent = can('remove_content');
  const canAudit = can('view_audit_log');
  const canWallpapers = can('manage_wallpapers');
  const canNotices = can('manage_notices');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={styles.title}>{tr('adminDash.title')}</Text>

      {err ? (
        <View style={styles.errBanner}><Text style={styles.errText}>{err}</Text></View>
      ) : null}

      <View style={styles.grid}>
        <StatCard width={cardW} icon="people" label={tr('adminDash.stat.users')} value={t.users} tint="#1DA1F2" />
        <StatCard width={cardW} icon="images" label={tr('adminDash.stat.posts')} value={t.posts} tint="#17BF63" />
        <StatCard width={cardW} icon="musical-notes" label={tr('adminDash.stat.tracks')} value={t.tracks} tint="#F4A261" />
        <StatCard width={cardW} icon="chatbubbles" label={tr('adminDash.stat.comments')} value={t.comments} tint="#9B59B6" />
        <StatCard width={cardW} icon="flag" label={tr('adminDash.stat.pendingReports')} value={r.pending} tint="#E0245E" />
        <StatCard width={cardW} icon="person-add" label={tr('adminDash.stat.new24h')} value={s.last_24h} tint="#2ECC71" />
        <StatCard width={cardW} set={MaterialCommunityIcons} icon="account-off" label={tr('adminDash.stat.suspended')} value={m.suspended} tint="#FB8C00" />
        <StatCard width={cardW} set={MaterialCommunityIcons} icon="cancel" label={tr('adminDash.stat.banned')} value={m.banned} tint="#E53935" />
      </View>

      <Text style={styles.sectionTitle}>{tr('adminDash.manage')}</Text>
      {canReports && (
        <QuickLink icon="flag-outline" label={tr('adminDash.link.reports')} sub={tr('adminDash.link.reportsSub')}
          badge={r.pending} onPress={() => navigation.navigate('AdminReports')} />
      )}
      {canAppeals && (
        <QuickLink icon="gavel" label={tr('adminDash.link.appeals')} sub={tr('adminDash.link.appealsSub')}
          badge={ap.pending} onPress={() => navigation.navigate('AdminAppeals')} />
      )}
      {canUsers && (
        <QuickLink icon="account-cog-outline" label={tr('adminDash.link.users')} sub={tr('adminDash.link.usersSub')}
          onPress={() => navigation.navigate('AdminUsers')} />
      )}
      {canContent && (
        <QuickLink icon="file-document-multiple-outline" label={tr('adminDash.link.content')} sub={tr('adminDash.link.contentSub')}
          onPress={() => navigation.navigate('AdminContent')} />
      )}
      {canNotices && (
        <QuickLink icon="bulletin-board" label={tr('adminDash.link.notices')} sub={tr('adminDash.link.noticesSub')}
          onPress={() => navigation.navigate('NoticeBoard')} />
      )}
      {canWallpapers && (
        <QuickLink icon="image-multiple-outline" label={tr('adminDash.link.wallpapers')} sub={tr('adminDash.link.wallpapersSub')}
          onPress={() => navigation.navigate('AdminWallpapers')} />
      )}
      {canAnalytics && (
        <QuickLink icon="chart-line" label={tr('adminDash.link.analytics')} sub={tr('adminDash.link.analyticsSub')}
          onPress={() => navigation.navigate('AdminAnalytics')} />
      )}
      {canAudit && (
        <QuickLink icon="history" label={tr('adminDash.link.audit')} sub={tr('adminDash.link.auditSub')}
          onPress={() => navigation.navigate('AdminLogs')} />
      )}
      {superAdmin && (
        <QuickLink icon="shield-key-outline" label={tr('adminDash.link.roles')} sub={tr('adminDash.link.rolesSub')}
          onPress={() => navigation.navigate('AdminRoles')} />
      )}

      {canReports && data?.recent_reports?.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{tr('adminDash.recentReports')}</Text>
          {data.recent_reports.slice(0, 5).map((rep) => (
            <TouchableOpacity key={rep.id} style={styles.recentRow}
              onPress={() => navigation.navigate('AdminReports')} activeOpacity={0.85}>
              <View style={styles.recentDot} />
              <Text style={styles.recentText} numberOfLines={1}>
                <Text style={{ fontWeight: '700' }}>{rep.reason}</Text>
                {'  ·  '}{rep.content_type} #{rep.object_id}
              </Text>
              <Text style={styles.recentStatus}>{rep.status}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      <TouchableOpacity style={styles.signOut} onPress={signOutOfAdmin} testID="admin-sign-out">
        <Ionicons name="log-out-outline" size={18} color="#FF8A7D" />
        <Text style={styles.signOutText}>{tr('adminDash.signOut')}</Text>
      </TouchableOpacity>
      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: spacing.md },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
  title: {
    ...typography.h1, color: colors.textPrimary, marginBottom: spacing.md,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: {
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.md,
    ...shadows.sm,
  },
  statIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  statValue: { ...typography.h1, color: colors.textPrimary, fontWeight: '800' },
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  sectionTitle: {
    ...typography.label, color: colors.accent, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: spacing.lg, marginBottom: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  linkCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.md, marginBottom: spacing.sm,
    ...shadows.sm,
  },
  linkIcon: {
    width: 42, height: 42, borderRadius: radius.md,
    backgroundColor: 'rgba(244,162,97,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  linkLabel: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  linkSub: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  badge: {
    minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7,
    backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '800' },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(16,28,46,0.7)',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs,
  },
  recentDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  recentText: { flex: 1, ...typography.caption, color: colors.textPrimary },
  recentStatus: { ...typography.caption, color: colors.textMuted, textTransform: 'capitalize' },
  errBanner: {
    backgroundColor: 'rgba(224,36,94,0.15)', borderWidth: 1, borderColor: 'rgba(224,36,94,0.5)',
    borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md,
  },
  errText: { ...typography.caption, color: '#FF6B6B' },
  signOut: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, marginTop: spacing.lg,
    borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(255,122,107,0.45)', backgroundColor: 'rgba(255,122,107,0.08)',
  },
  signOutText: { color: '#FF8A7D', fontWeight: '800', fontSize: 15 },
});

export default AdminDashboard;
