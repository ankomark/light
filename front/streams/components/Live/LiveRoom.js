/**
 * Live audio room (LiveKit). Host/co-host publish audio; viewers listen.
 *
 * NOTE: WebRTC is native — this screen only runs in a custom dev client / EAS
 * build (not Expo Go), and needs LIVEKIT_URL/KEY/SECRET configured on the
 * backend. The component uses LiveKit's documented high-level RN API.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LiveKitRoom, AudioSession, useParticipants, useLocalParticipant, useRoomContext,
} from '@livekit/react-native';
import {
  endBroadcast, requestCohost, fetchCohostRequests, approveCohost, rejectCohost,
  fetchCohostToken, moderateBroadcast,
} from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const LiveRoom = ({ navigation, route }) => {
  const { url, token: initialToken, broadcast, role: initialRole } = route.params;
  const [token, setToken] = useState(initialToken);
  const [role, setRole] = useState(initialRole); // host | viewer | cohost
  const canPublish = role === 'host' || role === 'cohost';

  useEffect(() => {
    AudioSession.startAudioSession().catch(() => {});
    return () => { AudioSession.stopAudioSession().catch(() => {}); };
  }, []);

  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect
      audio={canPublish}
      video={false}
      options={{ adaptiveStream: true }}
      onError={(e) => console.warn('LiveKit error', e)}
      onDisconnected={() => navigation.goBack()}
      style={styles.root}
    >
      <RoomInner
        broadcast={broadcast}
        role={role}
        canPublish={canPublish}
        navigation={navigation}
        onPromoted={(t) => { setRole('cohost'); setToken(t); }}
      />
    </LiveKitRoom>
  );
};

const RoomInner = ({ broadcast, role, canPublish, navigation, onPromoted }) => {
  const insets = useSafeAreaInsets();
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const isHost = role === 'host';

  const [micOn, setMicOn] = useState(canPublish);
  const [requests, setRequests] = useState([]);     // host: pending co-host requests
  const [requested, setRequested] = useState(false); // viewer: asked to join
  const pollRef = useRef(null);

  const speakers = participants.filter((p) => p.isMicrophoneEnabled);
  const viewerCount = participants.length;

  // Host: poll the co-host request inbox.
  useEffect(() => {
    if (!isHost) return undefined;
    const tick = async () => {
      try { setRequests(await fetchCohostRequests(broadcast.id)); } catch {}
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [isHost, broadcast.id]);

  // Viewer: after requesting, poll for approval → fetch a publish token → promote.
  const startPromotionPoll = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetchCohostToken(broadcast.id);
        if (res?.token) {
          clearInterval(pollRef.current); pollRef.current = null;
          onPromoted(res.token);
        }
      } catch { /* not approved yet (403) — keep waiting */ }
    }, 4000);
  }, [broadcast.id, onPromoted]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const toggleMic = async () => {
    const next = !micOn;
    try { await localParticipant?.setMicrophoneEnabled(next); setMicOn(next); } catch {}
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

  return (
    <View style={[styles.inner, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.liveDot} />
        <Text style={styles.liveLabel}>LIVE</Text>
        <Text style={styles.viewers}><Ionicons name="eye" size={13} color={colors.textSecondary} /> {viewerCount}</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={isHost ? endLive : leave} hitSlop={10}>
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>{broadcast.title}</Text>
      <Text style={styles.kind}>{(broadcast.kind || 'radio').toUpperCase()}</Text>

      {/* On-air speakers */}
      <Text style={styles.sectionLabel}>On air</Text>
      <View style={styles.speakerWrap}>
        {speakers.length === 0 ? (
          <View style={styles.connecting}><ActivityIndicator color={colors.accent} /><Text style={styles.connectingText}>Connecting…</Text></View>
        ) : speakers.map((p) => (
          <View key={p.identity} style={styles.speaker}>
            <View style={[styles.speakerAvatar, p.isSpeaking && styles.speakerActive]}>
              <MaterialCommunityIcons name="microphone" size={22} color={colors.accent} />
            </View>
            <Text style={styles.speakerName} numberOfLines={1}>{p.name || p.identity}</Text>
            {isHost && p.identity !== localParticipant?.identity && (
              <TouchableOpacity onPress={() => moderateBroadcast(broadcast.id, p.identity?.replace(/^u/, ''))}>
                <Text style={styles.removeText}>remove</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      {/* Host: co-host request inbox */}
      {isHost && requests.length > 0 && (
        <View style={styles.inbox}>
          <Text style={styles.sectionLabel}>Requests to join</Text>
          <ScrollView style={{ maxHeight: 160 }}>
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
      )}

      <View style={{ flex: 1 }} />

      {/* Controls */}
      <View style={styles.controls}>
        {canPublish ? (
          <>
            <TouchableOpacity style={[styles.ctrlBtn, !micOn && styles.ctrlMuted]} onPress={toggleMic}>
              <MaterialCommunityIcons name={micOn ? 'microphone' : 'microphone-off'} size={24} color="#fff" />
              <Text style={styles.ctrlText}>{micOn ? 'Mute' : 'Unmute'}</Text>
            </TouchableOpacity>
            {isHost ? (
              <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlEnd]} onPress={endLive}>
                <Ionicons name="stop" size={22} color="#fff" /><Text style={styles.ctrlText}>End</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlEnd]} onPress={leave}>
                <Ionicons name="exit-outline" size={22} color="#fff" /><Text style={styles.ctrlText}>Leave</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.ctrlBtn, requested && styles.ctrlMuted]}
              onPress={askToJoin}
              disabled={requested}
            >
              <MaterialCommunityIcons name="hand-back-right-outline" size={22} color="#fff" />
              <Text style={styles.ctrlText}>{requested ? 'Requested…' : 'Request to join'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.ctrlBtn, styles.ctrlEnd]} onPress={leave}>
              <Ionicons name="exit-outline" size={22} color="#fff" /><Text style={styles.ctrlText}>Leave</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628' },
  inner: { flex: 1, paddingHorizontal: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  liveDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.error },
  liveLabel: { ...typography.caption, color: colors.error, fontWeight: '900', letterSpacing: 1 },
  viewers: { ...typography.caption, color: colors.textSecondary, marginLeft: spacing.sm },
  closeBtn: { marginLeft: 'auto', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.md },
  kind: { ...typography.caption, color: colors.accent, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  sectionLabel: {
    ...typography.label, color: colors.accent, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  speakerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  connecting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  controls: { flexDirection: 'row', gap: spacing.sm },
  ctrlBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(16,28,46,0.9)', borderRadius: radius.full, paddingVertical: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', ...shadows.sm,
  },
  ctrlMuted: { opacity: 0.7 },
  ctrlEnd: { backgroundColor: colors.error, borderColor: colors.error },
  ctrlText: { ...typography.label, color: '#fff', fontWeight: '700' },
});

export default LiveRoom;
