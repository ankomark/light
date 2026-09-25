// A book's reviews on its page: the average, how the stars fall, the reader's
// own review (to write once they've read some of the book, or change), and
// others' reviews, more on request.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import useCachedData from '../utils/useCachedData';
import { userKey } from '../utils/screenCache';
import { useAuth } from '../context/useAuth';
import { fetchBookReviews, saveBookReview, deleteMyBookReview } from '../services/api';
import { confirmAction, notify } from '../utils/adminConfirm';
import { notePublicationsChanged } from '../services/publicationStore';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const StarRow = ({ value, size = 14, onPick, testPrefix }) => (
  <View style={styles.starRow}>
    {[1, 2, 3, 4, 5].map((n) => {
      const icon = value >= n ? 'star' : value >= n - 0.5 ? 'star-half' : 'star-outline';
      const star = <Ionicons name={icon} size={size} color={colors.accent} />;
      return onPick ? (
        <TouchableOpacity key={n} onPress={() => onPick(n)} hitSlop={6} accessibilityRole="button"
          accessibilityLabel={`${n}`} testID={`${testPrefix}-${n}`}>{star}</TouchableOpacity>
      ) : <View key={n}>{star}</View>;
    })}
  </View>
);

const Review = ({ r, t }) => (
  <View style={styles.review}>
    <View style={styles.reviewHead}>
      <Text style={styles.reviewer} numberOfLines={1}>{r.user?.username}</Text>
      <StarRow value={r.rating} size={12} />
    </View>
    {r.body ? <Text style={styles.reviewBody}>{r.body}</Text> : null}
  </View>
);

