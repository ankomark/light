// The word puzzle's themes, run from the app: on or off, in which order they
// are offered, their names in English and Swahili, and new ones. The words
// are never typed in: a theme says where in scripture they come from (some
// books, a passage, or a word searched for), and a theme that already has
// levels keeps its source (a new theme is made instead).
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Modal, ScrollView, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardSheetPad from '../KeyboardSheetPad';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { fetchPuzzleThemesAdmin, savePuzzleTheme, reorderPuzzleThemes } from '../../services/api';
import { notify } from '../../utils/adminConfirm';
import { ADMIN, ErrorState } from './AdminKit';

const KINDS = ['books', 'passage', 'topic'];
const BLANK = { name: '', name_sw: '', description: '', description_sw: '', source: { kind: 'topic', term: '', term_sw: '' } };

const firstError = (e) => {
  const data = e?.data || e?.response?.data;
  if (!data || typeof data !== 'object') return null;
  const value = Object.values(data)[0];
  return Array.isArray(value) ? value[0] : (typeof value === 'string' ? value : null);
};

/** ["MOSES", "SINAI"] ↔ "MOSES, SINAI": theme words as one editable line. */
const wordLine = (words) => (Array.isArray(words) ? words.join(', ') : (words || ''));

/** "Books 1–5", "Psalms 23", "faith": where a theme's words come from. */
const sourceText = (source = {}, t) => {
  if (source.kind === 'books') return t('adminPuzzle.fromBooks', { first: source.first, last: source.last });
  if (source.kind === 'passage') return `${source.book} ${source.chapter}`;
  if (source.kind === 'topic') return `“${source.term}”${source.term_sw ? ` / “${source.term_sw}”` : ''}`;
  return '';
};

