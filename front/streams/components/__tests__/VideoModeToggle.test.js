import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockSet = jest.fn();
let mockOn = false;

jest.mock('../../context/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { videoMode: mockOn }, setPreference: (k, v) => { mockSet(k, v); mockOn = v; } }),
}));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const VideoModeToggle = require('../VideoModeToggle').default;

beforeEach(() => { mockSet.mockClear(); mockOn = false; });

test('a tap turns video mode on (saved) and says the app will open here; again turns it off', () => {
  const r = render(<VideoModeToggle />);
  const sw = r.getByTestId('video-mode-toggle');
  expect(sw.props.accessibilityState).toEqual({ checked: false });
  fireEvent.press(sw);
  expect(mockSet).toHaveBeenLastCalledWith('videoMode', true);
  expect(r.getByText('video.mode.onNote')).toBeTruthy();

  r.rerender(<VideoModeToggle />);
  expect(r.getByTestId('video-mode-toggle').props.accessibilityState).toEqual({ checked: true });
  fireEvent.press(r.getByTestId('video-mode-toggle'));
  expect(mockSet).toHaveBeenLastCalledWith('videoMode', false);
  expect(r.getByText('video.mode.offNote')).toBeTruthy();
});
