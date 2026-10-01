// The quiz's written questions, run from the app (they were only in Django's
// admin). Each shows how often it is answered right; one the quiz retired by
// itself (almost everyone right, or almost everyone wrong, usually a wrong
// answer key) says why, for its answer to be checked before it comes back.
import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import {
  fetchQuizBank, fetchAdminByUrl, saveQuizQuestion, retireQuizQuestion, activateQuizQuestion,
} from '../../services/api';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { ADMIN, ErrorState } from './AdminKit';

const STATES = ['', 'active', 'retired', 'off'];
const KINDS = ['who_said', 'true_false', 'order', 'fact'];
const LEVELS = ['simple', 'moderate', 'hard'];
const LANGS = ['en', 'sw'];
const BLANK = {
  kind: 'fact', language: 'en', difficulty: 'simple', category: '', prompt: '',
  choices: ['', '', ''], answer_index: 0, explanation: '', reference: '',
};

/** The first message the server gave for a refused question. */
const firstError = (e) => {
  const data = e?.data || e?.response?.data;
  if (!data || typeof data !== 'object') return null;
  const value = Object.values(data)[0];
  return Array.isArray(value) ? value[0] : (typeof value === 'string' ? value : null);
};

const Chips = ({ options, value, onPick, label, testID }) => (
  <View style={styles.chips}>
    {options.map((o) => (
      <TouchableOpacity key={o} style={[styles.chip, value === o && styles.chipOn]} onPress={() => onPick(o)}
                        testID={`${testID}-${o || 'all'}`}>
        <Text style={[styles.chipText, value === o && styles.chipTextOn]}>{label(o)}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

export default function AdminQuizBank() {
  const { t } = useI18n();
  const [language, setLanguage] = useState('en');
  const [state, setState] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState(null);       // the question being written or edited
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);
  const debounce = useRef(null);

  const load = useCallback(async (lang, st, q) => {
    const mine = ++latest.current;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetchQuizBank({ language: lang, state: st, q });
      if (mine !== latest.current) return;
      setRows(res?.results || []);
      setNext(res?.next || null);
    } catch {
      if (mine === latest.current) setFailed(true);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(language, state, query.trim()); }, [load]));  // eslint-disable-line react-hooks/exhaustive-deps
  const refilter = (lang, st) => { setLanguage(lang); setState(st); load(lang, st, query.trim()); };
  const onQuery = (text) => {
    setQuery(text);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(language, state, text.trim()), 400);
  };
  const more = async () => {
    if (!next) return;
    try {
      const res = await fetchAdminByUrl(next);
      setRows((prev) => [...prev, ...(res?.results || []).filter((r) => !prev.some((p) => p.id === r.id))]);
      setNext(res?.next || null);
    } catch { /* pull to refresh */ }
  };

  const upsert = (q) => setRows((prev) => (prev.some((r) => r.id === q.id)
    ? prev.map((r) => (r.id === q.id ? q : r)) : [q, ...prev]));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const body = { ...draft, choices: draft.choices.map((c) => c.trim()).filter(Boolean) };
      upsert(await saveQuizQuestion(body));
      setDraft(null);
    } catch (e) {
      setError(firstError(e) || t('admin.actionFailedShort'));
    } finally {
      setSaving(false);
    }
  };

  const retireOrBring = async (q) => {
    try {
      if (q.is_active) {
        if (!(await confirmAction({ title: t('adminQuiz.retireTitle'), message: t('adminQuiz.retireBody'),
          confirmLabel: t('adminQuiz.retire'), destructive: true }))) return;
        await retireQuizQuestion(q.id);
        upsert({ ...q, is_active: false });
      } else {
        upsert(await activateQuizQuestion(q.id));
      }
    } catch (e) {
      notify(t('common.error'), e?.data?.error || t('admin.actionFailedShort'));
    }
  };

  const setChoice = (i, text) => setDraft((d) => ({ ...d, choices: d.choices.map((c, j) => (j === i ? text : c)) }));
  const addChoice = () => setDraft((d) => (d.choices.length < 4 ? { ...d, choices: [...d.choices, ''] } : d));
  const dropChoice = (i) => setDraft((d) => {
    if (d.choices.length <= 2) return d;
    const choices = d.choices.filter((_, j) => j !== i);
    const answer = d.answer_index === i ? 0 : d.answer_index > i ? d.answer_index - 1 : d.answer_index;
    return { ...d, choices, answer_index: answer };
  });
  const pickKind = (kind) => setDraft((d) => (kind === 'true_false'
    ? { ...d, kind, choices: [t('adminQuiz.true'), t('adminQuiz.false')], answer_index: 0 } : { ...d, kind }));

  const renderItem = ({ item }) => (
    <TouchableOpacity style={[styles.card, !item.is_active && styles.cardOff]} onPress={() => { setError(''); setDraft(item); }}
                      activeOpacity={0.85} testID={`quiz-${item.id}`}>
      <Text style={styles.prompt}>{item.prompt}</Text>
      {item.choices.map((c, i) => (
        <View key={`${i}-${c}`} style={styles.choiceRow}>
          <Ionicons name={i === item.answer_index ? 'checkmark-circle' : 'ellipse-outline'} size={15}
                    color={i === item.answer_index ? ADMIN.ok : ADMIN.muted} />
          <Text style={[styles.choiceText, i === item.answer_index && styles.choiceRight]}>{c}</Text>
        </View>
      ))}
      <Text style={styles.meta}>
        {[t(`adminQuiz.kind.${item.kind}`), t(`adminQuiz.level.${item.difficulty}`), item.language.toUpperCase(),
          item.reference].filter(Boolean).join('  ·  ')}
      </Text>
      <View style={styles.footRow}>
        <Text style={styles.stats}>
          {item.times_asked
            ? t('adminQuiz.accuracy', { pct: Math.round((item.accuracy || 0) * 100), n: item.times_asked })
            : t('adminQuiz.notAsked')}
        </Text>
        <TouchableOpacity onPress={() => retireOrBring(item)} testID={`quiz-toggle-${item.id}`}>
          <Text style={[styles.toggle, item.is_active ? styles.toggleOff : styles.toggleOn]}>
            {item.is_active ? t('adminQuiz.retire') : t('adminQuiz.bringBack')}
          </Text>
        </TouchableOpacity>
      </View>
      {!!item.retired_reason && (
        <Text style={styles.retired} testID={`quiz-retired-${item.id}`}>{t(`adminQuiz.retiredFor.${item.retired_reason}`)}</Text>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('adminQuiz.title')}</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => { setError(''); setDraft({ ...BLANK, language }); }}
                          testID="quiz-new">
          <Ionicons name="add" size={18} color={ADMIN.onGold} />
          <Text style={styles.newText}>{t('adminQuiz.new')}</Text>
        </TouchableOpacity>
      </View>
      <Chips options={LANGS} value={language} onPick={(l) => refilter(l, state)} label={(l) => l.toUpperCase()} testID="quiz-lang" />
      <Chips options={STATES} value={state} onPick={(st) => refilter(language, st)} label={(st) => t(`adminQuiz.state.${st || 'all'}`)}
             testID="quiz-state" />
      <TextInput style={styles.search} value={query} onChangeText={onQuery} placeholder={t('adminQuiz.search')}
                 placeholderTextColor="#5E7290" testID="quiz-search" />
      {loading && !rows.length ? (
        <ActivityIndicator color={ADMIN.gold} style={{ marginTop: 40 }} />
      ) : failed ? (
        <ErrorState onRetry={() => load(language, state, query.trim())} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onEndReached={more}
          onEndReachedThreshold={0.5}
          onRefresh={() => load(language, state, query.trim())}
          refreshing={loading}
          ListEmptyComponent={<Text style={styles.empty}>{t('adminQuiz.none')}</Text>}
        />
      )}

      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <View style={styles.backdrop}>
          <ScrollView style={styles.sheet} contentContainerStyle={{ gap: 10, paddingBottom: 28 }}
                      keyboardShouldPersistTaps="handled" testID="quiz-editor">
            <Text style={styles.sheetTitle}>{draft?.id ? t('adminQuiz.edit') : t('adminQuiz.new')}</Text>
            {draft && (
              <>
                <Chips options={KINDS} value={draft.kind} onPick={pickKind} label={(k) => t(`adminQuiz.kind.${k}`)} testID="quiz-kind" />
                <Chips options={LEVELS} value={draft.difficulty} onPick={(v) => setDraft((d) => ({ ...d, difficulty: v }))}
                       label={(v) => t(`adminQuiz.level.${v}`)} testID="quiz-level" />
                <Chips options={LANGS} value={draft.language} onPick={(v) => setDraft((d) => ({ ...d, language: v }))}
                       label={(v) => v.toUpperCase()} testID="quiz-language" />
                <TextInput style={[styles.input, styles.multi]} value={draft.prompt} multiline placeholder={t('adminQuiz.prompt')}
                           placeholderTextColor="#5E7290" onChangeText={(v) => setDraft((d) => ({ ...d, prompt: v }))}
                           testID="quiz-prompt" />
                <Text style={styles.label}>{t('adminQuiz.answers')}</Text>
                {draft.choices.map((c, i) => (
                  <View key={`choice-${i}`} style={styles.choiceEdit}>
                    <TouchableOpacity onPress={() => setDraft((d) => ({ ...d, answer_index: i }))} testID={`quiz-right-${i}`}
                                      accessibilityLabel={t('adminQuiz.markRight')}>
                      <Ionicons name={draft.answer_index === i ? 'checkmark-circle' : 'ellipse-outline'} size={24}
                                color={draft.answer_index === i ? ADMIN.ok : ADMIN.muted} />
                    </TouchableOpacity>
                    <TextInput style={[styles.input, { flex: 1 }]} value={c} onChangeText={(v) => setChoice(i, v)}
                               editable={draft.kind !== 'true_false'} placeholder={t('adminQuiz.answer', { n: i + 1 })}
                               placeholderTextColor="#5E7290" testID={`quiz-choice-${i}`} />
                    {draft.kind !== 'true_false' && draft.choices.length > 2 && (
                      <TouchableOpacity onPress={() => dropChoice(i)} accessibilityLabel={t('common.remove')}>
                        <Ionicons name="close-circle-outline" size={22} color={ADMIN.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                {draft.kind !== 'true_false' && draft.choices.length < 4 && (
                  <TouchableOpacity onPress={addChoice} testID="quiz-add-choice">
                    <Text style={styles.link}>{t('adminQuiz.addAnswer')}</Text>
                  </TouchableOpacity>
                )}
                <TextInput style={styles.input} value={draft.reference} placeholder={t('adminQuiz.reference')}
                           placeholderTextColor="#5E7290" onChangeText={(v) => setDraft((d) => ({ ...d, reference: v }))} />
                <TextInput style={[styles.input, styles.multi]} value={draft.explanation} multiline
                           placeholder={t('adminQuiz.explanation')} placeholderTextColor="#5E7290"
                           onChangeText={(v) => setDraft((d) => ({ ...d, explanation: v }))} />
                {!!error && <Text style={styles.error} testID="quiz-error">{error}</Text>}
                <TouchableOpacity style={[styles.save, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}
                                  testID="quiz-save">
                  {saving ? <ActivityIndicator color={ADMIN.onGold} /> : <Text style={styles.saveText}>{t('adminQuiz.save')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setDraft(null)} style={{ alignItems: 'center', padding: 8 }}>
                  <Text style={styles.cancel}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  title: { color: ADMIN.text, fontSize: 26, fontWeight: '800' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: ADMIN.gold, borderRadius: 18, paddingHorizontal: 14, height: 36 },
  newText: { color: ADMIN.onGold, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, marginTop: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: ADMIN.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  chipOn: { backgroundColor: ADMIN.gold, borderColor: ADMIN.gold },
  chipText: { color: ADMIN.muted, fontSize: 12.5, fontWeight: '700' },
  chipTextOn: { color: ADMIN.onGold },
  search: {
    marginHorizontal: 16, marginTop: 10, height: 42, borderRadius: 21, paddingHorizontal: 14, color: ADMIN.text,
    backgroundColor: ADMIN.card, borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  list: { padding: 16, paddingBottom: 48 },
  card: {
    padding: 14, borderRadius: 14, marginBottom: 10, gap: 4, backgroundColor: ADMIN.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  cardOff: { opacity: 0.7 },
  prompt: { color: ADMIN.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  choiceText: { color: ADMIN.muted, fontSize: 13.5 },
  choiceRight: { color: ADMIN.ok, fontWeight: '700' },
  meta: { color: '#7D8FA8', fontSize: 12, marginTop: 4 },
  footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  stats: { color: ADMIN.muted, fontSize: 12.5 },
  toggle: { fontWeight: '800', fontSize: 13 },
  toggleOff: { color: ADMIN.danger },
  toggleOn: { color: ADMIN.gold },
  retired: { color: '#FFB547', fontSize: 12.5, fontStyle: 'italic', marginTop: 4 },
  empty: { color: ADMIN.muted, textAlign: 'center', marginTop: 40 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%', backgroundColor: '#0E2038', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16,
  },
  sheetTitle: { color: ADMIN.text, fontSize: 18, fontWeight: '800' },
  label: { color: ADMIN.gold, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 4 },
  input: {
    minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: ADMIN.text, fontSize: 14.5,
    backgroundColor: ADMIN.field, borderWidth: 1, borderColor: '#1E3150',
  },
  multi: { minHeight: 72, textAlignVertical: 'top' },
  choiceEdit: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  link: { color: ADMIN.gold, fontWeight: '800' },
  error: { color: ADMIN.danger, fontSize: 13 },
  save: { height: 48, borderRadius: 14, backgroundColor: ADMIN.gold, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: ADMIN.onGold, fontWeight: '800', fontSize: 15 },
  cancel: { color: ADMIN.muted, fontWeight: '700' },
});
