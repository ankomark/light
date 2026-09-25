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
  fetchBookAnalytics: jest.fn(),
  fetchAuthorAnalytics: jest.fn(),
  fetchBookClubs: jest.fn(),
  createBookClub: jest.fn(),
  fetchBookClub: jest.fn(),
  fetchClubOfGroup: jest.fn(),
  fetchAiStatus: jest.fn(),
  askBookAi: jest.fn(),
  askWriterAi: jest.fn(),
  startManuscriptCheck: jest.fn(),
  fetchManuscriptCheck: jest.fn(),
  fetchHighlightCollections: jest.fn(),
  fetchOrganizations: jest.fn(),
  createOrganization: jest.fn(),
  fetchOrganization: jest.fn(),
  updateOrganization: jest.fn(),
  deleteOrganization: jest.fn(),
  followOrganization: jest.fn(),
  fetchOrgMembers: jest.fn(),
  inviteOrgMember: jest.fn(),
  setOrgMemberRole: jest.fn(),
  removeOrgMember: jest.fn(),
  respondOrgInvite: jest.fn(),
  fetchOrgInvitations: jest.fn(),
  shareBookToFeed: jest.fn(),
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
let mockNavigation = null;
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    useFocusEffect: (cb) => { R.useEffect(() => { mockFocus.push(cb); return cb(); }, [cb]); },
    useNavigation: () => mockNavigation,
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
let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => mockInsets };
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
  mockApi.fetchBookClubs.mockResolvedValue({ results: [] });
  mockApi.fetchAiStatus.mockResolvedValue({ enabled: false });
  mockApi.fetchHighlightCollections.mockResolvedValue({ results: [] });
  mockApi.fetchOrganizations.mockResolvedValue({ results: [] });
  mockApi.fetchOrgInvitations.mockResolvedValue({ results: [] });
  require('../../services/bookAi').__resetBookAi();
  require('../../services/bookHighlights').__resetBookHighlights();
  require('../../utils/readerSettings').__resetReaderSettings();
  require('../../services/readingTracker').__resetReadingTracker();
  mockAuth = { isAuthenticated: true, currentUser: { id: 1, username: 'me' } };
  mockConfirm.mockReset();
  mockNotify.mockReset();
  mockUpload.mockClear();
  mockFocus = [];
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
});

