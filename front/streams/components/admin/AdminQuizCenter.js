// The quiz, run from the app (manage_quiz): today's quiz with its answers,
// players' reports on questions, how each kind of question is answered (and
// runs too good to be honest), live battles, and the story journey.
// The written questions themselves stay in AdminQuizBank.
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Modal, RefreshControl,
} from 'react-native';
import KeyboardSheetPad from '../KeyboardSheetPad';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import {
  fetchAdminDailyQuiz, rebuildAdminDailyQuiz, fetchQuizReports, resolveQuizReport, fetchAdminQuizStats,
  fetchAdminBattles, endAdminBattle, fetchStoryPacksAdmin, saveStoryPack,
} from '../../services/api';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { ADMIN, ErrorState } from './AdminKit';
import { BookPicker, ChapterRange, bookAt } from './QuizAdminKit';

const TABS = ['today', 'reports', 'stats', 'battles', 'stories'];
const LANGS = ['en', 'sw'];
const BLANK_PACK = {
  title: '', title_sw: '', summary: '', summary_sw: '', book_number: 1, chapter_start: 1, chapter_end: 3,
  icon: 'book-outline', order: 0, is_active: true, is_featured: false,
};

const Pill = ({ label, on, onPress, testID }) => (
  <TouchableOpacity style={[styles.pill, on && styles.pillOn]} onPress={onPress} testID={testID}>
    <Text style={[styles.pillText, on && styles.pillTextOn]}>{label}</Text>
  </TouchableOpacity>
);

const errorOf = (e, t) => e?.data?.error || e?.response?.data?.error || t('admin.actionFailedShort');

