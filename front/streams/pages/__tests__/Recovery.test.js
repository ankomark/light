import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockApi = { reportNotMe: jest.fn(), requestAccountRecovery: jest.fn() };
jest.mock('../../services/api', () => ({
  reportNotMe: (...a) => mockApi.reportNotMe(...a),
  requestAccountRecovery: (...a) => mockApi.requestAccountRecovery(...a),
}));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
});
jest.mock('../../components/tickets/KeyboardLift', () => {
  const { View } = require('react-native');
  return ({ children }) => <View>{children}</View>;
});

const SecurityCheck = require('../SecurityCheck').default;
const RecoveryRequest = require('../RecoveryRequest').default;

beforeEach(() => { Object.values(mockApi).forEach((f) => f.mockReset()); });

const nav = () => ({ goBack: jest.fn(), replace: jest.fn(), navigate: jest.fn() });

test('"It wasn\'t me" secures the account and goes to a new password', async () => {
  mockApi.reportNotMe.mockResolvedValue({ revoked: 2 });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((title, body, buttons) => buttons?.[0]?.onPress?.());
  const navigation = nav();
  const screen = render(<SecurityCheck navigation={navigation} route={{ params: { device: 'Pixel 8' } }} />);
  expect(screen.getByText(/Pixel 8/)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('security-not-me')); });
  expect(mockApi.reportNotMe).toHaveBeenCalled();
  expect(navigation.replace).toHaveBeenCalledWith('Settings', { openPassword: true });
  alert.mockRestore();
});

test('"It was me" just closes', () => {
  const navigation = nav();
  const screen = render(<SecurityCheck navigation={navigation} route={{ params: {} }} />);
  fireEvent.press(screen.getByTestId('security-me'));
  expect(navigation.goBack).toHaveBeenCalled();
  expect(mockApi.reportNotMe).not.toHaveBeenCalled();
});

test('a recovery request needs enough to go on, then is sent', async () => {
  mockApi.requestAccountRecovery.mockResolvedValue({});
  const screen = render(<RecoveryRequest navigation={nav()} route={{ params: { account: 'mark' } }} />);
  fireEvent.changeText(screen.getByTestId('recovery-contact'), 'me@new.com');
  fireEvent.changeText(screen.getByTestId('recovery-details'), 'help');
  expect(screen.getByTestId('recovery-send').props.accessibilityState?.disabled).toBe(true);
  fireEvent.changeText(screen.getByTestId('recovery-details'), 'Someone changed my password and email last night.');
  await act(async () => { fireEvent.press(screen.getByTestId('recovery-send')); });
  expect(mockApi.requestAccountRecovery).toHaveBeenCalledWith('mark', 'me@new.com',
    'Someone changed my password and email last night.');
  expect(screen.getByTestId('recovery-sent')).toBeTruthy();
});
