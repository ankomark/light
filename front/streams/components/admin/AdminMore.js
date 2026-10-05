// More: every admin tool that is not a tab (Pulse, Reports, Users, Content,
// Appeals), each shown only to whom the server says may use it, and the way
// out of the admin tools.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { endAdminSession } from '../../services/api';
import { clearAdminSession } from '../../utils/adminSession';
import { useAdminMe } from './AdminKit';
import { PULSE } from './PulseCharts';
import { useI18n } from '../../context/I18nContext';

const QuickLink = ({ icon, label, sub, onPress }) => (
  <TouchableOpacity style={styles.link} onPress={onPress} activeOpacity={0.85}>
    <View style={styles.linkIcon}><MaterialCommunityIcons name={icon} size={22} color={PULSE.teal} /></View>
    <View style={{ flex: 1 }}>
      <Text style={styles.linkLabel}>{label}</Text>
      <Text style={styles.linkSub}>{sub}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={PULSE.faint} />
  </TouchableOpacity>
);

// [capability (or 'super'), route, icon, string key]
const TOOLS = [
  ['manage_notices', 'NoticeBoard', 'bulletin-board', 'notices'],
  ['broadcast', 'AdminBroadcast', 'bullhorn-outline', 'broadcast'],
  ['manage_app', 'AdminAppControl', 'toggle-switch-outline', 'app'],
  ['verify_accounts', 'AdminVerify', 'check-decagram-outline', 'verify'],
  ['review_singles', 'AdminSingles', 'ring', 'singles'],
  ['manage_tickets', 'AdminTickets', 'ticket-confirmation-outline', 'tickets'],
  ['manage_quiz', 'AdminQuizBank', 'head-question-outline', 'quiz'],
  ['manage_puzzles', 'AdminPuzzleThemes', 'puzzle-outline', 'puzzles'],
  ['manage_wallpapers', 'AdminWallpapers', 'image-multiple-outline', 'wallpapers'],
  ['view_analytics', 'AdminAnalytics', 'chart-line', 'analytics'],
  ['view_analytics', 'AdminMusic', 'music-note-eighth', 'music'],
  ['view_audit_log', 'AdminLogs', 'history', 'audit'],
  ['super', 'AdminRoles', 'shield-key-outline', 'roles'],
];

export default function AdminMore({ navigation }) {
  const { t } = useI18n();
  const { can, superAdmin } = useAdminMe();
  const tools = TOOLS.filter(([cap]) => (cap === 'super' ? superAdmin : can(cap)));

  // Leave the admin tools: the admin session ends here and on the server.
  const signOutOfAdmin = async () => {
    try { await endAdminSession(); } catch { /* it ends on its own soon */ }
    await clearAdminSession();
    navigation.navigate('Home');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>{t('adminMore.title')}</Text>
      {tools.map(([, route, icon, key]) => (
        <QuickLink key={route} icon={icon} label={t(`adminDash.link.${key}`)} sub={t(`adminDash.link.${key}Sub`)}
          onPress={() => navigation.navigate(route)} />
      ))}
      <TouchableOpacity style={styles.signOut} onPress={signOutOfAdmin} testID="admin-sign-out">
        <Ionicons name="log-out-outline" size={18} color={PULSE.coral} />
        <Text style={styles.signOutText}>{t('adminDash.signOut')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 18, paddingBottom: 48, gap: 10, width: '100%', maxWidth: 760, alignSelf: 'center' },
  title: { color: PULSE.text, fontSize: 24, fontWeight: '700', marginBottom: 6 },
  link: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 64,
    backgroundColor: PULSE.card, borderRadius: 16, borderWidth: 1, borderColor: PULSE.line,
  },
  linkIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: PULSE.tealSoft, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { color: PULSE.text, fontSize: 15, fontWeight: '600' },
  linkSub: { color: PULSE.muted, fontSize: 12, marginTop: 2 },
  signOut: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, marginTop: 14,
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,122,89,0.45)', backgroundColor: 'rgba(255,122,89,0.08)',
  },
  signOutText: { color: PULSE.coral, fontWeight: '700', fontSize: 15 },
});
