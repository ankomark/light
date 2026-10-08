import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockApi = new Proxy({}, {
  get: (target, name) => {
    if (!target[name]) target[name] = jest.fn(() => Promise.resolve({}));
    return target[name];
  },
});
jest.mock('../../../services/api', () => new Proxy({}, {
  get: (_, name) => (name === '__esModule' ? false : (...a) => mockApi[name](...a)),
}));
jest.mock('../../../context/I18nContext', () => ({
  useI18n: () => ({ t: (k, p) => (p ? `${k}:${Object.values(p).join(',')}` : k) }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View: V } = require('react-native');
  return { SafeAreaView: V, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (fn) => { const R = require('react'); R.useEffect(() => fn(), [fn]); },
}));
let mockUser = { id: 7, capabilities: [] };
jest.mock('../../../context/useAuth', () => ({ useAuth: () => ({ currentUser: mockUser }) }));
let mockOnline = true;
jest.mock('../../../hooks/useOnline', () => ({ __esModule: true, default: () => mockOnline }));
jest.mock('../../../utils/useReducedMotion', () => ({ __esModule: true, default: () => true }));
jest.mock('expo-linear-gradient', () => {
  const { View: V } = require('react-native');
  return { LinearGradient: ({ children, style }) => <V style={style}>{children}</V> };
});
jest.mock('expo-blur', () => {
  const { View: V } = require('react-native');
  return { BlurView: ({ children, style }) => <V style={style}>{children}</V> };
});
jest.mock('expo-constants', () => ({ __esModule: true, default: { executionEnvironment: 'standalone' } }));
let mockPerm = { granted: true };
jest.mock('expo-camera', () => ({ Camera: {
  requestMicrophonePermissionsAsync: () => Promise.resolve(mockPerm),
  requestCameraPermissionsAsync: () => Promise.resolve(mockPerm),
} }));
jest.mock('../../../utils/optionalNative', () => ({ keepAwake: () => ({ activateKeepAwakeAsync: jest.fn(() => Promise.resolve()), deactivateKeepAwake: jest.fn() }) }));
jest.mock('@livekit/react-native-webrtc', () => ({ mediaDevices: { getUserMedia: jest.fn(() => new Promise(() => {})) }, RTCView: () => null }));

// ── LiveKit, as far as the room screen uses it ───────────────────────────────
const mockRoom = {
  handlers: {},
  state: 'connected',
  remoteParticipants: new Map(),
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); },
  off() {},
  disconnect: jest.fn(),
  localParticipant: { publishData: jest.fn() },
};
const mockLocal = {
  identity: 'u7', name: 'me', permissions: { canPublish: false },
  setMicrophoneEnabled: jest.fn(() => Promise.resolve()), setCameraEnabled: jest.fn(() => Promise.resolve()),
};
const mockHost = { identity: 'u1', name: 'pastor', permissions: { canPublish: true }, isMicrophoneEnabled: true };
let mockParticipants = [mockHost, mockLocal];
jest.mock('@livekit/react-native', () => {
  const { View: V } = require('react-native');
  return {
    LiveKitRoom: ({ children }) => <V>{children}</V>,
    AudioSession: {
      configureAudio: () => Promise.resolve(), startAudioSession: () => Promise.resolve(), stopAudioSession: () => Promise.resolve(),
    },
    AndroidAudioTypePresets: { communication: {}, media: {} },
    useParticipants: () => mockParticipants,
    useLocalParticipant: () => ({ localParticipant: mockLocal }),
    useRoomContext: () => mockRoom,
    useTracks: () => [],
    VideoTrack: () => null,
  };
});
jest.mock('livekit-client', () => ({
  Track: { Source: { Camera: 'camera', Microphone: 'microphone' }, Kind: { Video: 'video' } },
  RoomEvent: {
    DataReceived: 'data', ConnectionStateChanged: 'state', TrackPublished: 'tp',
    TrackSubscriptionFailed: 'tsf', ParticipantConnected: 'pc',
  },
  ConnectionState: { Connected: 'connected', Reconnecting: 'reconnecting', SignalReconnecting: 'signal' },
  DisconnectReason: { CLIENT_INITIATED: 1, PARTICIPANT_REMOVED: 4, ROOM_DELETED: 5 },
  VideoPresets: { h180: {}, h360: {}, h720: { resolution: {}, encoding: {} } },
  setLogLevel: () => {},
}));
jest.mock('../../../utils/orientation', () => ({ lockPortrait: jest.fn(), allowAllOrientations: jest.fn() }));
jest.mock('../../../hooks/useKeyboardHeight', () => ({ __esModule: true, default: () => 0 }));
jest.mock('../../ReportModal', () => () => null);
jest.mock('../GraphicComposer', () => () => null);
jest.mock('../FloatingReactions', () => {
  const R = require('react');
  return R.forwardRef(() => null);
});
jest.mock('../LiveGraphic', () => {
  const { Text: T } = require('react-native');
  return ({ graphic }) => (graphic ? <T testID="graphic">{graphic.title}</T> : null);
});

