import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchAdminDashboard } from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const { width } = Dimensions.get('window');
const CARD_W = (width - spacing.md * 2 - spacing.sm) / 2;

const StatCard = ({ icon, set: Set = Ionicons, label, value, tint }) => (
  <View style={styles.statCard}>
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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetchAdminDashboard();
      setData(res);
    } catch {
      // gated server-side; if it fails the wrapper will have redirected
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && !data) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>;
  }

  const t = data?.totals || {};
  const s = data?.signups || {};
  const r = data?.reports || {};
  const m = data?.moderation || {};

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Text style={styles.title}>Dashboard</Text>

      <View style={styles.grid}>
        <StatCard icon="people" label="Users" value={t.users} tint="#1DA1F2" />
        <StatCard icon="images" label="Posts" value={t.posts} tint="#17BF63" />
        <StatCard icon="musical-notes" label="Tracks" value={t.tracks} tint="#F4A261" />
        <StatCard icon="chatbubbles" label="Comments" value={t.comments} tint="#9B59B6" />
        <StatCard icon="flag" label="Pending reports" value={r.pending} tint="#E0245E" />
        <StatCard icon="person-add" label="New · 24h" value={s.last_24h} tint="#2ECC71" />
        <StatCard set={MaterialCommunityIcons} icon="account-off" label="Suspended" value={m.suspended} tint="#FB8C00" />
        <StatCard set={MaterialCommunityIcons} icon="cancel" label="Banned" value={m.banned} tint="#E53935" />
      </View>

      <Text style={styles.sectionTitle}>Manage</Text>
      <QuickLink icon="flag-outline" label="Reports" sub="Review reported content"
        badge={r.pending} onPress={() => navigation.navigate('AdminReports')} />
      <QuickLink icon="account-cog-outline" label="Users" sub="Suspend, ban, assign roles"
        onPress={() => navigation.navigate('AdminUsers')} />
      <QuickLink icon="file-document-multiple-outline" label="Content" sub="Browse & remove posts, tracks, comments"
        onPress={() => navigation.navigate('AdminContent')} />

      {data?.recent_reports?.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Recent reports</Text>
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
    width: CARD_W,
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
});

export default AdminDashboard;
