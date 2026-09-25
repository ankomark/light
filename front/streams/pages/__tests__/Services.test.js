import React from 'react';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.setTimeout(20000);

const mockApi = {
  fetchServicesPage: jest.fn(),
  fetchServicesByUrl: jest.fn(),
  deleteVideoStudio: jest.fn(),
  createVideoStudio: jest.fn(),
  updateVideoStudio: jest.fn(),
  fetchServicesHome: jest.fn(),
  fetchVideoStudioById: jest.fn(),
  getOrCreateConversation: jest.fn(),
  fetchServiceReviews: jest.fn(),
  saveServiceReview: jest.fn(),
  deleteMyServiceReview: jest.fn(),
  replyToServiceReview: jest.fn(),
  deleteServiceReply: jest.fn(),
  fetchServiceVerification: jest.fn(),
  requestServiceVerification: jest.fn(),
  fetchOrganizations: jest.fn(),
  saveService: jest.fn(),
  recordServiceEvent: jest.fn(),
  fetchServiceInsights: jest.fn(),
  requestServiceBooking: jest.fn(),
  fetchServiceBookings: jest.fn(),
  respondServiceBooking: jest.fn(),
  cancelServiceBooking: jest.fn(),
  serviceShareUrl: jest.fn((id) => `https://app.test/service/${id}/`),
};
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
let mockAuth = { isAuthenticated: true, currentUser: { id: 1, username: 'me' } };
jest.mock('../../context/useAuth', () => ({ useAuth: () => mockAuth }));
jest.mock('../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));
const mockConfirm = jest.fn();
const mockNotify = jest.fn();
jest.mock('../../utils/adminConfirm', () => ({
  confirmAction: (...a) => mockConfirm(...a),
  notify: (...a) => mockNotify(...a),
}));
let mockFocus = [];
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => { R.useEffect(() => { mockFocus.push(cb); return cb(); }, [cb]); } };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null }));
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: (p) => <View testID={p.testID} /> };
});
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: ({ children }) => <View>{children}</View> };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }) };
});
jest.mock('react-native-keyboard-aware-scroll-view', () => {
  const { ScrollView } = require('react-native');
  return { KeyboardAwareScrollView: ScrollView };
});
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file://pic.jpg' }] })),
  MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('../../services/imageProcessing', () => ({ compressImage: jest.fn(async (uri) => ({ uri })) }));
jest.mock('../../services/cloudinary', () => ({ uploadMedia: jest.fn(async () => ({ url: 'https://r2.test/cover/x.jpg' })) }));
let mockLocation = { status: 'granted', coords: { latitude: -1.2921, longitude: 36.8219 } };
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: mockLocation.status })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: mockLocation.coords })),
  Accuracy: { Balanced: 3 },
}));
const mockPlaces = jest.fn(async () => []);
jest.mock('../../services/weather', () => ({ searchPlaces: (...a) => mockPlaces(...a) }));
jest.mock('../../components/ReportModal', () => {
  const { View } = require('react-native');
  return (p) => (p.visible ? <View testID={`report-${p.contentType}-${p.objectId}`} /> : null);
});

const { clearAllCaches } = require('../../utils/screenCache');
const catalog = require('../../services/servicesCatalog');
const Studios = require('../Studios').default;
const ServiceForm = require('../ServiceForm').default;

const nav = () => {
  const listeners = {};
  return {
    navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn(),
    addListener: jest.fn((ev, fn) => { listeners[ev] = fn; return () => { delete listeners[ev]; }; }),
    fire: (ev, e) => listeners[ev]?.(e),
  };
};
const svc = (id, extra = {}) => ({
  id, name: `Service ${id}`, location: 'Nairobi', category: 'home', service_types: ['plumbing'],
  is_owner: false, is_verified: false, ...extra,
});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const noReviews = (extra = {}) => ({
  summary: { count: 0, average: null, spread: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }, mine: null, can_review: true,
  is_owner: false, results: [], next: null, ...extra,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearAllCaches();
  catalog.__resetServicesCatalog();
  require('../../services/serviceLocation').__resetServiceLocation();
  mockLocation = { status: 'granted', coords: { latitude: -1.2921, longitude: 36.8219 } };
  mockPlaces.mockReset();
  mockPlaces.mockResolvedValue([]);
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.serviceShareUrl.mockImplementation((id) => `https://app.test/service/${id}/`);
  mockApi.fetchServicesHome.mockResolvedValue({ counts: {}, featured: [], verified: [], new: [] });
  mockApi.fetchServiceReviews.mockResolvedValue(noReviews());
  mockApi.fetchOrganizations.mockResolvedValue({ results: [] });
  mockApi.recordServiceEvent.mockResolvedValue({ counted: true });
  mockAuth = { isAuthenticated: true, currentUser: { id: 1, username: 'me' } };
  mockConfirm.mockReset();
  mockNotify.mockReset();
  mockFocus = [];
});

