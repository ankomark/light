/**
 * The header on every screen size: the title always fits the room between the
 * medallion and the icons, never taller than its row, and the tab labels stay
 * in their slots under a large system font.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useNavigationState: (pick) => pick({ index: 0, routes: [{ name: 'Home' }] }),
}));
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const Icon = ({ name }) => <Text>{name}</Text>;
  return { Ionicons: Icon, MaterialCommunityIcons: Icon };
});
jest.mock('../GlassView', () => () => null);
jest.mock('../NotificationsBell', () => () => null);
jest.mock('../HamburgerMenu', () => () => null);
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }) => children || null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }) => children }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: null, isAuthenticated: true }) }));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
jest.mock('../../context/WallpaperContext', () => ({ useWallpapersOn: () => true }));
jest.mock('../../context/AppStatusContext', () => ({ useFeature: () => true }));

const { default: Header, titleWidthFor } = require('../Header');
const { FONT_SCALE } = require('../../utils/layout');

const RATIO = 900 / 188;
const ROW_HEIGHT_WITH_PADDING = 34 + 5 * 2;

describe.each([
  ['small Android', 320], ['common Android', 360], ['iPhone', 390], ['large Android', 412],
  ['Pro Max', 430], ['foldable inner', 600], ['tablet', 768], ['large tablet', 1024],
])('%s (%i px)', (_name, width) => {
  const rowMax = width >= 768 ? 720 : undefined;
  const w = titleWidthFor(width, rowMax);
  const room = Math.min(width, rowMax || width) - (36 + 32 + 12 + 72);

  test('the title fits between the medallion and the icons', () => {
    expect(w).toBeLessThanOrEqual(Math.max(room, 120));
    expect(w).toBeGreaterThanOrEqual(60);
  });

  test('the title is never taller than its row', () => {
    expect(w / RATIO).toBeLessThanOrEqual(ROW_HEIGHT_WITH_PADDING);
  });
});

test('a 390 px phone gets the full-size title', () => {
  expect(titleWidthFor(390)).toBe(112);   // 226, after 4%, 4%, 10% and 40% smaller
});

test('tab labels grow only a little under a large system font', () => {
  const screen = render(<Header transparentBg />);
  for (const label of ['Home', 'Music', 'Bible', 'Hymns', 'You', 'header.alerts', 'header.market']) {
    expect(screen.getByText(label).props.maxFontSizeMultiplier).toBe(FONT_SCALE.tight);
  }
});
