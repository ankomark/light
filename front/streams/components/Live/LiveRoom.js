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
  KeyboardAvoidingView, Platform, useWindowDimensions,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { lockPortrait, allowAllOrientations } from '../../utils/orientation';
import Constants from 'expo-constants';
import {
  LiveKitRoom, AudioSession, useParticipants, useLocalParticipant, useRoomContext,
  useTracks, VideoTrack,
} from '@livekit/react-native';
import { Track, RoomEvent, ConnectionState } from 'livekit-client';
import {
  endBroadcast, requestCohost, fetchCohostRequests, approveCohost, rejectCohost,
  fetchCohostToken, moderateBroadcast,
} from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';
import LiveChat from './LiveChat';
import FloatingReactions from './FloatingReactions';

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

const KIND_LABEL = { meet: 'MEET', tv: 'GO-LIVE' };

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
  const {
    url, token: initialToken, broadcast, role: initialRole,
    initialMicOn, initialCamOn,
  } = route.params;
  const [token, setToken] = useState(initialToken);
  const [role, setRole] = useState(initialRole); // host | viewer | cohost
  // Set while we intentionally reconnect for a promotion, so the unmount's
  // disconnect doesn't bounce us out of the screen.
  const promotingRef = useRef(false);
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

  useEffect(() => {
    if (inExpoGo) return undefined;
    AudioSession.startAudioSession().catch(() => {});
    return () => { AudioSession.stopAudioSession().catch(() => {}); };
  }, [inExpoGo]);

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
        <MaterialCommunityIcons name="broadcast-off" size={56} color={colors.textSecondary} />
        <Text style={styles.guardTitle}>Live needs the full app</Text>
        <Text style={styles.guardText}>Live broadcasting uses native WebRTC, which isn’t available in Expo Go. Open a development build to go live or watch.</Text>
        <TouchableOpacity style={styles.guardBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.guardBtnText}>Go back</Text>
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
      key={token}
      serverUrl={url}
      token={token}
      connect
      audio={canPublish && (initialMicOn !== false)}
      video={canPublish && isVideo && (initialCamOn !== false)}
      // adaptiveStream pauses remote video whose view isn't detected as visible
      // (flaky in RN ScrollViews), which hid late publishers' (co-hosts') video
      // from the host. A broadcast has few publishers, so subscribe fully.
      options={{ adaptiveStream: false }}
      onError={(e) => console.warn('LiveKit error', e)}
      onConnected={() => { promotingRef.current = false; }}
      onDisconnected={() => {
        if (promotingRef.current) { promotingRef.current = false; return; } // promotion reconnect
        navigation.goBack();
      }}
      style={styles.root}
    >
      <RoomInner
        broadcast={broadcast}
        role={role}
        canPublish={canPublish}
        isVideo={isVideo}
        initialMicOn={initialMicOn !== false}
        initialCamOn={isVideo && initialCamOn !== false}
        navigation={navigation}
        onPromoted={(t) => {
          if (t && t !== token) { promotingRef.current = true; setToken(t); }
          setRole('cohost');
        }}
      />
    </LiveKitRoom>
  );
};

