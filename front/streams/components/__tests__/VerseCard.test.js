/**
 * The share picture keeps its 4:5 shape with the Bible below the verse; a
 * verse too tall for the room above the book is set smaller until it fits.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-media-library', () => ({}));
jest.mock('expo-clipboard', () => ({}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));

const { VerseCard } = require('../VerseShareSheet');

const verse = { date: '2026-09-29', text: 'The LORD is my shepherd; I shall not want.', reference: 'Psalms 23:1' };
const layout = (height) => ({ nativeEvent: { layout: { height, width: 300, x: 0, y: 0 } } });
const verseSize = (screen) => StyleSheet.flatten(screen.getByText(verse.text).props.style).fontSize;

test('the card is exactly 4:5, and the Bible comes after the verse', () => {
  const screen = render(<VerseCard verse={verse} width={320} title="T" />);
  const card = StyleSheet.flatten(screen.toJSON().props.style);
  expect(card.width).toBe(320);
  expect(card.height).toBe(400);
  const kids = screen.toJSON().children.map((c) => c.type);
  expect(kids[kids.length - 1]).toBe('Image');            // last: the book, below all text
});

test('a verse that fits keeps its size', () => {
  const screen = render(<VerseCard verse={verse} width={320} title="T" />);
  const before = verseSize(screen);
  act(() => {
    fireEvent(screen.getByTestId('verse-card-room'), 'layout', layout(200));
    fireEvent(screen.getByTestId('verse-card-words'), 'layout', layout(150));
  });
  expect(verseSize(screen)).toBe(before);
});

test('a verse taller than its room is set smaller', () => {
  const screen = render(<VerseCard verse={verse} width={320} title="T" />);
  const before = verseSize(screen);
  act(() => {
    fireEvent(screen.getByTestId('verse-card-room'), 'layout', layout(200));
    fireEvent(screen.getByTestId('verse-card-words'), 'layout', layout(260));
  });
  const smaller = verseSize(screen);
  expect(smaller).toBeLessThan(before);

  // Still too tall at that size: another step. Then it fits, and it stops.
  act(() => { fireEvent(screen.getByTestId('verse-card-words'), 'layout', layout(215)); });
  expect(verseSize(screen)).toBeLessThan(smaller);
  const fitted = verseSize(screen);
  act(() => { fireEvent(screen.getByTestId('verse-card-words'), 'layout', layout(190)); });
  expect(verseSize(screen)).toBe(fitted);
});