describe('Services list', () => {
  test('placeholders first, one request; opened again: there at once; offline: kept, and said', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(1), svc(2)], next: null });
    const first = render(<Studios navigation={nav()} />);
    await waitFor(() => expect(first.getByTestId('service-2')).toBeTruthy());
    expect(mockApi.fetchServicesPage).toHaveBeenCalledTimes(1);
    expect(mockApi.fetchServicesPage).toHaveBeenCalledWith({});
    first.unmount();

    mockApi.fetchServicesPage.mockRejectedValue(new Error('offline'));
    const again = render(<Studios navigation={nav()} />);
    expect(again.getByTestId('service-1')).toBeTruthy();                   // the first frame
    await waitFor(() => expect(again.getByTestId('services-offline')).toBeTruthy());
    expect(again.getByTestId('service-1')).toBeTruthy();
  });

  test('offline with nothing kept: a message and Retry', async () => {
    mockApi.fetchServicesPage.mockRejectedValueOnce(new Error('offline'));
    const r = render(<Studios navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('services-failed')).toBeTruthy());
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(3)], next: null });
    await act(async () => { fireEvent.press(r.getByTestId('services-retry')); });
    expect(r.getByTestId('service-3')).toBeTruthy();
  });

  test('search runs on the server, services by name too', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(1)], next: null });
    const r = render(<Studios navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('service-1')).toBeTruthy());
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(9, { name: 'Hope Plumbers' })], next: null });
    fireEvent.changeText(r.getByTestId('services-search'), 'plumb');
    await waitFor(() => expect(r.getByTestId('service-9')).toBeTruthy());
    expect(mockApi.fetchServicesPage).toHaveBeenLastCalledWith({ search: 'plumb', tags: 'plumbing' });
    expect(r.queryByTestId('service-1')).toBeNull();
  });

  test('a category, and more as you scroll', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(1)], next: 'http://x/api/video-studios/?page=2&category=health' });
    mockApi.fetchServicesByUrl.mockResolvedValue({ results: [svc(2), svc(1)], next: null });
    const r = render(<Studios navigation={nav()} />);
    await act(async () => { fireEvent.press(r.getByTestId('services-cat-health')); });
    await waitFor(() => expect(r.getByTestId('service-1')).toBeTruthy());
    expect(mockApi.fetchServicesPage).toHaveBeenLastCalledWith({ category: 'health' });
    await act(async () => { r.UNSAFE_getByType(require('react-native').FlatList).props.onEndReached(); });
    expect(mockApi.fetchServicesByUrl).toHaveBeenCalledWith('http://x/api/video-studios/?page=2&category=health');
    expect(r.getByTestId('service-2')).toBeTruthy();
  });

  test('owners edit and delete (asked first, on the web too); others report', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(1, { is_owner: true }), svc(2)], next: null });
    const n = nav();
    const r = render(<Studios navigation={n} />);
    await waitFor(() => expect(r.getByTestId('service-1')).toBeTruthy());
    fireEvent.press(r.getByTestId('service-more-1'));
    fireEvent.press(r.getByTestId('service-edit-1'));
    expect(n.navigate).toHaveBeenCalledWith('ServiceForm', { service: expect.objectContaining({ id: 1 }) });

    mockConfirm.mockResolvedValueOnce(false);
    fireEvent.press(r.getByTestId('service-more-1'));
    await act(async () => { fireEvent.press(r.getByTestId('service-delete-1')); });
    expect(mockApi.deleteVideoStudio).not.toHaveBeenCalled();
    mockConfirm.mockResolvedValueOnce(true);
    mockApi.deleteVideoStudio.mockResolvedValue({});
    fireEvent.press(r.getByTestId('service-more-1'));
    await act(async () => { fireEvent.press(r.getByTestId('service-delete-1')); });
    expect(mockApi.deleteVideoStudio).toHaveBeenCalledWith(1);
    expect(r.queryByTestId('service-1')).toBeNull();

    fireEvent.press(r.getByTestId('service-more-2'));
    expect(r.queryByTestId('service-edit-2')).toBeNull();
    fireEvent.press(r.getByTestId('service-report-2'));
    expect(r.getByTestId('report-videostudio-2')).toBeTruthy();
  });

  test('list a service: signed in, the form in the category browsed; guests sign in', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [], next: null });
    const n = nav();
    const r = render(<Studios navigation={n} />);
    await act(async () => { fireEvent.press(r.getByTestId('services-cat-health')); });
    fireEvent.press(r.getByTestId('services-create'));
    expect(n.navigate).toHaveBeenCalledWith('ServiceForm', { category: 'health' });
    mockAuth = { isAuthenticated: false, currentUser: null };
    const g = nav();
    const guest = render(<Studios navigation={g} />);
    fireEvent.press(guest.getByTestId('services-create'));
    expect(g.navigate).toHaveBeenCalledWith('Login');
  });

  test('back from the form: the saved listing shows at once', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(1)], next: null });
    const r = render(<Studios navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('service-1')).toBeTruthy());
    mockApi.fetchServicesPage.mockImplementation(() => new Promise(() => {}));   // slow
    await new Promise((res) => setTimeout(res, 5));
    catalog.noteServicesChanged({ item: svc(7, { name: 'Brand new', is_owner: true }), created: true });
    await act(async () => { mockFocus[mockFocus.length - 1](); });
    expect(r.getByTestId('service-7')).toBeTruthy();
  });
});

