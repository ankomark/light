import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockToggle = jest.fn();
jest.mock('../../services/api', () => ({ toggleTrackLike: (...a) => mockToggle(...a) }));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
const LikeButton = require('../LikeButton').default;

beforeEach(() => mockToggle.mockReset());

test('while the real like state is unknown a tap does nothing (the server toggles)', () => {
  const r = render(<LikeButton trackId={5} initialLikes={0} initialIsLiked={false} disabled />);
  fireEvent.press(r.getByTestId('like-button'));
  expect(mockToggle).not.toHaveBeenCalled();
});

test('with the state it shows it and likes', async () => {
  mockToggle.mockResolvedValue({ is_liked: true, likes_count: 4 });
  const r = render(<LikeButton trackId={5} initialLikes={3} initialIsLiked={false} />);
  expect(r.getByText('🤍 3')).toBeTruthy();
  fireEvent.press(r.getByTestId('like-button'));
  expect(r.getByText('❤️ 4')).toBeTruthy();          // at once, before the server
  await waitFor(() => expect(mockToggle).toHaveBeenCalledTimes(1));
  expect(mockToggle).toHaveBeenCalledWith(5);
});

test('a toggle that does not flip is believed, not retried forever', async () => {
  // We thought it was liked; the server says it still is after a toggle.
  mockToggle.mockResolvedValue({ is_liked: true, likes_count: 3 });
  const r = render(<LikeButton trackId={5} initialLikes={3} initialIsLiked />);
  fireEvent.press(r.getByTestId('like-button'));
  await waitFor(() => expect(r.getByText('❤️ 3')).toBeTruthy());
  expect(mockToggle).toHaveBeenCalledTimes(1);
});
