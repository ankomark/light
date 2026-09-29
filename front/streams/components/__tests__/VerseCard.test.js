/**
 * The share picture, "Resting" design: 4:5, title and date on top, the verse
 * in the room below, the app's name, then the Bible along the foot — after
 * everything, so no verse runs under it. A verse too tall for its room is set
 * smaller until it fits.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('expo-sharing', () => ({}));
jest.mock('expo-media-library', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));

const { VerseCard } = require('../VerseShareSheet');

const verse = { date: '2026-09-29', text: 'The LORD is my shepherd; I shall not want.', reference: 'Psalms 23:1' };
const layout = (height) => ({ nativeEvent: { layout: { height, width: 300, x: 0, y: 0 } } });
const verseSize = (screen) => StyleSheet.flatten(screen.getByText(verse.text).props.style).fontSize;

test('4:5, with the title and date first and the Bible last, along the foot', () => {
  const screen = render(<VerseCard verse={verse} width={400} title="VERSE OF THE DAY" />);
  const root = screen.toJSON();
  const card = StyleSheet.flatten(root.props.style);
  expect(card.width).toBe(400);
  expect(card.height).toBe(500);

  const last = root.children[root.children.length - 1];
  expect(last.type).toBe('Image');
  const book = StyleSheet.flatten(last.props.style);
  expect(book.width).toBeCloseTo(248);                      // 62% of the width
  expect(book.height).toBeCloseTo(248 * 339 / 900);          // the artwork's own shape
  expect(book.position).toBeUndefined();                     // in the flow, never over the verse

  expect(screen.getByText('VERSE OF THE DAY')).toBeTruthy();
  expect(screen.getByText('29 September 2026')).toBeTruthy();
  expect(screen.getByText('Adventist Life')).toBeTruthy();
});

test("sizes are the design's at 400 wide, scaled for a narrower card", () => {
  const at400 = verseSize(render(<VerseCard verse={verse} width={400} title="T" />));
  const at320 = verseSize(render(<VerseCard verse={verse} width={320} title="T" />));
  expect(at400).toBe(24);
  expect(at320).toBeCloseTo(24 * 0.8);
});

test('a verse that fits keeps its size', () => {
  const screen = render(<VerseCard verse={verse} width={400} title="T" />);
  act(() => {
    fireEvent(screen.getByTestId('verse-card-room'), 'layout', layout(260));
    fireEvent(screen.getByTestId('verse-card-words'), 'layout', layout(180));
  });
  expect(verseSize(screen)).toBe(24);
});

test('a verse taller than its room steps down until it fits, then stops', () => {
  const screen = render(<VerseCard verse={verse} width={400} title="T" />);
  act(() => {
    fireEvent(screen.getByTestId('verse-card-room'), 'layout', layout(200));
    fireEvent(screen.getByTestId('verse-card-words'), 'layout', layout(260));
  });
  const smaller = verseSize(screen);
  expect(smaller).toBeLessThan(24);
  act(() => { fireEvent(screen.getByTestId('verse-card-words'), 'layout', layout(190)); });
  expect(verseSize(screen)).toBe(smaller);
});
