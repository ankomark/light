import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SeekBar from '../SeekBar';

const layout = { nativeEvent: { layout: { width: 250, height: 52 } } };

test('with peaks it draws the waveform, played bars in the fill colour', () => {
  const peaks = Array.from({ length: 100 }, (_, i) => (i % 10) / 10);
  const { getByRole, UNSAFE_root } = render(
    <SeekBar value={0.5} peaks={peaks} minimumTrackTintColor="#0f0" maximumTrackTintColor="#555" />,
  );
  fireEvent(getByRole('adjustable'), 'layout', layout);
  const colours = UNSAFE_root.findAll((n) => n.type === 'View' && n.props.style?.[1]?.height?.endsWith?.('%'))
    .map((n) => n.props.style[1].backgroundColor);
  expect(colours).toHaveLength(50);                        // 250px / (3px bar + 2px gap)
  expect(colours.filter((c) => c === '#0f0')).toHaveLength(25);   // half played
});

test('without peaks it is the plain bar', () => {
  const { getByRole, UNSAFE_root } = render(<SeekBar value={0.5} />);
  fireEvent(getByRole('adjustable'), 'layout', layout);
  const bars = UNSAFE_root.findAll((n) => n.type === 'View' && n.props.style?.[1]?.height?.endsWith?.('%'));
  expect(bars).toHaveLength(0);
});
