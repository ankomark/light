// "Something's wrong with this question": the marked answer is wrong, it is
// unclear, a word is misspelt. Goes to the admins' queue (songs/views/
// admin_quiz.py) with a copy of the question as it was asked. Only for a
// question already answered — the server checks that too.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import { reportQuizQuestion } from '../services/api';
import { useI18n } from '../context/I18nContext';

const GOLD = '#F4A261';
const PARCHMENT = '#E8E3DA';
const MUTED = '#8395AE';
const INK = '#0A1628';
export const REPORT_REASONS = ['wrong_answer', 'unclear', 'typo', 'other'];

/** `ready`: what to wait for first — a practice answer still being recorded. */
export default function ReportQuestionSheet({ visible, onClose, questionId, ready, onDone }) {
  const { t } = useI18n();
  const kb = useKeyboardHeight();
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState({ busy: false, done: false, error: '' });

  useEffect(() => {
    if (visible) { setReason(null); setNote(''); setState({ busy: false, done: false, error: '' }); }
  }, [visible, questionId]);

  const send = async () => {
    if (!reason || state.busy) return;
    setState({ busy: true, done: false, error: '' });
    try {
      if (ready) await ready();
      await reportQuizQuestion(questionId, reason, note.trim());
      setState({ busy: false, done: true, error: '' });
      onDone?.();
    } catch {
      setState({ busy: false, done: false, error: t('quiz.report.failed') });
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      heightRatio={0.62}
      keyboardHeight={kb || 0}
      header={(
        <View style={styles.head}>
          <Ionicons name="flag-outline" size={18} color={GOLD} />
          <Text style={styles.title}>{t('quiz.report.title')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={22} color={MUTED} />
          </TouchableOpacity>
        </View>
      )}
    >
      {state.done ? (
        <View style={styles.thanks} testID="report-done">
          <Ionicons name="checkmark-circle" size={36} color={GOLD} />
          <Text style={styles.thanksText}>{t('quiz.report.thanks')}</Text>
          <TouchableOpacity style={styles.btn} onPress={onClose} accessibilityRole="button">
            <Text style={styles.btnText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.body}>
          {REPORT_REASONS.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.reason, reason === r && styles.reasonOn]}
              onPress={() => setReason(r)}
              accessibilityRole="radio"
              accessibilityState={{ checked: reason === r }}
              testID={`report-${r}`}
            >
              <Ionicons name={reason === r ? 'radio-button-on' : 'radio-button-off'} size={18}
                        color={reason === r ? GOLD : MUTED} />
              <Text style={[styles.reasonText, reason === r && styles.reasonTextOn]}>{t(`quiz.report.${r}`)}</Text>
            </TouchableOpacity>
          ))}
          <TextInput
            style={styles.note}
            value={note}
            onChangeText={setNote}
            placeholder={t('quiz.report.notePlaceholder')}
            placeholderTextColor={MUTED}
            multiline
            maxLength={500}
            testID="report-note"
          />
          {!!state.error && <Text style={styles.error}>{state.error}</Text>}
          <TouchableOpacity
            style={[styles.btn, (!reason || state.busy) && styles.btnOff]}
            onPress={send}
            disabled={!reason || state.busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: !reason || state.busy }}
            testID="report-send"
          >
            {state.busy ? <ActivityIndicator color={INK} /> : <Text style={styles.btnText}>{t('quiz.report.send')}</Text>}
          </TouchableOpacity>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
  title: { flex: 1, fontFamily: 'Cinzel_700Bold', fontSize: 15, letterSpacing: 0.6, color: PARCHMENT },
  body: { paddingHorizontal: 20, gap: 8 },
  reason: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 14, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)',
  },
  reasonOn: { borderColor: GOLD, backgroundColor: 'rgba(244,162,97,0.10)' },
  reasonText: { flex: 1, fontSize: 14, color: '#A9BCD0' },
  reasonTextOn: { color: PARCHMENT, fontWeight: '700' },
  note: {
    minHeight: 64, borderRadius: 12, padding: 12, color: PARCHMENT, fontSize: 14, textAlignVertical: 'top',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)',
  },
  error: { color: '#FF8A86', fontSize: 13 },
  btn: { minHeight: 48, borderRadius: 24, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  btnOff: { opacity: 0.5 },
  btnText: { fontFamily: 'Cinzel_700Bold', fontSize: 13, letterSpacing: 0.8, color: INK },
  thanks: { alignItems: 'center', gap: 12, padding: 24 },
  thanksText: { fontSize: 15, lineHeight: 22, color: PARCHMENT, textAlign: 'center' },
});
