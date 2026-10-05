/**
 * Emojis in a caption: the quick row and the panel insert where the cursor
 * is, within the length limit.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));

const { default: EmojiPicker, insertAt, GROUPS } = require('../EmojiPicker');

test('insertAt: at the cursor, replacing a selection, at the end without one', () => {
  expect(insertAt('Good morning', '🙏', { start: 4, end: 4 })).toEqual({ text: 'Good🙏 morning', selection: { start: 6, end: 6 } });
  expect(insertAt('Good morning', '🔥', { start: 5, end: 12 })).toEqual({ text: 'Good 🔥', selection: { start: 7, end: 7 } });
  expect(insertAt('Hi', '❤️', null).text).toBe('Hi❤️');
  expect(insertAt('x'.repeat(199), '😊', null, 200)).toBeNull();     // would pass the limit
});

test('the quick row and the panel both pick; the panel switches groups', () => {
  const onPick = jest.fn();
  const onToggle = jest.fn();
  const screen = render(<EmojiPicker onPick={onPick} onToggle={onToggle} open testID="e" />);
  fireEvent.press(screen.getByTestId('e-quick-🙏'));
  expect(onPick).toHaveBeenLastCalledWith('🙏');
  fireEvent.press(screen.getByTestId('e-tab-faith'));
  fireEvent.press(screen.getByTestId('e-cell-⛪'));
  expect(onPick).toHaveBeenLastCalledWith('⛪');
  fireEvent.press(screen.getByTestId('e-more'));
  expect(onToggle).toHaveBeenCalled();
  expect(GROUPS.find((g) => g.key === 'faith').items).toContain('✝️');
});
