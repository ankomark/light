// Reviews on a service's page: the average and how the stars fall, yours
// (write or change it — never on your own listing), others' with the
// owner's public reply, and, for the owner, Reply. A review can be
// reported. Drawn at once from the last copy, then fresh.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '../BottomSheet';
import ReportModal from '../ReportModal';
import { StarRow } from '../BookReviews';
import {
  fetchServiceReviews, saveServiceReview, deleteMyServiceReview, replyToServiceReview, deleteServiceReply,
} from '../../services/api';
import useCachedData from '../../utils/useCachedData';
import useKeyboardHeight from '../../hooks/useKeyboardHeight';
import { userKey } from '../../utils/screenCache';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { colors, typography, spacing, radius } from '../../constants/theme';

const when = (iso) => { try { return new Date(iso).toLocaleDateString(); } catch { return ''; } };

const Review = ({ r, t, ownerName, onReply, onReport }) => (
  <View style={styles.review} testID={`service-review-${r.id}`}>
    <View style={styles.reviewHead}>
      <Text style={styles.who} numberOfLines={1}>{r.user?.username}</Text>
      <StarRow value={r.rating} size={12} />
      <Text style={styles.when}>{when(r.updated_at)}</Text>
      {onReport ? (
        <TouchableOpacity onPress={() => onReport(r)} hitSlop={8} accessibilityLabel={t('common.report')} testID={`service-review-report-${r.id}`}>
          <Ionicons name="flag-outline" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
    {r.body ? <Text style={styles.body}>{r.body}</Text> : null}
    {r.reply ? (
      <View style={styles.reply}>
        <Text style={styles.replyWho}>{t('services.replyFrom', { name: ownerName })}</Text>
        <Text style={styles.replyText}>{r.reply}</Text>
      </View>
    ) : null}
    {onReply ? (
      <TouchableOpacity onPress={() => onReply(r)} testID={`service-review-reply-${r.id}`}>
        <Text style={styles.link}>{r.reply ? t('services.editReply') : t('services.replyAction')}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

const ServiceReviews = ({ service, uid, t, isAuthenticated, navigation }) => {
  const kb = useKeyboardHeight();
  const { data, setData, reload } = useCachedData(userKey(uid, `service-reviews:${service.id}`),
    () => fetchServiceReviews(service.id));
  const [sheet, setSheet] = useState(null);           // { kind: 'review' | 'reply', review? }
  const [draft, setDraft] = useState({ rating: 0, body: '' });
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState(null);

  if (!data) return null;
  const { summary } = data;
  const owner = !!data.is_owner;

  const openReview = () => {
    if (!isAuthenticated) { navigation.navigate('Login'); return; }
    setDraft({ rating: data.mine?.rating || 0, body: data.mine?.body || '' });
    setSheet({ kind: 'review' });
  };
  const openReply = (r) => { setDraft({ rating: 0, body: r.reply || '' }); setSheet({ kind: 'reply', review: r }); };

  const save = async () => {
    setSaving(true);
    try {
      if (sheet.kind === 'review') {
        await saveServiceReview(service.id, { rating: draft.rating, body: draft.body.trim() });
      } else {
        const saved = await replyToServiceReview(service.id, sheet.review.id, draft.body.trim());
        setData((d) => ({ ...d, results: d.results.map((x) => (x.id === saved.id ? saved : x)) }));
      }
      const wasReview = sheet.kind === 'review';
      setSheet(null);
      // A review changes the summary (fetch it); a reply came back whole.
      if (wasReview) await reload();
    } catch (err) {
      notify(t('common.error'), err?.data?.error || t('reviews.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const removeMine = async () => {
    const ok = await confirmAction({
      title: t('reviews.removeTitle'), confirmLabel: t('common.remove'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    try { await deleteMyServiceReview(service.id); setSheet(null); await reload(); } catch { notify(t('common.error'), t('reviews.saveFailed')); }
  };
  const removeReply = async () => {
    try {
      const saved = await deleteServiceReply(service.id, sheet.review.id);
      setData((d) => ({ ...d, results: d.results.map((x) => (x.id === saved.id ? saved : x)) }));
      setSheet(null);
    } catch { notify(t('common.error'), t('reviews.saveFailed')); }
  };

  const ready = sheet?.kind === 'review' ? draft.rating > 0 : draft.body.trim().length > 0;
  const ownerName = service.name;
  return (
    <View style={styles.section} testID="service-reviews">
      <Text style={styles.title}>{t('reviews.title')}</Text>
      {summary.count ? (
        <View style={styles.summary}>
          <View style={styles.avgBox}>
            <Text style={styles.avg}>{summary.average}</Text>
            <StarRow value={summary.average} />
            <Text style={styles.count}>{t('reviews.count', { n: summary.count })}</Text>
          </View>
          <View style={styles.spread}>
            {[5, 4, 3, 2, 1].map((s) => (
              <View key={s} style={styles.spreadRow}>
                <Text style={styles.spreadLabel}>{s}</Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(((summary.spread[s] || 0) / summary.count) * 100)}%` }]} />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : <Text style={styles.none}>{t('services.noReviews')}</Text>}

      {data.mine ? (
        <TouchableOpacity style={styles.mine} onPress={openReview} testID="service-review-mine">
          <Text style={styles.mineLabel}>{t('reviews.yours')}</Text>
          <Review r={data.mine} t={t} ownerName={ownerName} />
          <Text style={styles.link}>{t('reviews.edit')}</Text>
        </TouchableOpacity>
      ) : !owner ? (
        <TouchableOpacity style={styles.write} onPress={openReview} testID="service-review-write">
          <Ionicons name="star-outline" size={17} color={colors.white} />
          <Text style={styles.writeText}>{t('services.rateIt')}</Text>
        </TouchableOpacity>
      ) : null}

      {(data.results || []).map((r) => (
        <Review key={r.id} r={r} t={t} ownerName={ownerName} onReply={owner ? openReply : null}
          onReport={isAuthenticated && !owner ? setReporting : null} />
      ))}

      <BottomSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        keyboardHeight={kb}
        heightRatio={0.55}
        header={(
          <View style={styles.sheetHead}>
            <TouchableOpacity onPress={() => setSheet(null)} hitSlop={8}><Text style={styles.cancel}>{t('common.cancel')}</Text></TouchableOpacity>
            <Text style={styles.sheetTitle}>{sheet?.kind === 'reply' ? t('services.replyAction') : t('reviews.yours')}</Text>
            <TouchableOpacity onPress={save} disabled={!ready || saving} hitSlop={8} testID="service-review-save">
              {saving ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={[styles.saveText, !ready && { opacity: 0.4 }]}>{t('common.save')}</Text>}
            </TouchableOpacity>
          </View>
        )}
      >
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {sheet?.kind === 'reply' ? (
            <Text style={styles.quote} numberOfLines={3}>{`“${sheet.review.body || '★'.repeat(sheet.review.rating)}”`}</Text>
          ) : (
            <StarRow value={draft.rating} size={34} onPick={(n) => setDraft((d) => ({ ...d, rating: n }))} testPrefix="service-star" />
          )}
          <TextInput style={styles.input} value={draft.body} onChangeText={(v) => setDraft((d) => ({ ...d, body: v }))}
            placeholder={sheet?.kind === 'reply' ? t('services.replyPlaceholder') : t('services.reviewPlaceholder')}
            placeholderTextColor={colors.placeholder} multiline maxLength={2000} textAlignVertical="top" testID="service-review-input" />
          {sheet?.kind === 'review' && data.mine ? (
            <TouchableOpacity onPress={removeMine} style={styles.remove}><Text style={styles.removeText}>{t('reviews.remove')}</Text></TouchableOpacity>
          ) : null}
          {sheet?.kind === 'reply' && sheet.review.reply ? (
            <TouchableOpacity onPress={removeReply} style={styles.remove}><Text style={styles.removeText}>{t('services.removeReply')}</Text></TouchableOpacity>
          ) : null}
        </ScrollView>
      </BottomSheet>

      {reporting ? <ReportModal visible onClose={() => setReporting(null)} contentType="servicereview" objectId={reporting.id} /> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginHorizontal: spacing.md, marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  title: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  summary: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center', marginBottom: spacing.md },
  avgBox: { alignItems: 'center', minWidth: 90 },
  avg: { fontSize: 36, fontWeight: '800', color: colors.textPrimary },
  count: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  spread: { flex: 1, gap: 3 },
  spreadRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spreadLabel: { ...typography.caption, color: colors.textSecondary, width: 10 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  none: { ...typography.body, color: colors.textMuted, marginBottom: spacing.sm },
  mine: { padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  mineLabel: { ...typography.caption, color: colors.accent, fontWeight: '800', textTransform: 'uppercase' },
  write: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.primary,
    borderRadius: radius.md, paddingVertical: spacing.sm + 2, marginBottom: spacing.md,
  },
  writeText: { ...typography.button, color: colors.white },
  review: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 4 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  who: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
  when: { ...typography.caption, color: colors.textMuted, marginLeft: 'auto' },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 20 },
  reply: { marginTop: 4, marginLeft: spacing.md, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.primary, gap: 2 },
  replyWho: { ...typography.caption, color: colors.primary, fontWeight: '800' },
  replyText: { ...typography.body, color: colors.textSecondary },
  link: { ...typography.caption, color: colors.primary, fontWeight: '700', marginTop: 2 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  sheetTitle: { ...typography.h3, color: colors.textPrimary },
  cancel: { ...typography.label, color: colors.textSecondary },
  saveText: { ...typography.label, color: colors.primary, fontWeight: '800' },
  sheetBody: { paddingHorizontal: spacing.md, gap: spacing.md, alignItems: 'stretch' },
  quote: { ...typography.body, color: colors.textSecondary, fontStyle: 'italic' },
  input: {
    minHeight: 110, color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  remove: { alignSelf: 'center', padding: spacing.sm },
  removeText: { ...typography.label, color: colors.error, fontWeight: '700' },
});

export default ServiceReviews;
