/**
 * Stories: creating one (portrait and landscape, keyboard-safe, video
 * preview, ask before discarding, shows in the row at once), watching one
 * (turns with the phone, a story that won't load moves on), and the row
 * (the "+" always there on your own bubble).
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(20000);

const mockT = (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k);
jest.mock('../../context/I18nContext', () => ({ useI18n: () => ({ t: mockT }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 30, bottom: 20, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  const Img = (props) => <View testID={props.testID || 'img'} {...props} />;
  Img.prefetch = jest.fn(async () => true);
  return { Image: Img };
});
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }) => children || null }));
jest.mock('../AppVideo', () => {
  const { View } = require('react-native');
  const AppVideo = (props) => <View testID="app-video" {...props} />;
  return AppVideo;
});
jest.mock('../tickets/KeyboardLift', () => ({ children }) => children);
const mockOrientation = { allowAllOrientations: jest.fn(), lockPortrait: jest.fn() };
jest.mock('../../utils/orientation', () => mockOrientation);
const mockPicker = {
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  launchImageLibraryAsync: jest.fn(),
};
jest.mock('expo-image-picker', () => mockPicker);
jest.mock('../../services/imageProcessing', () => ({ compressImage: jest.fn(async (uri) => ({ uri: `${uri}#small` })) }));
jest.mock('../../services/videoProcessing', () => ({ processVideo: jest.fn(async ({ uri }) => ({ uri })) }));
jest.mock('../../services/cloudinary', () => ({ uploadMedia: jest.fn(async () => ({ publicId: 'p1', url: 'https://cdn.test/s.jpg' })) }));
const mockApi = { createStory: jest.fn(async (b) => ({ id: 9, ...b })), viewStory: jest.fn(async () => ({})), fetchStoryFeed: jest.fn(async () => []) };
jest.mock('../../services/api', () => new Proxy({}, { get: (_, k) => (...a) => mockApi[k](...a) }));
jest.mock('../../context/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 7, username: 'mark' } }) }));
jest.mock('../../utils/screenCache', () => ({
  peekCache: () => null, readCache: async () => null, writeCache: jest.fn(), userKey: (u, n) => `u${u}:${n}`,
}));

let mockNav;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useFocusEffect: (fn) => require('react').useEffect(fn, [fn]),
}));

const mockDims = { width: 390, height: 844 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ ...mockDims, scale: 2, fontScale: 1 }),
}));

const { emit, on, EVENTS } = require('../../utils/appEvents');
const CreateStoryScreen = require('../CreateStoryScreen').default;
const StoryViewer = require('../StoryViewer').default;
const { timeAgo } = require('../StoryViewer');
const StoriesBar = require('../StoriesBar').default;
const { storyCover } = require('../StoriesBar');

const listeners = {};
beforeEach(() => {
  Object.keys(listeners).forEach((k) => delete listeners[k]);
  mockNav = {
    goBack: jest.fn(), navigate: jest.fn(), canGoBack: () => true, dispatch: jest.fn(),
    addListener: jest.fn((ev, fn) => { listeners[ev] = fn; return () => { delete listeners[ev]; }; }),
  };
  mockDims.width = 390; mockDims.height = 844;
  Object.values(mockOrientation).forEach((f) => f.mockClear());
  mockPicker.launchImageLibraryAsync.mockReset();
  mockApi.createStory.mockClear();
});

describe('creating a story', () => {
  test('turns with the phone while open, portrait again on leaving', () => {
    const screen = render(<CreateStoryScreen />);
    expect(mockOrientation.allowAllOrientations).toHaveBeenCalled();
    screen.unmount();
    expect(mockOrientation.lockPortrait).toHaveBeenCalled();
  });

  test('portrait: a 9:16 preview that fits; landscape: side by side, sized by the height', () => {
    const portrait = render(<CreateStoryScreen />);
    const box = [].concat(portrait.getByTestId('story-pick').props.style).reduce((a, b) => ({ ...a, ...b }), {});
    expect(box.width / box.height).toBeCloseTo(9 / 16, 2);
    expect(box.width).toBeLessThanOrEqual(390);

    mockDims.width = 844; mockDims.height = 390;
    const wide = render(<CreateStoryScreen />);
    const side = [].concat(wide.getByTestId('story-pick').props.style).reduce((a, b) => ({ ...a, ...b }), {});
    expect(side.height).toBeLessThan(390);
    expect(side.width / side.height).toBeCloseTo(9 / 16, 2);
  });

  test('a video shows as a moving preview, not a blank picture; share sends it and shows it in the row', async () => {
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'video', uri: 'file:///v.mp4', duration: 12000, width: 720, height: 1280 }] });
    const created = jest.fn();
    const off = on(EVENTS.STORY_CREATED, created);
    const screen = render(<CreateStoryScreen />);
    await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
    expect(screen.getByTestId('app-video').props.source).toEqual({ uri: 'file:///v.mp4' });
    fireEvent.changeText(screen.getByTestId('story-caption'), '  Choir practice ');
    await act(async () => { fireEvent.press(screen.getByTestId('story-share')); });
    expect(mockApi.createStory).toHaveBeenCalledWith(expect.objectContaining({ content_type: 'video', caption: 'Choir practice' }));
    expect(created).toHaveBeenCalled();
    expect(mockNav.goBack).toHaveBeenCalled();
    off();
  });

  test('a clip over 30 s is refused with a translated title', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'video', uri: 'file:///long.mp4', duration: 45000 }] });
    const screen = render(<CreateStoryScreen />);
    await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
    expect(alert).toHaveBeenCalledWith('story.tooLongTitle', 'story.tooLong');
    expect(screen.queryByTestId('story-preview')).toBeNull();
    alert.mockRestore();
  });

  test('leaving with a photo chosen asks first; leaving empty does not', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<CreateStoryScreen />);
    const empty = { preventDefault: jest.fn(), data: { action: {} } };
    listeners.beforeRemove(empty);
    expect(empty.preventDefault).not.toHaveBeenCalled();

    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'image', uri: 'file:///a.jpg' }] });
    await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
    const leaving = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    listeners.beforeRemove(leaving);
    expect(leaving.preventDefault).toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('story.discardTitle', 'story.discardBody', expect.any(Array));
    alert.mockRestore();
  });
});

describe('watching a story', () => {
  const group = {
    user: { id: 3, username: 'ann', profile_picture: null },
    stories: [
      { id: 1, content_type: 'image', media_url: 'https://cdn.test/1.jpg', caption: 'Sunrise', created_at: new Date().toISOString() },
      { id: 2, content_type: 'image', media_url: 'https://cdn.test/2.jpg', created_at: new Date().toISOString() },
    ],
  };

  test('turns with the phone; sideways shows the whole story', () => {
    mockDims.width = 844; mockDims.height = 390;
    const screen = render(<StoryViewer route={{ params: { group } }} navigation={mockNav} />);
    expect(mockOrientation.allowAllOrientations).toHaveBeenCalled();
    const img = screen.UNSAFE_root.findAll((n) => n.props?.source?.uri === 'https://cdn.test/1.jpg' && n.props.contentFit)[0];
    expect(img.props.contentFit).toBe('contain');
  });

  test('a story that will not load says so instead of spinning forever', () => {
    const screen = render(<StoryViewer route={{ params: { group } }} navigation={mockNav} />);
    const img = screen.UNSAFE_root.findAll((n) => n.props?.source?.uri === 'https://cdn.test/1.jpg' && n.props.contentFit)[0];
    act(() => { img.props.onError(); });
    expect(screen.getByTestId('story-failed')).toBeTruthy();
  });

  test('times are short and translated; a brand-new story is "now", not "0m ago"', () => {
    expect(timeAgo(new Date().toISOString(), mockT)).toBe('feed.ago.now');
    expect(timeAgo(new Date(Date.now() - 5 * 60000).toISOString(), mockT)).toBe('feed.ago.m:5');
    expect(timeAgo(new Date(Date.now() - 3 * 3600000).toISOString(), mockT)).toBe('feed.ago.h:3');
  });
});

describe('the stories row', () => {
  test('your bubble keeps its "+" with stories up, and a shared story shows at once', async () => {
    mockApi.fetchStoryFeed.mockResolvedValue([{ user: { id: 7, username: 'mark' }, stories: [{ id: 1 }], has_unviewed: false }]);
    const screen = render(<StoriesBar navigation={mockNav} />);
    await waitFor(() => expect(screen.getByTestId('story-add')).toBeTruthy());
    fireEvent.press(screen.getByTestId('story-add'));
    expect(mockNav.navigate).toHaveBeenCalledWith('CreateStory');
    fireEvent.press(screen.getByTestId('story-own'));
    expect(mockNav.navigate).toHaveBeenCalledWith('StoryViewer', expect.any(Object));

    const before = mockApi.fetchStoryFeed.mock.calls.length;
    await act(async () => { emit(EVENTS.STORY_CREATED, { id: 2 }); });
    expect(mockApi.fetchStoryFeed.mock.calls.length).toBe(before + 1);
    expect(screen.getByText('story.yours')).toBeTruthy();
  });
});

describe('the bubble shows a story, not the profile picture', () => {
  test('the newest photo is the cover; only videos: none', () => {
    const t0 = '2026-10-05T08:00:00Z';
    const t1 = '2026-10-05T09:00:00Z';
    expect(storyCover([
      { content_type: 'image', media_url: 'old.jpg', created_at: t0 },
      { content_type: 'video', media_url: 'clip.mp4', created_at: '2026-10-05T10:00:00Z' },
      { content_type: 'image', media_url: 'new.jpg', created_at: t1 },
    ])).toBe('new.jpg');
    expect(storyCover([{ content_type: 'video', media_url: 'clip.mp4', created_at: t0 }])).toBeNull();
    expect(storyCover([])).toBeNull();
  });

  test('your bubble shows your story photo once you have one', async () => {
    mockApi.fetchStoryFeed.mockResolvedValue([{
      user: { id: 7, username: 'mark', profile_picture: 'https://cdn.test/me.jpg' },
      stories: [{ id: 1, content_type: 'image', media_url: 'https://cdn.test/story.jpg', created_at: new Date().toISOString() }],
      has_unviewed: false,
    }]);
    const screen = render(<StoriesBar navigation={mockNav} />);
    await waitFor(() => expect(screen.getByTestId('story-own-cover').props.source).toEqual({ uri: 'https://cdn.test/story.jpg' }));
  });

  test('no stories yet: your profile picture', async () => {
    mockApi.fetchStoryFeed.mockResolvedValue([]);
    const screen = render(<StoriesBar navigation={mockNav} />);
    await waitFor(() => expect(screen.getByTestId('story-own-cover')).toBeTruthy());
    expect(screen.getByTestId('story-own-cover').props.source).not.toEqual({ uri: 'https://cdn.test/story.jpg' });
  });
});
