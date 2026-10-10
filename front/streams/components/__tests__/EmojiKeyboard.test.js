/**
 * Emoji wherever people write: the button swaps the keyboard for the panel,
 * an emoji goes in at the cursor, the length limit holds, and tapping the
 * box brings the keyboard back.
 */
import React, { useState } from 'react';
import { Keyboard } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

jest.setTimeout(20000);

jest.mock('@expo/vector-icons', () => ({}));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));

const { EmojiTextInput } = require('../EmojiKeyboard');

const Box = ({ initial = '', max, onText }) => {
  const [value, setValue] = useState(initial);
  return (
    <EmojiTextInput
      value={value}
      onChangeText={(v) => { setValue(v); onText?.(v); }}
      maxLength={max}
      testID="box"
    />
  );
};

test('the button opens the panel in the keyboard\'s place', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  const screen = render(<Box />);
  expect(screen.queryByTestId('box-emoji-panel')).toBeNull();
  fireEvent.press(screen.getByTestId('box-emoji'));
  expect(screen.getByTestId('box-emoji-panel')).toBeTruthy();
  expect(dismiss).toHaveBeenCalled();
  expect(screen.getByLabelText('emoji.keyboard')).toBeTruthy();   // now offers the keyboard back
});

test('a tapped emoji goes in at the cursor', () => {
  const screen = render(<Box initial="Praise God" />);
  fireEvent(screen.getByTestId('box'), 'selectionChange', { nativeEvent: { selection: { start: 6, end: 6 } } });
  fireEvent.press(screen.getByTestId('box-emoji'));
  fireEvent.press(screen.getByTestId('box-emoji-panel-cell-🙏'));
  expect(screen.getByTestId('box').props.value).toBe('Praise🙏 God');
  // and the next one after it, not back at the old spot
  fireEvent.press(screen.getByTestId('box-emoji-panel-cell-❤️'));
  expect(screen.getByTestId('box').props.value).toBe('Praise🙏❤️ God');
});

test('without a cursor yet, emoji go at the end', () => {
  const screen = render(<Box initial="Amen" />);
  fireEvent.press(screen.getByTestId('box-emoji'));
  fireEvent.press(screen.getByTestId('box-emoji-panel-cell-🙏'));
  expect(screen.getByTestId('box').props.value).toBe('Amen🙏');
});

test('the length limit holds', () => {
  const onText = jest.fn();
  const screen = render(<Box initial="12345" max={6} onText={onText} />);
  fireEvent.press(screen.getByTestId('box-emoji'));
  fireEvent.press(screen.getByTestId('box-emoji-panel-cell-🙏'));   // 🙏 is two characters: 7 > 6
  expect(onText).not.toHaveBeenCalled();
  expect(screen.getByTestId('box').props.value).toBe('12345');
});

test('the tabs change the set; tapping the box closes the panel', () => {
  const screen = render(<Box />);
  fireEvent.press(screen.getByTestId('box-emoji'));
  fireEvent.press(screen.getByTestId('box-emoji-panel-tab-faith'));
  expect(screen.getByTestId('box-emoji-panel-cell-✝️')).toBeTruthy();
  fireEvent(screen.getByTestId('box'), 'focus');
  expect(screen.queryByTestId('box-emoji-panel')).toBeNull();
});