describe('Service form', () => {
  test('needs a name, a place and a service', async () => {
    const r = render(<ServiceForm route={{ params: {} }} navigation={nav()} />);
    await act(async () => { fireEvent.press(r.getByTestId('service-save')); });
    expect(mockNotify).toHaveBeenCalledWith('dir.missingInfo', 'studios.missingInfo');
    expect(mockApi.createVideoStudio).not.toHaveBeenCalled();
  });

  test('saves, links made real addresses, and the list is told', async () => {
    mockApi.createVideoStudio.mockResolvedValue(svc(5, { name: 'Hope Plumbers' }));
    const n = nav();
    const r = render(<ServiceForm route={{ params: { category: 'home' } }} navigation={n} />);
    fireEvent.changeText(r.getByTestId('service-name'), 'Hope Plumbers');
    fireEvent.changeText(r.getByTestId('service-location'), 'Kisumu');
    fireEvent.press(r.getByTestId('service-tag-plumbing'));
    fireEvent.changeText(r.getByPlaceholderText('services.link.instagram'), 'instagram.com/hope');
    await act(async () => { fireEvent.press(r.getByTestId('service-logo')); });
    await act(async () => { fireEvent.press(r.getByTestId('service-save')); });
    expect(mockApi.createVideoStudio).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Hope Plumbers', location: 'Kisumu', category: 'home', service_types: ['plumbing'],
      instagram_link: 'https://instagram.com/hope', logo: 'https://r2.test/cover/x.jpg', currency: 'KES',
    }));
    expect(n.goBack).toHaveBeenCalled();
    expect(catalog.servicesChangedSince(0).item.id).toBe(5);
  });

  test('a new category drops the tags that aren\'t in it', async () => {
    const r = render(<ServiceForm route={{ params: { category: 'home' } }} navigation={nav()} />);
    fireEvent.press(r.getByTestId('service-tag-plumbing'));
    fireEvent.press(r.getByTestId('service-cat-health'));
    expect(r.queryByTestId('service-tag-plumbing')).toBeNull();
    expect(r.getByTestId('service-tag-clinic').props.accessibilityState).toEqual({ checked: false });
  });

  test('leaving with changes asks first; untouched, it just leaves', async () => {
    const n = nav();
    const r = render(<ServiceForm route={{ params: { service: svc(4, { is_owner: true }) } }} navigation={n} />);
    const e = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    n.fire('beforeRemove', e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    fireEvent.changeText(r.getByTestId('service-name'), 'Renamed');
    mockConfirm.mockResolvedValueOnce(true);
    const e2 = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    await act(async () => { n.fire('beforeRemove', e2); });
    expect(e2.preventDefault).toHaveBeenCalled();
    expect(n.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  });
});

