// A day's quiz result as a picture to share: the score, the coins, the run,
// and one mark per question — gold where it was right — so the shape of the
// day shows without giving a single answer away to someone yet to play.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Coins, DISPLAY, DISPLAY_MID, SERIF, GOLD, GOLD_DEEP, PARCHMENT, MUTED, INK,
} from '../pages/quizTheme';

const APP_NAME = 'Adventist Life';
// Drawn at 400 wide; every size scales with the card.
const DESIGN_WIDTH = 400;
const RATIO = 5 / 4;
const PER_ROW = 10;

/** The same result as text: one square per question, a row per ten. */
export const resultMessage = ({ title, day, score, total, points, coinsLabel, marks, beatMe }) => {
  const rows = [];
  for (let i = 0; i < marks.length; i += PER_ROW) {
    rows.push(marks.slice(i, i + PER_ROW).map((m) => (m ? '🟨' : '⬛')).join(''));
  }
  return [`${title} — ${day}`, `${score}/${total} · ${coinsLabel}`, ...rows, beatMe]
    .filter(Boolean).join('\n');
};

const QuizResultCard = React.forwardRef(({
  width, title, day, score, total, points, streak, streakLabel, band, marks, beatMe,
}, ref) => {
  const k = width / DESIGN_WIDTH;
  const cell = 22 * k;
  const gap = 6 * k;
  return (
    <View ref={ref} collapsable={false}
          style={[styles.card, { width, height: width * RATIO, borderRadius: 24 * k, padding: 28 * k }]}>
      <LinearGradient
        colors={['#0A1628', '#12294A', '#0A1628']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.frame, { borderRadius: 18 * k, margin: 12 * k }]} pointerEvents="none" />

      <View style={styles.head}>
        <Text style={[styles.title, { fontSize: 11 * k, letterSpacing: 2.4 * k }]}>{title}</Text>
        {!!day && <Text style={[styles.day, { fontSize: 11 * k, marginTop: 4 * k }]}>{day}</Text>}
      </View>

      <View style={styles.middle}>
        <View style={styles.scoreRow}>
          <Text style={[styles.score, { fontSize: 84 * k, lineHeight: 92 * k }]}>{score}</Text>
          <Text style={[styles.of, { fontSize: 30 * k }]}>/{total}</Text>
        </View>
        {!!band && <Text style={[styles.band, { fontSize: 13 * k, marginTop: 2 * k }]}>{band}</Text>}

        <View style={[styles.marks, { gap, marginTop: 22 * k, width: PER_ROW * cell + (PER_ROW - 1) * gap }]}
              testID="quiz-card-marks">
          {marks.map((right, i) => (
            <View
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              style={[
                styles.mark,
                { width: cell, height: cell, borderRadius: 5 * k },
                right ? styles.markRight : styles.markWrong,
              ]}
            />
          ))}
        </View>

        <View style={[styles.stats, { gap: 22 * k, marginTop: 22 * k }]}>
          <Coins value={points} size={22 * k} textSize={18 * k} />
          {streak > 0 && (
            <Text style={[styles.streak, { fontSize: 13 * k }]}>{streakLabel}</Text>
          )}
        </View>
      </View>

      <View style={styles.foot}>
        {!!beatMe && <Text style={[styles.beat, { fontSize: 15 * k }]}>{beatMe}</Text>}
        <Text style={[styles.brand, { fontSize: 9 * k, letterSpacing: 2 * k, marginTop: 8 * k }]}>{APP_NAME}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { overflow: 'hidden', backgroundColor: INK, justifyContent: 'space-between' },
  frame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.35)',
  },
  head: { alignItems: 'center' },
  title: { fontFamily: DISPLAY_MID, color: GOLD, textTransform: 'uppercase' },
  day: { fontFamily: SERIF, color: 'rgba(232,227,218,0.7)' },
  middle: { alignItems: 'center' },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline' },
  score: { fontFamily: DISPLAY, color: GOLD },
  of: { fontFamily: DISPLAY_MID, color: MUTED },
  band: { fontFamily: SERIF, color: '#A9BCD0', textAlign: 'center' },
  marks: { flexDirection: 'row', flexWrap: 'wrap' },
  mark: {},
  markRight: { backgroundColor: GOLD },
  markWrong: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(255,255,255,0.04)' },
  stats: { flexDirection: 'row', alignItems: 'center' },
  streak: { fontFamily: DISPLAY_MID, color: GOLD_DEEP, letterSpacing: 0.6 },
  foot: { alignItems: 'center' },
  beat: { fontFamily: SERIF, fontStyle: 'italic', color: PARCHMENT },
  brand: { fontFamily: DISPLAY_MID, color: 'rgba(232,227,218,0.55)', textTransform: 'uppercase' },
});

export default QuizResultCard;
