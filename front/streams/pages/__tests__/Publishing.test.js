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
  sendReadingActivity: jest.fn(),
  fetchChapterRevisions: jest.fn(),
  fetchChapterRevision: jest.fn(),
  fetchReadingStats: jest.fn(),
  fetchBookHighlights: jest.fn(),
  syncBookHighlights: jest.fn(),
  fetchBooksHome: jest.fn(),
  fetchBookReviews: jest.fn(),
  saveBookReview: jest.fn(),
  deleteMyBookReview: jest.fn(),
  fetchChapterDiscussion: jest.fn(),
  postChapterComment: jest.fn(),
  deleteChapterComment: jest.fn(),
  fetchAuthorPage: jest.fn(),
  fetchCollaborators: jest.fn(),
  inviteCollaborator: jest.fn(),
  setCollaboratorRole: jest.fn(),
  removeCollaborator: jest.fn(),
  fetchBookInvitations: jest.fn(),
  answerBookInvitation: jest.fn(),
  requestBookExport: jest.fn(),
  fetchBookExport: jest.fn(),
  renderBookCover: jest.fn(),
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
// Reading aloud: what was said, and the "done" callbacks to finish each piece.
let mockSpoken = [];
jest.mock('expo-speech', () => ({
  speak: jest.fn((text, opts) => { mockSpoken.push({ text, opts }); }),
  stop: jest.fn(),
}));
jest.mock('expo-font', () => ({ loadAsync: jest.fn(async () => {}), isLoaded: jest.fn(() => true) }));
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
const ChapterHistory = require('../ChapterHistory').default;
const { foldChanges } = require('../ChapterHistory');
const { COMMIT_MS, IDLE_MS } = require('../ChapterReader');