const { peekCache, writeCache, userKey } = require('../../../utils/screenCache');
const LiveHub = require('../LiveHub').default;
const GoLive = require('../GoLive').default;
const LiveRoom = require('../LiveRoom').default;

const nav = () => ({
  navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), setParams: jest.fn(),
  addListener: jest.fn(() => () => {}), canGoBack: () => true,
});
const room = (id, title) => ({ id, title, kind: 'meet', viewer_count: 3, host: { id: 1, username: 'pastor' } });

beforeEach(() => {
  Object.keys(mockApi).forEach((k) => delete mockApi[k]);
  mockUser = { id: 7, capabilities: [] };
  mockOnline = true;
  mockPerm = { granted: true };
  mockRoom.handlers = {};
  mockParticipants = [mockHost, mockLocal];
});

describe('Live hub', () => {
  test('a failed refresh keeps the list on screen and says so', async () => {
    writeCache(userKey(7, 'live:hub'), [room(1, 'Evening hymns')], { persist: false });
    mockApi.fetchBroadcasts.mockRejectedValue(new Error('offline'));
    const screen = render(<LiveHub navigation={nav()} route={{ params: {} }} />);
    expect(screen.getByText('Evening hymns')).toBeTruthy();   // from the cache, at once
    await act(async () => {});
    expect(screen.getByText('Evening hymns')).toBeTruthy();   // still there
    expect(screen.getByTestId('live-hub-notice')).toBeTruthy();
    expect(screen.queryByText('live.noOneLive')).toBeNull();
  });

  test('a fresh list replaces the cached one and is kept', async () => {
    mockApi.fetchBroadcasts.mockResolvedValue({ results: [room(2, 'Bible study')] });
    const screen = render(<LiveHub navigation={nav()} route={{ params: {} }} />);
    await act(async () => {});
    expect(screen.getByText('Bible study')).toBeTruthy();
    expect(peekCache(userKey(7, 'live:hub'))[0].id).toBe(2);
  });

  test('opened from a push, it goes straight into that broadcast', async () => {
    mockApi.fetchBroadcasts.mockResolvedValue({ results: [] });
    mockApi.fetchBroadcastToken.mockResolvedValue({ url: 'wss://x', token: 'tok', broadcast: room(5, 'Live now') });
    const navigation = nav();
    render(<LiveHub navigation={navigation} route={{ params: { openBroadcast: 5 } }} />);
    await act(async () => {});
    expect(mockApi.fetchBroadcastToken).toHaveBeenCalledWith(5);
    expect(navigation.navigate).toHaveBeenCalledWith('LiveRoom', expect.objectContaining({ token: 'tok', role: 'viewer' }));
  });

  test('a refused join says why', async () => {
    mockApi.fetchBroadcasts.mockResolvedValue({ results: [] });
    mockApi.fetchBroadcastToken.mockRejectedValue({ response: { status: 403, data: { code: 'removed' } } });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<LiveHub navigation={nav()} route={{ params: { openBroadcast: 5 } }} />);
    await act(async () => {});
    expect(alert).toHaveBeenCalledWith('live.title', 'live.removedYou');
    alert.mockRestore();
  });

  test('an admin who may take content down gets the End button; a member does not', async () => {
    mockApi.fetchBroadcasts.mockResolvedValue({ results: [room(2, 'Bible study')] });
    let screen = render(<LiveHub navigation={nav()} route={{ params: {} }} />);
    await act(async () => {});
    expect(screen.queryByTestId('live-hub-end')).toBeNull();
    mockUser = { id: 8, capabilities: ['remove_content'] };
    screen = render(<LiveHub navigation={nav()} route={{ params: {} }} />);
    await act(async () => {});
    expect(screen.getByTestId('live-hub-end')).toBeTruthy();
  });
});

