/**
 * The wallpaper chosen in Settings is what every page shows: off is no
 * picture (the plain background), one chosen is that one on every surface,
 * and "all in turn" is each surface's own set.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

let mockPrefs = {};
jest.mock('../PreferencesContext', () => ({ usePreferences: () => ({ preferences: mockPrefs }) }));
jest.mock('../../services/api', () => ({
  fetchWallpapers: jest.fn(async () => [
    { image_url: 'https://cdn/g1.jpg', title: 'Sea', scope: 'general' },
    { image_url: 'https://cdn/g2.jpg', title: 'Hills', scope: 'general' },
    { image_url: 'https://cdn/m1.jpg', title: 'Choir', scope: 'music' },
  ]),
}));

const { WallpaperProvider, useWallpapers } = require('../WallpaperContext');

const Show = ({ scope }) => {
  const { wallpapers } = useWallpapers(scope);
  return <Text testID={`w-${scope}`}>{wallpapers.join(',') || 'none'}</Text>;
};
const show = () => render(
  <WallpaperProvider><Show scope="general" /><Show scope="music" /></WallpaperProvider>,
);

test('all in turn: each surface its own set (as before)', async () => {
  mockPrefs = { wallpaperOn: true, wallpaper: 'rotate' };
  const screen = show();
  await waitFor(() => expect(screen.getByTestId('w-general')).toHaveTextContent('https://cdn/g1.jpg,https://cdn/g2.jpg'));
  expect(screen.getByTestId('w-music')).toHaveTextContent('https://cdn/m1.jpg');
});

test('one chosen: that one everywhere, music too', async () => {
  mockPrefs = { wallpaperOn: true, wallpaper: 'https://cdn/g2.jpg' };
  const screen = show();
  await waitFor(() => expect(screen.getByTestId('w-music')).toHaveTextContent('https://cdn/g2.jpg'));
  expect(screen.getByTestId('w-general')).toHaveTextContent('https://cdn/g2.jpg');
});

test('off: no picture anywhere, the plain background', async () => {
  mockPrefs = { wallpaperOn: false, wallpaper: 'https://cdn/g2.jpg' };
  const screen = show();
  await waitFor(() => expect(screen.getByTestId('w-general')).toHaveTextContent('none'));
  expect(screen.getByTestId('w-music')).toHaveTextContent('none');
});

test('a chosen wallpaper the admins have removed falls back to all in turn', async () => {
  mockPrefs = { wallpaperOn: true, wallpaper: 'https://cdn/gone.jpg' };
  const screen = show();
  await waitFor(() => expect(screen.getByTestId('w-general')).toHaveTextContent('https://cdn/g1.jpg,https://cdn/g2.jpg'));
});
