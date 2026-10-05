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
const mockVideo = {
  processVideo: jest.fn(async ({ uri }) => ({ uri: `${uri}#720p`, thumbnailUri: 'file:///poster.jpg' })),
  isVideoProcessingAvailable: jest.fn(() => true),
  needsCut: jest.requireActual('../../services/videoProcessing').needsCut,
  extractFrame: jest.fn(async () => 'file:///frame0.jpg'),
};
jest.mock('../../services/videoProcessing', () => mockVideo);
const mockUpload = jest.fn(async (file) => ({ publicId: file.name, url: `https://cdn.test/${file.name}` }));
jest.mock('../../services/cloudinary', () => ({ uploadMedia: (...a) => mockUpload(...a) }));
jest.mock('../FullSheet', () => ({ children, visible }) => (visible ? children : null));
const mockTrimmer = jest.fn(() => null);
jest.mock('../VideoTrimmer', () => (props) => mockTrimmer(props));
jest.mock('../CoverPicker', () => () => null);
const mockEnqueue = jest.fn();
const mockJobs = { list: [] };
jest.mock('../../services/uploadQueue', () => ({
  enqueueUpload: (...a) => mockEnqueue(...a),
  useUploads: () => mockJobs.list,
}));
const mockApi = {
  createStory: jest.fn(async (b) => ({ id: 9, ...b })), viewStory: jest.fn(async () => ({})), fetchStoryFeed: jest.fn(async () => []),
  reactToStory: jest.fn(async (id, emoji) => ({ my_reaction: emoji })),
  deleteStory: jest.fn(async () => ({})),
  fetchStoryViewers: jest.fn(async () => ({ count: 1, results: [{ user: { id: 3, username: 'ann' }, viewed_at: new Date().toISOString(), reaction: '🙏' }] })),
};
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

  test('a landscape photo previews landscape-shaped and whole, not cropped to 9:16', async () => {
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'image', uri: 'file:///wide.jpg', width: 1600, height: 900 }] });
    const screen = render(<CreateStoryScreen />);
    await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
    const box = [].concat(screen.getByTestId('story-preview').props.style).reduce((a, b) => ({ ...a, ...b }), {});
    expect(box.width / box.height).toBeCloseTo(16 / 9, 2);
    const img = screen.UNSAFE_root.findAll((n) => n.props?.source?.uri?.startsWith('file:///wide.jpg') && n.props.contentFit)[0];
    expect(img.props.contentFit).toBe('contain');
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

  test('a video previews playing; share hands it to the background queue and closes at once', async () => {
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'video', uri: 'file:///v.mp4', duration: 12000, width: 720, height: 1280 }] });
    mockTrimmer.mockClear();
    mockEnqueue.mockClear();
    const screen = render(<CreateStoryScreen />);
    await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
    expect(screen.getByTestId('app-video').props.source).toEqual({ uri: 'file:///v.mp4' });
    expect(mockTrimmer).not.toHaveBeenCalled();                      // 12 s: no need to trim first
    fireEvent.changeText(screen.getByTestId('story-caption'), '  Choir practice ');
    fireEvent.press(screen.getByTestId('story-share'));
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'story',
      snap: expect.objectContaining({
        caption: 'Choir practice',
        video: expect.objectContaining({ uri: 'file:///v.mp4' }),
        trim: { start: 0, end: 12 },
      }),
    }));
    expect(mockNav.goBack).toHaveBeenCalled();
    expect(mockVideo.processVideo).not.toHaveBeenCalled();            // that happens in the queue now
  });

  test('a photo goes to the queue as one image', async () => {
    mockEnqueue.mockClear();
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'image', uri: 'file:///a.jpg', width: 900, height: 1600 }] });
    const screen = render(<CreateStoryScreen />);
    await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
    fireEvent.press(screen.getByTestId('story-share'));
    expect(mockEnqueue.mock.calls[0][0].snap.images[0].uri).toContain('file:///a.jpg');
  });

  test('a clip over 30 s opens the trimmer, and the window chosen is what goes up', async () => {
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'video', uri: 'file:///long.mp4', duration: 95000, width: 1080, height: 1920 }] });
    mockTrimmer.mockClear();
    mockVideo.processVideo.mockClear();
    const screen = render(<CreateStoryScreen />);
    await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
    expect(mockTrimmer).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///long.mp4', durationSec: 95 }));
    act(() => { mockTrimmer.mock.calls.at(-1)[0].onChange(40, 65); });
    fireEvent.press(screen.getByTestId('story-trim-done'));
    expect(screen.getByText('story.trim:0:40,1:05,25')).toBeTruthy();
    mockEnqueue.mockClear();
    fireEvent.press(screen.getByTestId('story-share'));
    expect(mockEnqueue.mock.calls[0][0].snap.trim).toEqual({ start: 40, end: 65 });
  });

  test('without the native trimmer, a clip over 30 s is refused', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockVideo.isVideoProcessingAvailable.mockReturnValueOnce(false);
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'video', uri: 'file:///long.mp4', duration: 45000 }] });
    const screen = render(<CreateStoryScreen />);
    await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
    expect(alert).toHaveBeenCalledWith('story.tooLongTitle', 'story.tooLong');
    expect(screen.queryByTestId('story-preview')).toBeNull();
    alert.mockRestore();
  });

  test('over 1080p is refused, as on Home', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'video', uri: 'file:///4k.mp4', duration: 9000, width: 2160, height: 3840 }] });
    const screen = render(<CreateStoryScreen />);
    await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
    expect(alert).toHaveBeenCalledWith('create.post.resolutionTitle', 'create.post.resolutionBody');
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

  test('turns with the phone, and shows the whole story over a blurred copy of it', () => {
    mockDims.width = 844; mockDims.height = 390;
    const screen = render(<StoryViewer route={{ params: { group } }} navigation={mockNav} />);
    expect(mockOrientation.allowAllOrientations).toHaveBeenCalled();
    const img = screen.UNSAFE_root.findAll((n) => n.props?.source?.uri === 'https://cdn.test/1.jpg' && n.props.contentFit && !n.props.blurRadius)[0];
    expect(img.props.contentFit).toBe('contain');
    expect(screen.getByTestId('story-backdrop')).toBeTruthy();
  });

  test('portrait too: a landscape photo is shown whole, never cropped to fill', () => {
    const screen = render(<StoryViewer route={{ params: { group } }} navigation={mockNav} />);
    const img = screen.UNSAFE_root.findAll((n) => n.props?.source?.uri === 'https://cdn.test/1.jpg' && n.props.contentFit && !n.props.blurRadius)[0];
    expect(img.props.contentFit).toBe('contain');
    expect(screen.getByTestId('story-backdrop')).toBeTruthy();
  });

  test('a video story shows its poster while it loads', () => {
    const vgroup = { ...group, stories: [{ id: 5, content_type: 'video', media_url: 'https://cdn.test/v.mp4',
      thumbnail_url: 'https://cdn.test/poster.jpg', created_at: new Date().toISOString() }] };
    const screen = render(<StoryViewer route={{ params: { group: vgroup } }} navigation={mockNav} />);
    expect(screen.getByTestId('story-poster').props.source).toEqual({ uri: 'https://cdn.test/poster.jpg' });
  });

  test('a story that will not load says so instead of spinning forever', () => {
    const screen = render(<StoryViewer route={{ params: { group } }} navigation={mockNav} />);
    const img = screen.UNSAFE_root.findAll((n) => n.props?.source?.uri === 'https://cdn.test/1.jpg' && n.props.onError)[0];
    act(() => { img.props.onError(); });
    expect(screen.getByTestId('story-failed')).toBeTruthy();
  });

  test('times are short and translated; a brand-new story is "now", not "0m ago"', () => {
    expect(timeAgo(new Date().toISOString(), mockT)).toBe('feed.ago.now');
    expect(timeAgo(new Date(Date.now() - 5 * 60000).toISOString(), mockT)).toBe('feed.ago.m:5');
    expect(timeAgo(new Date(Date.now() - 3 * 3600000).toISOString(), mockT)).toBe('feed.ago.h:3');
  });
});