describe('Go Live', () => {
  test('says how many followers are missing before the camera test', async () => {
    mockApi.fetchLiveEligibility.mockResolvedValue({
      followers: 40, needed: { meet: 100, tv: 1000 }, allowed: { meet: false, tv: false },
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<GoLive navigation={nav()} route={{ params: { title: 'Morning prayer' } }} />);
    await act(async () => {});
    expect(screen.getByTestId('golive-blocked').props.children).toBe('live.followersNeeded:100,live.kindMeet,40');
    fireEvent.press(screen.getByText('common.continue'));
    expect(alert).toHaveBeenCalledWith('live.goLive', 'live.followersNeeded:100,live.kindMeet,40');
    expect(screen.queryByText('live.ready')).toBeNull();          // still on setup
    alert.mockRestore();
  });

  test('allowed: on to the preview', async () => {
    mockApi.fetchLiveEligibility.mockResolvedValue({
      followers: 400, needed: { meet: 100, tv: 1000 }, allowed: { meet: true, tv: false },
    });
    const screen = render(<GoLive navigation={nav()} route={{ params: { title: 'Morning prayer' } }} />);
    await act(async () => {});
    expect(screen.queryByTestId('golive-blocked')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByText('common.continue')); });
    expect(screen.getByText('live.ready')).toBeTruthy();
  });

  test('camera or mic refused for good: offers Settings and stays put', async () => {
    mockApi.fetchLiveEligibility.mockResolvedValue({ followers: 400, needed: { meet: 100, tv: 1000 }, allowed: { meet: true, tv: true } });
    mockPerm = { granted: false, canAskAgain: false };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<GoLive navigation={nav()} route={{ params: { title: 'Morning prayer', kind: 'tv' } }} />);
    await act(async () => {});
    await act(async () => { fireEvent.press(screen.getByText('common.continue')); });
    const [title, body, buttons] = alert.mock.calls[0];
    expect(title).toBe('live.permTitle');
    expect(body).toContain('live.permBodyVideo');
    expect(buttons.map((b) => b.text)).toContain('live.openSettings');
    expect(screen.queryByText('live.ready')).toBeNull();
    alert.mockRestore();
  });
});

describe('Live room chat', () => {
  // ASCII only here, one byte a character.
  const bytes = (obj) => Uint8Array.from(JSON.stringify(obj), (c) => c.charCodeAt(0));
  const broadcast = { id: 3, kind: 'meet', title: 'Evening hymns', host: { id: 1, username: 'pastor' } };
  const send = (obj, sender) => act(() => { mockRoom.handlers.data.forEach((fn) => fn(bytes(obj), sender)); });
  const open = () => render(<LiveRoom navigation={nav()}
    route={{ params: { url: 'wss://x', token: 't', broadcast, role: 'viewer' } }} />);

  test('the name and HOST badge come from who sent it, not from the message', () => {
    const viewer = { identity: 'u9', name: 'sneaky', permissions: { canPublish: false } };
    mockParticipants = [mockHost, mockLocal, viewer];
    const screen = open();
    send({ t: 'chat', id: 'a', name: 'pastor', host: true, text: 'send money here' }, viewer);
    expect(screen.getByText('sneaky')).toBeTruthy();
    expect(screen.queryByText('live.hostBadge')).toBeNull();
    send({ t: 'chat', id: 'b', text: 'Welcome all' }, mockHost);
    expect(screen.getByText('live.hostBadge')).toBeTruthy();
  });

  test('only someone on stage can put text on screen', () => {
    const viewer = { identity: 'u9', name: 'sneaky', permissions: { canPublish: false } };
    mockParticipants = [mockHost, mockLocal, viewer];
    const screen = open();
    send({ t: 'graphic', visible: true, style: 'banner', title: 'HACKED' }, viewer);
    expect(screen.queryByTestId('graphic')).toBeNull();
    send({ t: 'graphic', visible: true, style: 'banner', title: 'Psalm 23' }, mockHost);
    expect(screen.getByTestId('graphic').props.children).toBe('Psalm 23');
  });

  test('not connected after a while: says so and offers to try again', () => {
    jest.useFakeTimers();
    try {
      const prev = mockRoom.state;
      mockRoom.state = 'connecting';
      const screen = open();
      expect(screen.queryByTestId('live-stuck')).toBeNull();
      act(() => { jest.advanceTimersByTime(21000); });
      expect(screen.getByTestId('live-stuck')).toBeTruthy();
      fireEvent.press(screen.getByTestId('live-retry'));
      expect(screen.queryByTestId('live-stuck')).toBeNull();
      mockRoom.state = prev;
    } finally {
      jest.useRealTimers();
    }
  });

  test('asking to join needs the microphone first', async () => {
    mockPerm = { granted: false, canAskAgain: true };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = open();
    await act(async () => { fireEvent.press(screen.getByText('live.requestToJoin')); });
    expect(mockApi.requestCohost).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('live.permTitle', 'live.permBodyAudio', expect.any(Array));
    mockPerm = { granted: true };
    await act(async () => { fireEvent.press(screen.getByText('live.requestToJoin')); });
    expect(mockApi.requestCohost).toHaveBeenCalledWith(3);
    alert.mockRestore();
  });

  test('a long chat line is cut, and one with no sender is ignored', () => {
    const screen = open();
    send({ t: 'chat', id: 'c', text: 'x'.repeat(5000) }, mockHost);
    expect(screen.getByText('x'.repeat(200))).toBeTruthy();
    send({ t: 'chat', id: 'd', text: 'from nowhere' }, undefined);
    expect(screen.queryByText('from nowhere')).toBeNull();
  });
});