// ── Phase 2: the service page, the home, the look ───────────────────────────
describe('Phase 2', () => {
  const RN = require('react-native');
  const ServiceDetail = require('../ServiceDetail').default;
  const { tidyTime } = require('../ServiceForm');
  const { openState, openLabel } = catalog;
  const tt = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
  const at = (day, hh, mm = 0) => { const d = new Date(2026, 8, 21 + day, hh, mm); return d; };   // 21 Sep 2026 is a Monday
  const hours = { mon: ['08:00', '17:00'], tue: ['08:00', '17:00'], sat: ['09:00', '13:00'] };

  test('open now or not, and when it opens next', () => {
    expect(openState({})).toEqual({ state: 'unknown' });
    expect(openLabel(openState(hours, at(0, 10)), tt)).toBe('services.openUntil:17:00');
    expect(openLabel(openState(hours, at(0, 7)), tt)).toBe('services.opensAt:08:00');
    expect(openLabel(openState(hours, at(0, 18)), tt)).toBe('services.opensTomorrow:08:00');
    expect(openLabel(openState(hours, at(1, 18)), tt)).toBe('services.opensOn:services.day.sat,09:00');
    expect(openLabel(openState(hours, at(5, 13)), tt)).toBe('services.opensOn:services.day.mon,08:00');   // 13:00 is closing time
    expect(tidyTime('8')).toBe('08:00');
    expect(tidyTime('830')).toBe('08:30');
    expect(tidyTime('17.30')).toBe('17:30');
  });

  test('a card opens its page, carrying what the page needs to draw at once', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(1)], next: null });
    const n = nav();
    const r = render(<Studios navigation={n} />);
    await waitFor(() => expect(r.getByTestId('service-1')).toBeTruthy());
    fireEvent.press(r.getByTestId('service-1'));
    expect(n.navigate).toHaveBeenCalledWith('ServiceDetail', { id: 1, preview: expect.objectContaining({ name: 'Service 1' }) });
  });

  test('the home: categories with counts, featured to open; a tile picks the category', async () => {
    mockApi.fetchServicesHome.mockResolvedValue({ counts: { health: 4 }, featured: [svc(8, { name: 'Picked' })], verified: [], new: [] });
    mockApi.fetchServicesPage.mockResolvedValue({ results: [], next: null });
    const n = nav();
    const r = render(<Studios navigation={n} />);
    await waitFor(() => expect(r.getByTestId('services-featured')).toBeTruthy());
    expect(r.getByText('services.countN:4')).toBeTruthy();
    expect(r.queryByTestId('services-verified')).toBeNull();               // an empty row isn't drawn
    fireEvent.press(r.getByTestId('service-tile-8'));
    expect(n.navigate).toHaveBeenCalledWith('ServiceDetail', expect.objectContaining({ id: 8 }));
    await act(async () => { fireEvent.press(r.getByTestId('services-tile-health')); });
    expect(mockApi.fetchServicesPage).toHaveBeenLastCalledWith({ category: 'health' });
    expect(r.queryByTestId('services-home')).toBeNull();                   // the home is for "all"
  });

  test('the page: at once from the row, then the gallery and the week\'s hours', async () => {
    let answer;
    mockApi.fetchVideoStudioById.mockImplementation(() => new Promise((res) => { answer = res; }));
    const r = render(<ServiceDetail route={{ params: { id: 5, preview: svc(5, { name: 'Hope Clinic' }) } }} navigation={nav()} />);
    expect(r.getByText('Hope Clinic')).toBeTruthy();                       // the first frame
    expect(r.queryByTestId('service-gallery')).toBeNull();
    await waitFor(() => expect(mockApi.fetchVideoStudioById).toHaveBeenCalledWith(5));
    await act(async () => { answer(svc(5, { name: 'Hope Clinic', gallery: ['https://r2.test/a.jpg'], opening_hours: hours })); });
    expect(r.getByTestId('service-gallery')).toBeTruthy();
    expect(r.getByTestId('service-hours')).toBeTruthy();
    expect(r.getByText('services.day.sat')).toBeTruthy();
    fireEvent.press(r.getByTestId('service-photo-0'));
    expect(r.getByTestId('service-photo-close')).toBeTruthy();
  });

  test('reaching them: directions, a message in the app, share', async () => {
    const openURL = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue(true);
    const share = jest.spyOn(RN.Share, 'share').mockResolvedValue({});
    const s = svc(5, { name: 'Hope Clinic', location: 'Kisumu, Kenya', contact_phone: '+254700', created_by: { id: 9, username: 'dr' } });
    mockApi.fetchVideoStudioById.mockResolvedValue(s);
    mockApi.getOrCreateConversation.mockResolvedValue({ id: 44, other_participant: { id: 9 } });
    const n = nav();
    const r = render(<ServiceDetail route={{ params: { id: 5, preview: s } }} navigation={n} />);
    await flush();
    fireEvent.press(r.getByTestId('service-directions'));
    expect(openURL).toHaveBeenCalledWith('https://www.google.com/maps/search/?api=1&query=Kisumu%2C%20Kenya');
    fireEvent.press(r.getByTestId('service-action-call'));
    expect(openURL).toHaveBeenLastCalledWith('tel:+254700');
    await act(async () => { fireEvent.press(r.getByTestId('service-action-message')); });
    expect(mockApi.getOrCreateConversation).toHaveBeenCalledWith(9);
    expect(n.navigate).toHaveBeenCalledWith('Chat', { conversationId: 44, otherUser: { id: 9 }, draft: 'services.messageDraft:Hope Clinic' });
    fireEvent.press(r.getByTestId('service-action-share'));
    expect(share.mock.calls[0][0].message).toContain('https://app.test/service/5/');
    openURL.mockRestore(); share.mockRestore();
  });

  test('its owner sees it as everyone does, with Edit — and no Message to themselves', async () => {
    const s = svc(5, { is_owner: true, created_by: { id: 1, username: 'me' } });
    mockApi.fetchVideoStudioById.mockResolvedValue(s);
    const n = nav();
    const r = render(<ServiceDetail route={{ params: { id: 5, preview: s } }} navigation={n} />);
    await flush();
    expect(r.getByTestId('service-owner-bar')).toBeTruthy();
    expect(r.queryByTestId('service-action-message')).toBeNull();
    fireEvent.press(r.getByTestId('service-page-edit'));
    expect(n.navigate).toHaveBeenCalledWith('ServiceForm', { service: expect.objectContaining({ id: 5 }) });
  });

  test('a shared link with no signal and nothing kept: say so, and Retry', async () => {
    mockApi.fetchVideoStudioById.mockRejectedValueOnce(new Error('offline'));
    const r = render(<ServiceDetail route={{ params: { id: '5' } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('service-retry')).toBeTruthy());
    mockApi.fetchVideoStudioById.mockResolvedValue(svc(5, { name: 'Back again' }));
    await act(async () => { fireEvent.press(r.getByTestId('service-retry')); });
    expect(r.getByText('Back again')).toBeTruthy();
    expect(mockApi.fetchVideoStudioById).toHaveBeenLastCalledWith(5);      // the link's id, as a number
  });

  test('the form: photos of the work and the week\'s hours', async () => {
    mockApi.createVideoStudio.mockResolvedValue(svc(6));
    const r = render(<ServiceForm route={{ params: { category: 'home' } }} navigation={nav()} />);
    fireEvent.changeText(r.getByTestId('service-name'), 'Hope Plumbers');
    fireEvent.changeText(r.getByTestId('service-location'), 'Kisumu');
    fireEvent.press(r.getByTestId('service-tag-plumbing'));
    await act(async () => { fireEvent.press(r.getByTestId('service-gallery-add')); });
    await act(async () => { fireEvent.press(r.getByTestId('service-gallery-add')); });
    fireEvent.press(r.getByTestId('service-gallery-remove-1'));
    fireEvent.press(r.getByTestId('service-day-toggle-mon'));
    fireEvent.changeText(r.getByTestId('service-day-mon-close'), '18:30');
    fireEvent.press(r.getByTestId('service-hours-copy'));
    fireEvent.press(r.getByTestId('service-day-toggle-sat'));
    fireEvent.changeText(r.getByTestId('service-day-sat-open'), '14:00');
    fireEvent.changeText(r.getByTestId('service-day-sat-close'), '12:00');   // closes before it opens
    await act(async () => { fireEvent.press(r.getByTestId('service-save')); });
    expect(mockNotify).toHaveBeenCalledWith('services.hours', 'services.hoursInvalid:services.day.sat');
    expect(mockApi.createVideoStudio).not.toHaveBeenCalled();
    fireEvent.press(r.getByTestId('service-day-toggle-sat'));               // not open Saturdays after all
    await act(async () => { fireEvent.press(r.getByTestId('service-save')); });
    const body = mockApi.createVideoStudio.mock.calls[0][0];
    expect(body.gallery).toEqual(['https://r2.test/cover/x.jpg']);
    expect(body.opening_hours).toEqual({
      mon: ['08:00', '18:30'], tue: ['08:00', '18:30'], wed: ['08:00', '18:30'], thu: ['08:00', '18:30'], fri: ['08:00', '18:30'],
    });
  });
});

