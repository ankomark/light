/**
 * Adding a product: the category is chosen from the marketplace's list (no
 * typing), the chosen one is what goes up, nothing goes up without one, and
 * an old typed category in a draft is not kept.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { writeCache, dropCache } from '../../../utils/screenCache';

jest.setTimeout(20000);

global.FormData = class {
  constructor() { this._parts = []; }
  append(key, value) { this._parts.push([key, value]); }
};

const mockApi = {
  createProduct: jest.fn(async () => ({})), fetchSellerProfile: jest.fn(async () => null),
  saveSellerProfile: jest.fn(async () => ({})), fetchProductCategories: jest.fn(async () => []),
};
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 2, username: 'ivy' } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav }));
jest.mock('react-native-vector-icons/FontAwesome', () => () => null);
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///big.jpg', width: 4000 }] })),
  MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: jest.fn(async () => ({ size: 1 })) }));
jest.mock('../../../services/imageProcessing', () => ({
  compressImage: jest.fn(async () => ({ uri: 'file:///small.jpg' })),
}));

const AddProduct = require('../AddProduct').default;
const DRAFT = 'u2:market:draft:add';

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockNav.goBack.mockClear();
  dropCache(DRAFT);
});

const fill = async (screen) => {
  await act(async () => { fireEvent.press(screen.getByTestId('add-photo')); });
  fireEvent.changeText(screen.getByTestId('add-title'), 'Study Bible');
  fireEvent.changeText(screen.getByTestId('add-description'), 'Leather cover');
  fireEvent.changeText(screen.getByTestId('add-price'), '1500');
};
const sent = (key) => mockApi.createProduct.mock.calls[0][0]._parts.find(([k]) => k === key)?.[1];

test('the category is picked from the list, and the picked one goes up', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<AddProduct />);
  await fill(screen);
  // Every category is there to tap; nothing to type. (This t has no
  // translations, so each shows its own name.)
  expect(screen.getByTestId('category-Phones & Tablets')).toHaveTextContent('Phones & Tablets');
  expect(screen.queryByPlaceholderText('market.form.category')).toBeNull();
  fireEvent.press(screen.getByTestId('category-Books & Bibles'));
  expect(screen.getByTestId('category-Books & Bibles').props.accessibilityState).toEqual({ selected: true });
  fireEvent.press(screen.getByTestId('add-condition-USED'));
  await act(async () => { fireEvent.press(screen.getByTestId('add-submit')); });
  expect(sent('category')).toBe('Books & Bibles');
  expect(sent('condition')).toBe('USED');
  alert.mockRestore();
});

test('nothing goes up without a category', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<AddProduct />);
  await fill(screen);
  await act(async () => { fireEvent.press(screen.getByTestId('add-submit')); });
  expect(mockApi.createProduct).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('common.error', 'market.form.needCategory');
  alert.mockRestore();
});

test('a category typed in an old draft is not kept: one is chosen from the list', async () => {
  writeCache(DRAFT, { formData: { title: 'Kept', category: 'sneakers for men' } });
  const screen = render(<AddProduct />);
  await waitFor(() => expect(screen.getByDisplayValue('Kept')).toBeTruthy());
  const chips = screen.getAllByRole('radio').filter((c) => c.props.testID?.startsWith('category-'));
  expect(chips.length).toBeGreaterThan(10);
  expect(chips.every((c) => !c.props.accessibilityState?.selected)).toBe(true);
});
