// A solved word puzzle as a picture to share: the verse the level came from,
// and the board's shape in gold with no letters on it, so a friend sees what
// was solved without being handed a single answer.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  DISPLAY, DISPLAY_MID, SERIF, GOLD, PARCHMENT, MUTED, INK,
} from '../pages/quizTheme';

const APP_NAME = 'Adventist Life';
// Drawn at 400 wide; every size scales with the card.
const DESIGN_WIDTH = 400;
const RATIO = 5 / 4;

/** "★★☆" for 2 of 3; empty for an unfinished board. */
export const starText = (stars) => (stars ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '');

/** The same result as text, for sharing without a picture. */
export const puzzleMessage = ({ title, line, verse, link }) => [
  title, line, verse ? `“${verse.text}” — ${verse.reference}` : null, link,
].filter(Boolean).join('\n');

const PuzzleShareCard = React.forwardRef(({
  width, title, subtitle, layout, verse, line,
}, ref) => {
  const k = width / DESIGN_WIDTH;
  const rows = (layout || []).length || 1;
  const cols = Math.max(1, ...(layout || []).map((r) => r.length));
  // The board sits in a box a little over half the card; tiles fit it.
  const tile = Math.min(24 * k, (width * 0.72) / cols, (width * RATIO * 0.34) / rows);
  return (
    <View ref={ref} collapsable={false}
          style={[styles.card, { width, height: width * RATIO, borderRadius: 24 * k, padding: 26 * k }]}>
      <LinearGradient
        colors={['#0A1628', '#12294A', '#0A1628']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.frame, { borderRadius: 18 * k, margin: 12 * k }]} pointerEvents="none" />

      <View style={styles.head}>
        <Text style={[styles.title, { fontSize: 11 * k, letterSpacing: 2.4 * k }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.subtitle, { fontSize: 12 * k, marginTop: 4 * k }]}>{subtitle}</Text>}
      </View>

      <View style={styles.board} testID="puzzle-card-board">
        {(layout || []).map((row, r) => (
          // eslint-disable-next-line react/no-array-index-key
          <View key={r} style={styles.boardRow}>
            {row.split('').map((mark, c) => (
              <View
                // eslint-disable-next-line react/no-array-index-key
                key={c}
                style={[
                  { width: tile - 2 * k, height: tile - 2 * k, margin: k, borderRadius: 4 * k },
                  mark === '#' && styles.tile,
                ]}
              />
            ))}
          </View>
        ))}
      </View>

      <View style={styles.foot}>
        {!!verse && (
          <>
            <Text style={[styles.verse, { fontSize: 14 * k, lineHeight: 21 * k }]} numberOfLines={4}>
              “{verse.text}”
            </Text>
            <Text style={[styles.ref, { fontSize: 11 * k, marginTop: 6 * k }]}>{verse.reference}</Text>
          </>
        )}
        {!!line && <Text style={[styles.line, { fontSize: 13 * k, marginTop: 12 * k }]}>{line}</Text>}
        <Text style={[styles.brand, { fontSize: 9 * k, marginTop: 10 * k, letterSpacing: 2 * k }]}>{APP_NAME}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { overflow: 'hidden', backgroundColor: INK, justifyContent: 'space-between' },
  frame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.45)',
  },
  head: { alignItems: 'center' },
  title: { fontFamily: DISPLAY, color: GOLD, textTransform: 'uppercase' },
  subtitle: { fontFamily: DISPLAY_MID, color: PARCHMENT },
  board: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  boardRow: { flexDirection: 'row' },
  tile: { backgroundColor: GOLD },
  foot: { alignItems: 'center' },
  verse: { fontFamily: SERIF, color: PARCHMENT, textAlign: 'center' },
  ref: { fontFamily: DISPLAY_MID, color: GOLD },
  line: { fontFamily: DISPLAY, color: PARCHMENT },
  brand: { fontFamily: DISPLAY_MID, color: MUTED, textTransform: 'uppercase' },
});

export default PuzzleShareCard;