// ── The list ─────────────────────────────────────────────────────────────────
describe('Publishing list', () => {
  test('one request on open (it used to fetch twice), then cached for the next open', async () => {
    mockApi.fetchPublications.mockResolvedValue({ results: [pubRow(1), pubRow(2)], next: null });
    const n = nav();
    const r = render(<Articles navigation={n} />);
    await waitFor(() => expect(r.getByTestId('book-tile-2')).toBeTruthy());
    await act(async () => { await new Promise((res) => setTimeout(res, 400)); });   // past the search debounce
    expect(mockApi.fetchPublications).toHaveBeenCalledTimes(1);
    r.unmount();

    mockApi.fetchPublications.mockImplementation(() => new Promise(() => {}));     // the network hangs
    const again = render(<Articles navigation={n} />);
    expect(again.getByTestId('book-tile-2')).toBeTruthy();                               // painted at once
  });

  test('offline with nothing kept: a message and Retry, not an empty "no publications"', async () => {
    mockApi.fetchPublications.mockRejectedValueOnce(new Error('Network Error'));
    const r = render(<Articles navigation={nav()} />);
    await waitFor(() => expect(r.getByText('articles.loadFailed')).toBeTruthy());
    mockApi.fetchPublications.mockResolvedValueOnce({ results: [pubRow(1)], next: null });
    await act(async () => { fireEvent.press(r.getByTestId('articles-retry')); });
    await waitFor(() => expect(r.getByTestId('book-tile-1')).toBeTruthy());
  });

  test('a refresh that fails keeps the rows and says it is offline', async () => {
    mockApi.fetchPublications.mockResolvedValueOnce({ results: [pubRow(1)], next: null });
    const r = render(<Articles navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('book-tile-1')).toBeTruthy());
    mockApi.fetchPublications.mockRejectedValueOnce(new Error('Network Error'));
    // Focus reaches every screen part that listens (the list and its shelves).
    const focusAll = () => act(async () => { [...new Set(mockFocus)].forEach((cb) => cb()); });
    await focusAll();                                                  // mount focus is skipped …
    store.notePublicationsChanged();
    await focusAll();                                                  // … a change since forces a reload
    await waitFor(() => expect(r.getByTestId('articles-offline')).toBeTruthy());
    expect(r.getByTestId('book-tile-1')).toBeTruthy();
  });

  test('a slow answer for an old tab never replaces the new tab', async () => {
    let answerDiscover;
    mockApi.fetchPublications.mockImplementationOnce(() => new Promise((res) => { answerDiscover = res; }));
    mockApi.fetchMyPublications.mockResolvedValueOnce({ results: [pubRow(9, { title: 'Saved one' })], next: null });
    const r = render(<Articles navigation={nav()} />);
    await flush();
    await act(async () => { fireEvent.press(r.getByTestId('articles-tab-mine')); });
    await flush();
    await waitFor(() => expect(r.getByTestId('book-tile-9')).toBeTruthy());
    await act(async () => { answerDiscover({ results: [pubRow(1)], next: null }); });
    expect(r.queryByTestId('book-tile-1')).toBeNull();
    expect(r.getByTestId('book-tile-9')).toBeTruthy();
  });

  test('guests: Library and My Work ask to sign in (Saved used to list everything); Write opens Login', async () => {
    mockAuth = { isAuthenticated: false, currentUser: null };
    mockApi.fetchPublications.mockResolvedValue({ results: [pubRow(1)], next: null });
    const n = nav();
    const r = render(<Articles navigation={n} />);
    await waitFor(() => expect(r.getByTestId('book-tile-1')).toBeTruthy());
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
    const bg = [].concat(r.UNSAFE_root.findAll((n) => Array.isArray(n.props?.edges) && n.props.edges.length === 0)[0].props.style).flat()
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

// ── Phase 5: the Author Studio and book clubs ───────────────────────────────
describe('Phase 5', () => {
  const { AuthorStudio, BookInsights } = require('../AuthorStudio');
  const BookClub = require('../BookClub').default;
  const BookClubBanner = require('../../components/BookClubBanner').default;
  const { DailyColumns, niceMax, compact } = require('../../components/BookCharts');
  const tt = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
  const days = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, readers: f(i) }));

  test('axis tops and big numbers read cleanly', () => {
    expect([niceMax(7), niceMax(23), niceMax(140), niceMax(0)]).toEqual([10, 25, 200, 1]);
    expect([compact(1284), compact(12900), compact(4200000)]).toEqual(['1,284', '12.9K', '4.2M']);
  });

  test('readers per day: press shows the day\'s readers; the table has every value', () => {
    const r = render(<DailyColumns data={days(10, (i) => i * 2)} title="Readers per day" t={tt} />);
    fireEvent(r.getByTestId('chart-daily-plot'), 'layout', { nativeEvent: { layout: { width: 200 } } });
    fireEvent(r.getByTestId('chart-daily-plot'), 'responderGrant', { nativeEvent: { locationX: 45 } });   // column 3
    expect(r.getByText('4')).toBeTruthy();
    fireEvent.press(r.getByText('studioStats.showTable'));
    expect(r.getByTestId('chart-daily-table')).toBeTruthy();
    expect(r.getByText('18')).toBeTruthy();
  });

  test('the Author Studio: numbers, a range above everything, the books', async () => {
    const overview = (dd) => ({
      days: dd, few_readers: false, readers: 42, reading_seconds: 13320, finished: 7, followers: 180,
      daily: days(dd === 7 ? 7 : 30, () => 3),
      books: [{ id: 5, title: 'The Silent Path', cover: '', readers: 40, finished: 7, completion: 0.35 }],
    });
    mockApi.fetchAuthorAnalytics.mockImplementation(async (dd) => overview(dd));
    const n = nav();
    const r = render(<AuthorStudio navigation={n} />);
    await waitFor(() => expect(r.getByText('The Silent Path')).toBeTruthy());
    expect(within(r.getByTestId('kpi-readers')).getByText('42')).toBeTruthy();
    expect(r.getByText('studioStats.bookLine:40,7,35%')).toBeTruthy();
    fireEvent.press(r.getByTestId('range-7'));
    await waitFor(() => expect(r.getByTestId('range-7').props.accessibilityState).toEqual({ checked: true }));
    expect(mockApi.fetchAuthorAnalytics.mock.calls).toEqual([[30], [7]]);
    fireEvent.press(r.getByTestId('studio-book-5'));
    expect(n.navigate).toHaveBeenCalledWith('BookInsights', { id: 5, title: 'The Silent Path' });
  });

  test('a book\'s insights: completion, where readers stop, and early days said plainly', async () => {
    mockApi.fetchBookAnalytics.mockResolvedValue({
      days: 30, few_readers: true, readers: 3, readers_all_time: 4, started: 4, finished: 1, completion: 0.25,
      reading_seconds: 3600, avg_seconds_per_reader: 1200, daily: days(30, () => 1),
      funnel: [{ index: 0, title: 'One', readers: 4 }, { index: 1, title: 'Two', readers: 2 }],
      most_left_after: { index: 1, title: 'Two', readers: 2 },
      likes: 5, saves: 2, highlights: 9, comments: 3, rating_avg: 4.5, rating_count: 2,
    });
    const r = render(<BookInsights route={{ params: { id: 5, title: 'Book' } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('kpi-completion')).toBeTruthy());
    expect(within(r.getByTestId('kpi-completion')).getByText('25%')).toBeTruthy();
    expect(r.getByTestId('stats-early')).toBeTruthy();
    expect(r.getByText('studioStats.mostStopHere:2')).toBeTruthy();
    expect(mockApi.fetchBookAnalytics).toHaveBeenCalledWith(5, 30);
  });

  test('a book club: this week, the plan, how many are there', async () => {
    mockApi.fetchBookClub.mockResolvedValue({
      id: 3, name: 'Sabbath readers', group: { id: 8, slug: 'sabbath-readers', name: 'Sabbath readers', is_private: true },
      publication: 5, members: 12, is_member: true, finished_members: 1, my_percent: 0.4, starts_on: '2026-09-20',
      plan: [
        { through_chapter: 0, due: '2026-09-26', state: 'done', members_there: 10 },
        { through_chapter: 1, due: '2026-10-03', state: 'current', members_there: 6 },
      ],
    });
    mockApi.fetchPublication.mockResolvedValue(book());
    const n = nav();
    const r = render(<BookClub route={{ params: { clubId: 3 } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('club-now')).toBeTruthy());
    expect(r.getByText('club.there:6,12')).toBeTruthy();
    expect(r.getByText('club.continue:40')).toBeTruthy();
    fireEvent.press(r.getByTestId('club-chat'));
    expect(n.navigate).toHaveBeenCalledWith('GroupDetail', { groupSlug: 'sabbath-readers' });
    fireEvent.press(r.getByTestId('club-live'));
    expect(n.navigate).toHaveBeenLastCalledWith('GoLive', expect.objectContaining({ kind: 'meet' }));
  });

  test('start a club from the book page', async () => {
    mockApi.fetchPublication.mockResolvedValue(book());
    mockApi.fetchBookClubs.mockResolvedValue({ results: [] });
  mockApi.fetchAiStatus.mockResolvedValue({ enabled: false });
  mockApi.fetchHighlightCollections.mockResolvedValue({ results: [] });
  mockApi.fetchOrganizations.mockResolvedValue({ results: [] });
  mockApi.fetchOrgInvitations.mockResolvedValue({ results: [] });
  require('../../services/bookAi').__resetBookAi();
    mockApi.createBookClub.mockResolvedValue({ id: 3 });
    const n = nav();
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('club-start')).toBeTruthy());
    fireEvent.press(r.getByTestId('club-start'));
    fireEvent.press(r.getByTestId('club-pace-week2'));
    fireEvent.press(r.getByTestId('club-public'));
    await act(async () => { fireEvent.press(r.getByTestId('club-create')); });
    expect(mockApi.createBookClub).toHaveBeenCalledWith(5, {
      name: 'club.defaultName:Book 5', private: false, chapters_per_step: 2, every_days: 7,
    });
    expect(n.navigate).toHaveBeenLastCalledWith('BookClub', { clubId: 3 });
  });

  test('a group that is a book club shows the way to its book', async () => {
    mockApi.fetchClubOfGroup.mockResolvedValue({ club: 3 });
    const n = nav();
    const r = render(<BookClubBanner groupSlug="readers" navigation={n} />);
    await waitFor(() => expect(r.getByTestId('group-book-club')).toBeTruthy());
    fireEvent.press(r.getByTestId('group-book-club'));
    expect(n.navigate).toHaveBeenCalledWith('BookClub', { clubId: 3 });
    mockApi.fetchClubOfGroup.mockResolvedValue({ club: null });
    const none = render(<BookClubBanner groupSlug="plain" navigation={nav()} />);
    await act(async () => {});
    expect(none.queryByTestId('group-book-club')).toBeNull();
  });
});