// ── Phase 3: trust ──────────────────────────────────────────────────────────
describe('Phase 3', () => {
  const ServiceDetail = require('../ServiceDetail').default;
  const ServiceVerification = require('../ServiceVerification').default;
  const review = (id, extra = {}) => ({ id, user: { id: 20 + id, username: `u${id}` }, rating: 4, body: `Review ${id}`,
    reply: '', updated_at: '2026-09-20T10:00:00Z', ...extra });
  const page = (extra = {}) => svc(5, { name: 'Hope Clinic', created_by: { id: 9, username: 'dr' }, ...extra });
  const open = async (s, n = nav()) => {
    mockApi.fetchVideoStudioById.mockResolvedValue(s);
    const r = render(<ServiceDetail route={{ params: { id: s.id, preview: s } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('service-reviews')).toBeTruthy());
    return r;
  };

  test('the stars, who runs it, and how long they\'ve been here', async () => {
    const n = nav();
    const r = await open(page({ rating_avg: 4.5, rating_count: 12, member_since: 2024,
      organization: { slug: 'kmh', name: 'Kisumu Mission Hospital', is_verified: true } }), n);
    expect(r.getByText('4.5 · reviews.count:12')).toBeTruthy();
    expect(r.getByText('services.runBy:Kisumu Mission Hospital')).toBeTruthy();
    expect(r.getByText('services.listedBy:dr · services.memberSince:2024')).toBeTruthy();
    fireEvent.press(r.getByTestId('service-org'));
    expect(n.navigate).toHaveBeenCalledWith('OrganizationPage', { slug: 'kmh', name: 'Kisumu Mission Hospital' });
  });

  test('rate a service; it shows as yours', async () => {
    mockApi.saveServiceReview.mockResolvedValue(review(1));
    const r = await open(page());
    fireEvent.press(r.getByTestId('service-review-write'));
    fireEvent.press(r.getByTestId('service-star-4'));
    fireEvent.changeText(r.getByTestId('service-review-input'), 'Kind nurses ');
    mockApi.fetchServiceReviews.mockResolvedValue(noReviews({
      summary: { count: 1, average: 4, spread: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 } }, mine: review(1, { body: 'Kind nurses', is_mine: true }),
    }));
    await act(async () => { fireEvent.press(r.getByTestId('service-review-save')); });
    expect(mockApi.saveServiceReview).toHaveBeenCalledWith(5, { rating: 4, body: 'Kind nurses' });
    await waitFor(() => expect(r.getByTestId('service-review-mine')).toBeTruthy());
    expect(r.queryByTestId('service-review-write')).toBeNull();
  });

  test('guests are asked to sign in to rate; others\' reviews can be reported', async () => {
    mockAuth = { isAuthenticated: false, currentUser: null };
    const n = nav();
    mockApi.fetchServiceReviews.mockResolvedValue(noReviews({ can_review: false, results: [review(2)] }));
    const r = await open(page(), n);
    await waitFor(() => expect(r.getByTestId('service-review-2')).toBeTruthy());
    fireEvent.press(r.getByTestId('service-review-write'));
    expect(n.navigate).toHaveBeenCalledWith('Login');
    expect(r.queryByTestId('service-review-report-2')).toBeNull();          // guests don't report
    mockAuth = { isAuthenticated: true, currentUser: { id: 1, username: 'me' } };
    const signedIn = await open(page());
    await waitFor(() => expect(signedIn.getByTestId('service-review-report-2')).toBeTruthy());
    fireEvent.press(signedIn.getByTestId('service-review-report-2'));
    expect(signedIn.getByTestId('report-servicereview-2')).toBeTruthy();
  });

  test('the owner answers reviews in public, can\'t rate their own, and can get verified', async () => {
    mockApi.fetchServiceReviews.mockResolvedValue(noReviews({ is_owner: true, can_review: false, results: [review(3, { rating: 2, body: 'Slow' })] }));
    mockApi.replyToServiceReview.mockResolvedValue(review(3, { rating: 2, body: 'Slow', reply: 'We have more staff now.' }));
    const n = nav();
    const r = await open(page({ is_owner: true, is_verified: false }), n);
    await waitFor(() => expect(r.getByTestId('service-review-reply-3')).toBeTruthy());
    expect(r.queryByTestId('service-review-write')).toBeNull();
    fireEvent.press(r.getByTestId('service-review-reply-3'));
    fireEvent.changeText(r.getByTestId('service-review-input'), 'We have more staff now.');
    await act(async () => { fireEvent.press(r.getByTestId('service-review-save')); });
    expect(mockApi.replyToServiceReview).toHaveBeenCalledWith(5, 3, 'We have more staff now.');
    expect(r.getByText('We have more staff now.')).toBeTruthy();
    expect(r.getByText('services.replyFrom:Hope Clinic')).toBeTruthy();
    fireEvent.press(r.getByTestId('service-get-verified'));
    expect(n.navigate).toHaveBeenCalledWith('ServiceVerification', { id: 5, name: 'Hope Clinic' });
  });

  test('asking for the tick: the papers, then waiting; refused says why and may ask again', async () => {
    mockApi.fetchServiceVerification.mockResolvedValue({ status: null });
    mockApi.requestServiceVerification.mockResolvedValue({ status: 'pending' });
    const r = render(<ServiceVerification route={{ params: { id: 5, name: 'Hope Clinic' } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('verify-form')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('verify-send')); });
    expect(mockNotify).toHaveBeenCalledWith('verify.title', 'verify.missing');
    fireEvent.changeText(r.getByTestId('verify-legal'), 'Hope Clinic Ltd');
    await act(async () => { fireEvent.press(r.getByTestId('verify-add-doc')); });
    await act(async () => { fireEvent.press(r.getByTestId('verify-send')); });
    expect(mockApi.requestServiceVerification).toHaveBeenCalledWith(5, expect.objectContaining({
      legal_name: 'Hope Clinic Ltd', documents: ['https://r2.test/cover/x.jpg'] }));
    expect(r.getByTestId('verify-pending')).toBeTruthy();
    expect(r.queryByTestId('verify-form')).toBeNull();

    mockApi.fetchServiceVerification.mockResolvedValue({ status: 'rejected', decision_note: 'The photo is unreadable.' });
    await clearAllCaches();
    const again = render(<ServiceVerification route={{ params: { id: 6 } }} navigation={nav()} />);
    await waitFor(() => expect(again.getByTestId('verify-rejected')).toBeTruthy());
    expect(again.getByText('The photo is unreadable.')).toBeTruthy();
    expect(again.getByTestId('verify-form')).toBeTruthy();
  });

  test('the form: listed under an organisation you belong to', async () => {
    mockApi.fetchOrganizations.mockResolvedValue({ results: [{ slug: 'kmh', name: 'Kisumu Mission Hospital' }] });
    mockApi.createVideoStudio.mockResolvedValue(svc(6));
    const r = render(<ServiceForm route={{ params: { category: 'health' } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('service-org-kmh')).toBeTruthy());
    fireEvent.press(r.getByTestId('service-org-kmh'));
    fireEvent.changeText(r.getByTestId('service-name'), 'Mission Clinic');
    fireEvent.changeText(r.getByTestId('service-location'), 'Kisumu');
    fireEvent.press(r.getByTestId('service-tag-clinic'));
    await act(async () => { fireEvent.press(r.getByTestId('service-save')); });
    expect(mockApi.createVideoStudio).toHaveBeenCalledWith(expect.objectContaining({ organization_slug: 'kmh' }));
  });

  test('cards carry the stars', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(1, { rating_avg: 4.8, rating_count: 20 }), svc(2)], next: null });
    const r = render(<Studios navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('service-stars-1')).toBeTruthy());
    expect(r.getByText('4.8 (20)')).toBeTruthy();
    expect(r.queryByTestId('service-stars-2')).toBeNull();
  });
});

