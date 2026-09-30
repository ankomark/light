/**
 * Editing a product: a new photo really goes up (the picker's result.assets,
 * shrunk first), removing one of two photos still saves, and the server's
 * field errors are shown.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

// A FormData that keeps what is appended, so the upload can be read back.
global.FormData = class {
  constructor() { this._parts = []; }
  append(key, value) { this._parts.push([key, value]); }
};

const mockApi = {
  fetchProductById: jest.fn(), fetchProductCategories: jest.fn(async () => []), updateProduct: jest.fn(),
};
jest.mock('../../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 2, username: 'aseller' } }) }));
const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav, useRoute: () => ({ params: { slug: 'hymnal' } }),
}));
jest.mock('react-native-vector-icons/FontAwesome', () => () => null);
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false, assets: [{ uri: 'file:///big.jpg', width: 4000 }],
  })),
  MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('../../../services/imageProcessing', () => ({
  compressImage: jest.fn(async () => ({ uri: 'file:///small.jpg' })),
}));

const EditProduct = require('../EditProduct').default;

const product = {
  id: 1, slug: 'hymnal', title: 'Hymnal', description: 'd', price: '10.00', quantity: 3,
  condition: 'NEW', category: 'Books', seller: { id: 2 },
  images: [{ id: 11, image_url: 'https://x/1.jpg' }, { id: 12, image_url: 'https://x/2.jpg' }],
};

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockClear());
  mockApi.fetchProductById.mockResolvedValue(product);
  mockApi.updateProduct.mockResolvedValue({});
});

const formData = () => mockApi.updateProduct.mock.calls[0][1];
const parts = (fd, name) => (fd._parts || []).filter(([k]) => k === name).map(([, v]) => v);

test('a new photo goes up, shrunk, and removing one of two still saves', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<EditProduct />);
  await waitFor(() => expect(screen.getByDisplayValue('Hymnal')).toBeTruthy(), { timeout: 8000 });
  fireEvent.press(screen.getByTestId('edit-remove-11'));
  const { compressImage } = require('../../../services/imageProcessing');
  fireEvent.press(screen.getByTestId('edit-add-photo'));
  await waitFor(() => expect(compressImage).toHaveBeenCalledWith('file:///big.jpg', expect.objectContaining({ maxWidth: 1280 })));
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  await act(async () => { fireEvent.press(screen.getByTestId('edit-save')); });
  expect(alert).not.toHaveBeenCalledWith('common.error', 'market.form.needKeepImage');
  const fd = formData();
  expect(parts(fd, 'images')).toEqual([{ uri: 'file:///small.jpg', name: 'product_image_0.jpg', type: 'image/jpeg' }]);
  expect(parts(fd, 'remove_images')).toEqual([11]);
  alert.mockRestore();
});

test('removing one of two photos (and adding none) still saves', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<EditProduct />);
  await waitFor(() => expect(screen.getByDisplayValue('Hymnal')).toBeTruthy(), { timeout: 8000 });
  fireEvent.press(screen.getByTestId('edit-remove-11'));
  await act(async () => { fireEvent.press(screen.getByTestId('edit-save')); });
  expect(mockApi.updateProduct).toHaveBeenCalled();
  alert.mockRestore();
});

test("the server's field errors are shown", async () => {
  mockApi.updateProduct.mockRejectedValue({ response: { data: { price: ['Ensure this value is greater than or equal to 0.'] } } });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<EditProduct />);
  await waitFor(() => expect(screen.getByDisplayValue('Hymnal')).toBeTruthy(), { timeout: 8000 });
  await act(async () => { fireEvent.press(screen.getByTestId('edit-save')); });
  expect(alert).toHaveBeenCalledWith('common.error', 'Ensure this value is greater than or equal to 0.');
  alert.mockRestore();
});