// ── Phase 6: AI in books, collections, "because you highlighted" ────────────
describe('Phase 6', () => {
  const WriterAssistant = require('../WriterAssistant').default;
  const BookLibrary = require('../../components/BookLibrary').default;
  const BooksHome = require('../../components/BooksHome').default;
  const params = { id: 5, index: 0, book: { id: 5, title: 'B', theme: {}, chapters: [
    { id: 51, version: 1, title: 'One', word_count: 100 }, { id: 52, version: 1, title: 'Two', word_count: 100 },
  ] } };
  const openReader = async () => {
    mockApi.fetchPublicationChapter.mockImplementation(async (id, i) => ({ chapter: {
      id: 51 + i, version: 1, title: 'One', word_count: 100, body: 'First paragraph.\n\nSecond paragraph.' } }));
    const r = render(<ChapterReader route={{ params }} navigation={nav()} />);
    await waitFor(() => expect(r.getByText('Second paragraph.')).toBeTruthy());
    return r;
  };
  const select = async (r, i) => { await act(async () => { fireEvent(r.getByTestId(`reader-block-${i}`), 'longPress'); }); };
  const aiErr = (status, code) => Object.assign(new Error('x'), status ? { status, data: { code } } : {});

  test('explain a paragraph: answered from the book, marked as AI, asked once', async () => {
    mockApi.fetchAiStatus.mockResolvedValue({ enabled: true, used: 0, limit: 40 });
    mockApi.askBookAi.mockResolvedValue({ kind: 'explain', text: 'It means the story goes on.', cached: false });
    const r = await openReader();
    await select(r, 1);
    await waitFor(() => expect(r.getByTestId('book-action-explain')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('book-action-explain')); });
    await waitFor(() => expect(r.getByText('It means the story goes on.')).toBeTruthy());
    expect(mockApi.askBookAi).toHaveBeenCalledWith(5, { kind: 'explain', chapter: 0, passage: 'Second paragraph.', lang: 'en' });
    expect(r.getByText('ai.badge')).toBeTruthy();
    expect(r.getByText('ai.disclaimer')).toBeTruthy();
    // The same paragraph again: the answer at once, not asked again.
    await select(r, 1);
    await act(async () => { fireEvent.press(r.getByTestId('book-action-explain')); });
    expect(r.getByText('It means the story goes on.')).toBeTruthy();
    expect(mockApi.askBookAi).toHaveBeenCalledTimes(1);
  });

  test('no AI on the server: no AI buttons', async () => {
    const r = await openReader();
    await flush();
    await select(r, 0);
    expect(r.getByTestId('book-action-collect')).toBeTruthy();
    expect(r.queryByTestId('book-action-explain')).toBeNull();
    expect(r.queryByTestId('reader-summary')).toBeNull();
  });

  test('chapter summary and hard words; when no answer comes it says why', async () => {
    mockApi.fetchAiStatus.mockResolvedValue({ enabled: true });
    mockApi.askBookAi.mockImplementation(async (id, spec) => (spec.kind === 'summary'
      ? { text: '- A beginning.' }
      : { terms: [{ term: 'paragraph', meaning: 'a block of writing' }] }));
    const r = await openReader();
    await waitFor(() => expect(r.getByTestId('reader-summary')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('reader-summary')); });
    await waitFor(() => expect(r.getByText('- A beginning.')).toBeTruthy());
    expect(mockApi.askBookAi).toHaveBeenLastCalledWith(5, { kind: 'summary', chapter: 0, passage: '', lang: 'en' });

    await select(r, 0);
    await act(async () => { fireEvent.press(r.getByTestId('book-action-define')); });
    await waitFor(() => expect(r.getByText('a block of writing')).toBeTruthy());
    expect(r.getByText('paragraph')).toBeTruthy();

    mockApi.askBookAi.mockRejectedValueOnce(aiErr(429, 'ai_limit'));
    await select(r, 1);
    await act(async () => { fireEvent.press(r.getByTestId('book-action-define')); });
    await waitFor(() => expect(r.getByText('ai.limit')).toBeTruthy());
    expect(r.queryByTestId('ai-retry')).toBeNull();                   // waiting won't help today

    mockApi.askBookAi.mockRejectedValueOnce(aiErr());                  // no signal
    await select(r, 1);
    await act(async () => { fireEvent.press(r.getByTestId('book-action-explain')); });
    await waitFor(() => expect(r.getByText('ai.offline')).toBeTruthy());
    mockApi.askBookAi.mockResolvedValueOnce({ text: 'Now it came.' });
    await act(async () => { fireEvent.press(r.getByTestId('ai-retry')); });
    await waitFor(() => expect(r.getByText('Now it came.')).toBeTruthy());
  });

  test('a paragraph goes into a collection (marked, if it wasn\'t) and syncs', async () => {
    mockApi.fetchHighlightCollections.mockResolvedValue({ results: [{ name: 'Prayer', count: 2 }] });
    const r = await openReader();
    await select(r, 0);
    await act(async () => { fireEvent.press(r.getByTestId('book-action-collect')); });
    await waitFor(() => expect(r.getByTestId('collection-Prayer')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('collection-Prayer')); });
    await flush();
    const ops = mockApi.syncBookHighlights.mock.calls.flatMap((c) => c[0]);
    expect(ops[0]).toMatchObject({ op: 'upsert', block: 0, color: 'yellow', collection: 'Prayer' });

    // A new one, typed.
    await select(r, 1);
    await act(async () => { fireEvent.press(r.getByTestId('book-action-collect')); });
    fireEvent.changeText(r.getByTestId('collection-new'), '  Sermon   ideas ');
    await act(async () => { fireEvent.press(r.getByTestId('collection-add')); });
    await flush();
    const all = mockApi.syncBookHighlights.mock.calls.flatMap((c) => c[0]);
    expect(all[all.length - 1]).toMatchObject({ block: 1, collection: 'Sermon ideas' });
  });

  test('the library: highlights by collection', async () => {
    mockApi.fetchHighlightCollections.mockResolvedValue({ results: [{ name: 'Prayer', count: 1 }] });
    mockApi.fetchBookHighlights.mockImplementation(async (p) => ({ results: [
      { client_id: p.collection ? 'p1' : 'a1', publication: 5, publication_title: 'B', chapter_title: 'One', block: 0,
        quote: p.collection ? 'In Prayer' : 'Anything', color: 'yellow', note: '', collection: p.collection || '' },
    ] }));
    mockApi.fetchPublications.mockResolvedValue({ results: [] });
    const r = render(<BookLibrary navigation={nav()} />);
    await act(async () => { fireEvent.press(r.getByTestId('library-shelf-highlights')); });
    await waitFor(() => expect(r.getByTestId('library-collection-Prayer')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('library-collection-Prayer')); });
    await waitFor(() => expect(r.getByText('“In Prayer”')).toBeTruthy());
    expect(mockApi.fetchBookHighlights).toHaveBeenLastCalledWith({ collection: 'Prayer' });
    expect(r.getAllByText('Prayer').length).toBeGreaterThan(1);                 // the chip and the row's tag
  });

  test('Discover: books because of the passage last highlighted', async () => {
    mockApi.fetchBooksHome.mockResolvedValue({
      continue: [], picks: [], trending: [], following: [], new: [], rising: [],
      because: { quote: 'A sower went out', publication: 5, title: 'Parables', books: [pubRow(7, { title: 'More parables' })] },
    });
    const n = nav();
    const r = render(<BooksHome navigation={n} />);
    await waitFor(() => expect(r.getByTestId('home-because')).toBeTruthy());
    expect(r.getByText('home.because:Parables')).toBeTruthy();
    expect(r.getByText('“A sower went out”')).toBeTruthy();
    expect(within(r.getByTestId('home-because')).getAllByText('More parables').length).toBeGreaterThan(0);
  });

  test('the writing helper: the whole chapter shortened, used, and undone', async () => {
    mockApi.fetchAiStatus.mockResolvedValue({ enabled: true });
    mockApi.fetchPublication.mockResolvedValue({ ...book(), chapters: [{ id: 51, title: 'One', body: 'A long long text.' }] });
    mockApi.askWriterAi.mockResolvedValue({ kind: 'shorten', text: 'A text.' });
    const n = nav();
    const r = render(<PublicationEditor route={{ params: { id: 5 } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('editor-ai-0')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('editor-ai-0')); });
    expect(r.getByText('ai.scopeChapter')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('ai-choice-shorten')); });
    await waitFor(() => expect(r.getByTestId('ai-use')).toBeTruthy());
    expect(mockApi.askWriterAi).toHaveBeenCalledWith(5, { kind: 'shorten', text: 'A long long text.', lang: 'en' });
    await act(async () => { fireEvent.press(r.getByTestId('ai-use')); });
    expect(r.getByDisplayValue('A text.')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('editor-ai-undo-0')); });
    expect(r.getByDisplayValue('A long long text.')).toBeTruthy();
    expect(r.queryByTestId('editor-ai-undo-0')).toBeNull();
    fireEvent.press(r.getByTestId('editor-assistant'));
    expect(n.navigate).toHaveBeenCalledWith('WriterAssistant', { id: 5, title: 'Book 5' });
  });

  test('the writing helper works on the selected words only', async () => {
    mockApi.fetchAiStatus.mockResolvedValue({ enabled: true });
    mockApi.fetchPublication.mockResolvedValue({ ...book(), chapters: [{ id: 51, title: 'One', body: 'Keep this. Fix teh this.' }] });
    mockApi.askWriterAi.mockResolvedValue({ text: 'Fix the this.' });
    const r = render(<PublicationEditor route={{ params: { id: 5 } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('editor-ai-0')).toBeTruthy());
    fireEvent(r.getByDisplayValue('Keep this. Fix teh this.'), 'selectionChange', { nativeEvent: { selection: { start: 11, end: 24 } } });
    await act(async () => { fireEvent.press(r.getByTestId('editor-ai-0')); });
    expect(r.getByText('ai.scopeSelection')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('ai-choice-grammar')); });
    await waitFor(() => expect(r.getByTestId('ai-use')).toBeTruthy());
    expect(mockApi.askWriterAi).toHaveBeenCalledWith(5, { kind: 'grammar', text: 'Fix teh this.', lang: 'en' });
    await act(async () => { fireEvent.press(r.getByTestId('ai-use')); });
    expect(r.getByDisplayValue('Keep this. Fix the this.')).toBeTruthy();
  });

  test('no AI, or a book not saved yet: no helper', async () => {
    mockApi.fetchPublication.mockResolvedValue({ ...book(), chapters: [{ id: 51, title: 'One', body: 'Text' }] });
    const r = render(<PublicationEditor route={{ params: { id: 5 } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByDisplayValue('Book 5')).toBeTruthy());
    await flush();
    expect(r.queryByTestId('editor-ai-0')).toBeNull();
    mockApi.fetchAiStatus.mockResolvedValue({ enabled: true });
    require('../../utils/screenCache').dropCache('ai:status');
    const fresh = render(<PublicationEditor route={{ params: {} }} navigation={nav()} />);
    await flush();
    expect(fresh.queryByTestId('editor-ai-0')).toBeNull();
    expect(fresh.queryByTestId('editor-assistant')).toBeNull();
  });

  test('the assistant: a structure, and the manuscript check picked up where it is', async () => {
    mockApi.askWriterAi.mockResolvedValue({ text: '## Shape' });
    mockApi.fetchManuscriptCheck.mockResolvedValue({ status: 'done', truncated: false, issues: [
      { chapter: 2, quote: 'Tom', problem: 'Called Tim in chapter 1', suggestion: 'Pick one name' },
    ] });
    mockApi.startManuscriptCheck.mockResolvedValue({ status: 'queued', issues: [] });
    const r = render(<WriterAssistant route={{ params: { id: 5, title: 'B' } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('check-done')).toBeTruthy());
    expect(r.getByText('assistant.found:1')).toBeTruthy();
    expect(r.getByText('Called Tim in chapter 1')).toBeTruthy();
    expect(r.getByText('pubDetail.chapterN:2')).toBeTruthy();

    await act(async () => { fireEvent.press(r.getByTestId('structure-run')); });
    await waitFor(() => expect(r.getByText('## Shape')).toBeTruthy());
    expect(mockApi.askWriterAi).toHaveBeenCalledWith(5, { kind: 'structure', lang: 'en' });

    await act(async () => { fireEvent.press(r.getByTestId('check-run')); });
    expect(r.getByTestId('check-working')).toBeTruthy();
    expect(r.queryByTestId('check-run')).toBeNull();
    r.unmount();                                                      // leaving stops the asking, not the check
  });

  test('a check that can\'t start says why', async () => {
    mockApi.fetchManuscriptCheck.mockResolvedValue({ status: null });
    mockApi.startManuscriptCheck.mockRejectedValue(aiErr(429, 'ai_limit'));
    const r = render(<WriterAssistant route={{ params: { id: 5 } }} navigation={nav()} />);
    await flush();
    await act(async () => { fireEvent.press(r.getByTestId('check-run')); });
    expect(r.getByText('ai.limit')).toBeTruthy();
  });
});

