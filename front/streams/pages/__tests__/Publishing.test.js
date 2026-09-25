import React from 'react';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.setTimeout(20000);

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockApi = {
  fetchPublications: jest.fn(),
  fetchMyPublications: jest.fn(),
  fetchPublicationsByUrl: jest.fn(),
  fetchPublication: jest.fn(),
  fetchPublicationChapter: jest.fn(),
  togglePublicationLike: jest.fn(),
  togglePublicationBookmark: jest.fn(),
  deletePublication: jest.fn(),
  saveReadingProgress: jest.fn(async () => ({})),
  createPublication: jest.fn(),
  updatePublication: jest.fn(),
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
  return {
    useFocusEffect: (cb) => { R.useEffect(() => { mockFocus.push(cb); return cb(); }, [cb]); },
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialIcons: () => null, MaterialCommunityIcons: () => null }));
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
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
});
jest.mock('react-native-markdown-display', () => {
  const { Text: T } = require('react-native');
  return ({ children }) => <T testID="markdown">{children}</T>;
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
const mockUpload = jest.fn(async () => ({ url: 'https://r2.test/cover_images/p.jpg' }));
jest.mock('../../services/cloudinary', () => ({ uploadMedia: (...a) => mockUpload(...a) }));
jest.mock('../../components/FollowButton', () => () => null);
jest.mock('../../components/ReportModal', () => () => null);

const store = require('../../services/publicationStore');
const { clearAllCaches } = require('../../utils/screenCache');
const Articles = require('../Articles').default;
const PublicationDetail = require('../PublicationDetail').default;
const ChapterReader = require('../ChapterReader').default;
const { speechChunks } = require('../ChapterReader');
const PublicationEditor = require('../PublicationEditor').default;
const { formatBody } = require('../PublicationEditor');

const nav = () => {
  const listeners = {};
  return {
    navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), push: jest.fn(), dispatch: jest.fn(),
    addListener: jest.fn((ev, fn) => { listeners[ev] = fn; return () => { delete listeners[ev]; }; }),
    fire: (ev, e) => listeners[ev]?.(e),
  };
};
const pubRow = (id, extra = {}) => ({
  id, title: `Book ${id}`, summary: '', cover: '', category: 'devotional', status: 'published',
  author: { id: 2, username: 'writer' }, chapter_count: 2, likes_count: 0, ...extra,
});
const book = (extra = {}) => ({
  ...pubRow(5), theme: {}, is_owner: false, is_liked: false, is_bookmarked: false, likes_count: 1,
  reading_minutes: 3, last_read_chapter: 0, updated_at: '2026-09-25T10:00:00Z',
  chapters: [{ id: 51, order: 1, title: 'One', word_count: 300 }, { id: 52, order: 2, title: 'Two', word_count: 300 }],
  ...extra,
});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearAllCaches();
  store.__resetPublicationStore();
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.saveReadingProgress.mockResolvedValue({});
  mockAuth = { isAuthenticated: true, currentUser: { id: 1, username: 'me' } };
  mockConfirm.mockReset();
  mockNotify.mockReset();
  mockUpload.mockClear();
  mockFocus = [];
});