const nav = () => {
  const listeners = {};
  return {
    navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), push: jest.fn(), dispatch: jest.fn(),
    popTo: jest.fn(), setParams: jest.fn(),
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
  mockApi.sendReadingActivity.mockResolvedValue({ accepted: 1 });
  mockApi.fetchBookHighlights.mockResolvedValue({ results: [] });
  mockApi.syncBookHighlights.mockResolvedValue({ applied: [] });
  mockApi.fetchReadingStats.mockResolvedValue(null);
  mockApi.fetchBooksHome.mockRejectedValue(new Error('not in this test'));
  mockApi.fetchBookReviews.mockRejectedValue(new Error('not in this test'));
  mockApi.fetchBookInvitations.mockResolvedValue({ results: [] });
  require('../../services/bookHighlights').__resetBookHighlights();
  require('../../utils/readerSettings').__resetReaderSettings();
  require('../../services/readingTracker').__resetReadingTracker();
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
    // Focus reaches every screen part that listens (the list and its shelves).
    const focusAll = () => act(async () => { [...new Set(mockFocus)].forEach((cb) => cb()); });
    await focusAll();                                                  // mount focus is skipped …
    store.notePublicationsChanged();
    await focusAll();                                                  // … a change since forces a reload
    await waitFor(() => expect(r.getByTestId('articles-offline')).toBeTruthy());
    expect(r.getByText('Book 1')).toBeTruthy();
  });

  test('a slow answer for an old tab never replaces the new tab', async () => {
    let answerDiscover;
    mockApi.fetchPublications.mockImplementationOnce(() => new Promise((res) => { answerDiscover = res; }));
    mockApi.fetchMyPublications.mockResolvedValueOnce({ results: [pubRow(9, { title: 'Saved one' })], next: null });
    const r = render(<Articles navigation={nav()} />);
    await flush();
    await act(async () => { fireEvent.press(r.getByTestId('articles-tab-mine')); });
    await flush();
    await waitFor(() => expect(r.getByText('Saved one')).toBeTruthy());
    await act(async () => { answerDiscover({ results: [pubRow(1)], next: null }); });
    expect(r.queryByText('Book 1')).toBeNull();
    expect(r.getByText('Saved one')).toBeTruthy();
  });

  test('guests: Library and My Work ask to sign in (Saved used to list everything); Write opens Login', async () => {
    mockAuth = { isAuthenticated: false, currentUser: null };
    mockApi.fetchPublications.mockResolvedValue({ results: [pubRow(1)], next: null });
    const n = nav();
    const r = render(<Articles navigation={n} />);
    await waitFor(() => expect(r.getByText('Book 1')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('articles-tab-library')); });
    await waitFor(() => expect(r.getByText('library.signIn')).toBeTruthy());
    expect(mockApi.fetchPublications).toHaveBeenCalledTimes(1);
    expect(mockApi.fetchReadingStats).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(r.getByTestId('articles-tab-mine')); });
    expect(r.getByText('articles.signInMine')).toBeTruthy();
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
    expect(params.book.chapters).toEqual([
      { id: 51, order: 1, title: 'One', word_count: 300 }, { id: 52, order: 2, title: 'Two', word_count: 300 },
    ]);
    expect(params.book.chapters.some((c) => 'body' in c)).toBe(false);
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
    // Publish opens the checklist; the rights are confirmed there, then out.
    await act(async () => { fireEvent.press(r.getByTestId('editor-publish')); });
    expect(mockApi.createPublication).not.toHaveBeenCalled();
    fireEvent.press(r.getByTestId('publish-rights'));
    await act(async () => { fireEvent.press(r.getByTestId('publish-go')); });
    expect(mockApi.createPublication).toHaveBeenCalledWith(expect.objectContaining({
      title: 'My Book', status: 'published', rights_confirmed: true,
      chapters: [{ order: 1, title: '', body: 'Once upon a time', status: 'published', publish_at: null }],   // new: no id yet
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
    // A published book: Save keeps it out (it used to unpublish it, as "Save Draft").
    expect(r.getByTestId('editor-unpublish')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('editor-publish')); });
    expect(mockApi.updatePublication).toHaveBeenCalledWith(5, expect.objectContaining({ status: 'published' }));
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

// ── Phase 1: chapters kept in place, history, reading time ───────────────────
describe('Phase 1', () => {
  const saved = (extra = {}) => ({
    ...book(), ...extra,
    chapters: [
      { id: 51, title: 'One', body: 'First', status: 'published', is_removed: false },
      { id: 52, title: 'Two', body: 'Second', status: 'draft', is_removed: false },
      { id: 53, title: 'Three', body: 'Third', status: 'published', is_removed: true },
    ],
  });

  test('the editor sends chapters back with their ids and draft state', async () => {
    mockApi.fetchPublication.mockResolvedValue(saved());
    mockApi.updatePublication.mockResolvedValue({ id: 5 });
    const r = render(<PublicationEditor route={{ params: { id: 5 } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByDisplayValue('First')).toBeTruthy());
    expect(r.getByText('pub.removedByModerator')).toBeTruthy();                // the author sees the takedown
    await act(async () => { fireEvent.press(r.getByTestId('editor-draft-0')); }); // chapter 1 → draft
    await act(async () => { fireEvent.press(r.getByTestId('editor-publish')); });   // Save (the book stays out)
    const { chapters } = mockApi.updatePublication.mock.calls[0][1];
    expect(chapters.map((c) => [c.id, c.status])).toEqual([[51, 'draft'], [52, 'draft'], [53, 'published']]);
  });

  test('History opens for a saved chapter; Deleted chapters for the book', async () => {
    mockApi.fetchPublication.mockResolvedValue(saved());
    const n = nav();
    const r = render(<PublicationEditor route={{ params: { id: 5 } }} navigation={n} />);
    await waitFor(() => expect(r.getByDisplayValue('First')).toBeTruthy());
    fireEvent.press(r.getByTestId('editor-history-1'));
    expect(n.navigate).toHaveBeenCalledWith('ChapterHistory', { pubId: 5, chapterId: 52, chapterTitle: 'Two' });
    fireEvent.press(r.getByTestId('editor-deleted'));
    expect(n.navigate).toHaveBeenLastCalledWith('ChapterHistory', { pubId: 5, chapterId: null, chapterTitle: '' });
  });

  test('a version brought back lands in its chapter; a deleted one comes back as a draft', async () => {
    mockApi.fetchPublication.mockResolvedValue(saved());
    const n = nav();
    const route = { params: { id: 5 } };
    const r = render(<PublicationEditor route={route} navigation={n} />);
    await waitFor(() => expect(r.getByDisplayValue('First')).toBeTruthy());
    r.rerender(<PublicationEditor route={{ params: { id: 5, restore: { chapterId: 51, title: 'One', body: 'First, as it was' } } }} navigation={n} />);
    await waitFor(() => expect(r.getByDisplayValue('First, as it was')).toBeTruthy());
    expect(n.setParams).toHaveBeenCalledWith({ restore: undefined });
    r.rerender(<PublicationEditor route={{ params: { id: 5, restore: { chapterId: null, title: 'Lost', body: 'Found again' } } }} navigation={n} />);
    await waitFor(() => expect(r.getByDisplayValue('Found again')).toBeTruthy());
    expect(r.getAllByText('pub.chapterDraft').length).toBe(2);                 // Two, and the one brought back
  });

  test('History: a version, what changed since, and bringing it back to the editor', async () => {
    mockApi.fetchChapterRevisions.mockResolvedValue({ results: [
      { id: 9, chapter_ref: 51, version: 3, title: 'One', word_count: 2, reason: 'edit', created_at: '2026-09-25T09:00:00Z' },
    ] });
    mockApi.fetchChapterRevision.mockResolvedValue({
      id: 9, chapter_ref: 51, version: 3, title: 'One', body: 'Old words', chapter_exists: true,
      created_at: '2026-09-25T09:00:00Z',
      changes: [{ op: 'delete', text: 'Old words' }, { op: 'insert', text: 'New words' }],
    });
    const n = nav();
    const r = render(<ChapterHistory route={{ params: { pubId: 5, chapterId: 51, chapterTitle: 'One' } }} navigation={n} />);
    await waitFor(() => expect(r.getByText('history.version:3')).toBeTruthy());
    expect(mockApi.fetchChapterRevisions).toHaveBeenCalledWith(5, 51);
    await act(async () => { fireEvent.press(r.getByTestId('history-row-9')); });
    expect(r.getByText('− Old words')).toBeTruthy();
    expect(r.getByText('+ New words')).toBeTruthy();
    fireEvent.press(r.getByTestId('history-mode-text'));
    expect(r.getByText('Old words')).toBeTruthy();
    fireEvent.press(r.getByTestId('history-restore'));
    expect(n.popTo).toHaveBeenCalledWith('PublicationEditor',
      { restore: expect.objectContaining({ chapterId: 51, title: 'One', body: 'Old words' }) }, { merge: true });
  });

  test('long unchanged stretches fold to their first and last lines', () => {
    const rows = foldChanges([{ op: 'equal', text: 'a\nb\nc\nd\ne\nf' }, { op: 'insert', text: 'g' }]);
    expect(rows.map((r) => (r.op === 'fold' ? `fold:${r.count}` : r.text))).toEqual(['a', 'fold:4', 'f', 'g']);
  });

  describe('reading time', () => {
    const params = { id: 5, index: 0, book: { id: 5, title: 'B', theme: {}, chapters: [{ id: 51, version: 1 }, { id: 52, version: 1 }] } };
    beforeEach(() => {
      jest.useFakeTimers();
      mockApi.fetchPublicationChapter.mockImplementation(async (id, i) => ({ chapter: { id: 51 + i, version: 1, title: 'x', body: 'text' } }));
    });
    afterEach(() => jest.useRealTimers());
    const advance = (ms) => act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve(); });

    test('counted while reading and sent every half minute', async () => {
      const r = render(<ChapterReader route={{ route: 1, params }} navigation={nav()} />);
      await act(async () => {});
      await waitFor(() => expect(r.getByText('text')).toBeTruthy());
      await advance(COMMIT_MS);
      await act(async () => {});
      const sent = mockApi.sendReadingActivity.mock.calls.flatMap((c) => c[1]);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent[0]).toMatchObject({ index: 0 });
      expect(sent.reduce((n, e) => n + e.seconds, 0)).toBeGreaterThanOrEqual(20);
    });

    test('a phone left open stops counting after a few minutes without a touch', async () => {
      const r = render(<ChapterReader route={{ params }} navigation={nav()} />);
      await act(async () => {});
      await waitFor(() => expect(r.getByText('text')).toBeTruthy());
      await advance(IDLE_MS + 10 * 60 * 1000);
      await act(async () => {});
      const total = mockApi.sendReadingActivity.mock.calls.flatMap((c) => c[1]).reduce((n, e) => n + e.seconds, 0);
      expect(total).toBeLessThanOrEqual(IDLE_MS / 1000 + 5);
    });

    test('guests: nothing is recorded', async () => {
      mockAuth = { isAuthenticated: false, currentUser: null };
      const r = render(<ChapterReader route={{ params }} navigation={nav()} />);
      await act(async () => {});
      await waitFor(() => expect(r.getByText('text')).toBeTruthy());
      await advance(COMMIT_MS * 3);
      expect(mockApi.sendReadingActivity).not.toHaveBeenCalled();
    });
  });

  test('the book page opens the reader at the place read on another phone', async () => {
    mockApi.fetchPublication.mockResolvedValue(book({ last_read_chapter: 1, last_read_position: 0.6 }));
    const n = nav();
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('pub-read')).toBeTruthy());
    fireEvent.press(r.getByTestId('pub-read'));
    expect(n.navigate.mock.calls[0][1]).toMatchObject({ index: 1, position: 0.6 });
  });

  test('the author sees draft and removed chapters marked in the contents', async () => {
    mockApi.fetchPublication.mockResolvedValue(book({
      is_owner: true,
      chapters: [{ id: 51, title: 'One', status: 'draft' }, { id: 52, title: 'Two', status: 'published', is_removed: true }],
    }));
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByText('pubDetail.removedChapter')).toBeTruthy());
    expect(r.getAllByText('pubDetail.draft').length).toBeGreaterThan(0);
  });
});