const RoomInner = ({
  broadcast, role, canPublish, isVideo, initialMicOn, initialCamOn, navigation, onPromoted,
}) => {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const cameraTracks = useTracks([Track.Source.Camera]);
  const isHost = role === 'host';

  const [micOn, setMicOn] = useState(canPublish && initialMicOn);
  const [camOn, setCamOn] = useState(canPublish && initialCamOn);
  const facingRef = useRef('user');
  const [requests, setRequests] = useState([]);     // host: pending co-host requests
  const [requested, setRequested] = useState(false); // viewer: asked to join

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
    cameraTracks.forEach((t) => { m[t.participant.identity] = t; });
    return m;
  }, [cameraTracks]);
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
    localParticipant.setMicrophoneEnabled(micOn).catch(() => {});
    if (isVideo) localParticipant.setCameraEnabled(camOn).catch(() => {});
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
    const onData = (payload) => {
      const msg = decodeData(payload);
      if (!msg) return;
      if (msg.t === 'chat') pushMessage({ id: msg.id, name: msg.name, text: msg.text });
      else if (msg.t === 'react') reactionsRef.current?.add(msg.emoji || '❤️');
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room, pushMessage]);

  const sendChat = useCallback((text) => {
    const m = { v: 1, t: 'chat', id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: myName, text };
    pushMessage({ id: m.id, name: m.name, text: m.text });
    setDraft('');
    try { room?.localParticipant?.publishData(encodeData(m), { reliable: true }); } catch {}
  }, [room, myName, pushMessage]);

  const sendReaction = useCallback(() => {
    reactionsRef.current?.add('❤️');
    try { room?.localParticipant?.publishData(encodeData({ v: 1, t: 'react', emoji: '❤️' }), { reliable: false }); } catch {}
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
      } catch { /* not approved yet (403) — keep waiting */ }
    }, 4000);
  }, [broadcast.id, onPromoted]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // When we become a co-host, the room reconnects publishing — reflect that in
  // the control state (mic on; camera on for video kinds).
  useEffect(() => {
    if (role === 'cohost') { setMicOn(true); setCamOn(isVideo); }
  }, [role, isVideo]);

  // ── publisher controls ───────────────────────────────────────────────────--
  const toggleMic = async () => {
    const next = !micOn;
    try { await localParticipant?.setMicrophoneEnabled(next); setMicOn(next); }
    catch (e) { if (__DEV__) Alert.alert('Mic failed', String(e?.message || e)); }
  };
  const toggleCam = async () => {
    const next = !camOn;
    try {
      await localParticipant?.setCameraEnabled(next);
      setCamOn(next);
    } catch (e) {
      if (__DEV__) Alert.alert('Camera publish failed', String(e?.message || e));
    }
  };
  const flipCam = async () => {
    const next = facingRef.current === 'user' ? 'environment' : 'user';
    try {
      const localId = localParticipant?.identity;
      const pub = localParticipant?.getTrackPublication?.(Track.Source.Camera)
        || camByIdentity[localId]?.publication;
      const vt = pub?.videoTrack || pub?.track;
      const mst = vt?.mediaStreamTrack || vt?._mediaStreamTrack;
      if (!vt && !mst) {
        Alert.alert('Flip camera', 'Turn your camera on first.');
        return;
      }

      // Flip in place (no renegotiation) by applying the *explicit* facing mode
      // we want. We deliberately don't use mst._switchCamera(): it toggles off
      // the track's own _settings.facingMode, which LiveKit often leaves unset,
      // so the first tap becomes a no-op. Setting facingMode directly is reliable.
      if (mst && typeof mst.applyConstraints === 'function') {
        const settings = typeof mst.getSettings === 'function' ? mst.getSettings() : {};
        const constraints = { ...settings };
        delete constraints.deviceId; // deviceId would pin the current camera
        constraints.facingMode = next;
        await mst.applyConstraints(constraints);
        facingRef.current = next;
        return;
      }
      // Fallback: re-acquire the camera with the other facing mode.
      if (vt && typeof vt.restartTrack === 'function') {
        await vt.restartTrack({ facingMode: next });
        facingRef.current = next;
        return;
      }
      Alert.alert('Flip camera', "This device doesn't support switching cameras here.");
    } catch (e) {
      Alert.alert('Flip camera', "Couldn't switch the camera. Please try again.");
      if (__DEV__) console.warn('flipCam failed', e);
    }
  };

  const leave = () => { try { room?.disconnect(); } catch {} };
  const endLive = () => {
    Alert.alert('End broadcast', 'Stop broadcasting for everyone?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'End', style: 'destructive', onPress: async () => {
        try { await endBroadcast(broadcast.id); } catch {}
        leave();
      } },
    ]);
  };

  const askToJoin = async () => {
    try { await requestCohost(broadcast.id); setRequested(true); startPromotionPoll(); }
    catch { Alert.alert('Live', 'Could not send your request.'); }
  };
  const approve = async (req) => {
    try { await approveCohost(broadcast.id, req.id); setRequests((p) => p.filter((r) => r.id !== req.id)); } catch {}
  };
  const reject = async (req) => {
    try { await rejectCohost(broadcast.id, req.id); setRequests((p) => p.filter((r) => r.id !== req.id)); } catch {}
  };
  const kick = (identity) => moderateBroadcast(broadcast.id, identity?.replace(/^u/, ''));

  const connecting = publishers.length === 0;

  // Host's pending co-host requests. Extracted so it can live in the main column
  // (portrait) or the side panel (landscape) without duplicating the markup.
  const inboxNode = isHost && requests.length > 0 ? (
    <View style={styles.inbox}>
      <Text style={styles.sectionLabel}>Requests to join</Text>
      <ScrollView style={{ maxHeight: 140 }}>
        {requests.map((r) => (
          <View key={r.id} style={styles.reqRow}>
            <Text style={styles.reqName} numberOfLines={1}>@{r.user?.username || 'user'}</Text>
            <TouchableOpacity style={[styles.reqBtn, styles.reqApprove]} onPress={() => approve(r)}>
              <Text style={styles.reqApproveText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.reqBtn, styles.reqReject]} onPress={() => reject(r)}>
              <Text style={styles.reqRejectText}>Decline</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  ) : null;

  // ── Shared pieces (composed differently for portrait vs landscape) ───────────
  const headerNode = (
    <View style={styles.header}>
      <View style={styles.liveDot} />
      <Text style={styles.liveLabel}>LIVE</Text>
      <Text style={styles.elapsed}>{elapsed}</Text>
      <Text style={styles.viewers}><Ionicons name="eye" size={13} color={colors.textSecondary} /> {watching}</Text>
      <TouchableOpacity style={styles.closeBtn} onPress={isHost ? endLive : leave} hitSlop={10}>
        <Ionicons name="close" size={24} color={colors.textPrimary} />
      </TouchableOpacity>
    </View>
  );

  const reconnectNode = reconnecting ? (
    <View style={styles.reconnect}>
      <ActivityIndicator size="small" color="#fff" />
      <Text style={styles.reconnectText}>Reconnecting…</Text>
    </View>
  ) : null;

  const stageNode = connecting ? (
    <View style={[styles.connecting, !landscape && styles.centerFill]}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.connectingText}>Connecting…</Text>
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
              color={p.isMicrophoneEnabled ? colors.accent : colors.textMuted}
            />
          </View>
          <Text style={styles.speakerName} numberOfLines={1}>{p.name || p.identity}</Text>
          {isHost && p.identity !== localParticipant?.identity && (
            <TouchableOpacity onPress={() => kick(p.identity)}>
              <Text style={styles.removeText}>remove</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );

  const controlsNode = (
    <View style={[styles.controls, landscape && styles.controlsLandscape]}>
      <TouchableOpacity style={styles.ctrlBtn} onPress={sendReaction}>
        <Ionicons name="heart" size={22} color={colors.error} />
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
          {isHost ? (
            <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlEnd]} onPress={endLive}>
              <Ionicons name="stop" size={20} color="#fff" /><Text style={styles.ctrlText}>End</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlEnd]} onPress={leave}>
              <Ionicons name="exit-outline" size={20} color="#fff" /><Text style={styles.ctrlText}>Leave</Text>
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
            <Text style={styles.ctrlText}>{requested ? 'Requested…' : 'Request to join'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlEnd]} onPress={leave}>
            <Ionicons name="exit-outline" size={20} color="#fff" /><Text style={styles.ctrlText}>Leave</Text>
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
          {reconnectNode}
          {stageNode}
        </View>
        <KeyboardAvoidingView
          style={styles.sidePanel}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.bottom + 8}
        >
          {inboxNode}
          <View style={[styles.bottomRow, styles.bottomRowLandscape]}>
            <LiveChat messages={messages} draft={draft} onChangeDraft={setDraft} onSend={sendChat} style={styles.chat} />
            <FloatingReactions ref={reactionsRef} />
          </View>
          {controlsNode}
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ── Portrait: full-bleed video with a frosted blue-glass dock (TikTok-style) ──
  return (
    <View style={styles.portraitRoot}>
      <View style={styles.bgStage}>{stageNode}</View>

      {/* Top scrim keeps the header + title legible over bright video. */}
      <LinearGradient
        colors={['rgba(6,16,32,0.92)', 'rgba(6,16,32,0.35)', 'transparent']}
        style={[styles.topScrim, { paddingTop: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        {headerNode}
        <Text style={styles.titleOverlay} numberOfLines={2}>{broadcast.title}</Text>
        <Text style={styles.kindOverlay}>{KIND_LABEL[broadcast.kind] || (broadcast.kind || 'meet').toUpperCase()}</Text>
      </LinearGradient>

      {reconnecting && <View style={styles.reconnectFloat} pointerEvents="none">{reconnectNode}</View>}

      <FloatingReactions ref={reactionsRef} />

      {/* Bottom dock: a frosted blue glass holding the inbox, chat and controls. */}
      <KeyboardAvoidingView
        style={styles.dockWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <BlurView intensity={32} tint="dark" style={styles.dock}>
          <View style={styles.dockTint} pointerEvents="none" />
          <View style={[styles.dockInner, { paddingBottom: insets.bottom + spacing.sm }]}>
            {inboxNode}
            <LiveChat messages={messages} draft={draft} onChangeDraft={setDraft} onSend={sendChat} style={styles.chatFull} />
            {controlsNode}
          </View>
        </BlurView>
      </KeyboardAvoidingView>
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
  // Render the camera track whenever we have a (non-muted) publication for it,
  // rather than trusting participant.isCameraEnabled, which can lag for a remote
  // participant that just started publishing.
  const hasVideo = !!trackRef && !trackRef.publication?.isMuted;
  return (
    <View style={[big ? styles.spotlightTile : styles.thumbTile, big && bigStyle, participant.isSpeaking && styles.tileSpeaking]}>
      {hasVideo ? (
        <VideoTrack trackRef={trackRef} style={styles.video} objectFit="cover" />
      ) : (
        <View style={styles.videoOff}>
          <MaterialCommunityIcons name="account" size={big ? 64 : 30} color={colors.textSecondary} />
        </View>
      )}
      <View style={styles.videoNameTag}>
        {!participant.isMicrophoneEnabled && (
          <MaterialCommunityIcons name="microphone-off" size={11} color="#fff" style={{ marginRight: 3 }} />
        )}
        <Text style={styles.videoName} numberOfLines={1}>{participant.name || participant.identity}</Text>
      </View>
      {showKick && (
        <TouchableOpacity style={styles.videoKick} onPress={() => onKick(participant.identity)}>
          <Ionicons name="close" size={14} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628' },
  inner: { flex: 1, paddingHorizontal: spacing.md },
  // Landscape: video on the left, a chat/controls side panel on the right.
  innerLandscape: { flexDirection: 'row' },
  mainCol: { flex: 1 },
  sidePanel: { width: '40%', maxWidth: 340, marginLeft: spacing.sm },
  videoStageFill: { flex: 1 },
  spotlightFill: { flex: 1, aspectRatio: undefined, width: '100%' },
  bottomRowLandscape: { flex: 1 },
  controlsLandscape: { flexWrap: 'wrap', justifyContent: 'center' },

  guard: { flex: 1, backgroundColor: '#0A1628', alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  guardTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  guardText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  guardBtn: { backgroundColor: colors.accent, borderRadius: radius.full, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm + 2, marginTop: spacing.sm },
  guardBtnText: { ...typography.button, color: '#0A1628', fontWeight: '800' },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  liveDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.error },
  liveLabel: { ...typography.caption, color: colors.error, fontWeight: '900', letterSpacing: 1 },
  elapsed: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing.sm, fontVariant: ['tabular-nums'] },
  viewers: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing.sm },
  closeBtn: { marginLeft: 'auto', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  reconnect: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.sm,
  },
  reconnectText: { ...typography.caption, color: '#fff', fontWeight: '700' },

  title: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.md },
  kind: { ...typography.caption, color: colors.accent, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  sectionLabel: {
    ...typography.label, color: colors.accent, fontWeight: '700', textTransform: 'uppercase',
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
  tileSpeaking: { borderColor: colors.accent },
  video: { flex: 1, backgroundColor: '#000' },
  videoOff: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
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
  connectingText: { ...typography.body, color: colors.textSecondary },
  speaker: { alignItems: 'center', width: 80, gap: 4 },
  speakerAvatar: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(16,28,46,0.9)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)',
  },
  speakerActive: { borderColor: colors.accent },
  speakerName: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  removeText: { ...typography.caption, color: colors.error, fontSize: 10 },

  inbox: {
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.sm, marginTop: spacing.md,
  },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  reqName: { flex: 1, ...typography.label, color: colors.textPrimary },
  reqBtn: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.md },
  reqApprove: { backgroundColor: colors.accent },
  reqApproveText: { ...typography.caption, color: '#0A1628', fontWeight: '800' },
  reqReject: { backgroundColor: 'rgba(255,255,255,0.08)' },
  reqRejectText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },

  bottomRow: { minHeight: 80, justifyContent: 'flex-end' },
  chat: { },

  controls: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  ctrlBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minWidth: 52, height: 52, paddingHorizontal: spacing.sm,
    backgroundColor: 'rgba(16,28,46,0.9)', borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', ...shadows.sm,
  },
  ctrlGrow: { flex: 1 },
  ctrlMuted: { opacity: 0.6 },
  ctrlEnd: { backgroundColor: colors.error, borderColor: colors.error, flex: 1 },
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
  kindOverlay: { ...typography.caption, color: colors.accent, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  reconnectFloat: { position: 'absolute', top: 110, left: 0, right: 0, alignItems: 'center', zIndex: 3 },

  dockWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4 },
  dock: {
    borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(160,200,255,0.28)',
  },
  // The blue cast over the blur — frosted "blue glass".
  dockTint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(16,46,80,0.46)' },
  dockInner: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  chatFull: { width: '100%' },
});

export default LiveRoom;
