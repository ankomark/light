/**
 * Single & Searching in the app: the door shows the right thing for where a
 * person is (switched off, not yet eligible, the welcome, a profile in
 * review, Discover), joining needs the rules agreed, creating sends the birth
 * date once, an answer can become a match with a way to begin, and the
 * reviewers approve with a refused photo.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() };
let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
let mockParams = {};
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useNavigation: () => mockNav,
    useRoute: () => ({ params: mockParams }),
    useFocusEffect: (fn) => R.useEffect(fn, [fn]),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({ MediaTypeOptions: { Images: 'Images' } }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => mockInsets };
});
jest.mock('../../utils/adminConfirm', () => ({
  notify: jest.fn(), confirmAction: jest.fn(async () => true),
}));
jest.mock('../../services/api', () => ({
  fetchSinglesMe: jest.fn(), fetchSinglesDiscover: jest.fn(), answerSingles: jest.fn(), fetchSinglesMatches: jest.fn(),
  createSinglesProfile: jest.fn(), updateSinglesProfile: jest.fn(), submitSinglesProfile: jest.fn(),
  pauseSinglesProfile: jest.fn(), leaveSingles: jest.fn(), addSinglesPhoto: jest.fn(), removeSinglesPhoto: jest.fn(),
  reportSingles: jest.fn(), blockSingles: jest.fn(), unmatchSingles: jest.fn(),
  fetchSinglesQueue: jest.fn(), fetchAdminByUrl: jest.fn(), reviewSinglesProfile: jest.fn(),
  banFromSingles: jest.fn(), unbanFromSingles: jest.fn(),
  fetchSinglesHub: jest.fn(), fetchSinglesLikes: jest.fn(), fetchConversations: jest.fn(async () => []),
  browseSingles: jest.fn(), fetchSinglesProfile: jest.fn(), saveSinglesAnswers: jest.fn(),
  fetchIcebreakers: jest.fn(async () => ({ results: [], keys: [] })), askIcebreaker: jest.fn(), answerIcebreaker: jest.fn(),
  tellSinglesStory: jest.fn(), agreeSinglesStory: jest.fn(), withdrawSinglesStory: jest.fn(),
  fetchSinglesTopics: jest.fn(), askSinglesTopic: jest.fn(), heartSinglesTopic: jest.fn(),
  fetchSinglesGatherings: jest.fn(), rsvpSinglesGathering: jest.fn(), suggestSinglesGathering: jest.fn(),
  fetchSinglesRooms: jest.fn(async () => ({ results: [] })), fetchBroadcastToken: jest.fn(), startSinglesRoom: jest.fn(),
  fetchSinglesStats: jest.fn(async () => ({ waiting: {} })), fetchSinglesReviewList: jest.fn(), decideSinglesItem: jest.fn(),
  fetchUnreadMessageCount: jest.fn(async () => ({ singles: 0 })), fetchSinglesChats: jest.fn(async () => ({ results: [] })),
  orderSinglesPhotos: jest.fn(async () => ({})),
}));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 1 } }) }));
jest.mock('../../components/RotatingBackground', () => () => null);
jest.mock('../../components/ScreenVignette', () => () => null);
let mockDM = null;
jest.mock('../../services/dmSocket', () => ({ subscribeDM: (fn) => { mockDM = fn; return () => {}; } }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light' }, NotificationFeedbackType: { Success: 'success' } }));
jest.mock('../../components/admin/AdminKit', () => ({
  ADMIN: { card: '#000', border: '#111', text: '#fff', muted: '#999', gold: '#fc6', onGold: '#000', danger: '#f00' },
  ErrorState: () => null,
  useReasonSheet: () => [null, jest.fn(async () => 'reason')],
}));

const api = require('../../services/api');
const SinglesHome = require('../singles/SinglesHome').default;
const SinglesEdit = require('../singles/SinglesEdit').default;
const AdminSingles = require('../../components/admin/AdminSingles').default;

const grace = {
  id: 7, first_name: 'Grace', age: 27, country: 'Kenya', town: 'Nairobi', church: 'Central', baptised: 'yes',
  looking_for: 'marriage', languages: ['English'], about: 'Nurse', prompts: [{ key: 'verse', answer: 'Isaiah 41:10' }],
  occupation: '', education: '', interests: [], photos: [{ id: 1, url: 'https://x/1.jpg' }],
};
const mine = (status, extra = {}) => ({
  id: 1, first_name: 'Mark', age: 29, country: 'Kenya', town: '', church: '', baptised: 'yes', looking_for: 'marriage',
  languages: [], about: 'Hi', prompts: [], occupation: '', education: '', interests: [], photos: [], status,
  review_note: '', is_paused: false, missing: [], ...extra,
});

const HUB = {
  first_name: 'Mark', paused: false, today: 12, left_today: 20, mode: 'foryou', likes: 2, matches: 1,
  preview: [{ id: 7, first_name: 'Grace', age: 27, town: 'Nairobi', looking_for: 'marriage', online: true,
    badges: { photo: true }, photo: null, reasons: [] }],
  topic: { id: 3, body: 'What matters most in marriage?', reply_count: 4 },
  gathering: null, live_rooms: 1, stories: 0,
};

beforeEach(async () => {
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  // Each test starts with nothing kept: no screen paints another test's copy.
  await require('../../utils/screenCache').clearAllCaches();
  jest.clearAllMocks();
  mockParams = {};
});

test('switched off, and not yet eligible, each say so', async () => {
  api.fetchSinglesMe.mockRejectedValueOnce({ data: { code: 'feature_off' } });
  let screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-off')).toBeTruthy());
  screen.unmount();
  api.fetchSinglesMe.mockResolvedValueOnce({ eligible: false, blockers: ['account_too_new'], ready_on: '2026-10-09', profile: null });
  screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByText('singles.blocker.account_too_new:2026-10-09')).toBeTruthy());
});

test('the welcome lets you create only once the rules are agreed', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: null });
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-welcome')).toBeTruthy());
  fireEvent.press(screen.getByTestId('singles-create'));
  expect(mockNav.navigate).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('singles-agree'));
  fireEvent.press(screen.getByTestId('singles-create'));
  expect(mockNav.navigate).toHaveBeenCalledWith('SinglesEdit', { create: true });
});

test('a profile in review shows where it stands, and missing parts when sent too soon', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('draft') });
  api.submitSinglesProfile.mockRejectedValueOnce({ data: { code: 'incomplete', missing: ['photo'] } });
  const { notify } = require('../../utils/adminConfirm');
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-status-draft')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('singles-submit')); });
  expect(notify).toHaveBeenCalledWith('singles.mine.missingTitle', '•  singles.missing.photo');
});

test('discover: interested can become a match with a way to begin, then the chat', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('approved') });
  api.fetchSinglesDiscover.mockResolvedValue({ results: [grace], left_today: 20 });
  api.answerSingles.mockResolvedValue({
    matched: true, left_today: 19,
    match: { id: 3, conversation_id: 44, profile: grace, user: { id: 9, username: 'grace' },
      opener: { kind: 'prompt', key: 'verse', answer: 'Isaiah 41:10' } },
  });
  api.fetchSinglesHub.mockResolvedValue(HUB);
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-hub')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('singles-tab-discover')); });
  await waitFor(() => expect(screen.getByTestId('singles-card-7')).toBeTruthy());
  expect(screen.getByText('singles.discover.left:20')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('singles-interested')); });
  expect(api.answerSingles).toHaveBeenCalledWith(7, 'interested');
  expect(screen.getByTestId('singles-match')).toBeTruthy();
  expect(screen.getByText('singles.opener.prompt:Grace,singles.prompt.verse,Isaiah 41:10')).toBeTruthy();
  fireEvent.press(screen.getByTestId('singles-hello'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Chat', { conversationId: 44, otherUser: { id: 9, username: 'grace' }, singles: true });
});

test('discover: "not now" moves on, and the day ends kindly', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('approved') });
  api.fetchSinglesDiscover.mockResolvedValueOnce({ results: [grace], left_today: 1 });
  api.answerSingles.mockResolvedValue({ matched: false, match: null, left_today: 0 });
  api.fetchSinglesHub.mockResolvedValue(HUB);
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-hub')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('singles-tab-discover')); });
  await waitFor(() => expect(screen.getByTestId('singles-card-7')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('singles-pass')); });
  expect(screen.getByText('singles.discover.doneTitle')).toBeTruthy();
});

test('creating sends the birth date once, as a date, with the rules agreed', async () => {
  mockParams = { create: true };
  api.createSinglesProfile.mockResolvedValue({});
  const screen = render(<SinglesEdit />);
  fireEvent.changeText(screen.getByTestId('singles-field-first_name'), 'Mark');
  fireEvent.changeText(screen.getByTestId('singles-birth-day'), '7');
  fireEvent.changeText(screen.getByTestId('singles-birth-month'), '3');
  fireEvent.changeText(screen.getByTestId('singles-birth-year'), '1997');
  fireEvent.press(screen.getByTestId('singles-gender-man'));
  fireEvent.changeText(screen.getByTestId('singles-field-country'), 'Kenya');
  fireEvent.press(screen.getByTestId('singles-baptised-yes'));
  fireEvent.press(screen.getByTestId('singles-prompt-verse'));
  fireEvent.changeText(screen.getByTestId('singles-answer-verse'), 'John 3:16');
  await act(async () => { fireEvent.press(screen.getByTestId('singles-save')); });
  expect(api.createSinglesProfile).toHaveBeenCalledWith(expect.objectContaining({
    agree_rules: true, gender: 'man', birth_date: '1997-03-07', first_name: 'Mark',
    prompts: [{ key: 'verse', answer: 'John 3:16' }],
  }));
  expect(mockNav.goBack).toHaveBeenCalled();
});

test('editing never sends birth date or gender', async () => {
  mockParams = { profile: mine('approved') };
  api.updateSinglesProfile.mockResolvedValue({});
  const screen = render(<SinglesEdit />);
  expect(screen.queryByTestId('singles-birth-day')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('singles-save')); });
  const sent = api.updateSinglesProfile.mock.calls[0][0];
  expect(sent.birth_date).toBeUndefined();
  expect(sent.gender).toBeUndefined();
});

test('reviewers approve with a refused photo', async () => {
  api.fetchSinglesQueue.mockResolvedValue({ results: [{
    id: 5, first_name: 'Ann', age: 30, gender: 'woman', town: '', country: 'Kenya', church: '', about: 'Hi', prompts: [],
    review_note: '', status: 'pending', user: { username: 'ann', joined: '2026-09-01', strikes: 0 },
    photos: [{ id: 11, url: 'https://x/a.jpg', status: 'pending' }, { id: 12, url: 'https://x/b.jpg', status: 'pending' }],
  }], next: null });
  api.reviewSinglesProfile.mockResolvedValue({ status: 'approved' });
  const screen = render(<AdminSingles />);
  await waitFor(() => expect(screen.getByTestId('singles-review-5')).toBeTruthy());
  fireEvent.press(screen.getAllByLabelText('adminSingles.togglePhoto')[1]);
  await act(async () => { fireEvent.press(screen.getByTestId('singles-approve-5')); });
  expect(api.reviewSinglesProfile).toHaveBeenCalledWith(5, 'approve', '', { 11: 'approve', 12: 'reject' });
  expect(screen.queryByTestId('singles-review-5')).toBeNull();
});

// ── The hub (phases 6-11) ───────────────────────────────────────────────────
test('the hub greets, counts today, and leads into the community and live rooms', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('approved') });
  api.fetchSinglesHub.mockResolvedValue(HUB);
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-hub')).toBeTruthy());
  expect(screen.getByText('singles.hub.today:12')).toBeTruthy();
  expect(screen.getByTestId('singles-grid-7')).toBeTruthy();
  fireEvent.press(screen.getByTestId('singles-grid-7'));
  expect(mockNav.navigate).toHaveBeenCalledWith('SinglesView', expect.objectContaining({ id: 7 }));
  fireEvent.press(screen.getByTestId('singles-hub-community'));
  expect(mockNav.navigate).toHaveBeenCalledWith('SinglesCommunity');
  fireEvent.press(screen.getByTestId('singles-hub-live'));
  expect(mockNav.navigate).toHaveBeenCalledWith('SinglesEvents', { tab: 'rooms' });
  await act(async () => { fireEvent.press(screen.getByTestId('singles-mode-online')); });
  expect(api.fetchSinglesHub).toHaveBeenLastCalledWith('online');
});

test('connections: who is interested in you', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('approved') });
  api.fetchSinglesHub.mockResolvedValue(HUB);
  api.fetchSinglesLikes.mockResolvedValue({ results: [{ ...HUB.preview[0], id: 9 }] });
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-hub')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('singles-tab-connections')); });
  await waitFor(() => expect(screen.getByTestId('singles-like-9')).toBeTruthy());
});

test('a suggested profile says why, and interest from it can become a match', async () => {
  mockParams = { id: 7 };
  const SinglesView = require('../singles/SinglesView').default;
  api.fetchSinglesProfile.mockResolvedValue({ ...grace, reasons: [{ kind: 'ministries', values: ['music'] }],
    badges: { photo: true } });
  api.answerSingles.mockResolvedValue({ matched: false, left_today: 19 });
  const screen = render(<SinglesView />);
  await waitFor(() => expect(screen.getByTestId('singles-why')).toBeTruthy());
  expect(screen.getByText('•  singles.reasonText.ministries:singles.ministry.music')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('singles-view-interested')); });
  expect(api.answerSingles).toHaveBeenCalledWith(7, 'interested');
  expect(mockNav.goBack).toHaveBeenCalled();
});

test('preferences and privacy save together, incognito included', async () => {
  mockParams = { profile: mine('approved', { show_age: true, discoverable: 'everyone', preferences: {} }) };
  const SinglesSettings = require('../singles/SinglesSettings').default;
  api.updateSinglesProfile.mockResolvedValue({});
  const screen = render(<SinglesSettings />);
  fireEvent.changeText(screen.getByTestId('singles-pref-min'), '25');
  fireEvent.changeText(screen.getByTestId('singles-pref-max'), '35');
  fireEvent(screen.getByTestId('singles-show_age'), 'valueChange', false);
  fireEvent.press(screen.getByTestId('singles-discoverable-liked'));
  await act(async () => { fireEvent.press(screen.getByTestId('singles-settings-save')); });
  expect(api.updateSinglesProfile).toHaveBeenCalledWith(expect.objectContaining({
    show_age: false, discoverable: 'liked', preferences: expect.objectContaining({ min_age: 25, max_age: 35 }) }));
});

test('values: answered and hidden or shown, each its own choice', async () => {
  mockParams = { profile: mine('approved', { answers: [] }) };
  const SinglesValues = require('../singles/SinglesValues').default;
  api.saveSinglesAnswers.mockResolvedValue({});
  const screen = render(<SinglesValues />);
  fireEvent.press(screen.getByTestId('singles-value-relocate-maybe'));
  await act(async () => { fireEvent.press(screen.getByTestId('singles-values-save')); });
  const sent = api.saveSinglesAnswers.mock.calls[0][0];
  expect(sent.find((a) => a.key === 'relocate')).toEqual({ key: 'relocate', answer: 'maybe', visible: true });
  expect(sent.find((a) => a.key === 'children').answer).toBe('');
});

test('a match: starters, and an icebreaker answered', async () => {
  mockParams = { match: { id: 3, conversation_id: 44, user: { id: 9 }, profile: grace, story: null,
    starters: [{ kind: 'prompt', key: 'verse', answer: 'Isaiah 41:10' }, { kind: 'meaningful' }] } };
  api.fetchIcebreakers.mockResolvedValue({ keys: ['gospel_song'], results: [
    { id: 5, key: 'country_visit', mine: null, theirs: null, waiting_for: 'you' }] });
  api.answerIcebreaker.mockResolvedValue({});
  const SinglesPerson = require('../singles/SinglesPerson').default;
  const screen = render(<SinglesPerson />);
  await waitFor(() => expect(screen.getByTestId('singles-ice-5')).toBeTruthy());
  expect(screen.getByTestId('singles-starter-1')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('singles-ice-input-5'), 'Japan');
  await act(async () => { fireEvent.press(screen.getByTestId('singles-ice-send-5')); });
  expect(api.answerIcebreaker).toHaveBeenCalledWith(5, 'Japan');
  await act(async () => { fireEvent.press(screen.getByTestId('singles-ice-ask-gospel_song')); });
  expect(api.askIcebreaker).toHaveBeenCalledWith(3, 'gospel_song');
});

test('community: ask a question', async () => {
  const SinglesCommunity = require('../singles/SinglesCommunity').default;
  api.fetchSinglesTopics.mockResolvedValue({ results: [] });
  api.askSinglesTopic.mockResolvedValue({ id: 8, body: 'What matters most?', author: { first_name: 'Mark' },
    reply_count: 0, heart_count: 0, hearted: false });
  const screen = render(<SinglesCommunity />);
  await waitFor(() => expect(screen.getByText('singles.community.empty')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('singles-ask-input'), 'What matters most in marriage?');
  api.fetchSinglesTopics.mockResolvedValue({ results: [{ id: 8, body: 'What matters most?', author: { first_name: 'Mark' },
    reply_count: 0, heart_count: 0, hearted: false }] });                  // the server has it now
  await act(async () => { fireEvent.press(screen.getByTestId('singles-ask')); });
  expect(api.askSinglesTopic).toHaveBeenCalledWith('What matters most in marriage?');
  await waitFor(() => expect(screen.getByTestId('singles-topic-8')).toBeTruthy());
});

test('events: interested, with the matches who are going', async () => {
  const SinglesEvents = require('../singles/SinglesEvents').default;
  const event = { id: 4, kind: 'coffee', title: 'Young Adults Connect', starts_at: '2030-01-04T16:00:00Z', place: 'Nairobi',
    country: '', status: 'approved', going: 3, interested: false, friends_going: ['Grace'] };
  api.fetchSinglesGatherings.mockResolvedValue({ results: [event] });
  api.rsvpSinglesGathering.mockResolvedValue({ ...event, going: 4, interested: true });
  const screen = render(<SinglesEvents />);
  await waitFor(() => expect(screen.getByTestId('singles-event-4')).toBeTruthy());
  expect(screen.getByText('singles.events.going:3  ·  singles.events.friends:Grace')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('singles-rsvp-4')); });
  expect(screen.getByText('singles.events.notGoing')).toBeTruthy();
});

test('reviewers see risk, and decide on events', async () => {
  api.fetchSinglesQueue.mockResolvedValue({ results: [{
    id: 5, first_name: 'Ann', age: 30, gender: 'woman', town: '', country: 'Kenya', church: '', about: '', prompts: [],
    review_note: '', status: 'pending', user: { username: 'ann', joined: '2026-09-01', strikes: 0 }, photos: [],
    risk: { level: 'high', score: 9, reasons: [{ kind: 'reports', n: 3 }] },
  }], next: null });
  api.fetchSinglesReviewList.mockResolvedValue({ results: [{ id: 2, kind: 'coffee', title: 'Coffee', starts_at: '2030-01-01T10:00:00Z',
    place: 'Nairobi', country: '', by: 'mark', description: '' }] });
  api.decideSinglesItem.mockResolvedValue({ id: 2, status: 'approved' });
  const screen = render(<AdminSingles />);
  await waitFor(() => expect(screen.getByTestId('singles-risk-5')).toBeTruthy());
  expect(screen.getByText('adminSingles.risk.high  ·  adminSingles.riskWhy.reports:3')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('singles-state-gatherings')); });
  await waitFor(() => expect(screen.getByTestId('singles-extra-2')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('singles-extra-approve-2')); });
  expect(api.decideSinglesItem).toHaveBeenCalledWith('gatherings', 2, 'approve', '');
});


// ── Phases 13-16 ────────────────────────────────────────────────────────────
test('a second visit paints at once from the last copy', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('approved') });
  api.fetchSinglesHub.mockResolvedValue(HUB);
  const first = render(<SinglesHome />);
  await waitFor(() => expect(first.getByTestId('singles-grid-7')).toBeTruthy());
  first.unmount();
  api.fetchSinglesHub.mockImplementation(() => new Promise(() => {}));      // the network hangs now
  api.fetchSinglesMe.mockImplementation(() => new Promise(() => {}));
  const again = render(<SinglesHome />);
  expect(again.getByTestId('singles-grid-7')).toBeTruthy();                   // no skeleton, no wait
});

test('unread in match chats shows on the Chats tab; a live match refreshes', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('approved') });
  api.fetchSinglesHub.mockResolvedValue(HUB);
  api.fetchUnreadMessageCount.mockResolvedValue({ singles: 2 });
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-unread')).toBeTruthy());
  const calls = api.fetchSinglesMe.mock.calls.length;
  await act(async () => { mockDM({ type: 'singles_match', match_id: 9 }); });
  expect(api.fetchSinglesMe.mock.calls.length).toBeGreaterThan(calls);
});

test('the chats tab asks the server for every match chat', async () => {
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('approved') });
  api.fetchSinglesHub.mockResolvedValue(HUB);
  api.fetchSinglesChats.mockResolvedValue({ results: [{ id: 31, singles: true, closed: true,
    other_participant: { id: 9, username: 'grace' }, last_message: null, unread_count: 0 }] });
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-hub')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('singles-tab-chats')); });
  await waitFor(() => expect(screen.getByTestId('singles-chatrow-31')).toBeTruthy());
  fireEvent.press(screen.getByTestId('singles-chatrow-31'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Chat', expect.objectContaining({ conversationId: 31, closed: true }));
});

test('an icebreaker answer arrives live', async () => {
  mockParams = { match: { id: 3, conversation_id: 44, user: { id: 9 }, profile: grace, story: null, starters: [] } };
  const SinglesPerson = require('../singles/SinglesPerson').default;
  render(<SinglesPerson />);
  await waitFor(() => expect(api.fetchIcebreakers).toHaveBeenCalledTimes(1));
  await act(async () => { mockDM({ type: 'singles_icebreaker', match_id: 3, icebreaker_id: 5 }); });
  expect(api.fetchIcebreakers).toHaveBeenCalledTimes(2);
  await act(async () => { mockDM({ type: 'singles_icebreaker', match_id: 99 }); });       // another match's
  expect(api.fetchIcebreakers).toHaveBeenCalledTimes(2);
});

test('any photo can become the main one', async () => {
  const MyProfilePane = require('../../components/singles/MyProfilePane').default;
  const onChange = jest.fn();
  const screen = render(<MyProfilePane profile={mine('approved', { photos: [
    { id: 1, url: 'https://x/1.jpg', status: 'approved' }, { id: 2, url: 'https://x/2.jpg', status: 'approved' }] })}
    onChange={onChange} />);
  await act(async () => { fireEvent.press(screen.getByTestId('singles-make-main-2')); });
  expect(api.orderSinglesPhotos).toHaveBeenCalledWith([2, 1]);
  expect(onChange).toHaveBeenCalled();
});


// ── Screens of every size ───────────────────────────────────────────────────
const RN = require('react-native');
const widths = (tree) => {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const w = RN.StyleSheet.flatten(n.props?.style || {})?.width;
    if (typeof w === 'number') out.push(w);
    walk(n.children);
  };
  walk(tree);
  return out;
};

test('the match moment fits two portraits on a small phone', () => {
  const { MatchMoment } = require('../singles/SinglesHome');
  const match = { id: 1, profile: grace, opener: { kind: 'general' } };
  jest.spyOn(RN, 'useWindowDimensions').mockReturnValue({ width: 320, height: 640, scale: 2, fontScale: 1 });
  const small = render(<MatchMoment match={match} onClose={() => {}} onHello={() => {}} />);
  expect(widths(small.toJSON())).toContain(108);
  small.unmount();
  RN.useWindowDimensions.mockReturnValue({ width: 414, height: 896, scale: 3, fontScale: 1 });
  const big = render(<MatchMoment match={match} onClose={() => {}} onHello={() => {}} />);
  expect(widths(big.toJSON())).toContain(118);
  RN.useWindowDimensions.mockRestore();
});

test('Interested and Not now clear the home indicator', async () => {
  mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
  api.fetchSinglesMe.mockResolvedValue({ eligible: true, blockers: [], profile: mine('approved') });
  api.fetchSinglesHub.mockResolvedValue(HUB);
  api.fetchSinglesDiscover.mockResolvedValue({ results: [grace], left_today: 20 });
  const screen = render(<SinglesHome />);
  await waitFor(() => expect(screen.getByTestId('singles-hub')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('singles-tab-discover')); });
  await waitFor(() => expect(screen.getByTestId('singles-interested')).toBeTruthy());
  let node = screen.getByTestId('singles-interested');
  while (node && RN.StyleSheet.flatten(node.props?.style || {})?.paddingBottom == null) node = node.parent;
  expect(RN.StyleSheet.flatten(node.props.style).paddingBottom).toBe(14 + 34);
});