export default function AdminPuzzleThemes() {
  const { t } = useI18n();
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetchPuzzleThemesAdmin();
      setThemes(Array.isArray(res) ? res : (res?.results || []));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const replace = (theme) => setThemes((prev) => (prev.some((x) => x.id === theme.id)
    ? prev.map((x) => (x.id === theme.id ? { ...x, ...theme } : x)) : [...prev, theme]));

  const setActive = async (theme, on) => {
    replace({ ...theme, is_active: on });
    try {
      await savePuzzleTheme({ id: theme.id, is_active: on });
    } catch (e) {
      replace(theme);
      notify(t('common.error'), firstError(e) || t('admin.actionFailedShort'));
    }
  };

  // Up or down one place; the whole order goes to the server.
  const move = async (index, by) => {
    const to = index + by;
    if (to < 0 || to >= themes.length) return;
    const before = themes;
    const next = [...themes];
    [next[index], next[to]] = [next[to], next[index]];
    setThemes(next);
    try {
      await reorderPuzzleThemes(next.map((x) => x.id));
    } catch {
      setThemes(before);
      notify(t('common.error'), t('admin.actionFailedShort'));
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      // The theme words and the Swahili term stay editable once a theme has
      // levels (they only shape levels still to come); the rest of the source
      // is sent back unchanged.
      // A list left empty is sent empty only when it was there before
      // (that clears it); otherwise it is left out.
      const source = { ...draft.source };
      ['words', 'words_sw'].forEach((k) => {
        const line = wordLine(source[k]);
        if (line || k in source) source[k] = line; else delete source[k];
      });
      const body = draft.id
        ? {
          id: draft.id, name: draft.name, name_sw: draft.name_sw, description: draft.description,
          description_sw: draft.description_sw, source,
        }
        : { ...draft, source };
      replace(await savePuzzleTheme(body));
      setDraft(null);
    } catch (e) {
      setError(firstError(e) || t('admin.actionFailedShort'));
    } finally {
      setSaving(false);
    }
  };

  const setSource = (patch) => setDraft((d) => ({ ...d, source: { ...d.source, ...patch } }));
  const pickKind = (kind) => setDraft((d) => ({
    ...d,
    source: kind === 'books' ? { kind, first: 1, last: 5 }
      : kind === 'passage' ? { kind, book: '', chapter: 1 } : { kind, term: '', term_sw: '' },
  }));
  const num = (v) => { const n = parseInt(String(v).replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : ''; };

  const renderItem = ({ item, index }) => (
    <View style={[styles.card, !item.is_active && styles.cardOff]} testID={`theme-${item.id}`}>
      <View style={styles.order}>
        <TouchableOpacity onPress={() => move(index, -1)} disabled={index === 0} testID={`theme-up-${item.id}`}
                          accessibilityLabel={t('adminPuzzle.up')}>
          <Ionicons name="chevron-up" size={20} color={index === 0 ? '#33465F' : ADMIN.gold} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => move(index, 1)} disabled={index === themes.length - 1}
                          accessibilityLabel={t('adminPuzzle.down')}>
          <Ionicons name="chevron-down" size={20} color={index === themes.length - 1 ? '#33465F' : ADMIN.gold} />
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={{ flex: 1 }} onPress={() => { setError(''); setDraft(item); }} testID={`theme-edit-${item.id}`}>
        <Text style={styles.name}>{item.name}{item.name_sw ? `  ·  ${item.name_sw}` : ''}</Text>
        <Text style={styles.sub}>{sourceText(item.source, t)}  ·  {t('adminPuzzle.levels', { n: item.puzzle_count || 0 })}</Text>
      </TouchableOpacity>
      <Switch value={!!item.is_active} onValueChange={(v) => setActive(item, v)}
              trackColor={{ false: '#2A3E5E', true: ADMIN.gold }} thumbColor="#FFFFFF" testID={`theme-on-${item.id}`} />
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('adminPuzzle.title')}</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => { setError(''); setDraft(BLANK); }} testID="theme-new">
          <Ionicons name="add" size={18} color={ADMIN.onGold} />
          <Text style={styles.newText}>{t('adminPuzzle.new')}</Text>
        </TouchableOpacity>
      </View>
      {loading && !themes.length ? (
        <ActivityIndicator color={ADMIN.gold} style={{ marginTop: 40 }} />
      ) : failed ? (
        <ErrorState onRetry={load} />
      ) : (
        <FlatList data={themes} keyExtractor={(x) => String(x.id)} renderItem={renderItem}
                  contentContainerStyle={styles.list} onRefresh={load} refreshing={loading} />
      )}

      <Modal visible={!!draft} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <KeyboardSheetPad style={styles.backdrop}>
          <ScrollView style={styles.sheet} contentContainerStyle={{ gap: 10, paddingBottom: 28 + insets.bottom }}
                      keyboardShouldPersistTaps="handled" testID="theme-editor">
            <Text style={styles.sheetTitle}>{draft?.id ? t('adminPuzzle.edit') : t('adminPuzzle.new')}</Text>
            {draft && (
              <>
                <TextInput style={styles.input} value={draft.name} placeholder={t('adminPuzzle.name')} placeholderTextColor="#5E7290"
                           onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))} testID="theme-name" />
                <TextInput style={styles.input} value={draft.name_sw} placeholder={t('adminPuzzle.nameSw')} placeholderTextColor="#5E7290"
                           onChangeText={(v) => setDraft((d) => ({ ...d, name_sw: v }))} />
                <TextInput style={styles.input} value={draft.description} placeholder={t('adminPuzzle.description')}
                           placeholderTextColor="#5E7290" onChangeText={(v) => setDraft((d) => ({ ...d, description: v }))} />
                <TextInput style={styles.input} value={draft.description_sw} placeholder={t('adminPuzzle.descriptionSw')}
                           placeholderTextColor="#5E7290" onChangeText={(v) => setDraft((d) => ({ ...d, description_sw: v }))} />
                <Text style={styles.label}>{t('adminPuzzle.wordsFrom')}</Text>
                {draft.id ? (
                  <>
                    <Text style={styles.sub}>{sourceText(draft.source, t)}  ·  {t('adminPuzzle.sourceFixed')}</Text>
                    {draft.source?.kind === 'topic' && (
                      <TextInput style={styles.input} value={draft.source.term_sw || ''} placeholder={t('adminPuzzle.termSw')}
                                 placeholderTextColor="#5E7290" onChangeText={(v) => setSource({ term_sw: v })}
                                 testID="theme-term-sw" />
                    )}
                  </>
                ) : (
                  <>
                    <View style={styles.chips}>
                      {KINDS.map((k) => (
                        <TouchableOpacity key={k} style={[styles.chip, draft.source.kind === k && styles.chipOn]}
                                          onPress={() => pickKind(k)} testID={`theme-kind-${k}`}>
                          <Text style={[styles.chipText, draft.source.kind === k && styles.chipTextOn]}>{t(`adminPuzzle.kind.${k}`)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {draft.source.kind === 'books' && (
                      <View style={styles.pair}>
                        <TextInput style={[styles.input, { flex: 1 }]} keyboardType="number-pad" value={String(draft.source.first ?? '')}
                                   placeholder={t('adminPuzzle.firstBook')} placeholderTextColor="#5E7290"
                                   onChangeText={(v) => setSource({ first: num(v) })} />
                        <TextInput style={[styles.input, { flex: 1 }]} keyboardType="number-pad" value={String(draft.source.last ?? '')}
                                   placeholder={t('adminPuzzle.lastBook')} placeholderTextColor="#5E7290"
                                   onChangeText={(v) => setSource({ last: num(v) })} />
                      </View>
                    )}
                    {draft.source.kind === 'passage' && (
                      <View style={styles.pair}>
                        <TextInput style={[styles.input, { flex: 2 }]} value={draft.source.book} placeholder={t('adminPuzzle.book')}
                                   placeholderTextColor="#5E7290" onChangeText={(v) => setSource({ book: v })} />
                        <TextInput style={[styles.input, { flex: 1 }]} keyboardType="number-pad" value={String(draft.source.chapter ?? '')}
                                   placeholder={t('adminPuzzle.chapter')} placeholderTextColor="#5E7290"
                                   onChangeText={(v) => setSource({ chapter: num(v) })} />
                      </View>
                    )}
                    {draft.source.kind === 'topic' && (
                      <View style={styles.pair}>
                        <TextInput style={[styles.input, { flex: 1 }]} value={draft.source.term} placeholder={t('adminPuzzle.term')}
                                   placeholderTextColor="#5E7290" onChangeText={(v) => setSource({ term: v })} testID="theme-term" />
                        <TextInput style={[styles.input, { flex: 1 }]} value={draft.source.term_sw} placeholder={t('adminPuzzle.termSw')}
                                   placeholderTextColor="#5E7290" onChangeText={(v) => setSource({ term_sw: v })} />
                      </View>
                    )}
                  </>
                )}
                <Text style={styles.label}>{t('adminPuzzle.themeWords')}</Text>
                <Text style={styles.sub}>{t('adminPuzzle.themeWordsHint')}</Text>
                {!!draft.theme_words?.en?.length && (
                  <Text style={styles.sub} numberOfLines={3}>
                    {t('adminPuzzle.autoWords', { words: draft.theme_words.en.slice(0, 24).join(', ') })}
                  </Text>
                )}
                <TextInput style={[styles.input, styles.multi]} multiline value={wordLine(draft.source?.words)}
                           placeholder={t('adminPuzzle.wordsEn')} placeholderTextColor="#5E7290" autoCapitalize="characters"
                           onChangeText={(v) => setSource({ words: v })} testID="theme-words" />
                <TextInput style={[styles.input, styles.multi]} multiline value={wordLine(draft.source?.words_sw)}
                           placeholder={t('adminPuzzle.wordsSw')} placeholderTextColor="#5E7290" autoCapitalize="characters"
                           onChangeText={(v) => setSource({ words_sw: v })} testID="theme-words-sw" />
                {!!error && <Text style={styles.error} testID="theme-error">{error}</Text>}
                <TouchableOpacity style={[styles.save, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="theme-save">
                  {saving ? <ActivityIndicator color={ADMIN.onGold} /> : <Text style={styles.saveText}>{t('adminPuzzle.save')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setDraft(null)} style={{ alignItems: 'center', padding: 8 }}>
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
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  title: { color: ADMIN.text, fontSize: 26, fontWeight: '800' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: ADMIN.gold, borderRadius: 18, paddingHorizontal: 14, height: 36 },
  newText: { color: ADMIN.onGold, fontWeight: '800' },
  list: { padding: 16, paddingBottom: 48 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, marginBottom: 8,
    backgroundColor: ADMIN.card, borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  cardOff: { opacity: 0.6 },
  order: { alignItems: 'center' },
  name: { color: ADMIN.text, fontSize: 15, fontWeight: '800' },
  sub: { color: ADMIN.muted, fontSize: 12.5, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', backgroundColor: '#0E2038', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16 },
  sheetTitle: { color: ADMIN.text, fontSize: 18, fontWeight: '800' },
  label: { color: ADMIN.gold, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 4 },
  input: {
    minHeight: 44, borderRadius: 12, paddingHorizontal: 12, color: ADMIN.text, fontSize: 14.5,
    backgroundColor: ADMIN.field, borderWidth: 1, borderColor: '#1E3150',
  },
  pair: { flexDirection: 'row', gap: 8 },
  multi: { minHeight: 64, paddingTop: 10, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: ADMIN.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  chipOn: { backgroundColor: ADMIN.gold, borderColor: ADMIN.gold },
  chipText: { color: ADMIN.muted, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: ADMIN.onGold },
  error: { color: ADMIN.danger, fontSize: 13 },
  save: { height: 48, borderRadius: 14, backgroundColor: ADMIN.gold, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: ADMIN.onGold, fontWeight: '800', fontSize: 15 },
  cancel: { color: ADMIN.muted, fontWeight: '700' },
});
