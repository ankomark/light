/**
 * Live room (LiveKit). Host/co-host publish audio (+video for tv);
 * viewers watch/listen. Chat and reactions ride the room's data channel.
 *
 * NOTE: WebRTC is native — this screen only runs in a custom dev client / EAS
 * build (not Expo Go), and needs LIVEKIT_URL/KEY/SECRET configured on the
 * backend. The component uses LiveKit's documented high-level RN API.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView,
  useWindowDimensions, AppState,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { lockPortrait, allowAllOrientations } from '../../utils/orientation';
import Constants from 'expo-constants';
import {
  LiveKitRoom, AudioSession, AndroidAudioTypePresets, useParticipants, useLocalParticipant, useRoomContext,
  useTracks, VideoTrack,
} from '@livekit/react-native';
import {
  Track, RoomEvent, ConnectionState, DisconnectReason, VideoPresets, setLogLevel,
} from 'livekit-client';
import {
  endBroadcast, requestCohost, fetchCohostRequests, approveCohost, rejectCohost,
  fetchCohostToken, moderateBroadcast, followUser, reactBroadcast, setBroadcastOverlay,
} from '../../services/api';
import { typography, spacing, radius, shadows } from '../../constants/theme';
import { live, goldGlow, redGlow, fmtCount } from '../../constants/liveTheme';
import { LiveBadge, ViewPill, GoldRing } from './LivePrimitives';
import LiveChat from './LiveChat';
import FloatingReactions from './FloatingReactions';
import LiveGraphic from './LiveGraphic';
import GraphicComposer from './GraphicComposer';
import useKeyboardHeight from '../../hooks/useKeyboardHeight';
import { useI18n } from '../../context/I18nContext';
import ReportModal from '../ReportModal';
import { keepAwake } from '../../utils/optionalNative';
import { ensureLivePermissions } from '../../utils/livePermissions';

// Quiet LiveKit's very chatty info/debug logging; keep genuine warnings/errors.
setLogLevel('warn');

// ── data-channel codec (manual UTF-8, no TextEncoder/escape dependency) ───────
const encodeData = (obj) => {
  const str = JSON.stringify(obj);
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff) { // high surrogate → 4-byte
      const c2 = str.charCodeAt((i += 1));
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(out);
};
const decodeData = (u8) => {
  try {
    let str = '';
    for (let i = 0; i < u8.length;) {
      const c = u8[i]; i += 1;
      if (c < 0x80) {
        str += String.fromCharCode(c);
      } else if (c < 0xe0) {
        str += String.fromCharCode(((c & 0x1f) << 6) | (u8[i] & 0x3f)); i += 1;
      } else if (c < 0xf0) {
        str += String.fromCharCode(((c & 0x0f) << 12) | ((u8[i] & 0x3f) << 6) | (u8[i + 1] & 0x3f)); i += 2;
      } else {
        const cp = ((c & 0x07) << 18) | ((u8[i] & 0x3f) << 12) | ((u8[i + 1] & 0x3f) << 6) | (u8[i + 2] & 0x3f);
        i += 3;
        const off = cp - 0x10000;
        str += String.fromCharCode(0xd800 + (off >> 10), 0xdc00 + (off & 0x3ff));
      }
    }
    return JSON.parse(str);
  } catch { return null; }
};

const KIND_KEY = { meet: 'live.kindMeet', tv: 'live.kindTv' };
// Not connected this long after opening: say so and offer to try again,
// instead of "Connecting..." for ever (server down, a network that blocks it).
const CONNECT_TIMEOUT_MS = 20000;
const AWAKE_TAG = 'live-room';

// Video for the networks we serve: the host sends 720p plus 360p and 180p
// copies (simulcast), and the server gives each viewer the one their
// connection carries. Audio gets redundancy (RED) and goes quiet between
// words (DTX): fewer dropouts on lossy mobile data, less data used.
const ROOM_OPTIONS = {
  adaptiveStream: false,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets?.h720?.resolution },
  publishDefaults: {
    simulcast: true,
    videoSimulcastLayers: [VideoPresets?.h180, VideoPresets?.h360].filter(Boolean),
    videoEncoding: VideoPresets?.h720?.encoding,
    red: true,
    dtx: true,
  },
};

// A publishData that can fail without an unhandled promise rejection (it
// rejects while reconnecting; try/catch alone only caught the sync throw).
const sendData = (room, obj, reliable = true) => {
  try {
    Promise.resolve(room?.localParticipant?.publishData(encodeData(obj), { reliable })).catch(() => {});
  } catch { /* not connected */ }
};
// Longest chat line drawn (the composer stops at 200 too; a hand-made
// message could be any length and flood the dock).
const CHAT_MAX = 200;
// Fewest milliseconds between two of my own chat lines.
const CHAT_GAP_MS = 700;

