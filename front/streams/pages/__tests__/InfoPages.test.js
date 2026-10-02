/**
 * The information pages: Help's search and topics, the guide's cards that
 * open and take you there, the legal page's summary, contents and other
 * documents, and About's ways in to help and the policies.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockNav = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };
let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
let mockParams = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
}));
let mockFeatures = { marketplace: true, quiz: true, puzzle: true, live: true };
jest.mock('../../context/AppStatusContext', () => ({ useAppStatus: () => ({ features: mockFeatures }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => mockInsets };
});

const Help = require('../Help').default;
const UserGuide = require('../UserGuide').default;
const LegalPage = require('../LegalPage').default;
const About = require('../About').default;
const PrivacyCentreScreen = require('../PrivacyCentre').default;

beforeEach(() => {
  mockNav.navigate.mockClear(); mockNav.replace.mockClear(); mockParams = {};
  mockFeatures = { marketplace: true, quiz: true, puzzle: true, live: true };
});

test('help: a search narrows the questions, a topic too, and one opens', () => {
  const screen = render(<Help />);
  expect(screen.getByText('help.faq.appealQ')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('help-search'), 'help.faq.language');
  expect(screen.getByText('help.faq.languageQ')).toBeTruthy();
  expect(screen.queryByText('help.faq.appealQ')).toBeNull();
  fireEvent.changeText(screen.getByTestId('help-search'), 'nothing like this');
  expect(screen.getByText('help.noMatch')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('help-search'), '');
  fireEvent.press(screen.getByTestId('help-topic-market'));
  expect(screen.queryByText('help.faq.appealQ')).toBeNull();
  fireEvent.press(screen.getByTestId('help-q-help.faq.sellQ'));
  expect(screen.getByText('help.faq.sellA')).toBeTruthy();
});

test('guide: a card opens and takes you to that part of the app', () => {
  const screen = render(<UserGuide />);
  fireEvent.press(screen.getByTestId('guide-music'));
  expect(screen.getByText('guide.music.body')).toBeTruthy();
  fireEvent.press(screen.getByTestId('guide-open-music'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Music');
});

test('legal: at a glance, contents for every part, and the other documents', () => {
  mockParams = { docKey: 'terms' };
  const { TERMS } = require('../../content/legal');
  const screen = render(<LegalPage />);
  expect(screen.getByTestId('legal-glance')).toBeTruthy();
  expect(screen.getByTestId(`legal-toc-${TERMS.sections.length - 1}`)).toBeTruthy();
  fireEvent.press(screen.getByTestId('legal-open-privacy'));
  expect(mockNav.replace).toHaveBeenCalledWith('LegalPage', { docKey: 'privacy' });
});

test('legal: an unknown document shows the privacy policy', () => {
  mockParams = { docKey: 'nope' };
  expect(render(<LegalPage />).getByTestId('legal-privacy')).toBeTruthy();
});

test('about: help, the guide and the policies are a tap away', () => {
  const screen = render(<About />);
  fireEvent.press(screen.getByText('guide.title'));
  expect(mockNav.navigate).toHaveBeenCalledWith('UserGuide');
  fireEvent.press(screen.getByText('about.terms'));
  expect(mockNav.navigate).toHaveBeenCalledWith('LegalPage', { docKey: 'terms' });
});

test('privacy centre: each control and policy tile leads to its place', () => {
  const PrivacyCentre = require('../PrivacyCentre').default;
  const screen = render(<PrivacyCentre />);
  fireEvent.press(screen.getByTestId('privacy-blocked'));
  expect(mockNav.navigate).toHaveBeenCalledWith('BlockedUsers');
  fireEvent.press(screen.getByTestId('privacy-terms'));
  expect(mockNav.navigate).toHaveBeenCalledWith('LegalPage', { docKey: 'terms' });
});

test('guide: the opened part closes again and the others stay as tiles', () => {
  const screen = render(<UserGuide />);
  fireEvent.press(screen.getByTestId('guide-bible'));
  expect(screen.getByText('guide.bible.body')).toBeTruthy();
  fireEvent.press(screen.getByTestId('guide-bible'));
  expect(screen.queryByText('guide.bible.body')).toBeNull();
  expect(screen.getByTestId('guide-feed')).toBeTruthy();
});

// ── Screen sizes and text sizes ─────────────────────────────────────────────
const RN = require('react-native');
const atSize = (width, fontScale = 1) => jest.spyOn(RN, 'useWindowDimensions')
  .mockReturnValue({ width, height: 800, scale: 2, fontScale });
const widthOf = (el) => StyleSheet.flatten(el.props.style).width;
afterEach(() => { jest.restoreAllMocks(); mockInsets = { top: 0, bottom: 0, left: 0, right: 0 }; });

test('tiles: two a row on a small phone, one at a large text size', () => {
  atSize(320);
  let screen = render(<PrivacyCentreScreen />);
  expect(widthOf(screen.getByTestId('privacy-blocked'))).toBe('48.5%');
  screen.unmount();
  atSize(390, 1.6);
  screen = render(<PrivacyCentreScreen />);
  expect(widthOf(screen.getByTestId('privacy-blocked'))).toBe('100%');
});

test('about: four features a row on a tablet, and the email address has the whole row', () => {
  atSize(1024);
  const screen = render(<About />);
  const grid = screen.getByText('about.feature.music').parent.parent;
  expect(widthOf(grid)).toBe('23.5%');
  expect(widthOf(screen.getByLabelText('about.contact'))).toBe('100%');
  expect(widthOf(screen.getByLabelText('about.share'))).toBe('48.5%');
});

test('legal: back to top clears the home indicator', () => {
  mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
  mockParams = { docKey: 'terms' };
  const screen = render(<LegalPage />);
  fireEvent.scroll(screen.UNSAFE_getByType(RN.ScrollView), {
    nativeEvent: { contentOffset: { y: 900 }, contentSize: { height: 4000 }, layoutMeasurement: { height: 800 } },
  });
  const btn = screen.getByLabelText('legal.backToTop');
  expect(StyleSheet.flatten(btn.props.style).bottom).toBe(24 + 34);
});

// ── The newer parts of the app ──────────────────────────────────────────────
test('guide: the newer parts are there and each opens its own page', () => {
  const screen = render(<UserGuide />);
  [['publishing', 'Publishing'], ['quiz', 'QuizHome'], ['puzzle', 'PuzzlePlay'], ['services', 'Studios'],
    ['verse', 'DailyVerse'], ['hymns', 'Hymns'], ['tools', 'Calendar']].forEach(([key, route]) => {
    fireEvent.press(screen.getByTestId(`guide-${key}`));
    fireEvent.press(screen.getByTestId(`guide-open-${key}`));
    expect(mockNav.navigate).toHaveBeenLastCalledWith(route);
  });
});

test('guide and help: a part switched off by an admin leaves both', () => {
  mockFeatures = { marketplace: false, quiz: false, puzzle: true, live: true };
  const guide = render(<UserGuide />);
  expect(guide.queryByTestId('guide-quiz')).toBeNull();
  expect(guide.queryByTestId('guide-market')).toBeNull();
  expect(guide.getByTestId('guide-puzzle')).toBeTruthy();
  guide.unmount();
  const help = render(<Help />);
  expect(help.queryByText('help.faq.battleQ')).toBeNull();
  expect(help.queryByText('help.faq.payQ')).toBeNull();
  expect(help.getByText('help.faq.coinsQ')).toBeTruthy();
});

test('help: the Bible topic shows the Bible, quiz and puzzle questions only', () => {
  const screen = render(<Help />);
  fireEvent.press(screen.getByTestId('help-topic-bible'));
  expect(screen.getByText('help.faq.versionQ')).toBeTruthy();
  expect(screen.getByText('help.faq.battleQ')).toBeTruthy();
  expect(screen.queryByText('help.faq.payQ')).toBeNull();
});
