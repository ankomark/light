import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HYMNALS } from '../../utils/hymnals';
import { __resetHymnFavorites } from '../../services/hymnFavorites';

jest.setTimeout(20000);   // the whole hymnal renders: slow under a parallel run

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));

const HymnDetail = require('../HymnDetail').default;
const HymnListBare = require('../HymnList').default;
const { PreferencesProvider } = require('../../context/PreferencesContext');
// The list keeps its Favourites order in the saved preferences.
const HymnList = (props) => <PreferencesProvider><HymnListBare {...props} /></PreferencesProvider>;

const swHymn = HYMNALS.sw.data.hymns[4];

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetHymnFavorites();
  mockNavigate.mockClear();
});

test('favourite a hymn, find it under Favourites, open it, take it off', async () => {
  // On the hymn: the heart adds it.
  const detail = render(<HymnDetail route={{ params: { hymn: swHymn, hymnalName: HYMNALS.sw.name, lang: 'sw' } }} />);
  const heart = detail.getByTestId('hymn-favorite');
  expect(heart.props.accessibilityState).toEqual({ selected: false });
  await act(async () => { fireEvent.press(heart); });
  expect(detail.getByText('hymns.favAdded')).toBeTruthy();
  expect(detail.getByTestId('hymn-favorite').props.accessibilityState).toEqual({ selected: true });
  detail.unmount();

  // The hymnal: the Favourites button shows it, with its book.
  const list = render(<HymnList navigation={{ navigate: mockNavigate }} />);
  await waitFor(() => expect(list.getByTestId('hymn-favorites-button')).toBeTruthy());
  await act(async () => { fireEvent.press(list.getByTestId('hymn-favorites-button')); });
  expect(list.getByText('hymns.favorites')).toBeTruthy();
  expect(list.getByText('hymns.favCount:1')).toBeTruthy();
  expect(list.getByText(swHymn.title)).toBeTruthy();
  expect(list.getByText(HYMNALS.sw.name)).toBeTruthy();

  // Tapping it opens that hymn, in its own hymnal.
  fireEvent.press(list.getByText(swHymn.title));
  expect(mockNavigate).toHaveBeenCalledWith('HymnDetail', { hymn: swHymn, hymnalName: HYMNALS.sw.name, lang: 'sw' });

  // Its heart takes it off the list.
  await act(async () => { fireEvent.press(list.getByLabelText('hymns.removeFavorite')); });
  expect(list.queryByText(swHymn.title)).toBeNull();
  expect(list.getByText('hymns.noFavorites')).toBeTruthy();
});

test('an empty Favourites explains how to add one; the button goes back to the hymnal', async () => {
  const list = render(<HymnList navigation={{ navigate: mockNavigate }} />);
  await act(async () => { fireEvent.press(list.getByTestId('hymn-favorites-button')); });
  expect(list.getByText('hymns.noFavoritesSub')).toBeTruthy();
  await act(async () => { fireEvent.press(list.getByTestId('hymn-favorites-button')); });
  expect(list.getByText('hymns.title')).toBeTruthy();
  expect(list.getByText(HYMNALS.en.data.hymns[0].title)).toBeTruthy();
});

test('favourites sort by number, title or hymnal, and the choice is remembered', async () => {
  const { toggleHymnFavorite } = require('../../services/hymnFavorites');
  const pick = (lang, i) => HYMNALS[lang].data.hymns[i];
  await toggleHymnFavorite('en', pick('en', 40).number);
  await toggleHymnFavorite('sw', pick('sw', 2).number);
  await toggleHymnFavorite('en', pick('en', 3).number);
  const titles = (r) => r.getAllByText(/./).map((n) => n.props.children)
    .filter((c) => [pick('en', 40).title, pick('sw', 2).title, pick('en', 3).title].includes(c));

  const list = render(<HymnList navigation={{ navigate: mockNavigate }} />);
  await act(async () => { fireEvent.press(list.getByTestId('hymn-favorites-button')); });
  expect(titles(list)).toEqual([pick('en', 3).title, pick('sw', 2).title, pick('en', 40).title]);   // recent
  await act(async () => { fireEvent.press(list.getByText('hymns.sort.hymnal')); });
  expect(titles(list)).toEqual([pick('en', 3).title, pick('en', 40).title, pick('sw', 2).title]);
  list.unmount();

  // Next visit: still by hymnal.
  const again = render(<HymnList navigation={{ navigate: mockNavigate }} />);
  await waitFor(async () => {
    await act(async () => {});
    expect(JSON.parse(await AsyncStorage.getItem('pref:hymnFavSort'))).toBe('hymnal');
  });
  await act(async () => { fireEvent.press(again.getByTestId('hymn-favorites-button')); });
  await waitFor(() => expect(again.getByTestId('hymn-sort-hymnal').props.accessibilityState).toEqual({ checked: true }));
  expect(titles(again)).toEqual([pick('en', 3).title, pick('en', 40).title, pick('sw', 2).title]);
});
