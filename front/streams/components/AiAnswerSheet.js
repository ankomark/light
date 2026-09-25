// An AI answer in a sheet: what was asked about, the answer (text, or words
// and their meanings), and always marked as AI — it can be wrong. Used by
// readers (explain / define / summary) and writers (a rewrite, which
// `renderActions` lets them take). With `choices` and no request yet, it first
// asks what to do. Asked once per request per session.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import BottomSheet from './BottomSheet';
import { askOnce, hadAnswer, aiErrorKey } from '../services/bookAi';
import { markdownTheme } from '../utils/publications';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const mdStyle = markdownTheme(15, { color: colors.textPrimary, lineHeight: 23 });

const AiAnswerSheet = ({
  visible, onClose, title, quote, note, requestKey, ask, renderActions, choices, onChoose, testID = 'ai-sheet',
}) => {
  const { t } = useI18n();
  const [state, setState] = useState({ status: 'idle' });

  const run = useCallback(async () => {
    const had = hadAnswer(requestKey);
    if (had) { setState({ status: 'done', result: had }); return; }
    setState({ status: 'loading' });
    try {
      const result = await askOnce(requestKey, ask);
      setState({ status: 'done', result });
    } catch (err) {
      setState({ status: 'error', errKey: aiErrorKey(err) });
    }
  }, [requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (visible && requestKey) run(); }, [visible, requestKey, run]);

  const { status, result, errKey } = state;
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      heightRatio={0.62}
      header={(
        <View style={styles.head}>
          <Ionicons name="sparkles" size={18} color={colors.accent} />
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <View style={styles.badge}><Text style={styles.badgeText}>{t('ai.badge')}</Text></View>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}
    >
      <ScrollView contentContainerStyle={styles.body} testID={testID}>
        {note ? <Text style={styles.scope}>{note}</Text> : null}
        {quote ? <Text style={styles.quote} numberOfLines={4}>{`“${quote}”`}</Text> : null}
        {!requestKey && choices ? choices.map((c) => (
          <TouchableOpacity key={c.kind} style={styles.choice} onPress={() => onChoose(c.kind)} testID={`ai-choice-${c.kind}`}
            accessibilityRole="button">
            <Ionicons name={c.icon} size={20} color={colors.accent} />
            <View style={styles.flex}>
              <Text style={styles.choiceLabel}>{c.label}</Text>
              {c.hint ? <Text style={styles.choiceHint}>{c.hint}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )) : null}
        {status === 'loading' ? (
          <View style={styles.center} testID="ai-loading">
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.muted}>{t('ai.thinking')}</Text>
          </View>
        ) : null}
        {status === 'error' ? (
          <View style={styles.center} testID="ai-error">
            <Ionicons name={errKey === 'ai.offline' ? 'cloud-offline-outline' : 'alert-circle-outline'} size={32}
              color={colors.textMuted} />
            <Text style={styles.muted}>{t(errKey)}</Text>
            {errKey === 'ai.offline' || errKey === 'ai.failed' ? (
              <TouchableOpacity style={styles.retry} onPress={run} testID="ai-retry">
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {status === 'done' && result ? (
          <View testID="ai-answer">
            {Array.isArray(result.terms) ? (
              result.terms.length ? result.terms.map((x) => (
                <View key={x.term} style={styles.term}>
                  <Text style={styles.termWord}>{x.term}</Text>
                  <Text style={styles.termMeaning}>{x.meaning}</Text>
                </View>
              )) : <Text style={styles.muted}>{t('ai.noTerms')}</Text>
            ) : (
              <Markdown style={mdStyle}>{result.text || ''}</Markdown>
            )}
            {renderActions ? renderActions(result) : null}
            <Text style={styles.note}>{t('ai.disclaimer')}</Text>
          </View>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.accent },
  badgeText: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  quote: { color: colors.textSecondary, fontStyle: 'italic', fontSize: 14, lineHeight: 20 },
  scope: { ...typography.caption, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' },
  flex: { flex: 1 },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  choiceLabel: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  choiceHint: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  center: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  muted: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  retry: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { ...typography.button, color: colors.white },
  term: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  termWord: { ...typography.label, color: colors.textPrimary, fontWeight: '800' },
  termMeaning: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  note: { ...typography.caption, color: colors.textMuted, marginTop: spacing.md },
});

export default AiAnswerSheet;
