import { useWindowDimensions } from 'react-native';

/**
 * Responsive grid sizing. Picks a column count so each tile lands near
 * `target` px wide, then returns the exact tile size for the available width.
 *
 * Unlike a module-level `Dimensions.get('window')` constant, this reacts to the
 * live window size — so a 2-column phone grid becomes 4–6 columns on a tablet,
 * and it re-flows on rotation / split-screen / foldables instead of leaving a
 * handful of giant tiles.
 *
 * Pass the same `horizontalPadding` (sum of both side paddings) and inter-tile
 * `gap` the list uses so `tileSize` fits exactly.
 *
 * Returns { cols, tileSize, width }. Use `key={cols}` on the FlatList so it
 * remounts cleanly when the column count changes (RN forbids changing
 * numColumns in place).
 */
export default function useGridColumns({
  target = 120,
  min = 2,
  max = 8,
  horizontalPadding = 0,
  gap = 0,
} = {}) {
  const { width } = useWindowDimensions();
  const usable = Math.max(1, width - horizontalPadding);
  let cols = Math.floor((usable + gap) / (target + gap));
  if (!Number.isFinite(cols) || cols < 1) cols = min;
  cols = Math.max(min, Math.min(max, cols));
  const tileSize = Math.floor((usable - gap * (cols - 1)) / cols);
  return { cols, tileSize, width };
}
