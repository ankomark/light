// What this player has found on one board: the answers, then the bonus words,
// longest first. Tap a word for what it means, as the Bible uses it — from the
// glossary of old words, or explained once by the AI and kept (songs/
// puzzle_words.py). Kept on the phone too, so a word asked twice is instant.
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import { useI18n } from '../context/I18nContext';
import { fetchPuzzleMeaning } from '../services/api';
import { peekCache, writeCache } from '../utils/screenCache';
import { DISPLAY, DISPLAY_MID, SERIF, GOLD, PARCHMENT, MUTED } from '../pages/quizTheme';

const MEANING_ERRORS = { ai_off: 'puzzle.meaning.off', ai_limit: 'puzzle.meaning.limit' };

const byLength = (a, b) => b.length - a.length || a.localeCompare(b);

const Word = ({ word, onWord, bonus, on }) => (
  <TouchableOpacity
    style={[styles.word, bonus && styles.wordBonus, on && styles.wordOn]}
    onPress={onWord ? () => onWord(word) : undefined}
    disabled={!onWord}
    accessibilityRole={onWord ? 'button' : 'text'}
    accessibilityLabel={word}
    testID={`found-word-${word}`}
  >
    <Text style={[styles.wordText, bonus && styles.wordTextBonus]}>{word}</Text>
    {!!onWord && <Ionicons name="information-circle-outline" size={13} color={bonus ? GOLD : MUTED} />}
  </TouchableOpacity>
);

export default function PuzzleWordsSheet({ visible, onClose, puzzle }) {
  const { t, resolvedLanguage } = useI18n();
  const explainIn = resolvedLanguage === 'sw' ? 'sw' : 'en';
  // The word being explained, and what came back: { loading } | { meaning, … } | { error }.
  const [asked, setAsked] = useState(null);
  const [answer, setAnswer] = useState(null);
  useEffect(() => { if (!visible) { setAsked(null); setAnswer(null); } }, [visible]);

  const onWord = (word) => {
    if (asked === word) { setAsked(null); return; }
    setAsked(word);
    const key = `puzzle:meaning:${puzzle?.language || 'en'}:${explainIn}:${word}`;
    const kept = peekCache(key);
    if (kept) { setAnswer(kept); return; }
    setAnswer({ loading: true });
    fetchPuzzleMeaning(puzzle.id, word, explainIn)
      .then((res) => {
        writeCache(key, res);
        setAnswer((now) => (now?.loading ? res : now));
      })
      .catch((e) => {
        const code = (e?.response?.data || e?.data || {}).code;
        setAnswer({ error: t(MEANING_ERRORS[code] || 'puzzle.meaning.failed') });
      });
  };
  const found = [...new Set(puzzle?.found || [])].sort(byLength);
  const bonus = [...new Set(puzzle?.bonus || [])].sort(byLength);
  const total = puzzle?.slots?.length || 0;
  const bonusLeft = Math.max(0, (puzzle?.bonus_total || 0) - bonus.length);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      heightRatio={0.62}
      header={(
        <View style={styles.head}>
          <Text style={styles.headTitle}>{t('puzzle.words.title')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={22} color="rgba(232,227,218,0.7)" />
          </TouchableOpacity>
        </View>
      )}
    >
      <ScrollView contentContainerStyle={styles.body} testID="puzzle-words">
        {!!asked && (
          <View style={styles.meaning} testID="puzzle-meaning" accessibilityLiveRegion="polite">
            <Text style={styles.meaningWord}>{asked}</Text>
            {answer?.loading ? (
              <ActivityIndicator color={GOLD} style={styles.meaningLoading} />
            ) : answer?.error ? (
              <Text style={styles.meaningError}>{answer.error}</Text>
            ) : (
              <>
                <Text style={styles.meaningText}>{answer?.meaning}</Text>
                {!!answer?.verse && (
                  <Text style={styles.meaningVerse} numberOfLines={3}>
                    “{answer.verse}” — {answer.reference}
                  </Text>
                )}
              </>
            )}
          </View>
        )}
        <Text style={styles.eyebrow}>{t('puzzle.words.board', { found: found.length, total })}</Text>
        {found.length ? (
          <View style={styles.wrap}>
            {found.map((w) => <Word key={w} word={w} onWord={onWord} on={asked === w} />)}
          </View>
        ) : (
          <Text style={styles.empty}>{t('puzzle.words.none')}</Text>
        )}

        {!!puzzle?.bonus_total && (
          <>
            <Text style={[styles.eyebrow, styles.gap]}>
              {t('puzzle.words.bonus', { found: bonus.length, total: puzzle.bonus_total })}
            </Text>
            {bonus.length ? (
              <View style={styles.wrap}>
                {bonus.map((w) => <Word key={w} word={w} onWord={onWord} bonus on={asked === w} />)}
              </View>
            ) : null}
            {bonusLeft > 0 && <Text style={styles.empty}>{t('puzzle.words.bonusLeft', { count: bonusLeft })}</Text>}
          </>
        )}
        {!asked && (found.length > 0 || bonus.length > 0) && (
          <Text style={styles.tip}>{t('puzzle.words.tapForMeaning')}</Text>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10,
  },
  headTitle: { fontFamily: DISPLAY, fontSize: 15, letterSpacing: 0.8, color: PARCHMENT },
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  eyebrow: {
    fontFamily: DISPLAY_MID, fontSize: 10, letterSpacing: 1.4, color: GOLD,
    textTransform: 'uppercase', marginBottom: 10,
  },
  gap: { marginTop: 20 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  word: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14,
    backgroundColor: GOLD,
  },
  wordBonus: {
    backgroundColor: 'rgba(244,162,97,0.12)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.5)',
  },
  wordText: { fontFamily: DISPLAY, fontSize: 13, letterSpacing: 1, color: '#0A1628' },
  wordTextBonus: { color: GOLD },
  empty: { fontSize: 13, color: 'rgba(232,227,218,0.6)', marginTop: 2 },
  tip: { fontSize: 12, color: 'rgba(232,227,218,0.5)', marginTop: 22, textAlign: 'center' },
  wordOn: { borderWidth: 2, borderColor: PARCHMENT },
  meaning: {
    padding: 14, borderRadius: 14, marginBottom: 18, gap: 6,
    backgroundColor: 'rgba(244,162,97,0.10)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.45)',
  },
  meaningWord: { fontFamily: DISPLAY, fontSize: 16, letterSpacing: 1.2, color: GOLD },
  meaningText: { fontSize: 15, lineHeight: 22, color: PARCHMENT },
  meaningVerse: { fontFamily: SERIF, fontSize: 13, lineHeight: 19, color: 'rgba(232,227,218,0.7)' },
  meaningError: { fontSize: 13, color: '#FF8A86' },
  meaningLoading: { alignSelf: 'flex-start', marginVertical: 4 },
});
