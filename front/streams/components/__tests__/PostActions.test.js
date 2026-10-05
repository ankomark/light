/**
 * A post's "…" menu: delete asks in the reader's language; editing opens on
 * what is posted (not a cancelled draft) and stays clear of the notch and
 * the keyboard.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 40, bottom: 24, left: 0, right: 0 }) }));
jest.mock('../tickets/KeyboardLift', () => ({ children }) => children);
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null, Feather: () => null }));
jest.mock('../ReportModal', () => () => null);
jest.mock('../../services/api', () => ({ API_URL: 'https://api.test/api', getAccessToken: async () => 't', markNotInterested: jest.fn() }));
jest.mock('axios', () => ({ patch: jest.fn(), delete: jest.fn() }));

const PostActions = require('../PostActions').default;

const post = { id: 5, caption: 'Sabbath sunrise', can_edit: true };

test('delete asks in the reader’s language', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<PostActions post={post} onUpdate={jest.fn()} onDelete={jest.fn()} />);
  fireEvent.press(screen.getByLabelText('post.options'));
  fireEvent.press(screen.getByText('post.delete'));
  expect(alert).toHaveBeenCalledWith('post.delete', 'post.deleteConfirm', [
    expect.objectContaining({ text: 'common.cancel' }),
    expect.objectContaining({ text: 'common.delete', style: 'destructive' }),
  ]);
  alert.mockRestore();
});

test('editing opens on the posted caption, not a cancelled draft', () => {
  const screen = render(<PostActions post={post} onUpdate={jest.fn()} onDelete={jest.fn()} />);
  fireEvent.press(screen.getByLabelText('post.options'));
  fireEvent.press(screen.getByText('post.edit'));
  fireEvent.changeText(screen.getByTestId('post-edit-caption'), 'half-typed change');
  fireEvent.press(screen.getByLabelText('common.close'));
  fireEvent.press(screen.getByLabelText('post.options'));
  fireEvent.press(screen.getByText('post.edit'));
  expect(screen.getByTestId('post-edit-caption').props.value).toBe('Sabbath sunrise');
  expect(screen.getByText('post.saveChanges')).toBeTruthy();
});