describe('reacting to a story', () => {
  const others = {
    user: { id: 3, username: 'ann' },
    stories: [{ id: 41, content_type: 'image', media_url: 'https://cdn.test/41.jpg', created_at: new Date().toISOString(), my_reaction: null }],
  };

  test("someone else's story: tap an emoji to react, the same one again takes it back", async () => {
    mockApi.reactToStory.mockClear();
    const screen = render(<StoryViewer route={{ params: { group: others } }} navigation={mockNav} />);
    expect(screen.queryByTestId('story-viewers')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('story-react-🔥')); });
    expect(mockApi.reactToStory).toHaveBeenLastCalledWith(41, '🔥');
    expect(screen.getByTestId('story-react-🔥').props.accessibilityState).toEqual({ selected: true });
    await act(async () => { fireEvent.press(screen.getByTestId('story-react-🔥')); });
    expect(mockApi.reactToStory).toHaveBeenLastCalledWith(41, null);
  });

  test('your own story: who watched and how they reacted, no emoji row', async () => {
    const mine = { user: { id: 7, username: 'mark' }, stories: [{ ...others.stories[0], id: 42, views_count: 1 }] };
    const screen = render(<StoryViewer route={{ params: { group: mine } }} navigation={mockNav} />);
    expect(screen.queryByTestId('story-react-🔥')).toBeNull();
    expect(screen.getByText('story.viewsCount:1')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('story-viewers')); });
    expect(mockApi.fetchStoryViewers).toHaveBeenCalledWith(42);
    await waitFor(() => expect(screen.getByText('ann')).toBeTruthy());
    expect(screen.getByText('🙏')).toBeTruthy();
  });
});

