/**
 * A note being written isn't lost to one stray swipe: closing with unsaved
 * words asks first; closing with nothing changed just closes.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
jest.mock('../../hooks/useKeyboardHeight', () => () => 0);
jest.mock('../BottomSheet', () => ({ visible, header, children }) => {
  const { View } = require('react-native');
  return visible ? <View>{header}{children}</View> : null;
});

const BibleNoteSheet = require('../BibleNoteSheet').default;

test('unchanged: Cancel just closes', () => {
  const onClose = jest.fn();
  const alert = jest.spyOn(Alert, 'alert');
  const screen = render(<BibleNoteSheet visible reference="John 3:16" initialNote="Loved" onSave={jest.fn()} onClose={onClose} />);
  fireEvent.press(screen.getByText('common.cancel'));
  expect(alert).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
  alert.mockRestore();
});

test('written but not saved: Cancel asks, and Keep editing keeps it open', () => {
  const onClose = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<BibleNoteSheet visible reference="John 3:16" initialNote="" onSave={jest.fn()} onClose={onClose} />);
  fireEvent.changeText(screen.getByTestId('bible-note-input'), 'A long thought about grace');
  fireEvent.press(screen.getByText('common.cancel'));
  expect(alert).toHaveBeenCalledWith('bible.discardNoteTitle', 'bible.discardNoteBody', expect.any(Array));
  expect(onClose).not.toHaveBeenCalled();
  const [, , buttons] = alert.mock.calls[0];
  buttons[1].onPress();                       // Discard
  expect(onClose).toHaveBeenCalled();
  alert.mockRestore();
});