// ── Phase 7: organisations, books in the feed, the cover grid ───────────────
describe('Phase 7', () => {
  const OrganizationPage = require('../OrganizationPage').default;
  const OrganizationEdit = require('../OrganizationEdit').default;
  const OrganizationMembers = require('../OrganizationMembers').default;
  const Organizations = require('../Organizations').default;
  const BookPostMedia = require('../../components/BookPostMedia').default;
  const BooksHome = require('../../components/BooksHome').default;
  const org = (extra = {}) => ({
    id: 3, slug: 'cku', name: 'Central Kenya Union', kind: 'union', logo: '', is_verified: true, location: 'Nairobi',
    website: 'https://cku.org', description: 'Books for the field', members_count: 4, followers_count: 10,
    books_count: 1, my_role: null, invited_as: null, is_following: false, ...extra,
  });

  test('the list is a shelf of covers; large, small or the list, remembered', async () => {
    mockApi.fetchPublications.mockResolvedValue({ results: [pubRow(1), pubRow(2, { organization: { name: 'CKU', is_verified: true } })], next: null });
    const r = render(<Articles navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('book-tile-2')).toBeTruthy());
    expect(within(r.getByTestId('book-tile-2')).getByText('CKU')).toBeTruthy();       // published under it
    await act(async () => { fireEvent.press(r.getByTestId('articles-layout-list')); });
    expect(r.queryByTestId('book-tile-1')).toBeNull();
    expect(r.getByText('Book 1')).toBeTruthy();
    expect(await AsyncStorage.getItem('pubs:layout')).toBe('list');
    await act(async () => { fireEvent.press(r.getByTestId('articles-layout-compact')); });
    expect(r.getByTestId('book-tile-1')).toBeTruthy();
    expect(r.getByTestId('articles-layout-compact').props.accessibilityState).toEqual({ checked: true });
  });

  test('a book in the feed: the card opens the book, a passage opens at its place, double-tap likes', async () => {
    jest.useFakeTimers();
    try {
      mockNavigation = nav();
      const like = jest.fn();
      const post = { id: 70, content_type: 'book', book: {
        id: 5, title: 'The Silent Path', cover: '', category: 'devotional', author: { id: 2, username: 'writer' },
        organization: { name: 'CKU', is_verified: true }, quote: '', chapter_id: null } };
      const r = render(<BookPostMedia item={post} width={360} onDoubleTapLike={like} />);
      expect(r.getByText('The Silent Path')).toBeTruthy();
      expect(r.getByText('bookPost.read')).toBeTruthy();
      fireEvent.press(r.getByTestId('book-post-70'));
      act(() => { jest.advanceTimersByTime(400); });
      expect(mockNavigation.navigate).toHaveBeenCalledWith('PublicationDetail', expect.objectContaining({ id: 5 }));
      fireEvent.press(r.getByTestId('book-post-70'));
      fireEvent.press(r.getByTestId('book-post-70'));
      act(() => { jest.advanceTimersByTime(400); });
      expect(like).toHaveBeenCalledWith(post);
      expect(mockNavigation.navigate).toHaveBeenCalledTimes(1);

      const passage = { ...post, id: 71, book: { ...post.book, quote: 'A sower went out.', chapter_id: 51, chapter_title: 'One', block: 2 } };
      const q = render(<BookPostMedia item={passage} width={360} />);
      expect(q.getByTestId('book-post-quote')).toBeTruthy();
      fireEvent.press(q.getByTestId('book-post-71'));
      act(() => { jest.advanceTimersByTime(400); });
      expect(mockNavigation.navigate).toHaveBeenLastCalledWith('ChapterReader', { id: 5, chapterId: 51, block: 2 });
    } finally {
      jest.useRealTimers();
    }
  });

  test('share a passage from the reader to the feed', async () => {
    mockApi.fetchPublicationChapter.mockImplementation(async (id, i) => ({ chapter: {
      id: 51 + i, version: 1, title: 'One', word_count: 100, body: 'First paragraph.\n\nSecond paragraph.' } }));
    mockApi.shareBookToFeed.mockResolvedValue({ id: 80 });
    const params = { id: 5, index: 0, book: { id: 5, title: 'B', status: 'published', theme: {}, chapters: [{ id: 51, version: 1, title: 'One' }] } };
    const r = render(<ChapterReader route={{ params }} navigation={nav()} />);
    await waitFor(() => expect(r.getByText('Second paragraph.')).toBeTruthy());
    await act(async () => { fireEvent(r.getByTestId('reader-block-1'), 'longPress'); });
    await act(async () => { fireEvent.press(r.getByTestId('book-action-share')); });
    expect(r.getByTestId('share-book-sheet')).toBeTruthy();
    fireEvent.changeText(r.getByTestId('share-book-caption'), 'This one ');
    await act(async () => { fireEvent.press(r.getByTestId('share-book-post')); });
    expect(mockApi.shareBookToFeed).toHaveBeenCalledWith(5, {
      caption: 'This one', quote: 'Second paragraph.', chapter_id: 51, block: 1,
    });
    expect(mockNotify).toHaveBeenCalledWith('shareBook.postedTitle', 'shareBook.postedBody');
  });

  test('the book page: published by an organisation; share it to the feed', async () => {
    mockApi.fetchPublication.mockResolvedValue(book({ organization: { slug: 'cku', name: 'CKU', is_verified: true, logo: '' } }));
    mockApi.shareBookToFeed.mockResolvedValue({ id: 81 });
    const n = nav();
    const r = render(<PublicationDetail route={{ params: { id: 5 } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('pub-org')).toBeTruthy());
    expect(r.getByText('org.publishedBy:CKU')).toBeTruthy();
    fireEvent.press(r.getByTestId('pub-org'));
    expect(n.navigate).toHaveBeenCalledWith('OrganizationPage', { slug: 'cku', name: 'CKU' });
    await act(async () => { fireEvent.press(r.getByTestId('pub-share')); });
    await act(async () => { fireEvent.press(r.getByTestId('share-book-post')); });
    expect(mockApi.shareBookToFeed).toHaveBeenCalledWith(5, { caption: '' });
  });

  test('start an organisation', async () => {
    mockApi.createOrganization.mockResolvedValue(org({ my_role: 'owner' }));
    const n = nav();
    const r = render(<OrganizationEdit route={{ params: {} }} navigation={n} />);
    fireEvent.changeText(r.getByTestId('org-name'), 'Central Kenya Union');
    fireEvent.press(r.getByTestId('org-kind-union'));
    fireEvent.changeText(r.getByTestId('org-website'), 'cku.org');
    await act(async () => { fireEvent.press(r.getByTestId('org-save')); });
    expect(mockApi.createOrganization).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Central Kenya Union', kind: 'union', website: 'cku.org' }));
    expect(n.replace).toHaveBeenCalledWith('OrganizationPage', { slug: 'cku', name: 'Central Kenya Union' });

    const empty = render(<OrganizationEdit route={{ params: {} }} navigation={nav()} />);
    await act(async () => { fireEvent.press(empty.getByTestId('org-save')); });
    expect(mockNotify).toHaveBeenCalledWith('org.nameNeeded', 'org.nameNeededBody');
  });

  test('an organisation\'s page: who it is, its books, follow; kept for offline', async () => {
    mockApi.fetchOrganization.mockResolvedValue(org());
    mockApi.fetchPublications.mockResolvedValue({ results: [pubRow(7, { title: 'Health Message' })] });
    mockApi.followOrganization.mockResolvedValue({ is_following: true, followers_count: 11 });
    const n = nav();
    const r = render(<OrganizationPage route={{ params: { slug: 'cku' } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('book-tile-7')).toBeTruthy());
    expect(mockApi.fetchPublications).toHaveBeenCalledWith({ organization: 'cku' });
    expect(r.getByText('org.kind.union · Nairobi')).toBeTruthy();
    expect(r.queryByTestId('org-edit')).toBeNull();                              // not theirs to run
    await act(async () => { fireEvent.press(r.getByTestId('org-follow')); });
    expect(mockApi.followOrganization).toHaveBeenCalledWith('cku', true);
    expect(r.getByText('11')).toBeTruthy();
    fireEvent.press(r.getByTestId('book-tile-7'));
    expect(n.navigate).toHaveBeenCalledWith('PublicationDetail', expect.objectContaining({ id: 7 }));

    // Offline next time: the kept page.
    mockApi.fetchOrganization.mockRejectedValue(new Error('offline'));
    const again = render(<OrganizationPage route={{ params: { slug: 'cku' } }} navigation={nav()} />);
    expect(again.getByText('Books for the field')).toBeTruthy();
  });

  test('an invitation is answered on the page; those who run it manage it', async () => {
    mockApi.fetchOrganization.mockResolvedValue(org({ invited_as: 'editor' }));
    mockApi.fetchPublications.mockResolvedValue({ results: [] });
    mockApi.respondOrgInvite.mockResolvedValue(org({ my_role: 'editor' }));
    const n = nav();
    const r = render(<OrganizationPage route={{ params: { slug: 'cku' } }} navigation={n} />);
    await waitFor(() => expect(r.getByTestId('org-invite')).toBeTruthy());
    expect(r.getByText('org.invitedAs:org.role.editor')).toBeTruthy();
    await act(async () => { fireEvent.press(r.getByTestId('org-accept')); });
    expect(mockApi.respondOrgInvite).toHaveBeenCalledWith('cku', true);
    expect(r.queryByTestId('org-invite')).toBeNull();
    expect(r.getByTestId('org-people')).toBeTruthy();
    expect(r.queryByTestId('org-edit')).toBeNull();                              // an editor doesn't run it

    mockApi.fetchOrganization.mockResolvedValue(org({ my_role: 'admin' }));
    const admin = render(<OrganizationPage route={{ params: { slug: 'cku' } }} navigation={n} />);
    await waitFor(() => expect(admin.getByTestId('org-edit')).toBeTruthy());
    fireEvent.press(admin.getByTestId('org-edit'));
    expect(n.navigate).toHaveBeenCalledWith('OrganizationEdit', { slug: 'cku' });
  });

  test('people: invite as editor; an admin can\'t make admins', async () => {
    mockApi.fetchOrgMembers.mockResolvedValue({ my_role: 'admin', results: [
      { id: 1, user: { id: 9, username: 'boss' }, role: 'owner', accepted: true },
      { id: 2, user: { id: 1, username: 'me' }, role: 'admin', accepted: true },
    ] });
    mockApi.inviteOrgMember.mockResolvedValue({ id: 3, user: { id: 4, username: 'ann' }, role: 'editor', accepted: false });
    const r = render(<OrganizationMembers route={{ params: { slug: 'cku', name: 'CKU' } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('org-member-username')).toBeTruthy());
    expect(r.queryByTestId('org-member-role-admin')).toBeNull();
    expect(r.queryByTestId('org-member-remove-1')).toBeNull();                   // the owner stays
    fireEvent.changeText(r.getByTestId('org-member-username'), 'ann');
    fireEvent.press(r.getByTestId('org-member-role-editor'));
    await act(async () => { fireEvent.press(r.getByTestId('org-member-invite')); });
    expect(mockApi.inviteOrgMember).toHaveBeenCalledWith('cku', 'ann', 'editor');
    expect(r.getByText('org.role.editor · studio.invited')).toBeTruthy();
  });

  test('organisations: mine and invitations; find by name or kind', async () => {
    mockApi.fetchOrganizations.mockImplementation(async (p) => ({ results: p.mine
      ? [{ slug: 'cku', name: 'Central Kenya Union', kind: 'union', books_count: 1 }]
      : [{ slug: p.kind === 'school' ? 'uea' : 'any', name: p.kind === 'school' ? 'UEA Baraton' : 'Any', kind: p.kind || 'other' }] }));
    mockApi.fetchOrgInvitations.mockResolvedValue({ results: [
      { organization: { slug: 'pub', name: 'Africa Herald', kind: 'publisher' }, role: 'author', invited_by: 'boss' }] });
    const n = nav();
    const r = render(<Organizations navigation={n} />);
    await waitFor(() => expect(r.getByTestId('org-row-cku')).toBeTruthy());
    expect(r.getByText('org.invitedBy:boss,org.role.author')).toBeTruthy();
    fireEvent.press(r.getByTestId('org-row-pub'));
    expect(n.navigate).toHaveBeenCalledWith('OrganizationPage', { slug: 'pub', name: 'Africa Herald' });
    await act(async () => { fireEvent.press(r.getByTestId('orgs-tab-find')); });
    await act(async () => { fireEvent.press(r.getByTestId('orgs-kind-school')); });
    await waitFor(() => expect(r.getByTestId('org-row-uea')).toBeTruthy());
    expect(mockApi.fetchOrganizations).toHaveBeenLastCalledWith({ kind: 'school' });
  });

  test('the editor: publish under an organisation you\'re in', async () => {
    mockApi.fetchOrganizations.mockResolvedValue({ results: [{ slug: 'cku', name: 'CKU' }] });
    mockApi.fetchPublication.mockResolvedValue({ ...book(), status: 'draft', chapters: [{ id: 51, title: 'One', body: 'Text' }] });
    mockApi.updatePublication.mockResolvedValue({ id: 5 });
    const r = render(<PublicationEditor route={{ params: { id: 5 } }} navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('editor-org-cku')).toBeTruthy());
    expect(r.getByTestId('editor-org-me').props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(r.getByTestId('editor-org-cku'));
    await act(async () => { fireEvent.press(r.getByTestId('editor-save-draft')); });
    expect(mockApi.updatePublication).toHaveBeenCalledWith(5, expect.objectContaining({ organization_slug: 'cku' }));
  });

  test('Discover: publishers', async () => {
    mockApi.fetchBooksHome.mockResolvedValue({
      continue: [], picks: [], trending: [], following: [], new: [], rising: [],
      publishers: [{ slug: 'cku', name: 'CKU', kind: 'union', logo: '', is_verified: true, books_count: 4 }],
    });
    const n = nav();
    const r = render(<BooksHome navigation={n} />);
    await waitFor(() => expect(r.getByTestId('home-publishers')).toBeTruthy());
    expect(r.getByText('home.booksN:4')).toBeTruthy();
    fireEvent.press(r.getByTestId('publisher-cku'));
    expect(n.navigate).toHaveBeenCalledWith('OrganizationPage', { slug: 'cku', name: 'CKU' });
    fireEvent.press(r.getByTestId('home-publishers-all'));
    expect(n.navigate).toHaveBeenLastCalledWith('Organizations');
  });
});

// ── Safe areas and screen sizes ─────────────────────────────────────────────
describe('Safe areas and sizes', () => {
  const RN = require('react-native');
  const { useBookGrid, SHELF_MAX } = require('../../components/BookGrid');
  const flat = (el) => [].concat(el.props.style).flat(Infinity).filter(Boolean).reduce((a, x) => ({ ...a, ...x }), {});
  afterEach(() => jest.restoreAllMocks());

  test('the reader\'s tools sit below the status bar and clear of a notch', async () => {
    mockInsets = { top: 30, bottom: 20, left: 44, right: 44 };
    mockApi.fetchPublicationChapter.mockResolvedValue({ chapter: { id: 51, version: 1, title: 'One', body: 'Words.' } });
    const r = render(<ChapterReader route={{ params: { id: 5, index: 0, book: { id: 5, title: 'B', theme: {}, chapters: [{ id: 51, title: 'One' }] } } }}
      navigation={nav()} />);
    await waitFor(() => expect(r.getByText('Words.')).toBeTruthy());
    const bar = flat(r.getByTestId('reader-chrome'));
    expect(bar.top).toBe(32.5);                                   // below the status bar and the progress line
    expect(bar.paddingLeft).toBeGreaterThanOrEqual(44);
    expect(flat(r.getByTestId('reader-footer')).paddingBottom).toBeGreaterThanOrEqual(20);
  });

  test('the list\'s Write button and last rows clear the gesture bar', async () => {
    mockInsets = { top: 0, bottom: 24, left: 0, right: 0 };
    mockApi.fetchPublications.mockResolvedValue({ results: [pubRow(1)], next: null });
    const r = render(<Articles navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('book-tile-1')).toBeTruthy());
    expect(flat(r.getByTestId('articles-write')).bottom).toBe(24 + 24);   // spacing.lg + the inset
  });

  test('a narrow phone: the reader bar keeps its buttons, not a squeezed title', async () => {
    jest.spyOn(RN, 'useWindowDimensions').mockReturnValue({ width: 320, height: 640, scale: 2, fontScale: 1 });
    mockApi.fetchPublicationChapter.mockResolvedValue({ chapter: { id: 51, version: 1, title: 'One', body: 'Words.' } });
    const r = render(<ChapterReader route={{ params: { id: 5, index: 0, book: { id: 5, title: 'Long Book Title', theme: {}, chapters: [{ id: 51, title: 'One' }] } } }}
      navigation={nav()} />);
    await waitFor(() => expect(r.getByText('Words.')).toBeTruthy());
    expect(within(r.getByTestId('reader-chrome')).queryByText('Long Book Title')).toBeNull();
  });

  test('covers: 2 or 3 across a phone, and book-sized on a wide screen', () => {
    const grid = (w, layout) => {
      jest.spyOn(RN, 'useWindowDimensions').mockReturnValue({ width: w, height: 800, scale: 2, fontScale: 1 });
      let out;
      const Probe = () => { out = useBookGrid(layout); return null; };
      render(<Probe />);
      jest.restoreAllMocks();
      return out;
    };
    expect(grid(360, 'large').cols).toBe(2);
    expect(grid(360, 'compact').cols).toBe(3);
    expect(grid(320, 'compact').cols).toBe(3);
    const wide = grid(1920, 'large');
    expect(wide.tileW).toBeLessThan(220);                               // capped at the shelf's width
    expect(wide.cols * wide.tileW).toBeLessThanOrEqual(SHELF_MAX);
  });
});

describe('Publishing as', () => {
  test('the publish step says whose name it goes out under, and changes it there', async () => {
    mockApi.fetchOrganizations.mockResolvedValue({ results: [{ slug: 'cku', name: 'CKU' }] });
    mockApi.createPublication.mockResolvedValue({ id: 78 });
    const r = render(<PublicationEditor route={{ params: {} }} navigation={nav()} />);
    await waitFor(() => expect(r.getByTestId('editor-org-cku')).toBeTruthy());
    fireEvent.press(r.getByTestId('editor-org-cku'));                    // chosen in the form…
    fireEvent.changeText(r.getByTestId('editor-title'), 'Health Message');
    fireEvent.changeText(r.getByPlaceholderText('pub.chapterBodyPlaceholder'), 'Words');
    await act(async () => { fireEvent.press(r.getByTestId('editor-publish')); });
    // …and said again where it matters, on the button itself.
    expect(r.getByTestId('publish-as-cku').props.accessibilityState).toEqual({ checked: true });
    expect(within(r.getByTestId('publish-go')).getByText('publish.goAs:CKU')).toBeTruthy();
    fireEvent.press(r.getByTestId('publish-as-me'));                      // changed their mind, right there
    expect(within(r.getByTestId('publish-go')).getByText('publish.goAsMe')).toBeTruthy();
    expect(r.getByTestId('editor-org-me').props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(r.getByTestId('publish-rights'));
    await act(async () => { fireEvent.press(r.getByTestId('publish-go')); });
    expect(mockApi.createPublication).toHaveBeenCalledWith(expect.objectContaining({ organization_slug: '' }));
  });

  test('no organisations: it still says it\'s you', async () => {
    const r = render(<PublicationEditor route={{ params: {} }} navigation={nav()} />);
    fireEvent.changeText(r.getByTestId('editor-title'), 'Mine');
    fireEvent.changeText(r.getByPlaceholderText('pub.chapterBodyPlaceholder'), 'Words');
    await act(async () => { fireEvent.press(r.getByTestId('editor-publish')); });
    expect(within(r.getByTestId('publish-as')).getByText('@me')).toBeTruthy();
    expect(r.queryByTestId('publish-as-me')).toBeNull();                 // nothing to choose between
    expect(within(r.getByTestId('publish-go')).getByText('publish.goAsMe')).toBeTruthy();
  });
});