// ── Phase 2: the reading experience ─────────────────────────────────────────
describe('Phase 2', () => {
  const params = (extra = {}) => ({
    id: 5, index: 0,
    book: { id: 5, title: 'B', theme: {}, chapters: [
      { id: 51, version: 1, title: 'One', word_count: 100 }, { id: 52, version: 1, title: 'Two', word_count: 100 },
    ] },
    ...extra,
  });
  const chapterOf = (i) => ({ chapter: { id: 51 + i, version: 1, title: i ? 'Two' : 'One', word_count: 100,
    body: i ? 'Second chapter.' : 'First paragraph.\n\nSecond paragraph.' } });
  beforeEach(() => {
    mockSpoken = [];
    mockApi.fetchPublicationChapter.mockImplementation(async (id, i) => chapterOf(i));
  });
  const open = async (p = params()) => {
    const n = nav();
    const r = render(<ChapterReader route={{ params: p }} navigation={n} />);
    await waitFor(() => expect(r.getByText('Second paragraph.')).toBeTruthy());
    return { r, n };
  };

  test('the text is in paragraphs; a tap hides and brings back the tools', async () => {
    const { r } = await open();
    expect(r.getByTestId('reader-block-1')).toBeTruthy();
    expect(r.getByTestId('reader-chrome')).toBeTruthy();
    fireEvent.press(r.getByTestId('reader-block-0'));
    expect(r.queryByTestId('reader-chrome')).toBeNull();
    fireEvent.press(r.getByTestId('reader-block-0'));
    expect(r.getByTestId('reader-chrome')).toBeTruthy();
    expect(r.getByTestId('reader-footer')).toBeTruthy();
  });

  test('long-press a paragraph → highlight it: shown, kept, and synced', async () => {
    const { r } = await open();
    await act(async () => { fireEvent(r.getByTestId('reader-block-1'), 'longPress'); });
    expect(r.getByTestId('book-passage-actions')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('book-highlight-green')); });
    expect(r.queryByTestId('book-passage-actions')).toBeNull();
    const style = [].concat(r.getByTestId('reader-block-1').props.style).flat(Infinity).filter(Boolean)
      .reduce((a, x) => ({ ...a, ...x }), {});
    expect(style.backgroundColor).toBe('rgba(52,199,89,0.24)');
    await flush();
    const ops = mockApi.syncBookHighlights.mock.calls.flatMap((c) => c[0]);
    expect(ops[0]).toMatchObject({ op: 'upsert', publication: 5, chapter_id: 51, block: 1, quote: 'Second paragraph.', color: 'green' });
  });

  test('guests are asked to sign in instead', async () => {
    mockAuth = { isAuthenticated: false, currentUser: null };
    mockConfirm.mockResolvedValue(false);
    const { r } = await open();
    await act(async () => { fireEvent(r.getByTestId('reader-block-0'), 'longPress'); });
    expect(mockConfirm).toHaveBeenCalled();
    expect(r.queryByTestId('book-passage-actions')).toBeNull();
  });

  test('a highlight made on another phone shows on its paragraph', async () => {
    mockApi.fetchBookHighlights.mockResolvedValue({ results: [
      { client_id: 'x', chapter_id: 51, block: 0, quote: 'Second paragraph.', color: 'pink', note: 'Mine', updated_at: '2026-09-25T10:00:00Z' },
    ] });
    const { r } = await open();
    await waitFor(() => {
      const style = [].concat(r.getByTestId('reader-block-1').props.style).flat(Infinity).filter(Boolean)
        .reduce((a, x) => ({ ...a, ...x }), {});
      expect(style.backgroundColor).toBe('rgba(255,77,109,0.24)');         // found by its words, not its old place
    });
  });

  test('the reader\'s theme is applied over the author\'s and kept', async () => {
    const { r } = await open();
    fireEvent.press(r.getByTestId('reader-font'));
    await act(async () => { fireEvent.press(r.getByTestId('reader-theme-sepia')); });
    const bg = [].concat(r.UNSAFE_root.findAll((n) => n.props?.edges?.[0] === 'top')[0].props.style).flat()
      .reduce((a, x) => ({ ...a, ...(x || {}) }), {}).backgroundColor;
    expect(bg).toBe('#F1E4CB');
  });

  test('listen reads paragraph by paragraph, then carries on into the next chapter', async () => {
    const { r } = await open();
    await act(async () => { fireEvent.press(r.getByTestId('reader-listen')); });
    expect(mockSpoken.map((s) => s.text)).toEqual(['First paragraph.']);
    await act(async () => { mockSpoken[0].opts.onDone(); });
    expect(mockSpoken[1].text).toBe('Second paragraph.');
    await act(async () => { mockSpoken[1].opts.onDone(); });                 // end of chapter 1
    await waitFor(() => expect(mockSpoken.map((s) => s.text)).toContain('Second chapter.'));
  });

  test('opened at a highlight from the library, by chapter', async () => {
    const n = nav();
    const r = render(<ChapterReader route={{ params: params({ index: undefined, chapterId: 52, block: 0 }) }} navigation={n} />);
    await waitFor(() => expect(r.getByText('Second chapter.')).toBeTruthy());
  });

  test('the book page shows how far, how long is left, or finished', async () => {
    mockApi.fetchPublication.mockResolvedValueOnce(book({ my_percent: 0.25, my_finished: false }));
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByText('pubDetail.percentRead:25 · pubDetail.timeLeft:time.minutes:2')).toBeTruthy());
    r.unmount();
    await clearAllCaches();
    mockApi.fetchPublication.mockResolvedValueOnce(book({ my_percent: 1, my_finished: true }));
    const done = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={nav()} />);
    await waitFor(() => expect(done.getByText('pubDetail.finished')).toBeTruthy());
  });

  describe('Library', () => {
    const openLibrary = async () => {
      mockApi.fetchPublications.mockImplementation(async (p) => (p?.shelf === 'reading'
        ? { results: [pubRow(7, { title: 'Half read', my_percent: 0.4 })] }
        : { results: [pubRow(1)] }));
      mockApi.fetchReadingStats.mockResolvedValue({
        streak: 6, best_streak: 9, read_today: true, today_seconds: 600, week_seconds: 13320, month_seconds: 51660,
        finished_this_year: 3,
        last7: ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']
          .map((day, i) => ({ day, seconds: i ? 600 : 0 })),
      });
      const n = nav();
      const r = render(<Articles navigation={n} />);
      await act(async () => { fireEvent.press(r.getByTestId('articles-tab-library')); });
      await waitFor(() => expect(r.getByText('Half read')).toBeTruthy());
      return { r, n };
    };

    test('the reader\'s numbers and the Reading shelf', async () => {
      const { r } = await openLibrary();
      await waitFor(() => expect(r.getByTestId('library-stats')).toBeTruthy());
      expect(r.getByText('6')).toBeTruthy();
      expect(r.getByText('time.hoursMinutes:3,42')).toBeTruthy();              // this week
      expect(r.getByText('40%')).toBeTruthy();
      expect(mockApi.fetchReadingStats.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);   // the phone's date
    });

    test('shelves: Finished asks for it; Highlights open the reader at the paragraph', async () => {
      const { r, n } = await openLibrary();
      await act(async () => { fireEvent.press(r.getByTestId('library-shelf-finished')); });
      expect(mockApi.fetchPublications).toHaveBeenLastCalledWith({ shelf: 'finished' });
      mockApi.fetchBookHighlights.mockResolvedValue({ results: [
        { client_id: 'h1', publication: 5, publication_title: 'B', chapter_id: 52, chapter_title: 'Two', block: 3, quote: 'Grace', color: 'yellow', note: 'Remember' },
      ] });
      await act(async () => { fireEvent.press(r.getByTestId('library-shelf-highlights')); });
      await waitFor(() => expect(r.getByText('“Grace”')).toBeTruthy());
      fireEvent.press(r.getByTestId('library-highlight-h1'));
      expect(n.navigate).toHaveBeenCalledWith('ChapterReader', { id: 5, chapterId: 52, block: 3 });
    });

    test('Downloaded works with no signal: the books kept on the phone', async () => {
      mockApi.fetchPublication.mockResolvedValue(book());
      mockApi.fetchPublicationChapter.mockImplementation(async (id, i) => ({ chapter: { id: 51 + i, title: 'x', body: 'y' } }));
      await store.fetchBook(1, 5);
      await store.downloadBook(5, [{ id: 51 }, { id: 52 }]);
      const { r } = await openLibrary();
      mockApi.fetchPublications.mockRejectedValue(new Error('Network Error'));
      await act(async () => { fireEvent.press(r.getByTestId('library-shelf-downloaded')); });
      await waitFor(() => expect(r.getByTestId('library-book-5')).toBeTruthy());
    });
  });
});