const BookReviews = ({ pubId, navigation, onChanged }) => {
  const { t } = useI18n();
  const kbHeight = useKeyboardHeight();       // the sheet rises with the keyboard
  const { currentUser } = useAuth();
  const [more, setMore] = useState([]);
  const [page, setPage] = useState(1);
  // The book page's reviews: the last copy at once (not popping in after
  // the rest of the page), then fresh. Offline, nothing kept: no section.
  const { data, setData, reload: load } = useCachedData(userKey(currentUser?.id, `reviews:${pubId}`), async () => {
    const res = await fetchBookReviews(pubId, 1);
    setMore([]);
    setPage(1);
    return res;
  });
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState({ rating: 0, body: '' });
  const [saving, setSaving] = useState(false);

  const loadMore = async () => {
    try {
      const res = await fetchBookReviews(pubId, page + 1);
      setMore((m) => [...m, ...(res.results || [])]);
      setPage((p) => p + 1);
      setData((d) => ({ ...d, next: res.next }));
    } catch {
      // try again later
    }
  };

  const openSheet = () => {
    setDraft({ rating: data?.mine?.rating || 0, body: data?.mine?.body || '' });
    setSheet(true);
  };

  const save = async () => {
    if (!draft.rating || saving) return;
    setSaving(true);
    try {
      await saveBookReview(pubId, draft);
      setSheet(false);
      notePublicationsChanged();
      await load();
      onChanged?.();
    } catch (err) {
      notify(t('common.error'), err?.response?.data?.error || t('reviews.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: t('reviews.removeTitle'), confirmLabel: t('common.remove'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMyBookReview(pubId);
      setSheet(false);
      notePublicationsChanged();
      await load();
      onChanged?.();
    } catch {
      notify(t('common.error'), t('reviews.saveFailed'));
    }
  };

  if (!data) return null;
  const { summary } = data;
  const others = [...(data.results || []), ...more];

  return (
    <View style={styles.section} testID="book-reviews">
      <Text style={styles.title}>{t('reviews.title')}</Text>
      {summary.count ? (
        <View style={styles.summary}>
          <View style={styles.avgBox}>
            <Text style={styles.avg}>{summary.average}</Text>
            <StarRow value={summary.average} />
            <Text style={styles.countText}>{t('reviews.count', { n: summary.count })}</Text>
          </View>
          <View style={styles.spread}>
            {[5, 4, 3, 2, 1].map((s) => (
              <View key={s} style={styles.spreadRow}>
                <Text style={styles.spreadLabel}>{s}</Text>
                <View style={styles.spreadTrack}>
                  <View style={[styles.spreadFill, { width: `${Math.round((summary.spread[s] / summary.count) * 100)}%` }]} />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : <Text style={styles.none}>{t('reviews.none')}</Text>}

      {data.mine ? (
        <TouchableOpacity style={styles.mine} onPress={openSheet} testID="reviews-mine">
          <Text style={styles.mineLabel}>{t('reviews.yours')}</Text>
          <Review r={data.mine} t={t} />
          <Text style={styles.edit}>{t('reviews.edit')}</Text>
        </TouchableOpacity>
      ) : data.can_review ? (
        <TouchableOpacity style={styles.writeBtn} onPress={openSheet} testID="reviews-write">
          <Ionicons name="create-outline" size={17} color={colors.white} />
          <Text style={styles.writeText}>{t('reviews.write')}</Text>
        </TouchableOpacity>
      ) : data.reason === 'read_more' ? (
        <Text style={styles.hint}>{t('reviews.readMore')}</Text>
      ) : data.reason === 'sign_in' ? (
        <TouchableOpacity onPress={() => navigation.navigate('Login')}><Text style={styles.link}>{t('reviews.signIn')}</Text></TouchableOpacity>
      ) : null}

      {others.map((r) => <Review key={r.id} r={r} t={t} />)}
      {data.next ? (
        <TouchableOpacity onPress={loadMore} style={styles.moreBtn} testID="reviews-more">
          <Text style={styles.link}>{t('reviews.more')}</Text>
        </TouchableOpacity>
      ) : null}

      <BottomSheet

        keyboardHeight={kbHeight}
        visible={sheet}
        onClose={() => setSheet(false)}
        heightRatio={0.55}
        header={(
          <View style={styles.sheetHead}>
            <TouchableOpacity onPress={() => setSheet(false)} hitSlop={8}><Text style={styles.cancel}>{t('common.cancel')}</Text></TouchableOpacity>
            <Text style={styles.sheetTitle}>{t('reviews.yours')}</Text>
            <TouchableOpacity onPress={save} disabled={!draft.rating || saving} hitSlop={8} testID="reviews-save">
              {saving ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={[styles.saveText, !draft.rating && { opacity: 0.4 }]}>{t('common.save')}</Text>}
            </TouchableOpacity>
          </View>
        )}
      >
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <StarRow value={draft.rating} size={34} onPick={(n) => setDraft((d) => ({ ...d, rating: n }))} testPrefix="reviews-star" />
          <TextInput
            style={styles.input}
            value={draft.body}
            onChangeText={(v) => setDraft((d) => ({ ...d, body: v }))}
            placeholder={t('reviews.placeholder')}
            placeholderTextColor={colors.placeholder}
            multiline
            maxLength={4000}
            textAlignVertical="top"
            testID="reviews-input"
          />
          {data.mine ? (
            <TouchableOpacity onPress={remove} style={styles.removeBtn}><Text style={styles.removeText}>{t('reviews.remove')}</Text></TouchableOpacity>
          ) : null}
        </ScrollView>
      </BottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl },
  title: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  summary: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center', marginBottom: spacing.md },
  avgBox: { alignItems: 'center', minWidth: 90 },
  avg: { fontSize: 36, fontWeight: '800', color: colors.textPrimary },
  countText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  spread: { flex: 1, gap: 3 },
  spreadRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spreadLabel: { ...typography.caption, color: colors.textSecondary, width: 10 },
  spreadTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden' },
  spreadFill: { height: '100%', backgroundColor: colors.accent },
  starRow: { flexDirection: 'row', gap: 2 },
  none: { ...typography.body, color: colors.textMuted, marginBottom: spacing.sm },
  mine: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent, marginBottom: spacing.md },
  mineLabel: { ...typography.caption, color: colors.accent, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  edit: { ...typography.caption, color: colors.primary, fontWeight: '700', marginTop: 4 },
  writeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, marginBottom: spacing.md,
  },
  writeText: { ...typography.label, color: colors.white, fontWeight: '700' },
  hint: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.md },
  link: { ...typography.label, color: colors.primary, fontWeight: '700' },
  review: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  reviewer: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
  reviewBody: { ...typography.body, color: colors.textSecondary, marginTop: 4, lineHeight: 21 },
  moreBtn: { paddingVertical: spacing.md, alignItems: 'center' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  sheetTitle: { ...typography.h3, color: colors.textPrimary },
  cancel: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  saveText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  sheetBody: { paddingHorizontal: spacing.md, gap: spacing.md, alignItems: 'center' },
  input: {
    alignSelf: 'stretch', minHeight: 120, color: colors.textPrimary, fontSize: 15,
    backgroundColor: colors.inputBg, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  removeBtn: { padding: spacing.sm },
  removeText: { ...typography.label, color: colors.error, fontWeight: '700' },
});

export default BookReviews;
