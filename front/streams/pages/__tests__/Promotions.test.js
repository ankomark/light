/**
 * Paid promotions on the phone: buying one (package, counties, M-Pesa, the
 * wait for the PIN), the list of mine, where promotions sit in the feed, and
 * the admins' review.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockApi = {
  fetchPromotionPackages: jest.fn(), createPromotion: jest.fn(), payPromotion: jest.fn(), fetchPromotion: jest.fn(),
  fetchMyPromotions: jest.fn(), cancelPromotion: jest.fn(),
  fetchAdminPromotions: jest.fn(), adminPromotionAction: jest.fn(),
  fetchAdminPromotionPackages: jest.fn(), updateAdminPromotionPackage: jest.fn(),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return { useFocusEffect: (fn) => React.useEffect(() => fn(), []), useNavigation: () => ({ navigate: jest.fn() }) };
});
jest.mock('../../utils/adminConfirm', () => ({ confirmAction: (_t, _b, ok) => ok(), notify: jest.fn() }));

const { default: Promote } = require('../Promote');
const { default: MyPromotions } = require('../MyPromotions');

const CATALOG = {
  packages: [
    { key: 'starter', name: 'Starter', price: 200, views: 1000, days: 3 },
    { key: 'standard', name: 'Standard', price: 500, views: 3000, days: 5 },
  ],
  counties: ['Kisumu', 'Nairobi'],
};
const promotion = (extra) => ({
  id: 9, kind: 'post', status: 'unpaid', price: 500, package: { key: 'standard', name: 'Standard' },
  counties: [], views: 0, views_target: 3000, clicks: 0, follows: 0, target: { caption: 'Choir night' }, ...extra,
});
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() });

beforeEach(() => Object.values(mockApi).forEach((f) => f.mockReset()));

test('buying: pick a package and counties, pay, wait for the PIN, then paid', async () => {
  mockApi.fetchPromotionPackages.mockResolvedValue(CATALOG);
  mockApi.createPromotion.mockResolvedValue(promotion());
  mockApi.payPromotion.mockResolvedValue(promotion({ status: 'paying' }));
  mockApi.fetchPromotion.mockResolvedValue(promotion({ status: 'review' }));
  const screen = render(<Promote navigation={nav()} route={{ params: { kind: 'post', targetId: 41, title: 'Choir' } }} />);
  await waitFor(() => expect(screen.getByTestId('promote-package-starter')).toBeTruthy());

  fireEvent.press(screen.getByTestId('promote-package-starter'));
  fireEvent.press(screen.getByTestId('promote-counties'));
  fireEvent.press(screen.getByTestId('promote-pay'));
  expect(screen.getByText('promote.phoneNeeded')).toBeTruthy();       // no number yet
  fireEvent.changeText(screen.getByTestId('promote-phone'), '0712345678');
  fireEvent.press(screen.getByTestId('promote-pay'));
  expect(screen.getByText('promote.countiesNeeded')).toBeTruthy();    // counties chosen, none picked
  fireEvent.press(screen.getByTestId('promote-county-Kisumu'));

  jest.useFakeTimers();
  await act(async () => { fireEvent.press(screen.getByTestId('promote-pay')); });
  expect(mockApi.createPromotion).toHaveBeenCalledWith({
    kind: 'post', target_id: 41, package: 'starter', counties: ['Kisumu'],
  });
  expect(mockApi.payPromotion).toHaveBeenCalledWith(9, '0712345678');
  expect(screen.getByTestId('promote-waiting')).toBeTruthy();

  await act(async () => { jest.advanceTimersByTime(3100); });
  jest.useRealTimers();
  await waitFor(() => expect(screen.getByTestId('promote-paid')).toBeTruthy());
});

test('no answer from M-Pesa: send again, and the waiting starts over', async () => {
  mockApi.fetchPromotionPackages.mockResolvedValue(CATALOG);
  mockApi.fetchPromotion.mockResolvedValue(promotion({ status: 'paying', payment_phone: '0712345678' }));
  mockApi.payPromotion.mockResolvedValue(promotion({ status: 'paying' }));
  jest.useFakeTimers();
  const screen = render(<Promote navigation={nav()} route={{ params: { promotionId: 9 } }} />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { jest.advanceTimersByTime(156000); });
  expect(screen.getByTestId('promote-timed-out')).toBeTruthy();
  // Sent again with the number it was paid from (the form isn't on screen).
  await act(async () => { fireEvent.press(screen.getByTestId('promote-retry')); });
  expect(mockApi.payPromotion).toHaveBeenCalledWith(9, '0712345678');
  expect(screen.getByTestId('promote-waiting')).toBeTruthy();
  // ...and it is watched again: M-Pesa answers, the screen moves on.
  mockApi.fetchPromotion.mockResolvedValue(promotion({ status: 'review' }));
  await act(async () => { jest.advanceTimersByTime(3100); });
  jest.useRealTimers();
  await waitFor(() => expect(screen.getByTestId('promote-paid')).toBeTruthy());
});

test('a refused payment says why and stays payable', async () => {
  mockApi.fetchPromotionPackages.mockResolvedValue(CATALOG);
  mockApi.createPromotion.mockResolvedValue(promotion());
  mockApi.payPromotion.mockRejectedValue({ response: { data: { error: 'Payments are not available right now.' } } });
  const screen = render(<Promote navigation={nav()} route={{ params: { kind: 'profile' } }} />);
  await waitFor(() => expect(screen.getByTestId('promote-pay')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('promote-phone'), '0712345678');
  await act(async () => { fireEvent.press(screen.getByTestId('promote-pay')); });
  expect(screen.getByText('Payments are not available right now.')).toBeTruthy();
  expect(screen.getByTestId('promote-pay')).toBeTruthy();
});

test('mine: progress for a running one, pay or cancel an unpaid one', async () => {
  mockApi.fetchMyPromotions.mockResolvedValue([
    promotion({ id: 1, status: 'active', views: 1200, clicks: 40 }),
    promotion({ id: 2, status: 'unpaid' }),
    promotion({ id: 3, status: 'rejected', review_note: 'Blurry', refund_due: true, refund_owed: 500 }),
  ]);
  mockApi.cancelPromotion.mockResolvedValue({});
  const n = nav();
  const screen = render(<MyPromotions navigation={n} />);
  await waitFor(() => expect(screen.getByTestId('promotion-1')).toBeTruthy());
  expect(screen.getByText('promote.viewsOf:1,200,3,000')).toBeTruthy();
  expect(screen.getByText('promote.refundOwed:500')).toBeTruthy();
  fireEvent.press(screen.getByTestId('promotion-pay-2'));
  expect(n.navigate).toHaveBeenCalledWith('Promote', { promotionId: 2 });
  await act(async () => { fireEvent.press(screen.getByTestId('promotion-cancel-2')); });
  expect(mockApi.cancelPromotion).toHaveBeenCalledWith(2);
});

describe('in the feed', () => {
  const { withSponsored } = require('../../utils/sponsored');
  const posts = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, user: { id: 1, username: 'a' } }));

  test('after the 3rd and the 14th post, a promoted post replacing its own copy', () => {
    const out = withSponsored(posts, [
      { promotion_id: 5, kind: 'post', post: { id: 10, user: { id: 2, username: 'b' } } },
      { promotion_id: 6, kind: 'product', product: { slug: 'x' } },
    ]);
    expect(out[3]).toMatchObject({ id: 10, sponsored: { promotion_id: 5 } });
    expect(out[14]).toMatchObject({ id: 'sp-6' });
    expect(out.filter((p) => p.id === 10)).toHaveLength(1);
    expect(out).toHaveLength(21);   // 20 posts - the copy + 2 promotions
  });

  test('a short feed never loses a promoted post', () => {
    const few = posts.slice(0, 2);
    const out = withSponsored(few, [{ promotion_id: 5, kind: 'post', post: { id: 2, user: { id: 2 } } }]);
    expect(out.map((p) => p.id)).toEqual([1, 2]);
  });

  test('nothing to draw, nothing placed', () => {
    expect(withSponsored(posts, [{ promotion_id: 7, kind: 'post', post: null }])).toBe(posts);
  });

  test('none, or too few posts: as it was', () => {
    expect(withSponsored(posts, [])).toBe(posts);
    expect(withSponsored(posts.slice(0, 2), [{ promotion_id: 1, kind: 'profile', profile: {} }])).toHaveLength(2);
  });
});