describe('watching, safely', () => {
  const two = {
    user: { id: 3, username: 'ann' },
    stories: [
      { id: 51, content_type: 'video', media_url: 'https://cdn.test/51.mp4', created_at: new Date().toISOString() },
      { id: 52, content_type: 'video', media_url: 'https://cdn.test/52.mp4', created_at: new Date().toISOString() },
    ],
  };

  test('a video reporting its end several times moves on once, and the last one closes once', () => {
    mockNav.goBack.mockClear();
    const screen = render(<StoryViewer route={{ params: { group: two } }} navigation={mockNav} />);
    const status = { isLoaded: true, durationMillis: 10000, positionMillis: 10000, didJustFinish: true };
    act(() => {
      const v = screen.getByTestId('app-video');
      v.props.onPlaybackStatusUpdate(status);
      v.props.onPlaybackStatusUpdate(status);
      v.props.onPlaybackStatusUpdate(status);
    });
    expect(screen.getByTestId('app-video').props.source).toEqual({ uri: 'https://cdn.test/52.mp4' });
    act(() => {
      const v = screen.getByTestId('app-video');
      v.props.onPlaybackStatusUpdate(status);
      v.props.onPlaybackStatusUpdate(status);
    });
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
  });

  test('your own story: not counted as your view, and it can be deleted', async () => {
    mockApi.viewStory.mockClear();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((title, body, buttons) => buttons?.[1]?.onPress?.());
    const removedEvt = jest.fn();
    const off = on(EVENTS.STORY_DELETED, removedEvt);
    const mine = { user: { id: 7, username: 'mark' }, stories: [
      { id: 61, content_type: 'image', media_url: 'https://cdn.test/61.jpg', created_at: new Date().toISOString() },
      { id: 62, content_type: 'image', media_url: 'https://cdn.test/62.jpg', created_at: new Date().toISOString() },
    ] };
    const screen = render(<StoryViewer route={{ params: { group: mine } }} navigation={mockNav} />);
    expect(mockApi.viewStory).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId('story-delete')); });
    expect(mockApi.deleteStory).toHaveBeenCalledWith(61);
    expect(removedEvt).toHaveBeenCalledWith({ storyId: 61 });
    expect(screen.UNSAFE_root.findAll((n) => n.props?.source?.uri === 'https://cdn.test/62.jpg').length).toBeGreaterThan(0);
    off();
    alert.mockRestore();
  });

  test("someone else's story is recorded as viewed; a reaction reaches the row", async () => {
    mockApi.viewStory.mockClear();
    const reacted = jest.fn();
    const off = on(EVENTS.STORY_REACTED, reacted);
    const screen = render(<StoryViewer route={{ params: { group: two } }} navigation={mockNav} />);
    expect(mockApi.viewStory).toHaveBeenCalledWith(51);
    await act(async () => { fireEvent.press(screen.getByTestId('story-react-❤️')); });
    expect(reacted).toHaveBeenCalledWith({ storyId: 51, emoji: '❤️' });
    off();
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
  test("a video story's poster can be the cover", () => {
    expect(storyCover([{ content_type: 'video', media_url: 'clip.mp4', thumbnail_url: 'poster.jpg', created_at: '2026-10-05T10:00:00Z' }]))
      .toBe('poster.jpg');
  });

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

describe('sharing in the background', () => {
  test('your bubble says it is sharing while a story uploads', async () => {
    mockApi.fetchStoryFeed.mockResolvedValue([]);
    mockJobs.list = [{ id: 'up1', kind: 'story', status: 'working', progress: 0.4 }];
    const screen = render(<StoriesBar navigation={mockNav} />);
    await waitFor(() => expect(screen.getByTestId('story-sharing')).toBeTruthy());
    expect(screen.getByText('story.sharing')).toBeTruthy();
    mockJobs.list = [];
  });

  test("a photo stored rotated takes the resized file's upright size", async () => {
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'image', uri: 'file:///rot.jpg', width: 4000, height: 3000 }] });
    const { compressImage } = require('../../services/imageProcessing');
    compressImage.mockResolvedValueOnce({ uri: 'file:///rot-small.jpg', width: 810, height: 1080 });
    const screen = render(<CreateStoryScreen />);
    await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
    const box = [].concat(screen.getByTestId('story-preview').props.style).reduce((x, y) => ({ ...x, ...y }), {});
    expect(box.width / box.height).toBeCloseTo(810 / 1080, 2);
  });

  test("a video's still comes from the trimmed part, and its real shape fixes the preview", async () => {
    mockVideo.extractFrame.mockClear();
    mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'video', uri: 'file:///side.mp4', duration: 95000, width: 1920, height: 1080 }] });
    const screen = render(<CreateStoryScreen />);
    await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
    act(() => { mockTrimmer.mock.calls.at(-1)[0].onChange(40, 65); });
    await waitFor(() => expect(mockVideo.extractFrame).toHaveBeenLastCalledWith('file:///side.mp4', 40, 720), { timeout: 2000 });
    fireEvent.press(screen.getByTestId('story-trim-done'));
    const still = await screen.findByTestId('story-preview-still');
    act(() => { still.props.onLoad({ source: { width: 1080, height: 1920 } }); });   // it's portrait after all
    const box = [].concat(screen.getByTestId('story-preview').props.style).reduce((x, y) => ({ ...x, ...y }), {});
    expect(box.width / box.height).toBeCloseTo(1080 / 1920, 2);
  });
});

