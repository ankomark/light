// A book club: a group reading one book on a plan — "up to chapter N by
// this date". The page shows the book, the plan with this week's step, how
// many members are there (a count, not who), your own place, and the way to
// the club's chat and to a live reading room.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchBookClub } from '../services/api';
import { peekBook, fetchBook } from '../services/publicationStore';
import { SERIES } from '../components/BookCharts';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const dateLabel = (iso) => {
  try { return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return iso; }
};

const BookClub = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const { clubId } = route.params || {};
  const [club, setClub] = useState(null);
  const [book, setBook] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const c = await fetchBookClub(clubId);
      setClub(c);
      setBook(peekBook(currentUser?.id, c.publication) || await fetchBook(currentUser?.id, c.publication).catch(() => null));
    } catch {
      setFailed(true);
    }
  }, [clubId, currentUser?.id]);
  useEffect(() => { load(); }, [load]);

  const chapterName = (i) => book?.chapters?.[i]?.title || t('pubDetail.chapterN', { n: i + 1 });
  const current = club?.plan?.find((s) => s.state === 'current');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>{club?.name || t('club.title')}</Text>
        <View style={styles.iconBtn} />
      </View>
      {!club ? (
        <View style={styles.centered}>
          {failed ? (
            <TouchableOpacity style={styles.btn} onPress={load}><Text style={styles.btnText}>{t('common.retry')}</Text></TouchableOpacity>
          ) : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <TouchableOpacity style={styles.book} onPress={() => navigation.navigate('PublicationDetail', { id: club.publication })}
            testID="club-book">
            <Ionicons name="book" size={22} color={colors.accent} />
            <View style={styles.flex}>
              <Text style={styles.bookTitle} numberOfLines={2}>{book?.title || '…'}</Text>
              <Text style={styles.meta}>{t('club.members', { n: club.members })}{club.finished_members ? ` · ${t('club.finishedN', { n: club.finished_members })}` : ''}</Text>
            </View>
          </TouchableOpacity>

          {current ? (
            <View style={styles.now} testID="club-now">
              <Text style={styles.nowLabel}>{t('club.thisStep')}</Text>
              <Text style={styles.nowText}>{t('club.readUpTo', { chapter: chapterName(current.through_chapter), date: dateLabel(current.due) })}</Text>
              {club.is_member ? (
                <TouchableOpacity style={styles.btn} testID="club-read"
                  onPress={() => navigation.navigate('PublicationDetail', { id: club.publication })}>
                  <Text style={styles.btnText}>{club.my_percent ? t('club.continue', { n: Math.round(club.my_percent * 100) }) : t('pubDetail.startReading')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : <Text style={styles.done}>{t('club.planDone')}</Text>}

          <Text style={styles.section}>{t('club.plan')}</Text>
          {club.plan.map((s) => (
            <View key={`${s.through_chapter}-${s.due}`} style={[styles.step, s.state === 'current' && styles.stepNow]}
              testID={`club-step-${s.through_chapter}`}>
              <View style={styles.stepHead}>
                <Text style={styles.stepTitle} numberOfLines={1}>{t('club.upTo', { chapter: chapterName(s.through_chapter) })}</Text>
                <Text style={styles.stepDate}>{dateLabel(s.due)}</Text>
              </View>
              {/* How many members are there: a meter, track and fill of one hue. */}
              <View style={styles.meter} accessible accessibilityLabel={t('club.there', { n: s.members_there, m: club.members })}>
                <View style={[styles.meterFill, { width: `${club.members ? (s.members_there / club.members) * 100 : 0}%` }]} />
              </View>
              <Text style={styles.stepMeta}>{t('club.there', { n: s.members_there, m: club.members })}</Text>
            </View>
          ))}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.action} testID="club-chat"
              onPress={() => navigation.navigate('GroupDetail', { groupSlug: club.group.slug })}>
              <Ionicons name="chatbubbles-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.actionText}>{club.is_member ? t('club.chat') : t('club.join')}</Text>
            </TouchableOpacity>
            {club.is_member ? (
              <TouchableOpacity style={styles.action} testID="club-live"
                onPress={() => navigation.navigate('GoLive', { kind: 'meet', title: t('club.liveTitle', { book: book?.title || '' }) })}>
                <Ionicons name="mic-outline" size={20} color={colors.textPrimary} />
                <Text style={styles.actionText}>{t('club.live')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.privacy}>{t('club.privacy')}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.md, paddingBottom: spacing.xxl, width: '100%', maxWidth: 760, alignSelf: 'center' },
  book: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  bookTitle: { ...typography.h3, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  now: { marginTop: spacing.md, padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.accent },
  nowLabel: { ...typography.caption, color: colors.accent, fontWeight: '800', textTransform: 'uppercase' },
  nowText: { ...typography.body, color: colors.textPrimary },
  done: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  step: {
    padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  stepNow: { borderColor: colors.accent, borderWidth: 1 },
  stepHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  stepTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flex: 1 },
  stepDate: { ...typography.caption, color: colors.textSecondary },
  meter: { height: 6, borderRadius: 3, backgroundColor: 'rgba(57,135,229,0.22)', marginTop: spacing.sm, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 3, backgroundColor: SERIES },
  stepMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  actionText: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' },
  btnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  privacy: { ...typography.caption, color: colors.textMuted, marginTop: spacing.lg, textAlign: 'center' },
});

export default BookClub;
