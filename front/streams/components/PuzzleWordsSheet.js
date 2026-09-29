// What this player has found on one board: the answers, then the bonus words,
// longest first. A word can be tapped for what it means (`onWord`).
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import { useI18n } from '../context/I18nContext';
import { DISPLAY, DISPLAY_MID, GOLD, PARCHMENT, MUTED } from '../pages/quizTheme';

const byLength = (a, b) => b.length - a.length || a.localeCompare(b);

const Word = ({ word, onWord, bonus }) => (
  <TouchableOpacity
    style={[styles.word, bonus && styles.wordBonus]}
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

export default function PuzzleWordsSheet({ visible, onClose, puzzle, onWord }) {
  const { t } = useI18n();
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
        <Text style={styles.eyebrow}>{t('puzzle.words.board', { found: found.length, total })}</Text>
        {found.length ? (
          <View style={styles.wrap}>
            {found.map((w) => <Word key={w} word={w} onWord={onWord} />)}
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
                {bonus.map((w) => <Word key={w} word={w} onWord={onWord} bonus />)}
              </View>
            ) : null}
            {bonusLeft > 0 && <Text style={styles.empty}>{t('puzzle.words.bonusLeft', { count: bonusLeft })}</Text>}
          </>
        )}
        {!!onWord && (found.length > 0 || bonus.length > 0) && (
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
});
