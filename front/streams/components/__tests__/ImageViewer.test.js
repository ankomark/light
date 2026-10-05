/**
 * The full-screen photo viewer: opens at the photo tapped, counts the
 * post's photos, shows the caption, closes on its button. (Pinch, pan and
 * swipe-down are native gestures, exercised on a phone.)
 */
import React from 'react';
import { FlatList } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

require('react-native-gesture-handler/jestSetup');
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 30, left: 0, right: 0 }) }));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));

const ImageViewer = require('../ImageViewer').default;

const URLS = ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg', 'https://cdn.test/3.jpg'];

test('opens at the photo tapped, with a counter, the caption and who posted it', () => {
  const screen = render(<ImageViewer visible urls={URLS} index={1} caption="Sabbath sunrise" author="mark" onClose={() => {}} />);
  expect(screen.UNSAFE_getByType(FlatList).props.initialScrollIndex).toBe(1);
  expect(screen.getByTestId('image-viewer-counter').props.children).toBe('2 / 3');
  expect(screen.getByText('Sabbath sunrise')).toBeTruthy();
  expect(screen.getByText('mark')).toBeTruthy();
});

test('one photo: no counter, and no paging', () => {
  const screen = render(<ImageViewer visible urls={URLS.slice(0, 1)} onClose={() => {}} />);
  expect(screen.queryByTestId('image-viewer-counter')).toBeNull();
  expect(screen.UNSAFE_getByType(FlatList).props.scrollEnabled).toBe(false);
});

test('the close button closes it; hidden, nothing renders', () => {
  const onClose = jest.fn();
  const screen = render(<ImageViewer visible urls={URLS} onClose={onClose} />);
  fireEvent.press(screen.getByTestId('image-viewer-close'));
  expect(onClose).toHaveBeenCalled();
  expect(render(<ImageViewer visible={false} urls={URLS} onClose={onClose} />).toJSON()).toBeNull();
});