// ── Phases 4 and 5: finding the right one; bookings and the provider's side ─
describe('Phases 4 and 5', () => {
  const ServiceDetail = require('../ServiceDetail').default;
  const ServiceBookings = require('../ServiceBookings').default;
  const ServiceInsights = require('../ServiceInsights').default;
  const { respondsLabel } = require('../ServiceDetail');
  const { nextDays } = require('../../components/services/BookingSheet');
  const { filterParams, openAtNow } = require('../../components/services/ServiceFilters');
  const tt = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
  const booking = (id, extra = {}) => ({
    id, service: 5, service_info: { id: 5, name: 'Hope Plumbers', logo: '' }, customer: { id: 2, username: 'ann' },
    kind: 'booking', date: '2026-10-02', time: '10:00', note: 'Kitchen sink', status: 'pending', reply_note: '', ...extra,
  });

  test('what the filters ask the server for', () => {
    expect(openAtNow(new Date(2026, 8, 21, 9, 5))).toBe('mon,09:05');
    expect(filterParams({ sort: 'near', openNow: false, verified: true, minRating: 4, minPrice: '', maxPrice: '5000', saved: true },
      { lat: -1.29211, lng: 36.82194 })).toEqual({ near: '-1.2921,36.8219', sort: 'near', verified: 1, min_rating: 4, max_price: '5000', saved: 1 });
    expect(filterParams({ sort: 'near' }, null)).toEqual({});                // nearest needs a place
    expect(respondsLabel(0.5, tt)).toBe('services.respondsHour');
    expect(respondsLabel(5.2, tt)).toBe('services.respondsHours:6');
    expect(respondsLabel(30, tt)).toBe('services.respondsDay');
  });

  test('near me: the phone\'s location, nearest first, distance on the card, remembered', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(1, { distance_km: 265.4 })], next: null });
    const r = render(<Studios navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('service-1')).toBeTruthy());
    fireEvent.press(r.getByTestId('services-near'));
    await waitFor(() => expect(r.getByTestId('place-sheet')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('place-mine')); });
    await waitFor(() => expect(mockApi.fetchServicesPage).toHaveBeenLastCalledWith({ near: '-1.2921,36.8219', sort: 'near' }));
    expect(r.getByText('Nairobi · 265 km')).toBeTruthy();
    expect(r.queryByTestId('services-home')).toBeNull();
    expect(JSON.parse(await AsyncStorage.getItem('services:near:v1'))).toMatchObject({ lat: -1.2921, mine: true });
  });

  test('location off: say so, and a town found by name will do', async () => {
    mockLocation.status = 'denied';
    mockPlaces.mockResolvedValue([{ name: 'Kisumu', region: 'Kisumu', country: 'Kenya', latitude: -0.0917, longitude: 34.768 }]);
    mockApi.fetchServicesPage.mockResolvedValue({ results: [], next: null });
    const r = render(<Studios navigation={nav()} />);
    fireEvent.press(r.getByTestId('services-near'));
    await act(async () => { fireEvent.press(r.getByTestId('place-mine')); });
    expect(r.getByText('places.denied')).toBeTruthy();
    fireEvent.changeText(r.getByTestId('place-search'), 'Kisu');
    await waitFor(() => expect(r.getByTestId('place-0')).toBeTruthy());
    expect(r.getByText('Kisumu, Kenya')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('place-0')); });
    await waitFor(() => expect(mockApi.fetchServicesPage).toHaveBeenLastCalledWith({ near: '-0.0917,34.7680', sort: 'near' }));
  });

  test('filters: open now, a rating; the chip shows how many', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [], next: null });
    const r = render(<Studios navigation={nav()} />);
    fireEvent.press(r.getByTestId('services-filters'));
    fireEvent.press(r.getByTestId('filters-open'));
    fireEvent.press(r.getByTestId('filters-rating-4'));
    await act(async () => { fireEvent.press(r.getByTestId('filters-apply')); });
    const params = mockApi.fetchServicesPage.mock.calls.at(-1)[0];
    expect(params).toMatchObject({ min_rating: 4 });
    expect(params.open_at).toMatch(/^(mon|tue|wed|thu|fri|sat|sun),\d\d:\d\d$/);
    expect(r.getByText('services.filters.withCount:2')).toBeTruthy();
  });

  test('keep a service: the heart on the card and on its page', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(1)], next: null });
    mockApi.saveService.mockResolvedValue({ is_saved: true });
    const r = render(<Studios navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('service-save-1')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('service-save-1')); });
    expect(mockApi.saveService).toHaveBeenCalledWith(1, true);
    expect(r.getByTestId('service-save-1').props.accessibilityState).toEqual({ selected: true });

    mockApi.fetchVideoStudioById.mockResolvedValue(svc(5, { is_saved: true }));
    const page = render(<ServiceDetail route={{ params: { id: 5, preview: svc(5, { is_saved: true }) } }} navigation={nav()} />);
    await act(async () => { fireEvent.press(page.getByTestId('service-page-save')); });
    expect(mockApi.saveService).toHaveBeenLastCalledWith(5, false);
  });

  test('the page counts a view and how they reached them (for the owner, never who)', async () => {
    const openURL = jest.spyOn(require('react-native').Linking, 'openURL').mockResolvedValue(true);
    const s = svc(5, { contact_phone: '+254700', responds_in_hours: 3 });
    mockApi.fetchVideoStudioById.mockResolvedValue(s);
    const r = render(<ServiceDetail route={{ params: { id: 5, preview: s } }} navigation={nav()} />);
    await flush();
    expect(mockApi.recordServiceEvent).toHaveBeenCalledWith(5, 'view');
    fireEvent.press(r.getByTestId('service-action-call'));
    await flush();
    expect(mockApi.recordServiceEvent).toHaveBeenLastCalledWith(5, 'call');
    expect(r.getByText('services.respondsHours:3')).toBeTruthy();
    openURL.mockRestore();
  });

  test('book a day and a time; a quote needs what for', async () => {
    mockApi.requestServiceBooking.mockResolvedValue(booking(1));
    const s = svc(5, { name: 'Hope Plumbers' });
    mockApi.fetchVideoStudioById.mockResolvedValue(s);
    const r = render(<ServiceDetail route={{ params: { id: 5, preview: s } }} navigation={nav()} />);
    fireEvent.press(r.getByTestId('service-book'));
    expect(r.getByTestId('booking-sheet')).toBeTruthy();
    expect(r.getByTestId('booking-send').props.accessibilityState?.disabled ?? true).toBeTruthy();   // no day yet
    const tomorrow = nextDays()[1].iso;
    fireEvent.press(r.getByTestId(`booking-day-${tomorrow}`));
    fireEvent.press(r.getByTestId('booking-time-12:00'));
    fireEvent.changeText(r.getByTestId('booking-note'), 'Kitchen sink ');
    await act(async () => { fireEvent.press(r.getByTestId('booking-send')); });
    expect(mockApi.requestServiceBooking).toHaveBeenCalledWith(5, { kind: 'booking', date: tomorrow, time: '12:00', note: 'Kitchen sink' });
    expect(mockNotify).toHaveBeenCalledWith('bookings.sentTitle', 'bookings.sentBody:Hope Plumbers');

    fireEvent.press(r.getByTestId('service-quote'));
    fireEvent.changeText(r.getByTestId('booking-note'), 'Rewire a house');
    await act(async () => { fireEvent.press(r.getByTestId('booking-send')); });
    expect(mockApi.requestServiceBooking).toHaveBeenLastCalledWith(5, { kind: 'quote', date: null, time: '', note: 'Rewire a house' });
  });

  test('requests: mine to cancel; asked of me to accept with a word', async () => {
    mockApi.fetchServiceBookings.mockImplementation(async (role) => ({
      results: role === 'incoming' ? [booking(2, { is_provider: true })] : [booking(1)], next: null,
    }));
    mockApi.cancelServiceBooking.mockResolvedValue(booking(1, { status: 'cancelled' }));
    mockApi.respondServiceBooking.mockResolvedValue(booking(2, { status: 'accepted', reply_note: 'Bring the parts' }));
    const n = nav();
    const r = render(<ServiceBookings route={{ params: {} }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('booking-1')).toBeTruthy());
    mockConfirm.mockResolvedValueOnce(true);
    await act(async () => { fireEvent.press(r.getByTestId('booking-cancel-1')); });
    expect(mockApi.cancelServiceBooking).toHaveBeenCalledWith(1);
    expect(r.getByText('bookings.status.cancelled')).toBeTruthy();
    expect(r.queryByTestId('booking-cancel-1')).toBeNull();

    await act(async () => { fireEvent.press(r.getByTestId('bookings-tab-incoming')); });
    await waitFor(() => expect(r.getByTestId('booking-2')).toBeTruthy());
    expect(r.getByText('ann → Hope Plumbers')).toBeTruthy();
    fireEvent.press(r.getByTestId('booking-accept-2'));
    fireEvent.changeText(r.getByTestId('booking-answer-note'), 'Bring the parts');
    await act(async () => { fireEvent.press(r.getByTestId('booking-answer-send')); });
    expect(mockApi.respondServiceBooking).toHaveBeenCalledWith(2, true, 'Bring the parts');
    expect(r.getByText('bookings.status.accepted')).toBeTruthy();
    expect(r.getByText('Bring the parts')).toBeTruthy();
  });

  test('insights: views, getting in touch, requests waiting', async () => {
    mockApi.fetchServiceInsights.mockImplementation(async (id, days) => ({
      days, totals: { view: 120, call: 8, whatsapp: 12, message: 3, directions: 5, share: 2 }, requests: 6, accepted: 4, waiting: 2,
      responds_in_hours: 2, daily: Array.from({ length: days }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, readers: i })),
    }));
    const n = nav();
    const r = render(<ServiceInsights route={{ params: { id: 5, name: 'Hope Plumbers' } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('service-insights')).toBeTruthy());
    expect(r.getByText('120')).toBeTruthy();
    expect(r.getByText('30')).toBeTruthy();                                   // calls + WhatsApp + … got in touch
    expect(r.getByText('insights.waiting:2')).toBeTruthy();
    fireEvent.press(r.getByTestId('insights-waiting'));
    expect(n.navigate).toHaveBeenCalledWith('ServiceBookings', { role: 'incoming' });
    await act(async () => { fireEvent.press(r.getByTestId('range-7')); });
    await waitFor(() => expect(mockApi.fetchServiceInsights).toHaveBeenLastCalledWith(5, 7));
  });

  test('the form pins the service on the map', async () => {
    mockPlaces.mockResolvedValue([{ name: 'Kisumu', region: 'Kisumu', country: 'Kenya', latitude: -0.091702, longitude: 34.768 }]);
    mockApi.createVideoStudio.mockResolvedValue(svc(6));
    const r = render(<ServiceForm route={{ params: { category: 'home' } }} navigation={nav()} />);
    fireEvent.changeText(r.getByTestId('service-name'), 'Hope Plumbers');
    fireEvent.changeText(r.getByTestId('service-location'), 'Kisumu');
    fireEvent.press(r.getByTestId('service-tag-plumbing'));
    fireEvent.press(r.getByTestId('service-pin'));
    await waitFor(() => expect(r.getByTestId('place-0')).toBeTruthy());        // searched for what was typed
    fireEvent.press(r.getByTestId('place-0'));
    expect(within(r.getByTestId('service-pin')).getByText('Kisumu, Kenya')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('service-save')); });
    expect(mockApi.createVideoStudio).toHaveBeenCalledWith(expect.objectContaining({ latitude: -0.091702, longitude: 34.768 }));
  });
});

