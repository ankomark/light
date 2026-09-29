import React from 'react';
import { StyleSheet } from 'react-native';
import { render, act } from '@testing-library/react-native';

jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: (p) => <View testID={p.blurRadius ? 'blur' : 'pic'} {...p} /> };
});

import NoticeCover from '../NoticeCover';

const boxRatio = (r) => StyleSheet.flatten(r.getByTestId('cover').props.style).aspectRatio;
const load = (r, width, height) => act(() => { r.getByTestId('pic').props.onLoad({ source: { width, height } }); });

test('takes the shape of the picture, never cropping it', () => {
  const r = render(<NoticeCover uri="https://x/a.jpg" minRatio={9 / 16} testID="cover" />);
  expect(r.getByTestId('pic').props.contentFit).toBe('contain');
  load(r, 1080, 1350);                 // portrait 4:5
  expect(boxRatio(r)).toBeCloseTo(0.8);
  expect(r.queryByTestId('blur')).toBeNull();
});

test('past the limits the box stops, and a blurred copy fills the sides', () => {
  const r = render(<NoticeCover uri="https://x/b.jpg" minRatio={4 / 5} testID="cover" />);
  load(r, 1080, 1920);                 // tall 9:16
  expect(boxRatio(r)).toBeCloseTo(0.8);
  expect(r.getByTestId('blur')).toBeTruthy();
});

test('a saved size gives the shape before the picture loads', () => {
  const r = render(<NoticeCover uri="https://x/d.jpg" width={1080} height={1350} minRatio={9 / 16} testID="cover" />);
  expect(boxRatio(r)).toBeCloseTo(0.8);
});

test('a new picture in the same place does not wear the old one\'s shape', () => {
  const r = render(<NoticeCover uri="https://x/e.jpg" minRatio={9 / 16} testID="cover" />);
  load(r, 1080, 1350);
  r.rerender(<NoticeCover uri="https://x/f.jpg" width={1920} height={1080} minRatio={9 / 16} testID="cover" />);
  expect(boxRatio(r)).toBeCloseTo(16 / 9);
});

test('a picture seen before opens at its shape (no jump)', () => {
  const first = render(<NoticeCover uri="https://x/c.jpg" testID="cover" />);
  load(first, 1000, 1000);
  first.unmount();
  const again = render(<NoticeCover uri="https://x/c.jpg" testID="cover" />);
  expect(boxRatio(again)).toBeCloseTo(1);
});