// ── Phase 3: discovery and community ────────────────────────────────────────
describe('Phase 3', () => {
  const ChapterDiscussion = require('../ChapterDiscussion').default;
  const AuthorPage = require('../AuthorPage').default;

  test('Discover shows its shelves over every book, and remembers them', async () => {
    mockApi.fetchPublications.mockResolvedValue({ results: [pubRow(1)], next: null });
    mockApi.fetchBooksHome.mockResolvedValue({
      continue: [pubRow(3, { title: 'Half read', my_percent: 0.5 })],
      picks: [pubRow(4, { title: 'A pick', rating_avg: 4.5, rating_count: 8 })],
      trending: [], following: [], new: [pubRow(5, { title: 'Brand new' })],
      rising: [{ id: 9, username: 'newvoice', readers: 12, growth: 1.42 }],
    });
    const n = nav();
    const r = render(<Articles navigation={n} />);
    await waitFor(() => expect(r.getByTestId('books-home')).toBeTruthy());
    expect(r.getByText('home.picks')).toBeTruthy();
    expect(r.queryByText('home.trending')).toBeNull();                 // an empty shelf isn't shown
    expect(r.getByText('4.5')).toBeTruthy();                           // a tile shows the average
    expect(r.getByText('home.risingGrowth:142')).toBeTruthy();
    fireEvent.press(r.getByTestId('home-author-9'));
    expect(n.navigate).toHaveBeenCalledWith('AuthorPage', { userId: 9, username: 'newvoice' });
    r.unmount();
    mockApi.fetchBooksHome.mockImplementation(() => new Promise(() => {}));
    const again = render(<Articles navigation={nav()} />);
    // Painted from the phone at once (a book with no cover shows its title on it too).
    expect(again.getAllByText('A pick').length).toBeGreaterThan(0);
  });

  test('a search or a category shows the plain list, not the shelves', async () => {
    mockApi.fetchPublications.mockResolvedValue({ results: [pubRow(1)], next: null });
    mockApi.fetchBooksHome.mockResolvedValue({ continue: [], picks: [pubRow(4)], trending: [], following: [], new: [], rising: [] });
    const r = render(<Articles navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('books-home')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByText('Health')); });
    expect(r.queryByTestId('books-home')).toBeNull();
  });

  describe('chapter discussion', () => {
    const params = { id: 5, index: 2, chapterTitle: 'Three' };

    test('past where the reader is: a spoiler warning first, then the comments on request', async () => {
      mockApi.fetchChapterDiscussion
        .mockResolvedValueOnce({ locked: true, reached: 0, count: 3, results: [] })
        .mockResolvedValueOnce({ locked: false, count: 1, results: [
          { id: 1, user: { username: 'ann' }, body: 'The twist!', is_author: true, replies: [] }] });
      const r = render(<ChapterDiscussion route={{ params }} navigation={nav()} />);
      await waitFor(() => expect(r.getByTestId('discussion-locked')).toBeTruthy());
      expect(r.getByText('discussion.spoilerReached:1,3')).toBeTruthy();
      expect(r.queryByText('The twist!')).toBeNull();
      await act(async () => { fireEvent.press(r.getByTestId('discussion-reveal')); });
      await waitFor(() => expect(r.getByText('The twist!')).toBeTruthy());
      expect(mockApi.fetchChapterDiscussion).toHaveBeenLastCalledWith(5, 2, { reveal: true });
      expect(r.getByText('discussion.author')).toBeTruthy();
    });

    test('comment, reply to it, and remove your own', async () => {
      mockApi.fetchChapterDiscussion.mockResolvedValue({ locked: false, count: 0, results: [] });
      mockApi.postChapterComment
        .mockResolvedValueOnce({ id: 10, user: { username: 'me' }, body: 'Lovely', parent: null, is_mine: true })
        .mockResolvedValueOnce({ id: 11, user: { username: 'me' }, body: 'Indeed', parent: 10, is_mine: true });
      mockApi.deleteChapterComment.mockResolvedValue({});
      mockConfirm.mockResolvedValue(true);
      const r = render(<ChapterDiscussion route={{ params }} navigation={nav()} />);
      await waitFor(() => expect(r.getByText('discussion.empty')).toBeTruthy());
      fireEvent.changeText(r.getByTestId('discussion-input'), 'Lovely');
      await act(async () => { fireEvent.press(r.getByTestId('discussion-send')); });
      expect(r.getByText('Lovely')).toBeTruthy();
      fireEvent.press(r.getByTestId('discussion-reply-10'));
      fireEvent.changeText(r.getByTestId('discussion-input'), 'Indeed');
      await act(async () => { fireEvent.press(r.getByTestId('discussion-send')); });
      expect(mockApi.postChapterComment).toHaveBeenLastCalledWith(5, 2, 'Indeed', 10);
      expect(r.getByText('Indeed')).toBeTruthy();
      await act(async () => { fireEvent.press(r.getByTestId('discussion-remove-10')); });
      expect(mockApi.deleteChapterComment).toHaveBeenCalledWith(5, 10);
      expect(r.queryByText('Lovely')).toBeNull();
      expect(r.queryByText('Indeed')).toBeNull();                        // its replies go with it
    });
  });

  test('an author\'s page: numbers, follow, their books', async () => {
    mockApi.fetchAuthorPage.mockResolvedValue({
      author: { id: 2, username: 'writer', verified: true }, followers_count: 18400, is_following: false,
      readers_count: 1234, finished_count: 56, books: [pubRow(5, { title: 'The Silent Path' })],
    });
    const n = nav();
    const r = render(<AuthorPage route={{ params: { userId: 2, username: 'writer' } }} navigation={n} />);
    await waitFor(() => expect(r.getByText('The Silent Path')).toBeTruthy());
    expect(r.getByText('18K')).toBeTruthy();
    expect(r.getByText('1.2K')).toBeTruthy();
    expect(r.getByText('author.verified')).toBeTruthy();
    fireEvent.press(r.getByTestId('author-book-5'));
    expect(n.navigate).toHaveBeenCalledWith('PublicationDetail', expect.objectContaining({ id: 5 }));
  });

  describe('reviews on the book page', () => {
    const summary = { count: 3, average: 4.3, spread: { 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 } };

    test('the summary, and a hint until the reader has read some of it', async () => {
      mockApi.fetchPublication.mockResolvedValue(book({ rating_avg: 4.3, rating_count: 3 }));
      mockApi.fetchBookReviews.mockResolvedValue({ summary, mine: null, can_review: false, reason: 'read_more',
        results: [{ id: 1, user: { username: 'ann' }, rating: 5, body: 'Life-changing' }], next: null });
      const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={nav()} />);
      await waitFor(() => expect(r.getByTestId('book-reviews')).toBeTruthy());
      expect(r.getByText('Life-changing')).toBeTruthy();
      expect(r.getByText('reviews.readMore')).toBeTruthy();
      expect(r.getAllByText('4.3').length).toBeGreaterThan(0);
    });

    test('write a review: stars, words, saved', async () => {
      mockApi.fetchPublication.mockResolvedValue(book());
      mockApi.fetchBookReviews.mockResolvedValue({ summary: { count: 0, average: null, spread: {} }, mine: null,
        can_review: true, reason: null, results: [], next: null });
      mockApi.saveBookReview.mockResolvedValue({ id: 3, rating: 4 });
      const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={nav()} />);
      await waitFor(() => expect(r.getByTestId('reviews-write')).toBeTruthy());
      fireEvent.press(r.getByTestId('reviews-write'));
      fireEvent.press(r.getByTestId('reviews-star-4'));
      fireEvent.changeText(r.getByTestId('reviews-input'), 'A gentle, deep book');
      await act(async () => { fireEvent.press(r.getByTestId('reviews-save')); });
      expect(mockApi.saveBookReview).toHaveBeenCalledWith(5, { rating: 4, body: 'A gentle, deep book' });
    });
  });

  test('the author\'s name opens their page; a chapter\'s bubble opens its discussion', async () => {
    mockApi.fetchPublication.mockResolvedValue(book({ chapters: [{ id: 51, title: 'One', comment_count: 7, status: 'published' }] }));
    const n = nav();
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('pub-discuss-0')).toBeTruthy());
    expect(within(r.getByTestId('pub-discuss-0')).getByText('7')).toBeTruthy();
    fireEvent.press(r.getByTestId('pub-discuss-0'));
    expect(n.navigate).toHaveBeenLastCalledWith('ChapterDiscussion', { id: 5, index: 0, chapterTitle: 'One', isBookAuthor: false });
    fireEvent.press(r.getByTestId('pub-author'));
    expect(n.navigate).toHaveBeenLastCalledWith('AuthorPage', { userId: 2, username: 'writer' });
  });

  test('the end of a chapter leads to its discussion', async () => {
    mockApi.fetchPublicationChapter.mockResolvedValue({ chapter: { id: 51, title: 'One', body: 'Words.', status: 'published' } });
    const n = nav();
    const r = render(<ChapterReader route={{ params: { id: 5, index: 0, book: { id: 5, title: 'B', chapters: [{ id: 51, comment_count: 4 }] } } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('reader-discuss')).toBeTruthy());
    expect(r.getByText('reader.discussCount:4')).toBeTruthy();
    fireEvent.press(r.getByTestId('reader-discuss'));
    expect(n.navigate).toHaveBeenCalledWith('ChapterDiscussion', expect.objectContaining({ id: 5, index: 0 }));
  });
});

