import React from 'react';
import { Text, View } from 'react-native';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

jest.setTimeout(20000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('../RotatingBackground', () => () => null);
jest.mock('../ScreenVignette', () => () => null);
const mockLogout = jest.fn(async () => {});
jest.mock('../../context/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, currentUser: { username: 'mark' }, logout: mockLogout }),
}));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
jest.mock('../../services/api', () => ({ fetchUnreadMessageCount: jest.fn(async () => ({ unread_count: 2, requests: 1 })) }));
let mockDM = null;
jest.mock('../../services/dmSocket', () => ({ subscribeDM: (fn) => { mockDM = fn; return () => {}; } }));

const { default: HamburgerMenu, MenuScreen } = require('../HamburgerMenu');

// Each page: its name and the header's menu button, as in the app.
const page = (name) => function Page({ route }) {
  return (
    <View>
      <Text>{`page:${name}${route.params?.docKey ? `:${route.params.docKey}` : ''}`}</Text>
      <HamburgerMenu />
    </View>
  );
};
const Stack = createNativeStackNavigator();
const nav = createNavigationContainerRef();
const App = () => (
  <NavigationContainer ref={nav}>
    <Stack.Navigator initialRouteName="Home" screenOptions={{ headerShown: false }}>
      {['Home', 'Weather', 'Settings', 'LegalPage', 'Profile', 'Login'].map((n) => (
        <Stack.Screen key={n} name={n} component={page(n)} />
      ))}
      <Stack.Screen name="Menu" component={MenuScreen} />
    </Stack.Navigator>
  </NavigationContainer>
);

const stack = () => nav.getRootState().routes.map((r) => (r.params?.docKey ? `${r.name}:${r.params.docKey}` : r.name));
const top = () => nav.getCurrentRoute().name;
const openMenu = async (r) => {
  const buttons = r.getAllByLabelText('Open menu');
  await act(async () => { fireEvent.press(buttons[buttons.length - 1]); });
};
const tap = async (r, label) => { await act(async () => { fireEvent.press(r.getByLabelText(label)); }); };
const back = async () => { await act(async () => { nav.goBack(); }); };

beforeEach(() => mockLogout.mockClear());

test('back from a page the menu opened returns to the menu, then to where it was opened', async () => {
  const r = render(<App />);
  await openMenu(r);
  expect(stack()).toEqual(['Home', 'Menu']);
  await tap(r, 'Weather');
  expect(stack()).toEqual(['Home', 'Menu', 'Weather']);
  await back();                                   // the swipe / phone's back button
  expect(top()).toBe('Menu');
  await back();
  expect(stack()).toEqual(['Home']);
});

test('the menu opened again from its page goes back to it, never stacking menus', async () => {
  const r = render(<App />);
  await openMenu(r);
  await tap(r, 'Weather');
  await openMenu(r);                              // from Weather's header
  expect(stack()).toEqual(['Home', 'Menu']);
  await tap(r, 'Settings');
  expect(stack()).toEqual(['Home', 'Menu', 'Settings']);
  await back();
  await back();
  expect(stack()).toEqual(['Home']);
});

test('the page the menu was opened over is marked, and choosing it just closes the menu', async () => {
  const r = render(<App />);
  await act(async () => { nav.navigate('Weather'); });
  await openMenu(r);
  expect(r.getByLabelText('Weather').props.accessibilityState).toEqual({ selected: true });
  expect(r.getByLabelText('Settings').props.accessibilityState).toEqual({ selected: false });
  await tap(r, 'Weather');
  expect(stack()).toEqual(['Home', 'Weather']);
});

test('the legal pages share a route: each is told apart by its document', async () => {
  const r = render(<App />);
  await act(async () => { nav.navigate('LegalPage', { docKey: 'privacy' }); });
  await openMenu(r);                              // over the privacy policy
  expect(r.getByLabelText('Privacy Policy').props.accessibilityState).toEqual({ selected: true });
  expect(r.getByLabelText('Terms of Service').props.accessibilityState).toEqual({ selected: false });
  await tap(r, 'Terms of Service');               // same route, another document: a new page
  expect(stack()).toEqual(['Home', 'LegalPage:privacy', 'Menu', 'LegalPage:terms']);
  await back();
  await back();
  expect(r.getByText('page:LegalPage:privacy')).toBeTruthy();
});

test('close and the profile row', async () => {
  const r = render(<App />);
  await openMenu(r);
  await tap(r, 'Close menu');
  expect(stack()).toEqual(['Home']);
  await openMenu(r);
  await act(async () => { fireEvent.press(r.getByText('mark')); });
  expect(stack()).toEqual(['Home', 'Menu', 'Profile']);
  await back();
  expect(top()).toBe('Menu');
});

test('the unread count (with requests) shows on Messages; log out leaves for the login page', async () => {
  const r = render(<App />);
  await openMenu(r);
  await waitFor(() => expect(r.getByText('3')).toBeTruthy());
  await act(async () => { fireEvent.press(r.getByLabelText('Log out')); });
  expect(mockLogout).toHaveBeenCalled();
  expect(stack()).toEqual(['Login']);
});

test('a live message counts again', async () => {
  const api = require('../../services/api');
  render(<App />);
  await waitFor(() => expect(api.fetchUnreadMessageCount).toHaveBeenCalled());
  const before = api.fetchUnreadMessageCount.mock.calls.length;
  expect(mockDM).toBeTruthy();
  await act(async () => { mockDM({ type: 'typing' }); mockDM({ type: 'message' }); mockDM({ type: 'message' }); });
  await waitFor(() => expect(api.fetchUnreadMessageCount.mock.calls.length).toBe(before + 1));
});