test('a phone that cannot cut refuses a trimmed clip before anything is queued', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockEnqueue.mockClear();
  mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ type: 'video', uri: 'file:///c.mp4', duration: 20000, width: 720, height: 1280 }] });
  const screen = render(<CreateStoryScreen />);
  await act(async () => { fireEvent.press(screen.getByTestId('story-pick')); });
  fireEvent.press(screen.getByTestId('story-trim'));
  act(() => { mockTrimmer.mock.calls.at(-1)[0].onChange(5, 15); });
  fireEvent.press(screen.getByTestId('story-trim-done'));
  mockVideo.isVideoProcessingAvailable.mockReturnValue(false);
  fireEvent.press(screen.getByTestId('story-share'));
  expect(alert).toHaveBeenCalledWith('story.trimUnavailableTitle', 'story.trimUnavailable');
  expect(mockEnqueue).not.toHaveBeenCalled();
  mockVideo.isVideoProcessingAvailable.mockReturnValue(true);
  alert.mockRestore();
});

test('emojis go into the caption where the cursor is', () => {
  const screen = render(<CreateStoryScreen />);
  fireEvent.changeText(screen.getByTestId('story-caption'), 'Good morning');
  fireEvent(screen.getByTestId('story-caption'), 'selectionChange', { nativeEvent: { selection: { start: 4, end: 4 } } });
  fireEvent.press(screen.getByTestId('story-emoji-quick-🙏'));
  expect(screen.getByTestId('story-caption').props.value).toBe('Good🙏 morning');
  fireEvent.press(screen.getByTestId('story-emoji-more'));
  expect(screen.getByTestId('story-emoji-panel')).toBeTruthy();
});