describe('Scan fixes', () => {
  const ServiceDetail = require('../ServiceDetail').default;

  test('a heart given on the page shows in the list on the way back — and nothing is added to a list it wasn\'t in', async () => {
    mockApi.fetchServicesPage.mockResolvedValue({ results: [svc(1), svc(2)], next: null });
    const r = render(<Studios navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('service-1')).toBeTruthy());
    mockApi.fetchServicesPage.mockImplementation(() => new Promise(() => {}));
    await new Promise((res) => setTimeout(res, 5));
    catalog.noteServicesChanged({ item: { ...svc(1), is_saved: true } });
    await act(async () => { mockFocus[mockFocus.length - 1](); });
    expect(r.getByTestId('service-save-1').props.accessibilityState).toEqual({ selected: true });
    await new Promise((res) => setTimeout(res, 5));
    catalog.noteServicesChanged({ item: { ...svc(9), is_saved: true } });     // saved elsewhere, not in this list
    await act(async () => { mockFocus[mockFocus.length - 1](); });
    expect(r.queryByTestId('service-9')).toBeNull();
  });

  test('the page tells the list when its heart changes', async () => {
    mockApi.saveService.mockResolvedValue({ is_saved: true });
    mockApi.fetchVideoStudioById.mockResolvedValue(svc(5));
    const r = render(<ServiceDetail route={{ params: { id: 5, preview: svc(5) } }} navigation={nav()} />);
    await act(async () => { fireEvent.press(r.getByTestId('service-page-save')); });
    expect(catalog.servicesChangedSince(0).item).toMatchObject({ id: 5, is_saved: true });
  });

  test('the insights chart speaks of page views, not readers', async () => {
    const { DailyColumns } = require('../../components/BookCharts');
    const tt = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
    const days = [{ day: '2026-09-20', readers: 3 }, { day: '2026-09-21', readers: 5 }];
    const r = render(<DailyColumns data={days} title="Views" t={tt} onLabel="page views on" totalKey="insights.totalViews" />);
    expect(r.getByTestId('chart-daily-plot').props.accessibilityLabel).toBe('Views: insights.totalViews:8');
  });
});