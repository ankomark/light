import waveformBars from '../waveformBars';

test('groups peaks into bars by their loudest point', () => {
  expect(waveformBars([0.1, 0.9, 0.2, 0.4], 2)).toEqual([0.9, 0.4]);
});

test('never more bars than peaks, and every peak lands in a bar', () => {
  const peaks = Array.from({ length: 100 }, (_, i) => (i === 99 ? 1 : 0.5));
  const bars = waveformBars(peaks, 60);
  expect(bars).toHaveLength(60);
  expect(bars[59]).toBe(1);
  expect(waveformBars([0.5, 0.5], 10)).toHaveLength(2);
});

test('quiet parts keep a visible floor; junk is empty', () => {
  expect(waveformBars([0, 0.02], 2)).toEqual([0.08, 0.08]);
  expect(waveformBars(null, 10)).toEqual([]);
  expect(waveformBars([1], 0)).toEqual([]);
});
