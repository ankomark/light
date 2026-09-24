import React from 'react';

jest.setTimeout(20000);   // slow first renders under a full parallel run
import { render, waitFor } from '@testing-library/react-native';

const mockSpec = { fps: 10, bands: 4, frames: 2, levels: Uint8Array.from([255, 128, 64, 0, 255, 128, 64, 0]) };
const mockFetch = jest.fn(async () => mockSpec);
let mockReduced = false;

jest.mock('../../services/api', () => ({ fetchSpectrum: (url) => mockFetch(url) }));
jest.mock('../../context/PlayerContext', () => ({
  usePlayer: () => ({ isPlaying: true }),
  usePlayerProgress: () => ({ positionMs: 0 }),
}));
jest.mock('../../utils/useReducedMotion', () => () => mockReduced);

const SpectrumVisualizer = require('../SpectrumVisualizer').default;

// It's hidden from screen readers (decoration), so the queries must look for hidden ones.
const HIDDEN = { includeHiddenElements: true };

beforeEach(() => { mockFetch.mockClear(); mockReduced = false; });

const bars = (r) => r.getByTestId('spectrum-visualizer', HIDDEN).children;

test('mirrored bars, bass in the middle, coloured red to green left to right', async () => {
  const r = render(<SpectrumVisualizer url="https://m/s.json" />);
  await waitFor(() => expect(r.getByTestId('spectrum-visualizer', HIDDEN)).toBeTruthy(), { timeout: 5000 });
  expect(mockFetch).toHaveBeenCalledWith('https://m/s.json');
  const row = bars(r);
  expect(row).toHaveLength(8);                                   // 4 bands, both sides
  const colour = (n) => [].concat(n.props.style).reduce((a, s) => ({ ...a, ...s }), {}).backgroundColor;
  expect(colour(row[0])).toBe('rgb(255,59,48)');                 // far left: red
  expect(colour(row[7])).toBe('rgb(52,199,89)');                 // far right: green
});

test('nothing for a song without the data, or with reduce motion on', async () => {
  const none = render(<SpectrumVisualizer url={null} />);
  expect(none.queryByTestId('spectrum-visualizer', HIDDEN)).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();

  mockReduced = true;
  const calm = render(<SpectrumVisualizer url="https://m/s.json" />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  expect(calm.queryByTestId('spectrum-visualizer', HIDDEN)).toBeNull();
});

test('while the song plays the bars follow its bands (bass here loud, treble silent)', async () => {
  const r = render(<SpectrumVisualizer url="https://m/s.json" />);
  await waitFor(() => expect(r.getByTestId('spectrum-visualizer', HIDDEN)).toBeTruthy(), { timeout: 5000 });
  const scale = (n) => {
    const t = [].concat(n.props.style).reduce((a, s) => ({ ...a, ...s }), {}).transform;
    const v = t[0].scaleY;
    return typeof v === "number" ? v : v.__getValue();       // an Animated.Value in tests
  };
  // A few animation frames.
  await waitFor(() => expect(scale(bars(r)[4])).toBeGreaterThan(0.8), { timeout: 3000 });   // band 0: full
  expect(scale(bars(r)[3])).toBeCloseTo(scale(bars(r)[4]), 5);                                // its mirror
  expect(scale(bars(r)[7])).toBeLessThan(0.1);                                                // band 3: silent
});