const fmtElapsed = (totalSec) => {
  const s = Math.max(0, totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
};

const isPublisher = (p) => {
  const perm = p?.permissions;
  if (perm && typeof perm.canPublish === 'boolean') return perm.canPublish;
  return !!(p?.isMicrophoneEnabled || p?.isCameraEnabled
    || p?.getTrackPublication?.(Track.Source.Camera)
    || p?.getTrackPublication?.(Track.Source.Microphone));
};

const LiveRoom = ({ navigation, route }) => {
  const { t } = useI18n();
  const {
    url, token: initialToken, broadcast, role: initialRole,
    initialMicOn, initialCamOn,
  } = route.params;
  const [token, setToken] = useState(initialToken);
  const [role, setRole] = useState(initialRole); // host | viewer | cohost
  // Set while we intentionally reconnect for a promotion, so the unmount's
  // disconnect doesn't bounce us out of the screen.
  const promotingRef = useRef(false);
  // Set once leaving is decided (or the room is gone), so the host's "leave
  // your broadcast?" question isn't asked on the way out.
  const leavingRef = useRef(false);
  const canPublish = role === 'host' || role === 'cohost';
  const isVideo = broadcast.kind === 'tv';
  // On promotion we swap to a publish token, which makes LiveKitRoom reconnect
  // negotiated as a *publisher* — the reliable way to start sending both audio
  // and video. Granting permission alone (grant_publish) let mic through but the
  // camera track never reached the server, because the connection was set up
  // subscribe-only. canPublish drives audio/video below, so the reconnected
  // co-host publishes immediately.

  // Expo Go has no WebRTC native module — fail gracefully instead of crashing.
  const inExpoGo = Constants.executionEnvironment === 'storeClient';

  // Audio as a call (echo cancelling) for those on stage; as media for those
  // only watching - fuller sound, and the volume buttons change media volume
  // rather than call volume. The loudspeaker unless headphones are in.
  useEffect(() => {
    if (inExpoGo) return undefined;
    let alive = true;
    (async () => {
      try {
        await AudioSession.configureAudio?.({
          android: {
            preferredOutputList: ['bluetooth', 'headset', 'speaker'],
            audioTypeOptions: canPublish ? AndroidAudioTypePresets?.communication : AndroidAudioTypePresets?.media,
          },
          ios: { defaultOutput: 'speaker' },
        });
      } catch { /* older native module: its defaults */ }
      if (alive) AudioSession.startAudioSession().catch(() => {});
    })();
    return () => { alive = false; AudioSession.stopAudioSession().catch(() => {}); };
  }, [inExpoGo, canPublish]);

  // Keep the screen on: a phone that locks mid-broadcast stops the host's
  // camera (and dims the viewer's video) after 30 seconds untouched.
  useEffect(() => {
    if (inExpoGo) return undefined;
    const awake = keepAwake();
    try { awake?.activateKeepAwakeAsync?.(AWAKE_TAG)?.catch?.(() => {}); } catch { /* no module */ }
    return () => { try { awake?.deactivateKeepAwake?.(AWAKE_TAG); } catch { /* already off */ } };
  }, [inExpoGo]);

  // Bumped by "Try again": a fresh connection.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { promotingRef.current = true; setAttempt((n) => n + 1); }, []);

  // The rest of the app is portrait-locked at the root. In the live room we switch
  // to full sensor rotation so the whole screen flips automatically with the
  // device (TikTok-style) — even if the phone's auto-rotate toggle is off — then
  // relock portrait on leave.
  useEffect(() => {
    if (inExpoGo) return undefined;
    allowAllOrientations();
    return () => {
      lockPortrait();
    };
  }, [inExpoGo]);

  if (inExpoGo) {
    return (
      <View style={styles.guard}>
        <MaterialCommunityIcons name="broadcast-off" size={56} color={live.inkDim} />
        <Text style={styles.guardTitle}>{t('live.needsFullApp')}</Text>
        <Text style={styles.guardText}>{t('live.expoGoNote')}</Text>
        <TouchableOpacity style={styles.guardBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.guardBtnText}>{t('common.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <LiveKitRoom
      // Remount on token change: swapping the prop alone won't reconnect because
      // livekit-client's connect() is a no-op while already connected. A fresh
      // mount establishes a new connection negotiated as a publisher (audio +
      // video), which is what lets a promoted co-host actually send video.
      key={`${token}:${attempt}`}
      serverUrl={url}
      token={token}
      connect
      audio={canPublish && (initialMicOn !== false)}
      // A co-host comes on stage with the camera off: it turns on when they
      // choose, not the moment the host taps Approve.
      video={canPublish && isVideo && role === 'host' && (initialCamOn !== false)}
      // adaptiveStream pauses remote video whose view isn't detected as visible
      // (flaky in RN ScrollViews), which hid late publishers' (co-hosts') video
      // from the host. A broadcast has few publishers, so subscribe fully.
      options={ROOM_OPTIONS}
      onError={(e) => { if (__DEV__) console.warn('LiveKit error', e); }}
      onConnected={() => { promotingRef.current = false; }}
      onDisconnected={(reason) => {
        if (promotingRef.current) { promotingRef.current = false; return; } // promotion reconnect
        // Leaving was my choice (Leave, End): nothing to explain.
        const chose = leavingRef.current;
        leavingRef.current = true;
        // Say why, unless I left myself: before, the screen just vanished.
        const why = reason === DisconnectReason.ROOM_DELETED ? 'live.ended'
          : reason === DisconnectReason.PARTICIPANT_REMOVED ? 'live.removedYou'
            : reason === DisconnectReason.CLIENT_INITIATED || reason == null ? null
              : 'live.connectionLost';
        // The host too: an admin ending it, or the connection dying, used to
        // close their screen without a word.
        if (why && !chose) Alert.alert(t('live.title'), t(why));
        if (navigation.canGoBack?.() !== false) navigation.goBack();
      }}
      style={styles.root}
    >
      <RoomInner
        broadcast={broadcast}
        role={role}
        canPublish={canPublish}
        isVideo={isVideo}
        initialMicOn={initialMicOn !== false}
        initialCamOn={isVideo && role === 'host' && initialCamOn !== false}
        navigation={navigation}
        leavingRef={leavingRef}
        onRetry={retry}
        onPromoted={(next) => {
          if (next && next !== token) { promotingRef.current = true; setToken(next); }
          setRole('cohost');
        }}
      />
    </LiveKitRoom>
  );
};

const RoomInner = ({
  broadcast, role, canPublish, isVideo, initialMicOn, initialCamOn, navigation, onPromoted, leavingRef, onRetry,
}) => {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;
  // Lift the chat dock above the keyboard. KeyboardAvoidingView doesn't work
  // under edgeToEdgeEnabled (Android stops resizing), so read the keyboard
  // height directly — the project-wide pattern for chat composers.
  const kbHeight = useKeyboardHeight();
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const cameraTracks = useTracks([Track.Source.Camera]);
  const isHost = role === 'host';

  const [micOn, setMicOn] = useState(canPublish && initialMicOn);
  const [camOn, setCamOn] = useState(canPublish && initialCamOn);
  const facingRef = useRef('user');
  const [requests, setRequests] = useState([]);     // host: pending co-host requests
  const [reporting, setReporting] = useState(false);
  const [requested, setRequested] = useState(false); // viewer: asked to join

  // Host + viewer engagement: follow the broadcaster, and a running tally of the
  // ❤️ reactions the room has sent (driven off the data channel).
  const hostUser = broadcast.host || {};
  const showFollow = !isHost && !!hostUser.id;
  const [followState, setFollowState] = useState(
    broadcast.follow_status || (broadcast.is_following ? 'following' : 'none'),
  ); // 'none' | 'following' | 'requested'
  const [followBusy, setFollowBusy] = useState(false);
  // Seed from the persisted total so the count reflects the whole session, then
  // keep it live off the data channel.
  const [likeCount, setLikeCount] = useState(broadcast.like_count || 0);
  const pendingLikesRef = useRef(0); // this viewer's own ❤️ awaiting a server flush
  // Hearts counted here and shown twice a second: one state update per heart
  // re-rendered the whole room hundreds of times a second in a busy room.
  const heardLikesRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      const n = heardLikesRef.current;
      if (n) { heardLikesRef.current = 0; setLikeCount((c) => c + n); }
    }, 500);
    return () => clearInterval(id);
  }, []);

  // On-screen graphic (lower third / banner / name tag / ticker). One at a time.
  // Seeded from the persisted overlay so late joiners / reconnects keep it.
  const [graphic, setGraphic] = useState(broadcast.overlay || null);
  const graphicRef = useRef(broadcast.overlay || null); // current, to re-send to late joiners
  const [graphicOpen, setGraphicOpen] = useState(false);
  const [dockH, setDockH] = useState(0); // measured dock height, to anchor the overlay above it

  const toggleFollow = useCallback(async () => {
    if (!hostUser.id || followBusy) return;
    setFollowBusy(true);
    const prev = followState;
    setFollowState(prev === 'none' ? 'following' : 'none'); // optimistic
    try {
      const res = await followUser(hostUser.id, prev === 'none');   // what was tapped for
      if (res?.follow_status) setFollowState(res.follow_status);
      else if (typeof res?.is_following === 'boolean') setFollowState(res.is_following ? 'following' : 'none');
    } catch {
      setFollowState(prev); // revert on failure
    } finally {
      setFollowBusy(false);
    }
  }, [hostUser.id, followState, followBusy]);

  // Persist likes in batches so rejoins/other viewers see the real total. Only
  // this viewer's own reactions are flushed (others' arrive via the data
  // channel and are flushed by their senders), so the tally isn't multiplied.
  const flushLikes = useCallback(() => {
    const n = pendingLikesRef.current;
    if (n <= 0) return;
    pendingLikesRef.current = 0;
    reactBroadcast(broadcast.id, n).catch(() => { pendingLikesRef.current += n; });
  }, [broadcast.id]);

  useEffect(() => {
    const iv = setInterval(flushLikes, 5000);
    return () => { clearInterval(iv); flushLikes(); };
  }, [flushLikes]);

  const [connState, setConnState] = useState(room?.state);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const reactionsRef = useRef(null);
  const pollRef = useRef(null);

  // ── derived roster ─────────────────────────────────────────────────────────
  const publishers = useMemo(() => participants.filter(isPublisher), [participants]);
  const watching = useMemo(
    () => Math.max(0, participants.filter((p) => !isPublisher(p)).length),
    [participants],
  );
  const camByIdentity = useMemo(() => {
    const m = {};
    // Keep only refs with a real subscribed track — a placeholder ref (no
    // .publication.track) would make the tile try to render an empty video.
    cameraTracks.forEach((t) => { if (t.publication?.track) m[t.participant.identity] = t; });
    // Backfill: a just-promoted co-host's camera can be subscribed yet missing
    // from useTracks for a beat (its source is briefly reported as unknown), so
    // the host sees audio but no video. Pull the camera straight from each
    // publisher's publication so it renders as soon as the track arrives.
    publishers.forEach((p) => {
      if (m[p.identity]) return;
      const pub = p.getTrackPublication?.(Track.Source.Camera);
      if (pub?.track) m[p.identity] = { participant: p, publication: pub, source: Track.Source.Camera };
    });
    return m;
  }, [cameraTracks, publishers]);
  const spotlight = useMemo(
    () => publishers.find((p) => p.isSpeaking) || publishers[0] || null,
    [publishers],
  );
  const myName = localParticipant?.name || localParticipant?.identity || 'me';

  const reconnecting = connState === ConnectionState.Reconnecting
    || connState === ConnectionState.SignalReconnecting;

  // ── elapsed timer ────────────────────────────────────────────────────────--
  const startedAt = useMemo(
    () => (broadcast.started_at ? new Date(broadcast.started_at).getTime() : Date.now()),
    [broadcast.started_at],
  );
  const [elapsed, setElapsed] = useState('0:00');
  useEffect(() => {
    const tick = () => setElapsed(fmtElapsed(Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // ── connection state (reconnect banner) ──────────────────────────────────--
  useEffect(() => {
    if (!room) return undefined;
    const onState = (s) => setConnState(s);
    room.on(RoomEvent.ConnectionStateChanged, onState);
    setConnState(room.state);
    return () => { room.off(RoomEvent.ConnectionStateChanged, onState); };
  }, [room]);

  // ── force-subscribe remote video ─────────────────────────────────────────--
  // Auto-subscribe can miss a publisher's camera (e.g. a co-host that reconnects
  // with the same identity): the host receives the publication (isCameraEnabled
  // true) but never subscribes, so useTracks omits it and the tile shows the
  // avatar. Explicitly subscribe to every remote video publication.
  const ensureSubscribed = useCallback(() => {
    if (!room) return;
    room.remoteParticipants?.forEach((p) => {
      p.trackPublications?.forEach((pub) => {
        if (pub.kind === Track.Kind.Video && typeof pub.setSubscribed === 'function' && !pub.isSubscribed) {
          // setSubscribed returns a promise that can reject during reconnect —
          // swallow both sync and async errors so it can't surface a redbox.
          try { Promise.resolve(pub.setSubscribed(true)).catch(() => {}); } catch {}
        }
      });
    });
  }, [room]);

  useEffect(() => {
    if (!room) return undefined;
    ensureSubscribed();
    room.on(RoomEvent.TrackPublished, ensureSubscribed);
    room.on(RoomEvent.TrackSubscriptionFailed, ensureSubscribed);
    room.on(RoomEvent.ParticipantConnected, ensureSubscribed);
    return () => {
      room.off(RoomEvent.TrackPublished, ensureSubscribed);
      room.off(RoomEvent.TrackSubscriptionFailed, ensureSubscribed);
      room.off(RoomEvent.ParticipantConnected, ensureSubscribed);
    };
  }, [room, ensureSubscribed]);

  // Re-check whenever the roster changes. A promoted co-host rejoins with the
  // same identity, so the host may see the new camera publication without a
  // fresh TrackPublished — this catches that case.
  useEffect(() => { ensureSubscribed(); }, [participants, ensureSubscribed]);

  // ── publish intent enforcement (fixes "audio but no video") ───────────────--
  // The <LiveKitRoom> audio/video props publish once at connect; on a
  // same-identity reconnect (co-host promotion token swap) the camera publish can
  // be dropped while the mic still goes through. Re-assert our intent on the SFU
  // every time we (re)connect as a publisher so the camera track actually lands.
  useEffect(() => {
    if (!canPublish || !localParticipant) return;
    if (connState !== ConnectionState.Connected) return;
    // A refusal (permission, the camera in use by another app) used to be
    // swallowed: the button said on, nobody heard or saw anything.
    localParticipant.setMicrophoneEnabled(micOn).catch(() => {
      if (micOn) { setMicOn(false); Alert.alert(t('live.title'), t('live.micOffNow')); }
    });
    if (isVideo) {
      localParticipant.setCameraEnabled(camOn).catch(() => {
        if (camOn) { setCamOn(false); Alert.alert(t('live.title'), t('live.camOffNow')); }
      });
    }
    // micOn/camOn intentionally read at connect time, not in deps, so this fires
    // on (re)connect rather than on every toggle (toggles publish directly).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connState, canPublish, isVideo, localParticipant]);

  // ── data channel: chat + reactions ───────────────────────────────────────--
  const pushMessage = useCallback((m) => {
    setMessages((prev) => [...prev.slice(-60), m]); // keep the tail bounded
  }, []);

  useEffect(() => {
    if (!room) return undefined;
    const hostIdentity = `u${broadcast.host?.id}`;
    // The sender is the participant LiveKit says sent it — never the name or
    // "host" flag inside the message, which any viewer could write.
    const onData = (payload, sender) => {
      const msg = decodeData(payload);
      if (!msg || !sender) return;
      if (msg.t === 'chat') {
        const text = String(msg.text || '').trim().slice(0, CHAT_MAX);
        if (!text) return;
        pushMessage({
          id: `${sender.identity}-${String(msg.id || Date.now()).slice(0, 40)}`,
          name: sender.name || sender.identity,
          text,
          host: sender.identity === hostIdentity,
        });
      } else if (msg.t === 'react') { reactionsRef.current?.add('❤️'); heardLikesRef.current += 1; }
      else if (msg.t === 'graphic') {
        // On-screen text only from those on stage: a viewer could otherwise
        // write over the broadcast for everyone.
        if (!isPublisher(sender)) return;
        const g = msg.visible
          ? { style: msg.style, title: msg.title, sub: msg.sub, x: msg.x ?? null, y: msg.y ?? null }
          : null;
        graphicRef.current = g;
        setGraphic(g);
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room, pushMessage, broadcast.host?.id]);

  // Host/co-host: publish (or clear) the on-screen graphic to everyone.
  const publishGraphic = useCallback((g) => {
    const payload = g
      ? { v: 1, t: 'graphic', visible: true, style: g.style, title: g.title, sub: g.sub, x: g.x ?? null, y: g.y ?? null }
      : { v: 1, t: 'graphic', visible: false };
    graphicRef.current = g || null;
    setGraphic(g || null);
    sendData(room, payload);
    // Persist so it survives reconnects and reaches late joiners in the payload.
    setBroadcastOverlay(broadcast.id, g || null).catch(() => {});
  }, [room, broadcast.id]);

  // Re-send the current graphic when someone new joins (data messages don't
  // reach late joiners), so viewers who arrive mid-stream still see it.
  useEffect(() => {
    if (!room || !canPublish) return undefined;
    const onJoin = () => {
      const g = graphicRef.current;
      if (!g) return;
      sendData(room, { v: 1, t: 'graphic', visible: true, style: g.style, title: g.title, sub: g.sub, x: g.x ?? null, y: g.y ?? null });
    };
    room.on(RoomEvent.ParticipantConnected, onJoin);
    return () => { room.off(RoomEvent.ParticipantConnected, onJoin); };
  }, [room, canPublish]);

  const lastChatRef = useRef(0);
  const sendChat = useCallback((raw) => {
    const text = String(raw || '').trim().slice(0, CHAT_MAX);
    const now = Date.now();
    if (!text || now - lastChatRef.current < CHAT_GAP_MS) return;
    lastChatRef.current = now;
    const m = { v: 1, t: 'chat', id: `${now}-${Math.random().toString(36).slice(2, 7)}`, name: myName, text, host: isHost };
    pushMessage({ id: m.id, name: m.name, text: m.text, host: m.host });
    setDraft('');
    sendData(room, m);
  }, [room, myName, pushMessage, isHost]);

  const sendReaction = useCallback(() => {
    reactionsRef.current?.add('❤️');
    setLikeCount((c) => c + 1);
    pendingLikesRef.current += 1;
    sendData(room, { v: 1, t: 'react', emoji: '❤️' }, false);
  }, [room]);

  // ── host: poll co-host request inbox ─────────────────────────────────────--
  useEffect(() => {
    if (!isHost) return undefined;
    const tick = async () => { try { setRequests(await fetchCohostRequests(broadcast.id)); } catch {} };
    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [isHost, broadcast.id]);

  // ── viewer → co-host promotion ───────────────────────────────────────────--
  // After the host approves, poll for the co-host publish token. Once we get it,
  // promote: this swaps the token so the room reconnects as a publisher and
  // starts sending audio + video (canPublish drives the LiveKitRoom a/v props).
  const startPromotionPoll = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetchCohostToken(broadcast.id); // 200 = approved, 403 = pending
        if (res?.token) {
          clearInterval(pollRef.current); pollRef.current = null;
          onPromoted(res.token);
        }
      } catch (e) {
        // 'pending' (or no answer, offline): keep waiting. Any other answer
        // ends the asking — before, a declined viewer asked every 4 s until
        // they left.
        const code = e?.response?.data?.code;
        if (code && code !== 'pending') {
          clearInterval(pollRef.current); pollRef.current = null;
          setRequested(false);
          if (code === 'rejected') Alert.alert(t('live.title'), t('live.requestDeclined'));
        }
      }
    }, 4000);
  }, [broadcast.id, onPromoted, t]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // When we become a co-host, the room reconnects publishing — reflect that in
  // the control state (mic on; camera on for video kinds).
  useEffect(() => {
    if (role !== 'cohost') return;
    setMicOn(true);
    setCamOn(false);
    Alert.alert(t('live.title'), t('live.onStage'));
  }, [role, t]);

  // ── publisher controls ───────────────────────────────────────────────────--
  const toggleMic = async () => {
    const next = !micOn;
    try { await localParticipant?.setMicrophoneEnabled(next); setMicOn(next); }
    catch (e) {
      Alert.alert(t('live.title'), t('live.micFailed'));
      if (__DEV__) console.warn('mic', e);
    }
  };
  const toggleCam = async () => {
    const next = !camOn;
    // A co-host turning the camera on for the first time: ask for it now.
    if (next && !(await ensureLivePermissions({ video: true, t }))) return;
    try {
      await localParticipant?.setCameraEnabled(next, next ? { facingMode: facingRef.current } : undefined);
      setCamOn(next);
    } catch (e) {
      Alert.alert(t('live.title'), t('live.cameraPublishFailed'));
      if (__DEV__) console.warn('camera', e);
    }
  };

  // Back from the background (a call, another app, the lock screen): Android
  // and iOS stop the camera there, and the track does not come back by
  // itself - the host returned to a black picture for everyone. Restart it.
  const camOnRef = useRef(camOn);
  camOnRef.current = camOn;
  useEffect(() => {
    if (!canPublish || !isVideo || !localParticipant) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !camOnRef.current) return;
      const pub = localParticipant.getTrackPublication?.(Track.Source.Camera);
      const vt = pub?.videoTrack || pub?.track;
      const stopped = !vt || vt.mediaStreamTrack?.readyState === 'ended';
      if (!stopped) return;
      const again = () => localParticipant.setCameraEnabled(true).catch(() => {});
      if (vt?.restartTrack) Promise.resolve(vt.restartTrack({ facingMode: facingRef.current })).catch(again);
      else again();
    });
    return () => sub?.remove?.();
  }, [canPublish, isVideo, localParticipant]);
  const flipCam = async () => {
    const next = facingRef.current === 'user' ? 'environment' : 'user';
    try {
      const localId = localParticipant?.identity;
      const pub = localParticipant?.getTrackPublication?.(Track.Source.Camera)
        || camByIdentity[localId]?.publication;
      const vt = pub?.videoTrack || pub?.track;
      const mst = vt?.mediaStreamTrack || vt?._mediaStreamTrack;
      if (!vt && !mst) {
        Alert.alert(t('live.flipCamera'), t('live.turnCameraOn'));
        return;
      }

      // Primary: re-acquire the camera with the other facing mode. restartTrack
      // does a real getUserMedia switch and replaces the sender track in place
      // (it skips a closed transport, so it won't break publishing). This is the
      // reliable path — applyConstraints/_switchCamera don't actually switch a
      // LiveKit-managed capture on @livekit/react-native-webrtc.
      if (vt && typeof vt.restartTrack === 'function') {
        await vt.restartTrack({ facingMode: next });
        facingRef.current = next;
        return;
      }
      // Fallback: react-native-webrtc's in-place camera switch.
      if (mst && typeof mst._switchCamera === 'function') {
        mst._switchCamera();
        facingRef.current = next;
        return;
      }
      Alert.alert(t('live.flipCamera'), t('live.flipUnsupported'));
    } catch (e) {
      Alert.alert(t('live.flipCamera'), t('live.flipFailed'));
      if (__DEV__) console.warn('flipCam failed', e);
    }
  };

  const leave = () => {
    if (leavingRef) leavingRef.current = true;
    try { room?.disconnect(); } catch {}
  };
  const endLive = () => {
    Alert.alert(t('live.endBroadcastTitle'), t('live.endBroadcastBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('live.end'), style: 'destructive', onPress: async () => {
        if (leavingRef) leavingRef.current = true;   // the room closing is my doing
        try { await endBroadcast(broadcast.id); } catch {}
        leave();
      } },
    ]);
  };

  // The host going back (Android's back button, a push opened) would leave
  // the room live with nobody hosting until LiveKit noticed: ask, and end it.
  useEffect(() => {
    if (!isHost || !navigation?.addListener) return undefined;
    return navigation.addListener('beforeRemove', (e) => {
      if (leavingRef?.current) return;
      e.preventDefault();
      Alert.alert(t('live.leaveHostTitle'), t('live.leaveHostBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('live.end'), style: 'destructive', onPress: async () => {
          if (leavingRef) leavingRef.current = true;
          try { await endBroadcast(broadcast.id); } catch {}
          leave();
          navigation.dispatch(e.data.action);
        } },
      ]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, navigation, broadcast.id, t]);

  const askToJoin = async () => {
    // On stage means speaking: the microphone is asked for before the host
    // is, so an approval never lands on a phone that cannot be heard.
    if (!(await ensureLivePermissions({ video: false, t }))) return;
    try { await requestCohost(broadcast.id); setRequested(true); startPromotionPoll(); }
    catch { Alert.alert(t('live.title'), t('live.requestFailed')); }
  };
  const approve = async (req) => {
    try { await approveCohost(broadcast.id, req.id); setRequests((p) => p.filter((r) => r.id !== req.id)); } catch {}
  };
  const reject = async (req) => {
    try { await rejectCohost(broadcast.id, req.id); setRequests((p) => p.filter((r) => r.id !== req.id)); } catch {}
  };
  // Asked first (a tap on a small x removed people by accident), and a
  // failure is said, not left as an unhandled promise.
  const kick = (identity) => {
    const who = participants.find((p) => p.identity === identity);
    Alert.alert(t('live.removeTitle', { name: who?.name || identity }), t('live.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('live.remove'), style: 'destructive', onPress: () => {
        moderateBroadcast(broadcast.id, String(identity || '').replace(/^u/, ''))
          .catch(() => Alert.alert(t('live.title'), t('live.removeFailed')));
      } },
    ]);
  };

  const connecting = publishers.length === 0;

  // Never connected after a while: say so, with Try again and Leave.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (connState === ConnectionState.Connected) { setStuck(false); return undefined; }
    const id = setTimeout(() => setStuck(true), CONNECT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [connState]);

  // Host's pending co-host requests. Extracted so it can live in the main column
  // (portrait) or the side panel (landscape) without duplicating the markup.
  const inboxNode = isHost && requests.length > 0 ? (
    <View style={styles.inbox}>
      <Text style={styles.sectionLabel}>{t('live.requestsToJoin')}</Text>
      <ScrollView style={{ maxHeight: 140 }}>
        {requests.map((r) => (
          <View key={r.id} style={styles.reqRow}>
            <Text style={styles.reqName} numberOfLines={1}>@{r.user?.username || 'user'}</Text>
            <TouchableOpacity style={[styles.reqBtn, styles.reqApprove]} onPress={() => approve(r)}>
              <Text style={styles.reqApproveText}>{t('common.approve')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.reqBtn, styles.reqReject]} onPress={() => reject(r)}>
              <Text style={styles.reqRejectText}>{t('common.decline')}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  ) : null;

  // ── Shared pieces (composed differently for portrait vs landscape) ───────────
  const headerNode = (
    <View style={styles.header}>
      <LiveBadge />
      <Text style={styles.elapsed}>{elapsed}</Text>
      {isHost && (
        <TouchableOpacity style={styles.endPillWrap} onPress={endLive} activeOpacity={0.85} hitSlop={6}>
          <LinearGradient colors={live.gradEnd} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.endPill}>
            <Ionicons name="stop" size={11} color="#fff" />
            <Text style={styles.endPillText}>{t('live.end')}</Text>
          </LinearGradient>
        </TouchableOpacity>
      )}
      <View style={styles.headerRight}>
        <View style={styles.heartPill}>
          <Ionicons name="heart" size={12} color={live.live} />
          <Text style={styles.heartPillText}>{fmtCount(likeCount)}</Text>
        </View>
        <ViewPill count={watching} />
        {!isHost && (
          <TouchableOpacity style={styles.closeBtn} onPress={leave} hitSlop={10}>
            <Ionicons name="close" size={20} color={live.ink} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  // Host chip + Follow — shown to viewers/co-hosts at the top of the room.
  const hostRowNode = (
    <View style={styles.hostRow}>
      <GoldRing uri={hostUser.profile_picture} size={26} />
      <Text style={styles.hostRowName} numberOfLines={1}>@{hostUser.username || 'host'}</Text>
      {showFollow && (
        <TouchableOpacity
          onPress={toggleFollow}
          disabled={followBusy}
          activeOpacity={0.85}
          style={[styles.followBtn, followState !== 'none' && styles.followingBtn]}
        >
          {followState === 'following' ? (
            <Text style={styles.followingText}>{t('profile.following')}</Text>
          ) : followState === 'requested' ? (
            <Text style={styles.followingText}>{t('profile.requested')}</Text>
          ) : (
            <>
              <Ionicons name="add" size={14} color={live.onGold} />
              <Text style={styles.followText}>{t('profile.follow')}</Text>
            </>
          )}
        </TouchableOpacity>
      )}
      {/* Viewers can report a broadcast; taking it down also ends it. */}
      {!isHost && !!broadcast?.id && (
        <TouchableOpacity onPress={() => setReporting(true)} hitSlop={10} style={{ marginLeft: 8 }}
          accessibilityRole="button" accessibilityLabel={t('report.action')} testID="live-report">
          <Ionicons name="flag-outline" size={18} color="#fff" />
        </TouchableOpacity>
      )}
      <ReportModal visible={reporting} onClose={() => setReporting(false)} contentType="livebroadcast"
        objectId={broadcast?.id} />
    </View>
  );

  const reconnectNode = reconnecting ? (
    <View style={styles.reconnect}>
      <ActivityIndicator size="small" color="#fff" />
      <Text style={styles.reconnectText}>{t('live.reconnecting')}</Text>
    </View>
  ) : null;

  const stageNode = stuck ? (
    <View style={[styles.connecting, styles.stuck, !landscape && styles.centerFill]} testID="live-stuck">
      <MaterialCommunityIcons name="access-point-network-off" size={40} color={live.inkDim} />
      <Text style={styles.connectingText}>{t('live.cantConnect')}</Text>
      <View style={styles.stuckRow}>
        <TouchableOpacity style={[styles.ctrlBtn, styles.stuckBtn]} onPress={() => { setStuck(false); onRetry?.(); }}
          accessibilityRole="button" testID="live-retry">
          <Text style={styles.ctrlText}>{t('live.tryAgain')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlEnd, styles.stuckBtn]} onPress={() => {
          if (leavingRef) leavingRef.current = true;
          navigation.goBack();
        }} accessibilityRole="button">
          <Text style={styles.ctrlText}>{t('live.leave')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : connecting ? (
    <View style={[styles.connecting, !landscape && styles.centerFill]}>
      <ActivityIndicator color={live.gold} />
      <Text style={styles.connectingText}>{t('live.connecting')}</Text>
    </View>
  ) : isVideo ? (
    <VideoStage
      spotlight={spotlight}
      publishers={publishers}
      camByIdentity={camByIdentity}
      isHost={isHost}
      localIdentity={localParticipant?.identity}
      onKick={kick}
      landscape={landscape}
      fill={!landscape}
    />
  ) : (
    <View style={[styles.speakerWrap, !landscape && styles.speakerWrapFull]}>
      {publishers.map((p) => (
        <View key={p.identity} style={styles.speaker}>
          <View style={[styles.speakerAvatar, p.isSpeaking && styles.speakerActive]}>
            <MaterialCommunityIcons
              name={p.isMicrophoneEnabled ? 'microphone' : 'microphone-off'}
              size={22}
              color={p.isMicrophoneEnabled ? live.gold : live.inkMute}
            />
          </View>
          <Text style={styles.speakerName} numberOfLines={1}>{p.name || p.identity}</Text>
          {isHost && p.identity !== localParticipant?.identity && (
            <TouchableOpacity onPress={() => kick(p.identity)} hitSlop={10} accessibilityRole="button">
              <Text style={styles.removeText}>{t('live.remove')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );

  const controlsNode = (
    <View style={[styles.controls, landscape && styles.controlsLandscape]}>
      <TouchableOpacity style={styles.ctrlBtn} onPress={sendReaction} accessibilityRole="button" testID="live-heart">
        <Ionicons name="heart" size={22} color={live.live} />
      </TouchableOpacity>
      {canPublish ? (
        <>
          <TouchableOpacity style={[styles.ctrlBtn, !micOn && styles.ctrlMuted]} onPress={toggleMic}>
            <MaterialCommunityIcons name={micOn ? 'microphone' : 'microphone-off'} size={22} color="#fff" />
          </TouchableOpacity>
          {isVideo && (
            <TouchableOpacity style={[styles.ctrlBtn, !camOn && styles.ctrlMuted]} onPress={toggleCam}>
              <MaterialCommunityIcons name={camOn ? 'video' : 'video-off'} size={22} color="#fff" />
            </TouchableOpacity>
          )}
          {isVideo && camOn && (
            <TouchableOpacity style={styles.ctrlBtn} onPress={flipCam}>
              <MaterialCommunityIcons name="camera-flip-outline" size={22} color="#fff" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.ctrlBtn, graphic && styles.ctrlOn]} onPress={() => setGraphicOpen(true)}>
            <MaterialCommunityIcons name="subtitles-outline" size={22} color={graphic ? live.gold : '#fff'} />
          </TouchableOpacity>
          {!isHost && (
            <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlEnd]} onPress={leave}>
              <Ionicons name="exit-outline" size={20} color="#fff" /><Text style={styles.ctrlText}>{t('live.leave')}</Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <>
          <TouchableOpacity
            style={[styles.ctrlBtn, styles.ctrlGrow, requested && styles.ctrlMuted]}
            onPress={askToJoin}
            disabled={requested}
          >
            <MaterialCommunityIcons name="hand-back-right-outline" size={20} color="#fff" />
            <Text style={styles.ctrlText}>{requested ? t('live.requested') : t('live.requestToJoin')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlEnd]} onPress={leave}>
            <Ionicons name="exit-outline" size={20} color="#fff" /><Text style={styles.ctrlText}>{t('live.leave')}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  // ── Landscape: video fills the left, a chat/controls panel on the right ──────
  if (landscape) {
    return (
      <View style={[styles.inner, styles.innerLandscape, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.mainCol}>
          {headerNode}
          {hostRowNode}
          {reconnectNode}
          {stageNode}
          <LiveGraphic
            graphic={graphic}
            insets={insets}
            bottomOffset={insets.bottom + spacing.lg}
            kbHeight={kbHeight}
            editable={canPublish}
            onReposition={(pos) => publishGraphic({ ...graphicRef.current, ...pos })}
          />
        </View>
        <View style={[styles.sidePanel, { marginBottom: kbHeight }]}>
          {inboxNode}
          <View style={[styles.bottomRow, styles.bottomRowLandscape]}>
            <LiveChat messages={messages} draft={draft} onChangeDraft={setDraft} onSend={sendChat} style={styles.chat} />
            <FloatingReactions ref={reactionsRef} />
          </View>
          {controlsNode}
        </View>
        {canPublish && (
          <GraphicComposer
            visible={graphicOpen}
            current={graphic}
            onShow={publishGraphic}
            onClear={() => publishGraphic(null)}
            onClose={() => setGraphicOpen(false)}
          />
        )}
      </View>
    );
  }

  // ── Portrait: full-bleed video with a frosted blue-glass dock (TikTok-style) ──
  return (
    <View style={styles.portraitRoot}>
      <View style={styles.bgStage}>{stageNode}</View>

      {/* Top scrim keeps the header + title legible over bright video. */}
      <LinearGradient
        colors={live.gradScrimTop}
        style={[styles.topScrim, { paddingTop: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        {headerNode}
        <Text style={styles.titleOverlay} numberOfLines={2}>{broadcast.title}</Text>
        <Text style={styles.kindOverlay}>{t(KIND_KEY[broadcast.kind] || 'live.kindMeet').toUpperCase()}</Text>
        {hostRowNode}
      </LinearGradient>

      {reconnecting && <View style={styles.reconnectFloat} pointerEvents="none">{reconnectNode}</View>}

      <LiveGraphic
        graphic={graphic}
        insets={insets}
        bottomOffset={(dockH || 150) + spacing.sm}
        kbHeight={kbHeight}
        editable={canPublish}
        onReposition={(pos) => publishGraphic({ ...graphicRef.current, ...pos })}
      />
      <FloatingReactions ref={reactionsRef} />

      {/* Bottom dock: a frosted blue glass holding the inbox, chat and controls.
          Floats above the keyboard by shifting `bottom` (edge-to-edge safe). */}
      <View
        style={[styles.dockWrap, { bottom: kbHeight }]}
        onLayout={(e) => setDockH(e.nativeEvent.layout.height)}
      >
        <BlurView intensity={32} tint="dark" style={styles.dock}>
          <View style={styles.dockTint} pointerEvents="none" />
          <View style={[styles.dockInner, { paddingBottom: kbHeight > 0 ? spacing.sm : insets.bottom + spacing.sm }]}>
            {inboxNode}
            <LiveChat messages={messages} draft={draft} onChangeDraft={setDraft} onSend={sendChat} style={styles.chatFull} />
            {controlsNode}
          </View>
        </BlurView>
      </View>

      {canPublish && (
        <GraphicComposer
          visible={graphicOpen}
          current={graphic}
          onShow={publishGraphic}
          onClear={() => publishGraphic(null)}
          onClose={() => setGraphicOpen(false)}
        />
      )}
    </View>
  );
};

// Video: large active-speaker tile + a thumbnail row of the other publishers.
const VideoStage = ({ spotlight, publishers, camByIdentity, isHost, localIdentity, onKick, landscape, fill }) => {
  const others = publishers.filter((p) => p.identity !== spotlight?.identity);
  // `cover` = the spotlight fills its container edge-to-edge (landscape, or the
  // portrait full-bleed layout). Otherwise it's a 16:10 tile with a thumbnail row.
  const cover = landscape || fill;
  return (
    <View style={[styles.videoStage, cover && styles.videoStageFill]}>
      {spotlight && (
        <PublisherTile
          participant={spotlight}
          trackRef={camByIdentity[spotlight.identity]}
          big
          bigStyle={cover ? styles.spotlightFill : null}
          showKick={isHost && spotlight.identity !== localIdentity}
          onKick={onKick}
        />
      )}
      {!cover && others.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow} contentContainerStyle={{ gap: spacing.sm }}>
          {others.map((p) => (
            <PublisherTile
              key={p.identity}
              participant={p}
              trackRef={camByIdentity[p.identity]}
              showKick={isHost && p.identity !== localIdentity}
              onKick={onKick}
            />
          ))}
        </ScrollView>
      )}
      {/* Portrait full-bleed: co-hosts float as small picture-in-picture tiles. */}
      {fill && others.length > 0 && (
        <View style={styles.floatThumbs} pointerEvents="box-none">
          {others.slice(0, 3).map((p) => (
            <PublisherTile
              key={p.identity}
              participant={p}
              trackRef={camByIdentity[p.identity]}
              showKick={isHost && p.identity !== localIdentity}
              onKick={onKick}
            />
          ))}
        </View>
      )}
    </View>
  );
};

const PublisherTile = ({ participant, trackRef, big, bigStyle, showKick, onKick }) => {
  // Render only when there's an actual subscribed track that isn't muted. A bare
  // placeholder ref (publication without a track) must fall back to the avatar,
  // not try to draw an empty video — that's what hid a co-host's late video.
  const hasVideo = !!trackRef?.publication?.track && !trackRef.publication.isMuted;
  return (
    <View style={[big ? styles.spotlightTile : styles.thumbTile, big && bigStyle, participant.isSpeaking && styles.tileSpeaking]}>
      {hasVideo ? (
        <VideoTrack trackRef={trackRef} style={styles.video} objectFit="cover" />
      ) : (
        <View style={styles.videoOff}>
          <MaterialCommunityIcons name="account" size={big ? 64 : 30} color={live.inkDim} />
        </View>
      )}
      <View style={styles.videoNameTag}>
        {!participant.isMicrophoneEnabled && (
          <MaterialCommunityIcons name="microphone-off" size={11} color="#fff" style={{ marginRight: 3 }} />
        )}
        <Text style={styles.videoName} numberOfLines={1}>{participant.name || participant.identity}</Text>
      </View>
      {showKick && (
        <TouchableOpacity style={styles.videoKick} onPress={() => onKick(participant.identity)} hitSlop={12}
          accessibilityRole="button">
          <Ionicons name="close" size={14} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: live.bg },
  inner: { flex: 1, paddingHorizontal: spacing.md },
  // Landscape: video on the left, a chat/controls side panel on the right.
  innerLandscape: { flexDirection: 'row' },
  mainCol: { flex: 1 },
  sidePanel: { width: '40%', maxWidth: 340, marginLeft: spacing.sm },
  videoStageFill: { flex: 1 },
  spotlightFill: { flex: 1, aspectRatio: undefined, width: '100%' },
  bottomRowLandscape: { flex: 1 },
  controlsLandscape: { flexWrap: 'wrap', justifyContent: 'center' },

  guard: { flex: 1, backgroundColor: live.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  guardTitle: { ...typography.h2, color: live.ink, textAlign: 'center' },
  guardText: { ...typography.body, color: live.inkDim, textAlign: 'center' },
  guardBtn: { backgroundColor: live.gold, borderRadius: radius.full, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm + 2, marginTop: spacing.sm },
  guardBtnText: { ...typography.button, color: live.onGold, fontWeight: '800' },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  elapsed: { ...typography.caption, color: live.inkDim, fontVariant: ['tabular-nums'], fontWeight: '600', flexShrink: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginLeft: 'auto', flexShrink: 0 },
  heartPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: radius.full, backgroundColor: 'rgba(6,13,26,0.5)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(229,72,74,0.45)',
  },
  heartPillText: { color: live.ink, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(6,13,26,0.45)', borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
  },

  // Host chip + Follow
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  hostRowName: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '700' },
  followBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.full, backgroundColor: live.gold, ...goldGlow, shadowRadius: 10, elevation: 5,
  },
  followText: { color: live.onGold, fontSize: 12.5, fontWeight: '800' },
  followingBtn: {
    backgroundColor: 'rgba(6,13,26,0.5)', borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
    shadowOpacity: 0, elevation: 0,
  },
  followingText: { color: live.gold, fontSize: 12.5, fontWeight: '700' },

  reconnect: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.sm,
  },
  reconnectText: { ...typography.caption, color: '#fff', fontWeight: '700' },

  title: { ...typography.h2, color: live.ink, marginTop: spacing.md },
  kind: { ...typography.caption, color: live.gold, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  sectionLabel: {
    ...typography.label, color: live.gold, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm,
  },

  videoStage: { gap: spacing.sm },
  spotlightTile: {
    width: '100%', aspectRatio: 16 / 10, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: '#000', borderWidth: 2, borderColor: 'rgba(255,255,255,0.10)',
  },
  thumbRow: { },
  thumbTile: {
    width: 110, aspectRatio: 3 / 4, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: '#000', borderWidth: 2, borderColor: 'rgba(255,255,255,0.10)',
  },
  // Gold ring only — no goldGlow here: its Android elevation would raise the
  // full-bleed spotlight above the title overlay, making the title vanish while
  // someone talks. The border alone is the "who's speaking" cue.
  tileSpeaking: { borderColor: live.gold },
  video: { flex: 1, backgroundColor: '#000' },
  videoOff: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: live.navy },
  videoNameTag: {
    position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: radius.full, maxWidth: '80%',
  },
  videoName: { color: '#fff', fontSize: 11, fontWeight: '700' },
  videoKick: {
    position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(229,57,53,0.85)', alignItems: 'center', justifyContent: 'center',
  },

  speakerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  connecting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  connectingText: { ...typography.body, color: live.inkDim },
  stuck: { flexDirection: 'column', gap: spacing.md, paddingHorizontal: spacing.lg },
  stuckRow: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'stretch' },
  stuckBtn: { flex: 1 },
  speaker: { alignItems: 'center', width: 80, gap: 4 },
  speakerAvatar: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(16,28,46,0.9)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)',
  },
  speakerActive: { borderColor: live.gold },
  speakerName: { ...typography.caption, color: live.ink, fontWeight: '600' },
  removeText: { ...typography.caption, color: live.live, fontSize: 10 },

  inbox: {
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.sm, marginTop: spacing.md,
  },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  reqName: { flex: 1, ...typography.label, color: live.ink },
  reqBtn: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.md },
  reqApprove: { backgroundColor: live.gold },
  reqApproveText: { ...typography.caption, color: live.onGold, fontWeight: '800' },
  reqReject: { backgroundColor: 'rgba(255,255,255,0.08)' },
  reqRejectText: { ...typography.caption, color: live.inkDim, fontWeight: '700' },

  bottomRow: { minHeight: 80, justifyContent: 'flex-end' },
  chat: { },

  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  ctrlBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minWidth: 52, height: 52, paddingHorizontal: spacing.sm,
    backgroundColor: 'rgba(16,28,46,0.9)', borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', ...shadows.sm,
  },
  ctrlGrow: { flex: 1 },
  ctrlMuted: { opacity: 0.6 },
  ctrlOn: { borderColor: live.gold },
  ctrlEnd: { backgroundColor: live.live, borderColor: live.live, flex: 1 },

  // End-live: a compact crimson pill in the header, next to the live timer — up
  // and away from the frequently-tapped controls so it can't be hit by accident.
  endPillWrap: { borderRadius: radius.full, ...redGlow, shadowRadius: 8, elevation: 4 },
  endPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 26,
    borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)',
  },
  endPillText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  ctrlText: { ...typography.label, color: '#fff', fontWeight: '700' },

  // ── Portrait full-bleed (TikTok-style) ──────────────────────────────────────
  portraitRoot: { flex: 1, backgroundColor: '#000' },
  bgStage: { ...StyleSheet.absoluteFillObject },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  speakerWrapFull: { flex: 1, alignItems: 'center', justifyContent: 'center', alignContent: 'center' },
  floatThumbs: { position: 'absolute', top: 104, right: spacing.md, gap: spacing.sm },

  topScrim: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: spacing.md, paddingBottom: spacing.xl, zIndex: 2,
  },
  titleOverlay: {
    ...typography.h3, color: '#fff', fontWeight: '800', marginTop: spacing.xs,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  kindOverlay: { ...typography.caption, color: live.gold, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  reconnectFloat: { position: 'absolute', top: 110, left: 0, right: 0, alignItems: 'center', zIndex: 3 },

  dockWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4 },
  dock: {
    borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, overflow: 'hidden',
    borderTopWidth: 1, borderColor: live.hair,
  },
  // The blue cast over the blur — frosted "blue glass" with a faint gold sheen at the top edge.
  dockTint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(14,42,74,0.5)' },
  dockInner: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  chatFull: { width: '100%' },
});

export default LiveRoom;
