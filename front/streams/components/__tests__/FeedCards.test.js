/**
 * Feed cards: a product or service post drawn as the thing (opening the shop
 * or the listing), the verse of the day pinned to the top of the feed, and the
 * "also share to my feed" switch.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: (p) => <View testID="img" {...p} /> };
});
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));
const mockFetchVerse = jest.fn();
jest.mock('../../services/api', () => ({ fetchDailyVerse: (...a) => mockFetchVerse(...a) }));
jest.mock('../VerseShareSheet', () => {
  const { Text, View } = require('react-native');
  const Sheet = ({ visible }) => (visible ? <View testID="verse-share-sheet" /> : null);
  Sheet.VerseCard = ({ verse }) => <Text testID="verse-card">{verse.text}</Text>;
  return { __esModule: true, default: Sheet, VerseCard: Sheet.VerseCard };
});

const { default: ItemPostMedia, formatPrice } = require('../ItemPostMedia');
const { default: FeedVerseCard, _resetFeedVerse, markVersePassed } = require('../FeedVerseCard');
const AsyncStorageModule = require('@react-native-async-storage/async-storage');
const AsyncStorage = AsyncStorageModule.default || AsyncStorageModule;
const { default: ShareToFeedSwitch } = require('../ShareToFeedSwitch');

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
  mockNavigate.mockReset();
  mockFetchVerse.mockReset();
  _resetFeedVerse();
});
afterEach(() => jest.useRealTimers());

const productPost = {
  id: 7, content_type: 'product',
  product: { id: 3, slug: 'study-bible', title: 'Study Bible', price: '1500.00', currency: 'KES',
    image: 'https://m/1.jpg', location: 'Nairobi', description: 'Leather' },
};
const servicePost = {
  id: 8, content_type: 'service',
  service: { id: 5, name: 'Hope Clinic', location: 'Kisumu', rate: '', cover: 'https://m/c.jpg', is_verified: true },
};

test('a product card shows the price and opens the shop', () => {
  const screen = render(<ItemPostMedia item={productPost} width={360} />);
  expect(screen.getByText('Study Bible')).toBeTruthy();
  expect(screen.getByText('KES 1,500')).toBeTruthy();
  expect(screen.getByText('itemPost.viewProduct')).toBeTruthy();
  fireEvent.press(screen.getByTestId('product-post-7'));
  act(() => { jest.advanceTimersByTime(300); });
  expect(mockNavigate).toHaveBeenCalledWith('ProductDetail', expect.objectContaining({ slug: 'study-bible' }));
});

test('a service card opens the listing; double-tap likes instead', () => {
  const onLike = jest.fn();
  const screen = render(<ItemPostMedia item={servicePost} width={360} onDoubleTapLike={onLike} />);
  expect(screen.getByText('Hope Clinic')).toBeTruthy();
  expect(screen.getByText('Kisumu')).toBeTruthy();
  fireEvent.press(screen.getByTestId('service-post-8'));
  fireEvent.press(screen.getByTestId('service-post-8'));
  act(() => { jest.advanceTimersByTime(300); });
  expect(onLike).toHaveBeenCalledWith(servicePost);
  expect(mockNavigate).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('service-post-8'));
  act(() => { jest.advanceTimersByTime(300); });
  expect(mockNavigate).toHaveBeenCalledWith('ServiceDetail', { id: 5 });
});

test('prices read plainly', () => {
  expect(formatPrice('1500.00', 'KES')).toBe('KES 1,500');
  expect(formatPrice('12.50', 'USD')).toBe('USD 12.5');
  expect(formatPrice('x', 'KES')).toBe('');
});

test('the verse of the day sits at the top, fetched as the feed (not a visit)', async () => {
  jest.useRealTimers();
  mockFetchVerse.mockResolvedValue({ text: 'The Lord is my shepherd', reference: 'Psalm 23:1', date: '2026-10-10' });
  const screen = render(<FeedVerseCard width={390} />);
  await waitFor(() => expect(screen.getByTestId('verse-card')).toBeTruthy());
  expect(mockFetchVerse).toHaveBeenCalledWith(null, { via: 'feed' });
  fireEvent.press(screen.getByTestId('feed-verse-share'));
  expect(screen.getByTestId('verse-share-sheet')).toBeTruthy();
  fireEvent.press(screen.getByTestId('feed-verse-read'));
  expect(mockNavigate).toHaveBeenCalledWith('DailyVerse');
});

test('no verse, no card, and no error in the feed', async () => {
  jest.useRealTimers();
  mockFetchVerse.mockRejectedValue(new Error('offline'));
  const screen = render(<FeedVerseCard width={390} />);
  await waitFor(() => expect(mockFetchVerse).toHaveBeenCalled());
  expect(screen.queryByTestId('feed-verse')).toBeNull();
});

test('the share switch says what it does and can be turned off', () => {
  const onChange = jest.fn();
  const screen = render(<ShareToFeedSwitch value onValueChange={onChange} />);
  expect(screen.getByText('shareToFeed.label')).toBeTruthy();
  fireEvent(screen.getByTestId('share-to-feed'), 'valueChange', false);
  expect(onChange).toHaveBeenCalledWith(false);
});

test('passed today: the next launch starts without it; a new day brings it back', async () => {
  jest.useRealTimers();
  mockFetchVerse.mockResolvedValue({ text: 'Be still', reference: 'Psalm 46:10', date: '2026-10-10' });
  markVersePassed(7);
  await new Promise((r) => setTimeout(r, 0));
  const screen = render(<FeedVerseCard width={390} userId={7} />);
  await waitFor(() => expect(mockFetchVerse).not.toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByTestId('feed-verse')).toBeNull();

  // Someone else on the same phone hasn't seen it.
  const other = render(<FeedVerseCard width={390} userId={8} />);
  await waitFor(() => expect(other.getByTestId('feed-verse')).toBeTruthy());

  // Seen on an earlier day: shown again.
  await AsyncStorage.setItem('feedVerse:passed:7', '2000-01-01');
  _resetFeedVerse();
  const tomorrow = render(<FeedVerseCard width={390} userId={7} />);
  await waitFor(() => expect(tomorrow.getByTestId('feed-verse')).toBeTruthy());
});

test('it says where it ends, so scrolling past it can be noticed', async () => {
  jest.useRealTimers();
  mockFetchVerse.mockResolvedValue({ text: 'Be still', reference: 'Psalm 46:10', date: '2026-10-10' });
  const onBottom = jest.fn();
  const screen = render(<FeedVerseCard width={390} userId={3} onBottom={onBottom} />);
  await waitFor(() => expect(screen.getByTestId('feed-verse')).toBeTruthy());
  fireEvent(screen.getByTestId('feed-verse'), 'layout', { nativeEvent: { layout: { y: 120, height: 540 } } });
  expect(onBottom).toHaveBeenCalledWith(660);
});
