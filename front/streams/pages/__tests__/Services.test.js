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
