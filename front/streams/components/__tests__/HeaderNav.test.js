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

const Header = require('../Header').default;

beforeEach(() => { mockNav.navigate.mockClear(); mockRoute = 'Home'; });

test('Market is third in the row, where Explore was, and opens the marketplace', () => {
  const screen = render(<Header />);
  const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel).filter(Boolean);
  expect(labels.slice(1, 5)).toEqual(['Home', 'Music', 'header.market', 'Bible']);
  expect(labels).not.toContain('Explore');
  fireEvent.press(screen.getByTestId('nav-storefront-outline'));
  expect(mockNav.navigate).toHaveBeenCalledWith('MarketplaceHome');
});

test('on the marketplace, Market is lit', () => {
  mockRoute = 'MarketplaceHome';
  const screen = render(<Header />);
  expect(screen.getByText('icon:storefront')).toBeTruthy();
});
