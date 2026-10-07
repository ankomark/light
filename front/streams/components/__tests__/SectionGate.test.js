import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SectionGate from '../SectionGate';
import { sectionOfRoute, SECTION_KEYS } from '../../utils/appSections';

let mockRoute = 'NoticeBoard';
let mockStatus = { features: {}, messages: {} };
let mockUser = { id: 1, username: 'member' };
const mockNav = { canGoBack: jest.fn(() => true), goBack: jest.fn(), navigate: jest.fn() };

jest.mock('../../services/navigationRef', () => ({
  navigationRef: {
    canGoBack: (...a) => mockNav.canGoBack(...a),
    goBack: (...a) => mockNav.goBack(...a),
    navigate: (...a) => mockNav.navigate(...a),
  },
  useCurrentRouteName: () => mockRoute,
}));
jest.mock('../../context/AppStatusContext', () => ({ useAppStatus: () => mockStatus }));
jest.mock('../../context/useAuth', () => ({ useOptionalAuth: () => ({ currentUser: mockUser }) }));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));

beforeEach(() => {
  mockRoute = 'NoticeBoard';
  mockStatus = { features: {}, messages: {} };
  mockUser = { id: 1, username: 'member' };
  Object.values(mockNav).forEach((f) => f.mockClear());
});

test('screens find their section; account screens have none', () => {
  expect(sectionOfRoute('GroupDetail')).toBe('groups');
  expect(sectionOfRoute('HymnDetail')).toBe('hymns');
  expect(sectionOfRoute('Settings')).toBeNull();
  expect(sectionOfRoute('AdminDashboard')).toBeNull();
  expect(SECTION_KEYS).toEqual(expect.arrayContaining(['marketplace', 'quiz', 'puzzle', 'live', 'singles']));
});

test('a part switched on is left alone', () => {
  const screen = render(<SectionGate />);
  expect(screen.queryByTestId('section-off')).toBeNull();
});

test('a part switched off is covered, with the admins’ message and a way back', () => {
  mockStatus = { features: { notices: false }, messages: { notices: 'Back on Sunday.' } };
  const screen = render(<SectionGate />);
  expect(screen.getByTestId('section-off')).toBeTruthy();
  expect(screen.getByText('Back on Sunday.')).toBeTruthy();
  fireEvent.press(screen.getByTestId('section-off-back'));
  expect(mockNav.goBack).toHaveBeenCalled();
});

test('with nothing to go back to, it goes home', () => {
  mockStatus = { features: { notices: false }, messages: {} };
  mockNav.canGoBack.mockReturnValueOnce(false);
  const screen = render(<SectionGate />);
  expect(screen.getByText('sections.offBody')).toBeTruthy();
  fireEvent.press(screen.getByTestId('section-off-back'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Home');
});

test('an admin carries on, with a note that members see it closed', () => {
  mockStatus = { features: { notices: false }, messages: {} };
  mockUser = { id: 2, username: 'boss', admin_role: 'super_admin' };
  const screen = render(<SectionGate />);
  expect(screen.queryByTestId('section-off')).toBeNull();
  expect(screen.getByTestId('section-off-admin')).toBeTruthy();
});
