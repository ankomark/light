/**
 * After the host ends a live: how it went (TikTok-style) - how long, the
 * most people watching at once, reactions and comments - then back.
 * route.params.summary is the ended broadcast from the server, plus the
 * comment count the room kept.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { live, fmtCount } from '../../constants/liveTheme';
import { useI18n } from '../../context/I18nContext';

export const fmtDuration = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

const Stat = ({ icon, label, value, testID }) => (
  <View style={styles.stat} testID={testID}>
    <MaterialCommunityIcons name={icon} size={24} color={live.gold} />
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const LiveSummary = ({ navigation, route }) => {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const s = route?.params?.summary || {};
  // The server knows when it ended; without that, what the room counted.
  const seconds = s.duration_seconds ?? (s.started_at ? (Date.now() - new Date(s.started_at).getTime()) / 1000 : 0);
  return (
    <ScrollView style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
      <MaterialCommunityIcons name="broadcast" size={44} color={live.gold} style={{ alignSelf: 'center' }} />
      <Text style={styles.title}>{t('live.summaryTitle')}</Text>
      {!!s.title && <Text style={styles.sub} numberOfLines={2}>{s.title}</Text>}
      <View style={styles.grid}>
        <Stat icon="timer-outline" label={t('live.summaryDuration')} value={fmtDuration(seconds)} testID="summary-duration" />
        <Stat icon="account-group-outline" label={t('live.summaryPeak')} value={fmtCount(s.peak_viewer_count || 0)}
          testID="summary-peak" />
        <Stat icon="heart-outline" label={t('live.summaryLikes')} value={fmtCount(s.like_count || 0)} testID="summary-likes" />
        <Stat icon="comment-text-outline" label={t('live.summaryComments')} value={fmtCount(s.comments || 0)}
          testID="summary-comments" />
      </View>
      <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.9} accessibilityRole="button" testID="summary-done">
        <LinearGradient colors={live.gradCta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.done}>
          <Text style={styles.doneText}>{t('common.done')}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: live.bg },
  content: { paddingHorizontal: 20, gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  sub: { color: live.inkDim, fontSize: 14, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  stat: {
    flexGrow: 1, flexBasis: '45%', alignItems: 'center', gap: 4, paddingVertical: 18,
    borderRadius: 18, backgroundColor: 'rgba(16,28,46,0.85)', borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
  },
  statValue: { color: '#fff', fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { color: live.inkDim, fontSize: 12, textAlign: 'center' },
  done: { height: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  doneText: { color: live.onGold, fontSize: 16, fontWeight: '800' },
});

export default LiveSummary;
