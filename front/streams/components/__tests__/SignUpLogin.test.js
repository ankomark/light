/**
 * Sign-up and sign-in: what people are told when something is wrong (in
 * their language, never a server address or "Server error (500)"), and where
 * they go when it works.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockNav = { navigate: jest.fn(), reset: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav }));
const mockLogin = jest.fn();
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ login: mockLogin }) }));
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000' }) }),
}));
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: (k) => k }) }));
jest.mock('../tickets/KeyboardLift', () => {
  const { View } = require('react-native');
  return ({ children }) => <View>{children}</View>;
});
const mockPost = jest.fn();
jest.mock('axios', () => ({ post: (...a) => mockPost(...a) }));
jest.mock('../../services/api', () => ({ API_URL: 'https://api.test/api' }));

const SignUpPage = require('../SignUpPage').default;
const LoginPage = require('../LoginPage').default;

beforeEach(() => { mockPost.mockReset(); mockLogin.mockReset(); Object.values(mockNav).forEach((f) => f.mockReset()); });

const fillSignUp = (screen, { username = 'mary.w', email = 'mary@x.com', password = 'Zx9kLmq2-play' } = {}) => {
  fireEvent.changeText(screen.getByPlaceholderText('auth.chooseUsername'), username);
  fireEvent.changeText(screen.getByPlaceholderText('auth.emailPlaceholder'), email);
  fireEvent.changeText(screen.getByPlaceholderText('auth.createPassword'), password);
};
const submitSignUp = (screen) => act(async () => { const all = screen.getAllByText('auth.createTitle'); fireEvent.press(all[all.length - 1]); });

describe('Sign-up', () => {
  test('a username that would break links is caught before sending', async () => {
    const screen = render(<SignUpPage />);
    fillSignUp(screen, { username: 'me@home' });
    await submitSignUp(screen);
    expect(screen.getByText('auth.usernameRule')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('no network: a plain message, no server address', async () => {
    mockPost.mockRejectedValue(new Error('Network Error'));
    const screen = render(<SignUpPage />);
    fillSignUp(screen);
    await submitSignUp(screen);
    expect(screen.getByText('auth.cantReach')).toBeTruthy();
  });

  test('the server failing: a plain message, not "Server error (500)"', async () => {
    mockPost.mockRejectedValue({ response: { status: 500, data: '<html>oops</html>' } });
    const screen = render(<SignUpPage />);
    fillSignUp(screen);
    await submitSignUp(screen);
    expect(screen.getByText('auth.serverDown')).toBeTruthy();
  });

  test('created and verified: on to making a profile', async () => {
    mockPost.mockResolvedValue({ data: {} });
    mockLogin.mockResolvedValue({ isVerified: false, hasProfile: false });
    const screen = render(<SignUpPage />);
    fillSignUp(screen);
    await submitSignUp(screen);
    expect(mockLogin).toHaveBeenCalledWith('mary.w', 'Zx9kLmq2-play');
    expect(mockNav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'EmailVerification', params: { email: 'mary@x.com' } }] });
  });
});

describe('Sign-in', () => {
  const signIn = async (screen) => {
    fireEvent.changeText(screen.getByPlaceholderText('auth.usernamePlaceholder'), 'mary.w');
    fireEvent.changeText(screen.getByPlaceholderText('auth.passwordPlaceholder'), 'pw-12345678');
    await act(async () => { fireEvent.press(screen.getAllByText('auth.login')[0]); });
  };

  test('a wrong password says so', async () => {
    mockLogin.mockRejectedValue({ response: { status: 401, data: { detail: 'No active account found' } } });
    const screen = render(<LoginPage />);
    await signIn(screen);
    expect(screen.getByText('auth.invalidCredentials')).toBeTruthy();
  });

  test('the server failing is not called a wrong password', async () => {
    mockLogin.mockRejectedValue({ response: { status: 502, data: {} } });
    const screen = render(<LoginPage />);
    await signIn(screen);
    expect(screen.getByText('auth.serverDown')).toBeTruthy();
  });

  test('no network: a plain message', async () => {
    mockLogin.mockRejectedValue(new Error('Network Error'));
    const screen = render(<LoginPage />);
    await signIn(screen);
    expect(screen.getByText('auth.cantReach')).toBeTruthy();
  });

  test('signed in with a profile: home', async () => {
    mockLogin.mockResolvedValue({ isVerified: true, hasProfile: true });
    const screen = render(<LoginPage />);
    await signIn(screen);
    expect(mockNav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Home' }] });
  });
});