export default function AdminQuizCenter() {
  const { t } = useI18n();
  const [tab, setTab] = useState('today');
  const [language, setLanguage] = useState('en');
  const [reportStatus, setReportStatus] = useState('open');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pack, setPack] = useState(null);           // the story pack being written or edited
  const [saving, setSaving] = useState(false);
  const [packError, setPackError] = useState('');

  const load = useCallback(async (which = tab, lang = language, st = reportStatus) => {
    setLoading(true);
    setFailed(false);
    try {
      let value;
      if (which === 'today') value = await fetchAdminDailyQuiz({ language: lang });
      else if (which === 'reports') value = await fetchQuizReports(st);
      else if (which === 'stats') value = await fetchAdminQuizStats();
      else if (which === 'battles') value = await fetchAdminBattles();
      else value = await fetchStoryPacksAdmin();
      setData((d) => ({ ...d, [which]: value }));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [tab, language, reportStatus]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const pick = (next) => { setTab(next); load(next); };

  // ── actions ────────────────────────────────────────────────────────────────
  const rebuild = async () => {
    if (!(await confirmAction({ title: t('adminQuizCenter.rebuildTitle'), message: t('adminQuizCenter.rebuildBody'),
      confirmLabel: t('adminQuizCenter.rebuild') }))) return;
    try {
      const quiz = await rebuildAdminDailyQuiz({ language });
      setData((d) => ({ ...d, today: quiz }));
    } catch (e) {
      const code = e?.data?.code || e?.response?.data?.code;
      notify(t('common.error'), code === 'played' ? t('adminQuizCenter.played')
        : code === 'in_play' ? t('adminQuizCenter.inPlay') : errorOf(e, t));
    }
  };

  const resolve = async (report, status, retire = false) => {
    try {
      await resolveQuizReport(report.id, status, retire);
      setData((d) => ({ ...d, reports: { ...d.reports, results: (d.reports?.results || []).filter((r) => r.id !== report.id) } }));
    } catch (e) {
      notify(t('common.error'), errorOf(e, t));
    }
  };

  const endBattle = async (b) => {
    if (!(await confirmAction({ title: t('adminQuizCenter.endTitle', { code: b.code }), message: t('adminQuizCenter.endBody'),
      confirmLabel: t('adminQuizCenter.end'), destructive: true }))) return;
    try {
      await endAdminBattle(b.code);
      setData((d) => ({ ...d, battles: (d.battles || []).filter((x) => x.code !== b.code) }));
    } catch (e) {
      notify(t('common.error'), errorOf(e, t));
    }
  };

  const savePack = async () => {
    const book = bookAt(pack.book_number);
    if (!pack.title.trim() || !book || pack.chapter_start < 1 || pack.chapter_end < pack.chapter_start
        || pack.chapter_end > book.chapters) {
      setPackError(t('adminQuizCenter.packInvalid'));
      return;
    }
    setSaving(true);
    setPackError('');
    try {
      await saveStoryPack({ ...pack, title: pack.title.trim() });
      setPack(null);
      load('stories');
    } catch (e) {
      const body = e?.data || e?.response?.data;
      const first = body && typeof body === 'object' ? Object.values(body)[0] : null;
      setPackError((Array.isArray(first) ? first[0] : first) || t('admin.actionFailedShort'));
    } finally {
      setSaving(false);
    }
  };

  // ── tabs ───────────────────────────────────────────────────────────────────
  const today = () => {
    const quiz = data.today;
    if (!quiz) return null;
    return (
      <>
        <View style={styles.row}>
          {LANGS.map((l) => (
            <Pill key={l} label={l.toUpperCase()} on={language === l}
                  onPress={() => { setLanguage(l); load('today', l); }} testID={`center-lang-${l}`} />
          ))}
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{String(quiz.date)}</Text>
          <Text style={styles.meta}>
            {[quiz.theme ? t(`quiz.theme.${quiz.theme}`) : t('adminQuizCenter.noTheme'),
              t('adminQuizCenter.plays', { count: quiz.attempts })].join('  ·  ')}
          </Text>
          <TouchableOpacity onPress={rebuild} disabled={quiz.attempts > 0 || quiz.playing > 0} testID="center-rebuild">
            <Text style={[styles.action, (quiz.attempts > 0 || quiz.playing > 0) && styles.actionOff]}>
              {quiz.attempts > 0 ? t('adminQuizCenter.played')
                : quiz.playing > 0 ? t('adminQuizCenter.inPlay') : t('adminQuizCenter.rebuild')}
            </Text>
          </TouchableOpacity>
        </View>
        {quiz.questions.map((q) => (
          <View key={q.id} style={styles.card} testID={`center-q-${q.id}`}>
            <Text style={styles.meta}>
              {`${q.order + 1}  ·  ${t(`quiz.difficulty.${q.difficulty}`)}  ·  ${q.kind}${q.bank_question ? '  ·  ✎' : ''}`}
            </Text>
            {!!q.passage && <Text style={styles.passage} numberOfLines={4}>{q.passage}</Text>}
            <Text style={styles.prompt}>{q.prompt}</Text>
            {q.choices.map((c, i) => (
              <Text key={`${q.id}-${i}`} style={[styles.choice, i === q.answer_index && styles.choiceRight]}>
                {i === q.answer_index ? '✓ ' : '· '}{c}
              </Text>
            ))}
            <Text style={styles.meta}>{q.reference}</Text>
          </View>
        ))}
      </>
    );
  };

  const reports = () => {
    const rows = data.reports?.results || [];
    return (
      <>
        <View style={styles.row}>
          {['open', 'fixed', 'dismissed'].map((st) => (
            <Pill key={st} label={t(`adminQuizCenter.status.${st}`)} on={reportStatus === st}
                  onPress={() => { setReportStatus(st); load('reports', language, st); }} testID={`center-status-${st}`} />
          ))}
        </View>
        {!rows.length && <Text style={styles.empty}>{t('adminQuizCenter.noReports')}</Text>}
        {rows.map((r) => (
          <View key={r.id} style={styles.card} testID={`center-report-${r.id}`}>
            <Text style={styles.flag}>
              {t(`quiz.report.${r.reason}`)}{r.reports_on_question > 1 ? `  ·  ${t('adminQuizCenter.times', { count: r.reports_on_question })}` : ''}
            </Text>
            {!!r.passage && <Text style={styles.passage} numberOfLines={4}>{r.passage}</Text>}
            <Text style={styles.prompt}>{r.prompt}</Text>
            {r.choices.map((c, i) => (
              <Text key={`${r.id}-${i}`} style={[styles.choice, i === r.answer_index && styles.choiceRight]}>
                {i === r.answer_index ? '✓ ' : '· '}{c}
              </Text>
            ))}
            {!!r.note && <Text style={styles.note}>“{r.note}”</Text>}
            <Text style={styles.meta}>{[r.reference, r.reporter, r.language.toUpperCase()].filter(Boolean).join('  ·  ')}</Text>
            {r.status === 'open' && (
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => resolve(r, 'dismissed')} testID={`center-dismiss-${r.id}`}>
                  <Text style={styles.actionMuted}>{t('adminQuizCenter.dismiss')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => resolve(r, 'fixed')} testID={`center-fixed-${r.id}`}>
                  <Text style={styles.action}>{t('adminQuizCenter.fixed')}</Text>
                </TouchableOpacity>
                {!!r.bank_question && (
                  <TouchableOpacity onPress={() => resolve(r, 'fixed', true)} testID={`center-retire-${r.id}`}>
                    <Text style={styles.actionDanger}>{t('adminQuizCenter.retire')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        ))}
      </>
    );
  };

  const stats = () => {
    const s = data.stats;
    if (!s) return null;
    return (
      <>
        <View style={styles.tiles}>
          {[['open_reports', 'flag-outline'], ['review_drafts', 'sparkles'], ['calibrated', 'swap-vertical']].map(([k, icon]) => (
            <View key={k} style={styles.tile}>
              <Ionicons name={icon} size={16} color={ADMIN.gold} />
              <Text style={styles.tileValue}>{s[k]}</Text>
              <Text style={styles.tileLabel}>{t(`adminQuizCenter.tile.${k}`)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.section}>{t('adminQuizCenter.byKind')}</Text>
        {!s.kinds.length && <Text style={styles.empty}>{t('adminQuizCenter.noAnswers')}</Text>}
        {s.kinds.map((k) => {
          const pct = k.accuracy == null ? null : Math.round(k.accuracy * 100);
          return (
            <View key={`${k.kind}-${k.difficulty}`} style={styles.kindRow}>
              <Text style={styles.kindName} numberOfLines={1}>{`${k.kind} · ${t(`quiz.difficulty.${k.difficulty}`)}`}</Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${pct || 0}%` },
                  pct != null && (pct < 30 || pct > 92) && styles.barWarn]} />
              </View>
              <Text style={styles.kindPct}>{pct == null ? '—' : `${pct}%`}</Text>
              <Text style={styles.kindN}>{k.answered}</Text>
            </View>
          );
        })}
        <Text style={styles.hint}>{t('adminQuizCenter.kindHint')}</Text>

        <Text style={styles.section}>{t('adminQuizCenter.suspicious')}</Text>
        <Text style={styles.hint}>{t('adminQuizCenter.suspiciousHint')}</Text>
        {!s.suspicious.fast_daily.length && !s.suspicious.practice_capped.length && (
          <Text style={styles.empty}>{t('adminQuizCenter.nothingOdd')}</Text>
        )}
        {s.suspicious.fast_daily.map((a) => (
          <View key={`f-${a.user_id}-${a.date}`} style={styles.card}>
            <Text style={styles.prompt}>{a.user}</Text>
            <Text style={styles.meta}>{t('adminQuizCenter.tooFast', { score: a.score, total: a.total, seconds: a.seconds, date: String(a.date) })}</Text>
          </View>
        ))}
        {s.suspicious.practice_capped.map((a) => (
          <View key={`c-${a.user_id}`} style={styles.card}>
            <Text style={styles.prompt}>{a.user}</Text>
            <Text style={styles.meta}>{t('adminQuizCenter.atCap', { coins: a.coins })}</Text>
          </View>
        ))}
      </>
    );
  };

  const battles = () => {
    const rows = data.battles || [];
    return (
      <>
        {!rows.length && <Text style={styles.empty}>{t('adminQuizCenter.noBattles')}</Text>}
        {rows.map((b) => (
          <View key={b.code} style={styles.card} testID={`center-battle-${b.code}`}>
            <Text style={styles.cardTitle}>{b.code}{b.title ? `  ·  ${b.title}` : ''}</Text>
            <Text style={styles.meta}>
              {[b.host, t(`adminQuizCenter.battle.${b.status}`), t('adminQuizCenter.players', { count: b.players }),
                b.language.toUpperCase()].join('  ·  ')}
            </Text>
            <TouchableOpacity onPress={() => endBattle(b)} testID={`center-end-${b.code}`}>
              <Text style={styles.actionDanger}>{t('adminQuizCenter.end')}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </>
    );
  };

  const stories = () => {
    const rows = data.stories || [];
    return (
      <>
        <TouchableOpacity style={styles.newBtn} onPress={() => { setPackError(''); setPack({ ...BLANK_PACK, order: (rows.length + 1) * 10 }); }}
                          testID="center-new-pack">
          <Ionicons name="add" size={18} color={ADMIN.onGold} />
          <Text style={styles.newText}>{t('adminQuizCenter.newPack')}</Text>
        </TouchableOpacity>
        {rows.map((p) => (
          <TouchableOpacity key={p.id} style={[styles.card, !p.is_active && styles.cardOff]}
                            onPress={() => { setPackError(''); setPack(p); }} testID={`center-pack-${p.id}`}>
            <Text style={styles.cardTitle}>{p.title}{p.is_featured ? '  ★' : ''}</Text>
            <Text style={styles.meta}>
              {[`${bookAt(p.book_number)?.name || ''} ${p.chapter_start}–${p.chapter_end}`,
                t('adminQuizCenter.runs', { count: p.runs || 0 }),
                p.is_active ? null : t('adminQuizCenter.off')].filter(Boolean).join('  ·  ')}
            </Text>
          </TouchableOpacity>
        ))}
      </>
    );
  };

  const body = { today, reports, stats, battles, stories }[tab]();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('adminQuizCenter.title')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {TABS.map((k) => <Pill key={k} label={t(`adminQuizCenter.tab.${k}`)} on={tab === k} onPress={() => pick(k)} testID={`center-tab-${k}`} />)}
      </ScrollView>
      {failed && !data[tab] ? (
        <ErrorState onRetry={() => load()} />
      ) : loading && !data[tab] ? (
        <ActivityIndicator color={ADMIN.gold} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}
                    refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} tintColor={ADMIN.gold} />}>
          {body}
        </ScrollView>
      )}

      <Modal visible={!!pack} transparent animationType="slide" onRequestClose={() => setPack(null)}>
        <KeyboardSheetPad style={styles.backdrop}>
          <ScrollView style={styles.sheet} contentContainerStyle={{ gap: 10, paddingBottom: 28 }}
                      keyboardShouldPersistTaps="handled" testID="pack-editor">
            <Text style={styles.sheetTitle}>{pack?.id ? t('adminQuizCenter.editPack') : t('adminQuizCenter.newPack')}</Text>
            {pack && (
              <>
                <TextInput style={styles.input} value={pack.title} placeholder={t('adminQuizCenter.packTitle')}
                           placeholderTextColor="#5E7290" onChangeText={(v) => setPack((p) => ({ ...p, title: v }))} testID="pack-title" />
                <TextInput style={styles.input} value={pack.title_sw} placeholder={t('adminQuizCenter.packTitleSw')}
                           placeholderTextColor="#5E7290" onChangeText={(v) => setPack((p) => ({ ...p, title_sw: v }))} />
                <TextInput style={styles.input} value={pack.summary} placeholder={t('adminQuizCenter.packSummary')}
                           placeholderTextColor="#5E7290" onChangeText={(v) => setPack((p) => ({ ...p, summary: v }))} />
                <TextInput style={styles.input} value={pack.summary_sw} placeholder={t('adminQuizCenter.packSummarySw')}
                           placeholderTextColor="#5E7290" onChangeText={(v) => setPack((p) => ({ ...p, summary_sw: v }))} />
                <BookPicker value={pack.book_number} testID="pack-book"
                            onPick={(n) => setPack((p) => ({ ...p, book_number: n, chapter_start: 1,
                              chapter_end: Math.min(3, bookAt(n)?.chapters || 1) }))} />
                <ChapterRange first={pack.chapter_start} last={pack.chapter_end} max={bookAt(pack.book_number)?.chapters}
                              label={t('adminQuiz.draft.chapters')} testID="pack-chapters"
                              onChange={(a, b) => setPack((p) => ({ ...p, chapter_start: a, chapter_end: b }))} />
                <View style={styles.row}>
                  <Pill label={t('adminQuizCenter.active')} on={pack.is_active}
                        onPress={() => setPack((p) => ({ ...p, is_active: !p.is_active }))} testID="pack-active" />
                  <Pill label={t('adminQuizCenter.featured')} on={pack.is_featured}
                        onPress={() => setPack((p) => ({ ...p, is_featured: !p.is_featured }))} testID="pack-featured" />
                </View>
                <Text style={styles.hint}>{t('adminQuizCenter.featuredHint')}</Text>
                {!!packError && <Text style={styles.error} testID="pack-error">{packError}</Text>}
                <TouchableOpacity style={[styles.save, saving && { opacity: 0.6 }]} onPress={savePack} disabled={saving} testID="pack-save">
                  {saving ? <ActivityIndicator color={ADMIN.onGold} /> : <Text style={styles.saveText}>{t('adminQuiz.save')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setPack(null)} style={{ alignItems: 'center', padding: 8 }}>
                  <Text style={styles.cancel}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardSheetPad>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { color: ADMIN.text, fontSize: 26, fontWeight: '800', paddingHorizontal: 16, paddingTop: 8 },
  tabs: { gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  pill: {
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: 15, backgroundColor: ADMIN.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  pillOn: { backgroundColor: ADMIN.gold, borderColor: ADMIN.gold },
  pillText: { color: ADMIN.muted, fontSize: 12.5, fontWeight: '700' },
  pillTextOn: { color: ADMIN.onGold },
  list: { paddingHorizontal: 16, paddingBottom: 48 },
  card: {
    padding: 14, borderRadius: 14, marginBottom: 10, gap: 4, backgroundColor: ADMIN.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  cardOff: { opacity: 0.6 },
  cardTitle: { color: ADMIN.text, fontSize: 16, fontWeight: '800' },
  prompt: { color: ADMIN.text, fontSize: 14.5, fontWeight: '700' },
  passage: { color: '#A9BCD0', fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  choice: { color: ADMIN.muted, fontSize: 13.5 },
  choiceRight: { color: ADMIN.ok, fontWeight: '700' },
  meta: { color: '#7D8FA8', fontSize: 12 },
  flag: { color: '#FFB547', fontSize: 12.5, fontWeight: '800' },
  note: { color: ADMIN.text, fontSize: 13, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 18, marginTop: 6, flexWrap: 'wrap' },
  action: { color: ADMIN.gold, fontWeight: '800', fontSize: 13, marginTop: 4 },
  actionOff: { color: ADMIN.muted },
  actionMuted: { color: ADMIN.muted, fontWeight: '800', fontSize: 13, marginTop: 4 },
  actionDanger: { color: ADMIN.danger, fontWeight: '800', fontSize: 13, marginTop: 4 },
  empty: { color: ADMIN.muted, textAlign: 'center', marginVertical: 24 },
  tiles: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  tile: {
    flex: 1, padding: 12, borderRadius: 14, gap: 2, backgroundColor: ADMIN.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  tileValue: { color: ADMIN.text, fontSize: 20, fontWeight: '800' },
  tileLabel: { color: ADMIN.muted, fontSize: 11.5 },
  section: { color: ADMIN.gold, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 14, marginBottom: 6 },
  hint: { color: ADMIN.muted, fontSize: 12, lineHeight: 17, marginBottom: 6 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
  kindName: { width: 120, color: ADMIN.text, fontSize: 12.5 },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: ADMIN.ok },
  barWarn: { backgroundColor: '#FFB547' },
  kindPct: { width: 40, textAlign: 'right', color: ADMIN.text, fontSize: 12.5, fontWeight: '700' },
  kindN: { width: 44, textAlign: 'right', color: ADMIN.muted, fontSize: 11.5 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: ADMIN.gold,
    borderRadius: 18, paddingHorizontal: 14, height: 36, marginBottom: 10,
  },
  newText: { color: ADMIN.onGold, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', backgroundColor: '#0E2038', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16 },
  sheetTitle: { color: ADMIN.text, fontSize: 18, fontWeight: '800' },
  input: {
    minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: ADMIN.text, fontSize: 14.5,
    backgroundColor: ADMIN.field, borderWidth: 1, borderColor: '#1E3150',
  },
  error: { color: ADMIN.danger, fontSize: 13 },
  save: { height: 48, borderRadius: 14, backgroundColor: ADMIN.gold, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: ADMIN.onGold, fontWeight: '800', fontSize: 15 },
  cancel: { color: ADMIN.muted, fontWeight: '700' },
});
