import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
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

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearAllCaches();
  catalog.__resetServicesCatalog();
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.serviceShareUrl.mockImplementation((id) => `https://app.test/service/${id}/`);
  mockApi.fetchServicesHome.mockResolvedValue({ counts: {}, featured: [], verified: [], new: [] });
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
    catalog.noteServicesChanged({ item: svc(7, { name: 'Brand new', is_owner: true }) });
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
    expect(n.navigate).toHaveBeenCalledWith('Chat', { conversationId: 44, otherUser: { id: 9 } });
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