// ── The list ─────────────────────────────────────────────────────────────────
describe('Publishing list', () => {
  test('one request on open (it used to fetch twice), then cached for the next open', async () => {
    mockApi.fetchPublications.mockResolvedValue({ results: [pubRow(1), pubRow(2)], next: null });
    const n = nav();
    const r = render(<Articles navigation={n} />);
    await waitFor(() => expect(r.getByText('Book 2')).toBeTruthy());
    await act(async () => { await new Promise((res) => setTimeout(res, 400)); });   // past the search debounce
    expect(mockApi.fetchPublications).toHaveBeenCalledTimes(1);
    r.unmount();

    mockApi.fetchPublications.mockImplementation(() => new Promise(() => {}));     // the network hangs
    const again = render(<Articles navigation={n} />);
    expect(again.getByText('Book 2')).toBeTruthy();                               // painted at once
  });

  test('offline with nothing kept: a message and Retry, not an empty "no publications"', async () => {
    mockApi.fetchPublications.mockRejectedValueOnce(new Error('Network Error'));
    const r = render(<Articles navigation={nav()} />);
    await waitFor(() => expect(r.getByText('articles.loadFailed')).toBeTruthy());
    mockApi.fetchPublications.mockResolvedValueOnce({ results: [pubRow(1)], next: null });
    await act(async () => { fireEvent.press(r.getByTestId('articles-retry')); });
    await waitFor(() => expect(r.getByText('Book 1')).toBeTruthy());
  });

  test('a refresh that fails keeps the rows and says it is offline', async () => {
    mockApi.fetchPublications.mockResolvedValueOnce({ results: [pubRow(1)], next: null });
    const r = render(<Articles navigation={nav()} />);
    await waitFor(() => expect(r.getByText('Book 1')).toBeTruthy());
    mockApi.fetchPublications.mockRejectedValueOnce(new Error('Network Error'));
    await act(async () => { mockFocus[mockFocus.length - 1](); });   // mount focus is skipped …
    store.notePublicationsChanged();
    await act(async () => { mockFocus[mockFocus.length - 1](); });   // … a change since forces a reload
    await waitFor(() => expect(r.getByTestId('articles-offline')).toBeTruthy());
    expect(r.getByText('Book 1')).toBeTruthy();
  });

  test('a slow answer for an old tab never replaces the new tab', async () => {
    let answerDiscover;
    mockApi.fetchPublications
      .mockImplementationOnce(() => new Promise((res) => { answerDiscover = res; }))
      .mockResolvedValueOnce({ results: [pubRow(9, { title: 'Saved one' })], next: null });
    const r = render(<Articles navigation={nav()} />);
    await flush();
    await act(async () => { fireEvent.press(r.getByTestId('articles-tab-saved')); });
    await flush();
    await waitFor(() => expect(r.getByText('Saved one')).toBeTruthy());
    await act(async () => { answerDiscover({ results: [pubRow(1)], next: null }); });
    expect(r.queryByText('Book 1')).toBeNull();
    expect(r.getByText('Saved one')).toBeTruthy();
  });

  test('guests: Saved and My Work ask to sign in (Saved used to list everything); Write opens Login', async () => {
    mockAuth = { isAuthenticated: false, currentUser: null };
    mockApi.fetchPublications.mockResolvedValue({ results: [pubRow(1)], next: null });
    const n = nav();
    const r = render(<Articles navigation={n} />);
    await waitFor(() => expect(r.getByText('Book 1')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('articles-tab-saved')); });
    expect(r.getByText('articles.signInSaved')).toBeTruthy();
    expect(mockApi.fetchPublications).toHaveBeenCalledTimes(1);
    fireEvent.press(r.getByTestId('articles-write'));
    expect(n.navigate).toHaveBeenCalledWith('Login');
  });
});

