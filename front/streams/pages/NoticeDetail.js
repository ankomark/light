// One notice, in full: its picture, its words (links tappable), who posted
// it and when — and Share. Opens at once on the copy the board passed (or
// the one kept from last time), then refreshes; a shared link or a push
// (streams://notice/<id>) opens it straight away.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchNotice } from '../services/api';
import { useAuth } from '../context/useAuth';
import { useI18n } from '../context/I18nContext';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import LinkedText from '../components/LinkedText';
import NoticeCover from '../components/NoticeCover';
import { SkeletonBox } from '../components/SkeletonLoader';
import { colors, typography, spacing, radius } from '../constants/theme';

export const noticeLink = (id) => `streams://notice/${id}`;

const NoticeDetail = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const id = route?.params?.id;
  const key = userKey(currentUser?.id, `notice:${id}`);
  const [notice, setNotice] = useState(() => route?.params?.notice || peekCache(key) || null);
  const [gone, setGone] = useState(false);
  // No answer and nothing kept (opened from a push, offline): said, with a
  // retry - it was a loading skeleton for ever.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!notice) readCache(key).then((disk) => { if (!cancelled && disk) setNotice((n) => n || disk); });
    fetchNotice(id)
      .then((n) => { if (!cancelled && n) { setNotice(n); setFailed(false); writeCache(key, n); } })
      .catch((e) => {
        if (cancelled) return;
        if (e?.response?.status === 404) { setGone(true); writeCache(key, null); } else setFailed(true);
      });
    return () => { cancelled = true; };
  }, [id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = () => {
    if (!notice) return;
    const excerpt = (notice.body || '').slice(0, 280);
    Share.share({ message: `${notice.title}\n\n${excerpt}\n\n${noticeLink(notice.id)}` }).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>{t('notice.board')}</Text>
        <TouchableOpacity onPress={share} hitSlop={10} disabled={!notice} accessibilityLabel={t('notice.share')} testID="notice-share">
          <Ionicons name="share-social-outline" size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {gone ? (   // expired, deleted, or not live yet: even a kept copy isn't shown
        <View style={styles.gone}>
          <MaterialCommunityIcons name="bulletin-board" size={48} color={colors.textMuted} />
          <Text style={styles.goneText}>{t('notice.notAvailable')}</Text>
        </View>
      ) : !notice && failed ? (
        <View style={styles.gone} testID="notice-detail-failed">
          <MaterialCommunityIcons name="wifi-off" size={44} color={colors.textMuted} />
          <Text style={styles.goneText}>{t('common.somethingWrong')}</Text>
          <TouchableOpacity onPress={() => { setFailed(false); setAttempt((a) => a + 1); }} accessibilityRole="button" testID="notice-retry">
            <Text style={[styles.goneText, { color: colors.accent }]}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : !notice ? (
        <View style={styles.body} testID="notice-detail-skeleton">
          <SkeletonBox width="70%" height={22} style={{ marginBottom: 14 }} />
          {[100, 96, 90, 60].map((w, i) => <SkeletonBox key={i} width={`${w}%`} height={13} style={{ marginBottom: 8 }} />)}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {notice.cover_image ? (
            <NoticeCover uri={notice.cover_image} width={notice.cover_width} height={notice.cover_height} minRatio={9 / 16} maxRatio={3} style={styles.cover} />
          ) : null}
          <View style={styles.tags}>
            {notice.category && notice.category !== 'general' ? (
              <View style={styles.tag}><Text style={styles.tagText}>{t(`notice.category.${notice.category}`)}</Text></View>
            ) : null}
            {notice.is_pinned ? (
              <View style={styles.tag}>
                <MaterialCommunityIcons name="pin" size={12} color={colors.accent} />
                <Text style={styles.tagText}>{t('notice.pinned')}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.title} selectable>{notice.title}</Text>
          <Text style={styles.meta}>
            {notice.created_by_username || t('notice.leadership')} · {new Date(notice.publish_at || notice.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
            {notice.edited_at ? `  ·  ${t('notice.edited')}` : ''}
          </Text>
          <LinkedText style={styles.text}>{notice.body}</LinkedText>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  topTitle: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  body: { padding: spacing.md, paddingBottom: spacing.xxl, width: '100%', maxWidth: 820, alignSelf: 'center' },
  cover: { borderRadius: radius.lg, marginBottom: spacing.md },
  tags: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full,
    backgroundColor: 'rgba(244,162,97,0.14)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.5)',
  },
  tagText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: 4 },
  meta: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.md },
  text: { ...typography.body, color: colors.textSecondary, lineHeight: 24 },
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  goneText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});

export default NoticeDetail;
