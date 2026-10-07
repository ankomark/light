// "Why?" — why an answer is right, explained from the Scripture behind it
// (songs/quiz_ai.py on the server). Three ways to hear it: plainly, more
// simply, or for a child. Each is fetched once and kept while the app is open;
// the server keeps them for everyone.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import { askQuizWhy } from '../services/api';
import { useI18n } from '../context/I18nContext';

const GOLD = '#F4A261';
const PARCHMENT = '#E8E3DA';
const MUTED = '#8395AE';
const LEVELS = ['why', 'simple', 'children'];
const kept = new Map();

const ERRORS = {
  ai_off: 'quiz.why.off',
  ai_limit: 'quiz.why.limit',
  not_answered: 'quiz.why.notYet',
};

/** `ready`: what to wait for before asking — the answer being recorded. */
export default function WhySheet({ visible, onClose, questionId, lang = 'en', ready }) {
  const { t } = useI18n();
  const [level, setLevel] = useState('why');
  const [state, setState] = useState({ loading: false, text: '', error: '' });

  useEffect(() => { if (visible) setLevel('why'); }, [visible, questionId]);

  useEffect(() => {
    if (!visible || !questionId) return undefined;
    const key = `${questionId}:${level}:${lang}`;
    if (kept.has(key)) { setState({ loading: false, text: kept.get(key), error: '' }); return undefined; }
    let live = true;
    setState({ loading: true, text: '', error: '' });
    (async () => {
      try {
        if (ready) await ready();
        const res = await askQuizWhy(questionId, level, lang);
        kept.set(key, res.text);
        if (live) setState({ loading: false, text: res.text, error: '' });
      } catch (e) {
        const code = e?.response?.data?.code || e?.data?.code;
        if (live) setState({ loading: false, text: '', error: t(ERRORS[code] || 'quiz.why.failed') });
      }
    })();
    return () => { live = false; };
  }, [visible, questionId, level, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      heightRatio={0.6}
      header={(
        <View style={styles.head}>
          <Ionicons name="bulb-outline" size={18} color={GOLD} />
          <Text style={styles.title}>{t('quiz.why.title')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={22} color={MUTED} />
          </TouchableOpacity>
        </View>
      )}
    >
      <View style={styles.levels} accessibilityRole="tablist">
        {LEVELS.map((l) => (
          <TouchableOpacity
            key={l}
            style={[styles.level, level === l && styles.levelOn]}
            onPress={() => setLevel(l)}
            accessibilityRole="tab"
            accessibilityState={{ selected: level === l }}
          >
            <Text style={[styles.levelText, level === l && styles.levelTextOn]}>{t(`quiz.why.${l}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.body} testID="why-sheet">
        {state.loading ? (
          <ActivityIndicator color={GOLD} style={styles.loading} />
        ) : state.error ? (
          <Text style={styles.error}>{state.error}</Text>
        ) : (
          <>
            <Text style={styles.text} accessibilityLiveRegion="polite">{state.text}</Text>
            {/* For a parent reading it to a child, a teacher to a class: send it on. */}
            {!!state.text && (
              <TouchableOpacity
                style={styles.share}
                onPress={() => Share.share({ message: `${state.text}\n\n— ${t('quiz.why.sharedFrom')}` }).catch(() => {})}
                accessibilityRole="button"
                testID="why-share"
              >
                <Ionicons name="share-social-outline" size={15} color={GOLD} />
                <Text style={styles.shareText}>{t('quiz.why.share')}</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.note}>{t('quiz.why.note')}</Text>
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
  title: { flex: 1, fontFamily: 'Cinzel_700Bold', fontSize: 15, letterSpacing: 0.6, color: PARCHMENT },
  levels: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  level: {
    flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  levelOn: { backgroundColor: 'rgba(244,162,97,0.16)', borderColor: GOLD },
  levelText: { fontSize: 12.5, color: '#A9BCD0' },
  levelTextOn: { color: GOLD, fontWeight: '700' },
  body: { padding: 20, gap: 14 },
  loading: { marginTop: 24 },
  text: { fontFamily: 'Lora_400Regular', fontSize: 16, lineHeight: 26, color: PARCHMENT },
  note: { fontSize: 11.5, lineHeight: 17, color: MUTED },
  share: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 40,
    paddingHorizontal: 14, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: GOLD,
  },
  shareText: { fontSize: 13, color: GOLD, fontWeight: '700' },
  error: { fontSize: 14, lineHeight: 21, color: '#A9BCD0', textAlign: 'center', marginTop: 16 },
});
