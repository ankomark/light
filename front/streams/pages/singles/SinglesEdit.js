// Making (or changing) a singles profile. Birth date and gender are asked
// once, when it is made — they decide who sees whom, so they never change.
// Up to three prompts; numbers, emails and links are taken out by the server.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { createSinglesProfile, updateSinglesProfile } from '../../services/api';
import { notify } from '../../utils/adminConfirm';
import {
  GOLD, FACE, SinglesScreen, GoldButton, Label, Chip, Body,
} from '../../components/singles/SinglesKit';
import { PROMPTS } from '../../components/singles/ProfileCard';

const MAX_PROMPTS = 3;
const splitList = (text) => text.split(',').map((x) => x.trim()).filter(Boolean);

export default function SinglesEdit() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const creating = !!params.create;
  const start = params.profile || {};
  const [f, setF] = useState({
    first_name: start.first_name || '', country: start.country || '', town: start.town || '',
    church: start.church || '', baptised: start.baptised || '', looking_for: start.looking_for || 'marriage',
    about: start.about || '', occupation: start.occupation || '', education: start.education || '',
    languages: (start.languages || []).join(', '), interests: (start.interests || []).join(', '),
    gender: '', day: '', month: '', year: '',
  });
  const [answers, setAnswers] = useState(() => Object.fromEntries((start.prompts || []).map((p) => [p.key, p.answer])));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((cur) => ({ ...cur, [k]: v }));
  const answered = Object.values(answers).filter((a) => a && a.trim()).length;

  const save = async () => {
    const payload = {
      first_name: f.first_name.trim(), country: f.country.trim(), town: f.town.trim(), church: f.church.trim(),
      baptised: f.baptised, looking_for: f.looking_for, about: f.about.trim(), occupation: f.occupation.trim(),
      education: f.education.trim(), languages: splitList(f.languages), interests: splitList(f.interests),
      prompts: PROMPTS.filter((k) => answers[k]?.trim()).map((k) => ({ key: k, answer: answers[k].trim() })),
    };
    if (creating) {
      const pad = (n) => String(n).padStart(2, '0');
      Object.assign(payload, {
        agree_rules: true, gender: f.gender,
        birth_date: f.year && f.month && f.day ? `${f.year}-${pad(f.month)}-${pad(f.day)}` : '',
      });
    }
    setBusy(true);
    setErrors({});
    try {
      if (creating) await createSinglesProfile(payload); else await updateSinglesProfile(payload);
      navigation.goBack();
    } catch (e) {
      const data = e?.data || {};
      if (data.code === 'under_18') {
        notify(t('singles.edit.under18Title'), t('singles.edit.under18Body'));
      } else if (data.code === 'not_eligible') {
        notify(t('singles.notYet.title'), (data.blockers || []).map((b) => t(`singles.blocker.${b}`, { date: '' })).join('\n'));
      } else {
        setErrors(data);
        notify(t('singles.edit.checkTitle'), t('singles.edit.checkBody'));
      }
    } finally {
      setBusy(false);
    }
  };

  const field = (key, label, opts = {}) => (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput style={[styles.input, opts.multiline && styles.multi, errors[key] && styles.inputBad]}
        value={f[key]} onChangeText={set(key)} placeholder={opts.hint} placeholderTextColor={GOLD.muted}
        multiline={opts.multiline} maxLength={opts.max} accessibilityLabel={label} testID={`singles-field-${key}`} />
      {!!errors[key] && <Text style={styles.error}>{t('singles.edit.fieldBad')}</Text>}
    </View>
  );

  return (
    <SinglesScreen title={t(creating ? 'singles.edit.createTitle' : 'singles.edit.title')} testID="singles-edit-screen"
      footer={<GoldButton label={t(creating ? 'singles.edit.create' : 'singles.edit.save')} onPress={save} busy={busy}
        testID="singles-save" />}>
      <Body style={styles.lead}>{t('singles.edit.lead')}</Body>

      {field('first_name', t('singles.field.firstName'), { max: 40 })}

      {creating && (
        <>
          <View style={styles.field}>
            <Label>{t('singles.field.birthDate')}</Label>
            <View style={styles.dateRow}>
              {[['day', 2, 'DD'], ['month', 2, 'MM'], ['year', 4, 'YYYY']].map(([k, n, hint]) => (
                <TextInput key={k} style={[styles.input, styles.dateBox, k === 'year' && { flex: 1.6 },
                  errors.birth_date && styles.inputBad]}
                  value={f[k]} onChangeText={(v) => set(k)(v.replace(/[^0-9]/g, '').slice(0, n))}
                  keyboardType="number-pad" placeholder={hint} placeholderTextColor={GOLD.muted}
                  accessibilityLabel={t(`singles.field.${k}`)} testID={`singles-birth-${k}`} />
              ))}
            </View>
            <Text style={styles.note}>{t('singles.edit.fixedNote')}</Text>
            {!!errors.birth_date && <Text style={styles.error}>{t('singles.edit.badDate')}</Text>}
          </View>
          <View style={styles.field}>
            <Label>{t('singles.field.gender')}</Label>
            <View style={styles.chips}>
              {['woman', 'man'].map((g) => (
                <Chip key={g} text={t(`singles.gender.${g}`)} on={f.gender === g} onPress={() => set('gender')(g)}
                  testID={`singles-gender-${g}`} />
              ))}
            </View>
            {!!errors.gender && <Text style={styles.error}>{t('singles.edit.pickOne')}</Text>}
          </View>
        </>
      )}

      {field('country', t('singles.field.country'), { max: 60 })}
      {field('town', t('singles.field.town'), { max: 80 })}
      {field('church', t('singles.field.church'), { max: 120, hint: t('singles.edit.churchHint') })}

      <View style={styles.field}>
        <Label>{t('singles.field.baptised')}</Label>
        <View style={styles.chips}>
          {['yes', 'not_yet'].map((b) => (
            <Chip key={b} text={t(`singles.baptised.${b}`)} on={f.baptised === b} onPress={() => set('baptised')(b)}
              testID={`singles-baptised-${b}`} />
          ))}
        </View>
        {!!errors.baptised && <Text style={styles.error}>{t('singles.edit.pickOne')}</Text>}
      </View>

      <View style={styles.field}>
        <Label>{t('singles.field.lookingFor')}</Label>
        <View style={styles.chips}>
          {['marriage', 'friendship'].map((b) => (
            <Chip key={b} text={t(`singles.looking.${b}`)} on={f.looking_for === b} onPress={() => set('looking_for')(b)} />
          ))}
        </View>
      </View>

      {field('about', t('singles.field.about'), { multiline: true, max: 500, hint: t('singles.edit.aboutHint') })}

      <View style={styles.field}>
        <Label>{t('singles.field.prompts')}</Label>
        <Text style={styles.note}>{t('singles.edit.promptsNote', { n: answered, max: MAX_PROMPTS })}</Text>
        {PROMPTS.map((k) => {
          const open = answers[k] !== undefined;
          const full = answered >= MAX_PROMPTS && !answers[k]?.trim();
          return (
            <View key={k} style={styles.prompt}>
              <TouchableOpacity onPress={() => setAnswers((a) => {
                const next = { ...a };
                if (open) delete next[k]; else next[k] = '';
                return next;
              })} disabled={!open && full} accessibilityRole="button" accessibilityState={{ expanded: open }}
                style={[styles.promptHead, !open && full && { opacity: 0.4 }]} testID={`singles-prompt-${k}`}>
                <Text style={styles.promptTitle}>{t(`singles.prompt.${k}`)}</Text>
                <Text style={styles.promptSign}>{open ? '−' : '+'}</Text>
              </TouchableOpacity>
              {open && (
                <TextInput style={[styles.input, styles.multi]} value={answers[k]} multiline maxLength={200}
                  onChangeText={(v) => setAnswers((a) => ({ ...a, [k]: v }))} placeholderTextColor={GOLD.muted}
                  accessibilityLabel={t(`singles.prompt.${k}`)} testID={`singles-answer-${k}`} />
              )}
            </View>
          );
        })}
        {!!errors.prompts && <Text style={styles.error}>{t('singles.edit.fieldBad')}</Text>}
      </View>

      {field('languages', t('singles.field.languages'), { hint: t('singles.edit.listHint') })}
      {field('interests', t('singles.field.interests'), { hint: t('singles.edit.listHint') })}
      {field('occupation', t('singles.field.occupation'), { max: 80 })}
      {field('education', t('singles.field.education'), { max: 80 })}

      <Text style={[styles.note, { marginTop: 8 }]}>{t('singles.edit.contactNote')}</Text>
    </SinglesScreen>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: 6 },
  field: { gap: 8, marginTop: 16 },
  input: {
    minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: GOLD.border, backgroundColor: GOLD.card,
    color: GOLD.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15.5, fontFamily: FACE.body,
  },
  inputBad: { borderColor: GOLD.danger },
  multi: { minHeight: 96, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateBox: { flex: 1, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { color: GOLD.muted, fontSize: 12.5, lineHeight: 18, fontFamily: FACE.body },
  error: { color: GOLD.danger, fontSize: 13, fontFamily: FACE.semi },
  prompt: { gap: 8 },
  promptHead: {
    flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: GOLD.cardDeep, borderWidth: 1, borderColor: GOLD.border,
  },
  promptTitle: { flex: 1, color: GOLD.text, fontSize: 15, fontFamily: FACE.semi },
  promptSign: { color: GOLD.gold, fontSize: 22, fontFamily: FACE.bold },
});
