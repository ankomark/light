import axios from 'axios';

jest.mock('expo-device', () => ({ deviceName: 'Pixel 8', modelName: 'Pixel 8', manufacturer: 'Google' }));

// eslint-disable-next-line import/first
import { deviceName } from '../deviceHeaders';

test('a phone named only by its model is named by make and model', () => {
  expect(deviceName()).toBe('Google Pixel 8');
});

test('every request carries which phone it is', () => {
  expect(axios.defaults.headers.common['X-Device-Name']).toBe('Google Pixel 8');
  expect(axios.defaults.headers.common['X-Device-Platform']).toBeTruthy();
});
