/**
 * The header's nav row: the marketplace sits where Explore was (third, after
 * Home and Music) and opens it; Explore is no longer in the row.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNav = { navigate: jest.fn() };
let mockRoute = 'Home';
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useNavigationState: (pick) => pick({ index: 0, routes: [{ name: mockRoute }] }),
}));
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const Icon = ({ name }) => <Text>{`icon:${name}`}</Text>;
  return { Ionicons: Icon, MaterialCommunityIcons: Icon };
});
jest.mock('../GlassView', () => () => null);
jest.mock('../ScreenVignette', () => () => null);
jest.mock('../NotificationsBell', () => () => null);
jest.mock('../HamburgerMenu', () => () => null);
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }) => children ?? null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 1 }, isAuthenticated: true }) }));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
let mockWallOn = true;
jest.mock('../../context/WallpaperContext', () => ({ useWallpapersOn: () => mockWallOn }));

const Header = require('../Header').default;

beforeEach(() => { mockNav.navigate.mockClear(); mockRoute = 'Home'; });

test('Market is third in the row, where Explore was, and opens the marketplace', () => {
  const screen = render(<Header />);
  const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel).filter(Boolean);
  expect(labels.slice(1, 5)).toEqual(['Home', 'Music', 'header.market', 'Bible']);
  expect(labels).not.toContain('Explore');
  fireEvent.press(screen.getByTestId('nav-market'));
  expect(mockNav.navigate).toHaveBeenCalledWith('MarketplaceHome');
});

test('Market is a storefront icon, filled and lit on the marketplace', () => {
  mockRoute = 'MarketplaceHome';
  const screen = render(<Header />);
  const market = screen.getByTestId('nav-market');
  expect(market.props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByText('icon:storefront')).toBeTruthy();
  expect(screen.getByText('icon:home-outline')).toBeTruthy();   // the others are outlines
});

test('Music is a notes icon, filled and lit on the Music screen', () => {
  mockRoute = 'Music';
  const screen = render(<Header />);
  expect(screen.getByTestId('nav-music').props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByText('icon:musical-notes')).toBeTruthy();
});

test('Bible is a book icon, filled and lit in the reader; Hymns a hymnal, not a crossed-out piano', () => {
  mockRoute = 'bible';
  const screen = render(<Header />);
  expect(screen.getByTestId('nav-bible').props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByText('icon:book')).toBeTruthy();
  expect(screen.getByText('icon:book-music-outline')).toBeTruthy();
  expect(screen.queryByText('icon:piano-off')).toBeNull();
});

test('wallpapers off: the header drops its picture for the plain navy', () => {
  const { Image } = require('react-native');
  const pictures = (screen) => screen.UNSAFE_queryAllByType(Image).filter((i) => /wallpapers\//.test(i.props.source?.uri || ''));
  mockWallOn = false;
  expect(pictures(render(<Header />))).toHaveLength(0);
  mockWallOn = true;
  expect(pictures(render(<Header />))).toHaveLength(1);
});