// ── The book page ────────────────────────────────────────────────────────────
describe('Book page', () => {
  test('its top draws at once from the list row; the contents come without bodies', async () => {
    let answer;
    mockApi.fetchPublication.mockImplementation(() => new Promise((res) => { answer = res; }));
    const r = render(<PublicationDetail route={{ params: { id: 5, preview: pubRow(5) } }} navigation={nav()} />);
    expect(r.getByText('Book 5')).toBeTruthy();
    await waitFor(() => expect(mockApi.fetchPublication).toHaveBeenCalledWith(5, { toc: true }));
    await act(async () => { answer(book()); });
    expect(r.getByText('Two')).toBeTruthy();
    expect(r.getByText('pubDetail.chapterCount:2 · pubDetail.minRead:3')).toBeTruthy();
  });

  test('the reader gets the contents, not the whole book', async () => {
    mockApi.fetchPublication.mockResolvedValue(book({ last_read_chapter: 1 }));
    const n = nav();
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={n} />);
    await waitFor(() => expect(r.getByText('pubDetail.continue:2')).toBeTruthy());
    fireEvent.press(r.getByTestId('pub-read'));
    const [, params] = n.navigate.mock.calls[0];
    expect(params.index).toBe(1);
    expect(params.book.chapters).toEqual([{ id: 51, order: 1, title: 'One' }, { id: 52, order: 2, title: 'Two' }]);
    expect(params.publication).toBeUndefined();
  });

  test('offline on a return visit: the kept page, marked offline', async () => {
    mockApi.fetchPublication.mockResolvedValueOnce(book());
    const first = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={nav()} />);
    await waitFor(() => expect(first.getByText('Two')).toBeTruthy());
    first.unmount();
    mockApi.fetchPublication.mockRejectedValueOnce(new Error('Network Error'));
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={nav()} />);
    expect(r.getByText('Two')).toBeTruthy();
    await waitFor(() => expect(r.getByTestId('pub-offline')).toBeTruthy());
  });

  test('deleted or taken down: unavailable, and the kept copy is dropped', async () => {
    mockApi.fetchPublication.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    const r = render(<PublicationDetail route={{ params: { id: 5, preview: pubRow(5) } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByText('pubDetail.unavailable')).toBeTruthy());
  });

  test('guests are asked to sign in to like — no silent failure', async () => {
    mockAuth = { isAuthenticated: false, currentUser: null };
    mockApi.fetchPublication.mockResolvedValue(book());
    mockConfirm.mockResolvedValue(true);
    const n = nav();
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={n} />);
    await waitFor(() => expect(r.getByText('Two')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('pub-like')); });
    expect(mockApi.togglePublicationLike).not.toHaveBeenCalled();
    expect(n.navigate).toHaveBeenCalledWith('Login');
  });

  test('a like is kept on the page and tells the list to refresh', async () => {
    mockApi.fetchPublication.mockResolvedValue(book());
    mockApi.togglePublicationLike.mockResolvedValue({ is_liked: true, likes_count: 2 });
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByText('Two')).toBeTruthy());
    const before = Date.now() - 1;
    await act(async () => { fireEvent.press(r.getByTestId('pub-like')); });
    expect(within(r.getByTestId('pub-like')).getByText('2')).toBeTruthy();
    expect(store.peekBook(1, 5).likes_count).toBe(2);
    expect(store.publicationsChangedSince(before)).toBe(true);
  });

  test('delete asks first (works on web) and leaves', async () => {
    mockApi.fetchPublication.mockResolvedValue(book({ is_owner: true }));
    mockApi.deletePublication.mockResolvedValue({});
    const n = nav();
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('pub-delete')).toBeTruthy());
    mockConfirm.mockResolvedValueOnce(false);
    await act(async () => { fireEvent.press(r.getByTestId('pub-delete')); });
    expect(mockApi.deletePublication).not.toHaveBeenCalled();
    mockConfirm.mockResolvedValueOnce(true);
    await act(async () => { fireEvent.press(r.getByTestId('pub-delete')); });
    expect(mockApi.deletePublication).toHaveBeenCalledWith(5);
    expect(n.goBack).toHaveBeenCalled();
  });

  test('download for offline reading', async () => {
    mockApi.fetchPublication.mockResolvedValue(book());
    mockApi.fetchPublicationChapter.mockImplementation(async (id, i) => ({ chapter: { id: 51 + i, title: 'x', body: 'y' } }));
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByText('pubDetail.download')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('pub-download')); });
    await waitFor(() => expect(r.getByText('pubDetail.downloaded')).toBeTruthy());
    expect(mockApi.fetchPublicationChapter).toHaveBeenCalledTimes(2);
  });
});

