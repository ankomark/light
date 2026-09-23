/**
 * Fit a song's waveform peaks (0..1, ~100 of them) to `count` bars: each bar
 * takes the loudest peak in its share, and never drops below `floor` so quiet
 * passages still show as a bar. Pure, for the seek bar.
 */
export default function waveformBars(peaks, count, floor = 0.08) {
  if (!Array.isArray(peaks) || !peaks.length || !(count > 0)) return [];
  const n = Math.min(Math.floor(count), peaks.length);
  const out = [];
  for (let b = 0; b < n; b += 1) {
    const from = Math.floor((b * peaks.length) / n);
    const to = Math.max(from + 1, Math.floor(((b + 1) * peaks.length) / n));
    let top = 0;
    for (let i = from; i < to; i += 1) {
      const v = Number(peaks[i]);
      if (v > top) top = v;
    }
    out.push(Math.max(floor, Math.min(1, top)));
  }
  return out;
}