// ── Phase 4: the Writer Studio ──────────────────────────────────────────────
describe('Phase 4', () => {
  const CoverStudio = require('../CoverStudio').default;
  const BookCollaborators = require('../BookCollaborators').default;
  const { splitFootnotes, countWords } = require('../../utils/chapterBlocks');
  const { schedulePresets } = require('../../components/ScheduleSheet');
  const { publishChecks } = require('../../components/PublishSheet');
  const { Linking } = require('react-native');

  const serverBook = (extra = {}) => ({
    ...book(), my_role: 'owner', rights_confirmed_at: null, status: 'draft', ...extra,
    chapters: [
      { id: 51, title: 'One', body: 'Grace and peace to you', status: 'published', version: 3 },
      { id: 52, title: 'Two', body: 'More words here', status: 'draft', version: 1, publish_at: null },
    ],
  });
  const openEditor = async (extra) => {
    mockApi.fetchPublication.mockResolvedValue(serverBook(extra));
    const n = nav();
    const r = render(<PublicationEditor route={{ params: { id: 5 } }} navigation={n} />);
    await waitFor(() => expect(r.getByDisplayValue('Grace and peace to you')).toBeTruthy());
    return { r, n };
  };

  test('footnotes, tables and word counts', () => {
    const f = formatBody('Grace', { start: 5, end: 5 }, 'footnote');
    expect(f.body).toBe('Grace[^1]\n[^1]: ');
    expect(formatBody(f.body + 'A note', { start: 5, end: 5 }, 'footnote').body).toContain('[^2]');
    expect(formatBody('Text', null, 'table').body).toBe('Text\n\n|  |  |\n| --- | --- |\n|  |  |\n\n');
    expect(splitFootnotes('Grace[^a] and peace[^b].\n[^a]: First.\n[^b]: Second.')).toEqual({
      body: 'Grace¹ and peace².\n\n', notes: [{ n: 1, text: 'First.' }, { n: 2, text: 'Second.' }],
    });
    expect(countWords("It's a [link](http://x.y/z) ![p](http://img) — well-known, 2 ways")).toBe(6);
  });

  test('schedule presets are in the future; the checklist needs a title and words', () => {
    const now = new Date(2026, 8, 25, 12, 0);                          // a Friday, noon
    const p = Object.fromEntries(schedulePresets(now).map((x) => [x.key, x.date]));
    expect(p.friday.getDay()).toBe(5);
    expect(p.friday > now).toBe(true);
    expect(p.sabbath.getDay()).toBe(6);
    expect(p.tomorrow.getDate()).toBe(26);
    const checks = publishChecks({ title: '', cover: '', summary: '', chapters: [{ title: 'x', body: '', status: 'published' }] });
    expect(checks.filter((c) => c.required && !c.ok).map((c) => c.key)).toEqual(['title', 'content']);
  });

  test('the editor counts words and sends versions and a scheduled time', async () => {
    mockApi.updatePublication.mockResolvedValue({ id: 5 });
    const { r } = await openEditor();
    expect(r.getByTestId('editor-totals').props.children).toBe('studio.totals:5,1,2');   // drafts don't count
    fireEvent.press(r.getByTestId('editor-schedule-1'));
    fireEvent.press(r.getByTestId('schedule-sabbath'));
    expect(r.getByText(/schedule\.goesOut/)).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('editor-save-draft')); });
    const { chapters } = mockApi.updatePublication.mock.calls[0][1];
    expect(chapters[0]).toMatchObject({ id: 51, version: 3, publish_at: null });
    expect(new Date(chapters[1].publish_at).getDay()).toBe(6);
  });

  test('changed elsewhere: keep mine resends with force', async () => {
    mockApi.updatePublication
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409, data: { code: 'conflict', chapters: [{ id: 51, title: 'One', version: 4 }] } }))
      .mockResolvedValueOnce({ id: 5 });
    mockConfirm.mockResolvedValueOnce(true);
    const { r, n } = await openEditor();
    fireEvent.changeText(r.getByDisplayValue('Grace and peace to you'), 'My edit');
    await act(async () => { fireEvent.press(r.getByTestId('editor-save-draft')); });
    await waitFor(() => expect(mockApi.updatePublication).toHaveBeenCalledTimes(2));
    expect(mockApi.updatePublication.mock.calls[1][1]).toMatchObject({ force: true });
    await waitFor(() => expect(n.goBack).toHaveBeenCalled());
  });

  test('changed elsewhere: load theirs brings in just those chapters', async () => {
    mockApi.updatePublication.mockRejectedValueOnce(Object.assign(new Error('conflict'),
      { status: 409, data: { code: 'conflict', chapters: [{ id: 51, title: 'One', version: 4 }] } }));
    mockConfirm.mockResolvedValueOnce(false);
    const { r } = await openEditor();
    fireEvent.changeText(r.getByDisplayValue('More words here'), 'My second-chapter edit');
    mockApi.fetchPublication.mockResolvedValue({ ...serverBook(), chapters: [
      { id: 51, title: 'One', body: 'Their newer words', status: 'published', version: 4 },
      { id: 52, title: 'Two', body: 'More words here', status: 'draft', version: 1 },
    ] });
    await act(async () => { fireEvent.press(r.getByTestId('editor-save-draft')); });
    await waitFor(() => expect(r.getByDisplayValue('Their newer words')).toBeTruthy());
    expect(r.getByDisplayValue('My second-chapter edit')).toBeTruthy();     // mine elsewhere kept
  });

  test('a co-author saves without touching publishing', async () => {
    mockApi.updatePublication.mockResolvedValue({ id: 5 });
    const { r } = await openEditor({ my_role: 'coauthor', status: 'published' });
    expect(r.getByText('studio.youAre:studio.role.coauthor')).toBeTruthy();
    expect(r.queryByTestId('editor-unpublish')).toBeNull();
    await act(async () => { fireEvent.press(r.getByTestId('editor-publish')); });
    expect('status' in mockApi.updatePublication.mock.calls[0][1]).toBe(false);
  });

  test('preview shows the book as readers will, from the editor, recording nothing', async () => {
    const { r, n } = await openEditor();
    fireEvent.press(r.getByTestId('editor-publish'));
    fireEvent.press(r.getByTestId('publish-preview'));
    const [screen, params] = n.navigate.mock.calls.find((c) => c[0] === 'ChapterReader');
    expect(screen).toBe('ChapterReader');
    expect(params.preview).toBe(true);
    expect(params.publication.chapters.map((c) => c.title)).toEqual(['One']);        // the draft isn't in
    const reader = render(<ChapterReader route={{ params }} navigation={nav()} />);
    await waitFor(() => expect(reader.getByText('Grace and peace to you')).toBeTruthy());
    expect(reader.getByTestId('reader-preview')).toBeTruthy();
    expect(mockApi.fetchPublicationChapter).not.toHaveBeenCalled();
    expect(reader.queryByTestId('reader-discuss')).toBeNull();
  });

  test('the Cover studio makes a cover and hands it to the editor', async () => {
    mockApi.renderBookCover.mockResolvedValue({ url: 'https://r2.test/cover_images/c.jpg' });
    const n = nav();
    const r = render(<CoverStudio route={{ params: { title: 'Steps', author: 'me' } }} navigation={n} />);
    fireEvent.press(r.getByTestId('cover-template-classic'));
    fireEvent.press(r.getByTestId('cover-palette-wine'));
    fireEvent.changeText(r.getByTestId('cover-subtitle'), 'A devotional');
    await act(async () => { fireEvent.press(r.getByTestId('cover-make')); });
    expect(mockApi.renderBookCover).toHaveBeenCalledWith({ template: 'classic', palette: 'wine', title: 'Steps', subtitle: 'A devotional', author: 'me' });
    expect(n.popTo).toHaveBeenCalledWith('PublicationEditor', { cover: 'https://r2.test/cover_images/c.jpg' }, { merge: true });
  });

  test('people: invite by username with a role', async () => {
    mockApi.fetchCollaborators.mockResolvedValue({ results: [], my_role: 'owner' });
    mockApi.inviteCollaborator.mockResolvedValue({ id: 3, user: { id: 9, username: 'ann' }, role: 'coauthor', accepted: false });
    const r = render(<BookCollaborators route={{ params: { id: 5, title: 'Book' } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('collab-username')).toBeTruthy());
    fireEvent.changeText(r.getByTestId('collab-username'), 'ann');
    fireEvent.press(r.getByTestId('collab-role-coauthor'));
    await act(async () => { fireEvent.press(r.getByTestId('collab-invite')); });
    expect(mockApi.inviteCollaborator).toHaveBeenCalledWith(5, 'ann', 'coauthor');
    expect(r.getByTestId('collab-row-3')).toBeTruthy();
  });

  test('the book page: what\'s coming, and an EPUB for its writers', async () => {
    jest.useFakeTimers();
    try {
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      mockApi.fetchPublication.mockResolvedValue(book({
        is_owner: true, my_role: 'owner',
        upcoming: [{ id: 60, title: 'Chapter three', publish_at: '2026-10-03T06:00:00Z' }],
      }));
      mockApi.requestBookExport.mockResolvedValue({ status: 'queued' });
      mockApi.fetchBookExport.mockResolvedValueOnce({ status: 'running' })
        .mockResolvedValueOnce({ status: 'done', url: 'https://r2.test/exports/5/b.epub' });
      const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={nav()} />);
      await act(async () => {});
      await waitFor(() => expect(r.getByTestId('pub-upcoming')).toBeTruthy());
      expect(r.getByText('Chapter three')).toBeTruthy();
      await act(async () => { fireEvent.press(r.getByTestId('pub-export')); });
      await act(async () => { jest.advanceTimersByTime(3000); });
      await act(async () => { jest.advanceTimersByTime(3000); });
      await act(async () => {});
      expect(open).toHaveBeenCalledWith('https://r2.test/exports/5/b.epub');
      open.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });
});
