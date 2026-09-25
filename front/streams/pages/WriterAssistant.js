// A book's writing assistant (AI), for its writers: advice on the book's
// structure, and the manuscript read for things that disagree between
// chapters (names, dates, facts). Both read the last saved version. The
// check runs on the server — leaving doesn't stop it; the page picks it up.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { askWriterAi, fetchManuscriptCheck, startManuscriptCheck } from '../services/api';
import { askOnce, hadAnswer, aiErrorKey } from '../services/bookAi';
import { peekCache, writeCache } from '../utils/screenCache';
import { markdownTheme } from '../utils/publications';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const POLL_MS = 5000;
const mdStyle = markdownTheme(15, { color: colors.textPrimary, lineHeight: 23 });

const Card = ({ icon, title, body, children, testID }) => (
  <View style={styles.card} testID={testID}>
    <View style={styles.cardHead}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={styles.cardTitle}>{title}</Text>
    </View>
    <Text style={styles.cardBody}>{body}</Text>
    {children}
  </View>
);

const Button = ({ label, onPress, busy, testID, quiet }) => (
  <TouchableOpacity style={[styles.btn, quiet && styles.btnQuiet]} onPress={onPress} disabled={busy} testID={testID}
    accessibilityRole="button">
    {busy ? <ActivityIndicator color={quiet ? colors.primary : colors.white} /> : (
      <Text style={[styles.btnText, quiet && styles.btnTextQuiet]}>{label}</Text>
    )}
  </TouchableOpacity>
);

const Structure = ({ id, lang, t }) => {
  const key = `structure:${id}:${lang}`;
  const [state, setState] = useState(() => (hadAnswer(key) ? { status: 'done', result: hadAnswer(key) } : { status: 'idle' }));
  const run = async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'done', result: await askOnce(key, () => askWriterAi(id, { kind: 'structure', lang })) });
    } catch (err) {
      setState({ status: 'error', errKey: aiErrorKey(err) });
    }
  };
  return (
    <Card icon="git-network-outline" title={t('assistant.structure')} body={t('assistant.structureBody')} testID="assistant-structure">
      {state.status === 'done' ? (
        <View style={styles.answer} testID="structure-answer">
          <Markdown style={mdStyle}>{state.result?.text || ''}</Markdown>
          <Text style={styles.disclaimer}>{t('ai.disclaimer')}</Text>
        </View>
      ) : null}
      {state.status === 'error' ? <Text style={styles.error}>{t(state.errKey)}</Text> : null}
      {state.status !== 'done' ? (
        <Button label={t('assistant.suggest')} onPress={run} busy={state.status === 'loading'} testID="structure-run" />
      ) : null}
    </Card>
  );
};

const Issue = ({ issue, t }) => (
  <View style={styles.issue}>
    <Text style={styles.issueWhere}>{t('pubDetail.chapterN', { n: issue.chapter })}</Text>
    {issue.quote ? <Text style={styles.issueQuote}>{`“${issue.quote}”`}</Text> : null}
    <Text style={styles.issueProblem}>{issue.problem}</Text>
    {issue.suggestion ? (
      <View style={styles.fix}>
        <Ionicons name="bulb-outline" size={14} color={colors.accent} />
        <Text style={styles.fixText}>{issue.suggestion}</Text>
      </View>
    ) : null}
  </View>
);

const Consistency = ({ id, t }) => {
  const cacheKey = `aicheck:${id}`;
  const [check, setCheck] = useState(() => peekCache(cacheKey));
  const [errKey, setErrKey] = useState(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef(null);
  const live = useRef(true);

  const got = useCallback((c) => {
    if (!live.current) return;
    setCheck(c);
    writeCache(cacheKey, c, { persist: false });
    clearTimeout(timer.current);
    if (c?.status === 'queued' || c?.status === 'running') {
      timer.current = setTimeout(async () => {
        try { got(await fetchManuscriptCheck(id)); } catch { got(c); }   // offline: keep asking
      }, POLL_MS);
    }
  }, [id, cacheKey]);

  useEffect(() => {
    live.current = true;
    fetchManuscriptCheck(id).then(got).catch(() => {});
    return () => { live.current = false; clearTimeout(timer.current); };
  }, [id, got]);

  const start = async () => {
    setErrKey(null);
    setStarting(true);
    try { got(await startManuscriptCheck(id)); } catch (err) { setErrKey(aiErrorKey(err)); }
    setStarting(false);
  };

  const status = check?.status;
  const working = status === 'queued' || status === 'running';
  return (
    <Card icon="shield-checkmark-outline" title={t('assistant.check')} body={t('assistant.checkBody')} testID="assistant-check">
      {working ? (
        <View style={styles.working} testID="check-working">
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.workingText}>{t('assistant.checking')}</Text>
        </View>
      ) : null}
      {status === 'done' ? (
        <View testID="check-done">
          {check.issues?.length ? (
            <>
              <Text style={styles.count}>{t('assistant.found', { n: check.issues.length })}</Text>
              {check.issues.map((issue, i) => <Issue key={i} issue={issue} t={t} />)}
            </>
          ) : <Text style={styles.clean}>{t('assistant.noIssues')}</Text>}
          {check.truncated ? <Text style={styles.disclaimer}>{t('assistant.truncated')}</Text> : null}
          <Text style={styles.disclaimer}>{t('ai.disclaimer')}</Text>
        </View>
      ) : null}
      {status === 'failed' ? <Text style={styles.error}>{t('assistant.checkFailed')}</Text> : null}
      {errKey ? <Text style={styles.error}>{t(errKey)}</Text> : null}
      {!working ? (
        <Button label={status ? t('assistant.checkAgain') : t('assistant.checkRun')} onPress={start} busy={starting}
          quiet={status === 'done'} testID="check-run" />
      ) : null}
    </Card>
  );
};

const WriterAssistant = ({ route, navigation }) => {
  const { t, resolvedLanguage } = useI18n();
  const { id, title } = route.params || {};
  const lang = resolvedLanguage === 'sw' ? 'sw' : 'en';
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.flex}>
          <Text style={styles.topTitle} numberOfLines={1}>{t('assistant.title')}</Text>
          {title ? <Text style={styles.topSub} numberOfLines={1}>{title}</Text> : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>{t('assistant.intro')}</Text>
        <Structure id={id} lang={lang} t={t} />
        <Consistency id={id} t={t} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  topSub: { ...typography.caption, color: colors.textSecondary },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl, width: '100%', maxWidth: 760, alignSelf: 'center' },
  intro: { ...typography.body, color: colors.textSecondary },
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  cardBody: { ...typography.body, color: colors.textSecondary },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm + 2, alignItems: 'center', marginTop: spacing.xs },
  btnQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  btnText: { ...typography.button, color: colors.white },
  btnTextQuiet: { color: colors.primary },
  answer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  disclaimer: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  error: { ...typography.body, color: colors.error },
  working: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  workingText: { ...typography.body, color: colors.textSecondary, flex: 1 },
  count: { ...typography.label, color: colors.textPrimary, fontWeight: '800', marginBottom: spacing.xs },
  clean: { ...typography.body, color: colors.success || colors.textPrimary },
  issue: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 4 },
  issueWhere: { ...typography.caption, color: colors.accent, fontWeight: '800', textTransform: 'uppercase' },
  issueQuote: { ...typography.body, color: colors.textSecondary, fontStyle: 'italic' },
  issueProblem: { ...typography.body, color: colors.textPrimary },
  fix: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  fixText: { ...typography.body, color: colors.textSecondary, flex: 1 },
});

export default WriterAssistant;
