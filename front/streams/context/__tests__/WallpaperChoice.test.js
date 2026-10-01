/**
 * Wallpapers on (Settings) are each surface's own admin set, changing in
 * turn as designed; off is no picture anywhere (the plain background).
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

test('on: each surface its own set, in turn (as designed)', async () => {
  mockPrefs = { wallpaperOn: true };
  const screen = show();
  await waitFor(() => expect(screen.getByTestId('w-general')).toHaveTextContent('https://cdn/g1.jpg,https://cdn/g2.jpg'));
  expect(screen.getByTestId('w-music')).toHaveTextContent('https://cdn/m1.jpg');
});

test('off: no picture anywhere, the plain background', async () => {
  mockPrefs = { wallpaperOn: false };
  const screen = show();
  await waitFor(() => expect(screen.getByTestId('w-general')).toHaveTextContent('none'));
  expect(screen.getByTestId('w-music')).toHaveTextContent('none');
});