// ── The reader ───────────────────────────────────────────────────────────────
describe('Reader', () => {
  const params = (extra = {}) => ({
    id: 5, index: 0,
    book: { id: 5, title: 'Book 5', theme: {}, chapters: [{ id: 51, title: 'One' }, { id: 52, title: 'Two' }, { id: 53, title: 'Three' }] },
    ...extra,
  });

  test('loads one chapter, then the next quietly; turning the page needs no wait', async () => {
    mockApi.fetchPublicationChapter.mockImplementation(async (id, i) => ({ chapter: { id: 51 + i, title: `T${i}`, body: `Body ${i}` } }));
    const r = render(<ChapterReader route={{ params: params() }} navigation={nav()} />);
    await waitFor(() => expect(r.getByText('Body 0')).toBeTruthy());
    await flush();
    expect(mockApi.fetchPublicationChapter.mock.calls.map((c) => c[1])).toEqual([0, 1]);
    await act(async () => { fireEvent.press(r.getByTestId('reader-next')); });
    await waitFor(() => expect(r.getByText('Body 1')).toBeTruthy());
    await flush();
    expect(mockApi.fetchPublicationChapter.mock.calls.map((c) => c[1])).toEqual([0, 1, 2]);   // chapter 2 fetched once
  });

  test('offline and nothing kept: a message and Retry', async () => {
    mockApi.fetchPublicationChapter.mockRejectedValueOnce(new Error('Network Error'));
    const r = render(<ChapterReader route={{ params: params() }} navigation={nav()} />);
    await waitFor(() => expect(r.getByText('reader.loadFailed')).toBeTruthy());
    mockApi.fetchPublicationChapter.mockResolvedValue({ chapter: { id: 51, title: 'One', body: 'Now it came' } });
    await act(async () => { fireEvent.press(r.getByTestId('reader-retry')); });
    await waitFor(() => expect(r.getByText('Now it came')).toBeTruthy());
  });

  test('a server without the one-chapter endpoint: the whole book once, still readable', async () => {
    mockApi.fetchPublicationChapter.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    mockApi.fetchPublication.mockResolvedValue({ chapters: [{ id: 51, body: 'Old server body' }, { id: 52, body: 'b' }, { id: 53, body: 'c' }] });
    const r = render(<ChapterReader route={{ params: params() }} navigation={nav()} />);
    await waitFor(() => expect(r.getByText('Old server body')).toBeTruthy());
  });

  test('opened the old way (the whole publication passed in) still works, with no request', async () => {
    const publication = { id: 5, title: 'Old', theme: {}, chapters: [{ id: 51, title: 'A', body: 'Passed body' }] };
    const r = render(<ChapterReader route={{ params: { publication, index: 0 } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByText('Passed body')).toBeTruthy());
    expect(mockApi.fetchPublicationChapter).not.toHaveBeenCalled();
  });

  test('progress is saved for readers with an account only', async () => {
    jest.useFakeTimers();
    try {
      mockApi.fetchPublicationChapter.mockResolvedValue({ chapter: { id: 51, title: 'One', body: 'x' } });
      mockAuth = { isAuthenticated: false, currentUser: null };
      const r = render(<ChapterReader route={{ params: params() }} navigation={nav()} />);
      await act(async () => { jest.advanceTimersByTime(3000); });
      expect(mockApi.saveReadingProgress).not.toHaveBeenCalled();
      r.unmount();
      mockAuth = { isAuthenticated: true, currentUser: { id: 1 } };
      render(<ChapterReader route={{ params: params({ index: 1 }) }} navigation={nav()} />);
      await act(async () => { jest.advanceTimersByTime(3000); });
      expect(mockApi.saveReadingProgress).toHaveBeenCalledWith(5, 1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('long chapters are read aloud in pieces the phone accepts', () => {
    const sentence = 'Grace and peace to you all. ';
    const text = sentence.repeat(400).trim();                 // ~11,000 characters
    const pieces = speechChunks(text, 3500);
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces.every((p) => p.length <= 3500)).toBe(true);
    expect(pieces.every((p) => p.endsWith('.'))).toBe(true);  // broken between sentences
    expect(pieces.join(' ')).toBe(text);
  });
});

// ── The editor ───────────────────────────────────────────────────────────────
describe('Editor', () => {
  test('formatting wraps the selection and never inserts placeholder words', () => {
    expect(formatBody('hello world', { start: 6, end: 11 }, 'bold')).toEqual({ body: 'hello **world**', caret: [15, 15] });
    expect(formatBody('one\ntwo', { start: 5, end: 5 }, 'h1').body).toBe('one\n# two');
    expect(formatBody('x', null, 'nope')).toBeNull();
  });

  test('a new publication: saved, then its page takes the editor\'s place', async () => {
    mockApi.createPublication.mockResolvedValue({ id: 77 });
    const n = nav();
    const r = render(<PublicationEditor route={{ params: {} }} navigation={n} />);
    fireEvent.changeText(r.getByTestId('editor-title'), 'My Book');
    fireEvent.changeText(r.getByPlaceholderText('pub.chapterBodyPlaceholder'), 'Once upon a time');
    await act(async () => { fireEvent.press(r.getByTestId('editor-publish')); });
    expect(mockApi.createPublication).toHaveBeenCalledWith(expect.objectContaining({
      title: 'My Book', status: 'published', chapters: [{ order: 1, title: '', body: 'Once upon a time' }],
    }));
    expect(n.replace).toHaveBeenCalledWith('PublicationDetail', { id: 77 });
    expect(n.navigate).not.toHaveBeenCalled();
  });

  test('editing: saved, then back to the book page (not a second copy of it)', async () => {
    mockApi.fetchPublication.mockResolvedValue({ ...book(), chapters: [{ id: 51, title: 'One', body: 'Text' }] });
    mockApi.updatePublication.mockResolvedValue({ id: 5 });
    const n = nav();
    const r = render(<PublicationEditor route={{ params: { id: 5 } }} navigation={n} />);
    await waitFor(() => expect(r.getByDisplayValue('Book 5')).toBeTruthy());
    expect(mockApi.fetchPublication).toHaveBeenCalledWith(5);          // bodies: it's the editor
    await act(async () => { fireEvent.press(r.getByTestId('editor-save-draft')); });
    expect(mockApi.updatePublication).toHaveBeenCalledWith(5, expect.objectContaining({ status: 'draft' }));
    expect(n.goBack).toHaveBeenCalled();
  });

  test('a picture is uploaded and goes in as a short address, not base64', async () => {
    const r = render(<PublicationEditor route={{ params: {} }} navigation={nav()} />);
    await act(async () => { fireEvent.press(r.getByTestId('editor-image-0')); });
    const input = r.getByPlaceholderText('pub.chapterBodyPlaceholder');
    await waitFor(() => expect(input.props.value).toContain('![image](https://r2.test/cover_images/p.jpg)'));
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/jpeg' }), 'cover');
    expect(input.props.value).not.toContain('base64');
  });

  test('leaving with unsaved changes asks first; untouched, it just leaves', async () => {
    const n = nav();
    const r = render(<PublicationEditor route={{ params: {} }} navigation={n} />);
    const leave = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    n.fire('beforeRemove', leave);
    expect(leave.preventDefault).not.toHaveBeenCalled();

    fireEvent.changeText(r.getByTestId('editor-title'), 'Half written');
    mockConfirm.mockResolvedValueOnce(false);
    const again = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    await act(async () => { n.fire('beforeRemove', again); });
    expect(again.preventDefault).toHaveBeenCalled();
    expect(n.dispatch).not.toHaveBeenCalled();

    mockConfirm.mockResolvedValueOnce(true);
    await act(async () => { n.fire('beforeRemove', again); });
    expect(n.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  });

  test('guests are asked to sign in instead of writing something that cannot save', () => {
    mockAuth = { isAuthenticated: false, currentUser: null };
    const n = nav();
    const r = render(<PublicationEditor route={{ params: {} }} navigation={n} />);
    fireEvent.press(r.getByText('auth.login'));
    expect(n.replace).toHaveBeenCalledWith('Login');
  });
});
