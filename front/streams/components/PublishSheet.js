// Before a book goes out: a checklist (what's needed, what's recommended), a
// preview as readers will see it, whose name it goes out under (the author,
// or an organisation they're in — chosen here, so no one publishes as the
// wrong one), and — the first time — the author's confirmation that the
// words are theirs to publish.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

/** The checks for a book about to go out: [{ key, ok, required }]. */
export const publishChecks = ({ title, cover, summary, chapters }) => {
  const live = chapters.filter((c) => c.status !== 'draft' && (c.title?.trim() || c.body?.trim()));
  return [
    { key: 'title', ok: !!title?.trim(), required: true },
    { key: 'content', ok: live.some((c) => c.body?.trim()), required: true },
    { key: 'cover', ok: !!cover, required: false },
    { key: 'summary', ok: !!summary?.trim(), required: false },
    { key: 'chapterTitles', ok: live.every((c) => c.title?.trim()), required: false },
  ];
};

const PublishSheet = ({
  visible, onClose, book, needsRights, onPreview, onPublish, publishing,
  me = '', orgs = [], publishAs = '', onPublishAs,
}) => {
  const { t } = useI18n();
  const as = orgs.find((o) => o.slug === publishAs) || null;
  const asName = as ? as.name : me;
  const [agreed, setAgreed] = useState(false);
  const checks = publishChecks(book);
  const blocked = checks.some((c) => c.required && !c.ok) || (needsRights && !agreed);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      heightRatio={0.78}
      header={(
        <View style={styles.head}>
          <Text style={styles.title}>{t('publish.title')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity>
        </View>
      )}
    >
      <ScrollView contentContainerStyle={styles.body}>
        {checks.map((c) => (
          <View key={c.key} style={styles.check} testID={`publish-check-${c.key}`}>
            <Ionicons
              name={c.ok ? 'checkmark-circle' : c.required ? 'close-circle' : 'alert-circle-outline'}
              size={20}
              color={c.ok ? colors.success || '#34C759' : c.required ? colors.error : colors.warning}
            />
            <View style={styles.checkText}>
              <Text style={styles.checkLabel}>{t(`publish.check.${c.key}`)}</Text>
              {!c.ok ? <Text style={styles.checkHint}>{t(`publish.fix.${c.key}`)}</Text> : null}
            </View>
            {!c.required ? <Text style={styles.optional}>{t('publish.recommended')}</Text> : null}
          </View>
        ))}

        <TouchableOpacity style={styles.preview} onPress={onPreview} accessibilityRole="button" testID="publish-preview">
          <Ionicons name="eye-outline" size={18} color={colors.primary} />
          <Text style={styles.previewText}>{t('publish.preview')}</Text>
        </TouchableOpacity>

        {/* Whose name it carries: said plainly, and changeable here. */}
        <View style={styles.as} testID="publish-as">
          <Text style={styles.asLabel}>{t('publish.asTitle')}</Text>
          {orgs.length ? [{ slug: '', name: me, me: true }, ...orgs].map((o) => {
            const on = o.slug === (as ? as.slug : '');
            return (
              <TouchableOpacity key={o.slug || '_me'} style={[styles.asRow, on && styles.asRowOn]} onPress={() => onPublishAs?.(o.slug)}
                accessibilityRole="radio" accessibilityState={{ checked: on }} testID={`publish-as-${o.slug || 'me'}`}>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.textSecondary} />
                <Ionicons name={o.me ? 'person-outline' : 'business-outline'} size={16} color={colors.textSecondary} />
                <View style={styles.checkText}>
                  <Text style={styles.checkLabel} numberOfLines={1}>{o.me ? `@${o.name}` : o.name}</Text>
                  <Text style={styles.checkHint}>{o.me ? t('publish.asMeHint') : t('publish.asOrgHint')}</Text>
                </View>
              </TouchableOpacity>
            );
          }) : (
            <View style={styles.asRow}>
              <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.checkLabel, styles.checkText]} numberOfLines={1}>{`@${me}`}</Text>
            </View>
          )}
        </View>

        {needsRights ? (
          <TouchableOpacity style={styles.rights} onPress={() => setAgreed((a) => !a)}
            accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} testID="publish-rights">
            <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? colors.primary : colors.textSecondary} />
            <Text style={styles.rightsText}>{t('publish.rights')}</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.go, blocked && styles.goOff]}
          disabled={blocked || publishing}
          onPress={() => onPublish({ rightsConfirmed: agreed })}
          accessibilityRole="button"
          testID="publish-go"
        >
          {publishing ? <ActivityIndicator color={colors.white} /> : (
            <Text style={styles.goText} numberOfLines={1}>
              {as ? t('publish.goAs', { name: asName }) : t('publish.goAsMe')}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 4 },
  checkText: { flex: 1 },
  checkLabel: { ...typography.label, color: colors.textPrimary, fontWeight: '600' },
  checkHint: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  optional: { ...typography.caption, color: colors.textMuted, fontSize: 10.5 },
  preview: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, marginTop: spacing.sm,
  },
  previewText: { ...typography.label, color: colors.primary, fontWeight: '700' },
  as: {
    gap: spacing.xs, padding: spacing.sm, marginTop: spacing.sm, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  asLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', paddingHorizontal: 4 },
  asRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm },
  asRowOn: { backgroundColor: 'rgba(57,135,229,0.12)' },
  rights: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  rightsText: { ...typography.caption, color: colors.textPrimary, flex: 1, lineHeight: 18 },
  go: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  goOff: { opacity: 0.4 },
  goText: { ...typography.button, color: colors.white },
});

export default PublishSheet;
