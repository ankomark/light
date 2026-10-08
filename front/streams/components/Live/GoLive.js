import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert, Keyboard,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import { mediaDevices, RTCView } from '@livekit/react-native-webrtc';
import { createBroadcast, fetchLiveEligibility } from '../../services/api';
import { typography, spacing, radius } from '../../constants/theme';
import { live, goldGlow } from '../../constants/liveTheme';
import { useI18n } from '../../context/I18nContext';
import { ensureLivePermissions } from '../../utils/livePermissions';

// Module scope can't call t(); the hint key is resolved at render.
const KINDS = [
  { key: 'meet', labelKey: 'live.kindMeet', icon: 'account-group', hintKey: 'live.kind.meetHint' },
  { key: 'tv', labelKey: 'live.kindTv', icon: 'television-classic', hintKey: 'live.kind.tvHint' },
];

// Champagne-gold gradient action button used across the setup + lobby steps.
const GoldButton = ({ onPress, disabled, children }) => (
  <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.9}
    style={[styles.goBtnWrap, disabled && { opacity: 0.7 }]}>
    <LinearGradient colors={live.gradCta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.goBtn}>
      {children}
    </LinearGradient>
  </TouchableOpacity>
);

const GoLive = ({ navigation, route }) => {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState('setup'); // setup | lobby
  const [kind, setKind] = useState(route?.params?.kind || 'meet');
  // A title can come with the screen (a book club's reading room, say).
  const [title, setTitle] = useState(route?.params?.title || '');
  const [busy, setBusy] = useState(false);
  // Followers held and needed: what is missing is said up front, not after
  // the camera test. Unknown (offline, an old server) = let them try.
  const [eligibility, setEligibility] = useState(null);
  // Bumped to take the camera again after a failed start (it was released
  // for LiveKit, and the preview stayed black).
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchLiveEligibility().then((e) => { if (alive) setEligibility(e); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const shortBy = (k) => {
    if (!eligibility?.allowed || eligibility.allowed[k] !== false) return null;
    return t('live.followersNeeded', {
      n: (eligibility.needed?.[k] ?? 0).toLocaleString(),
      kind: t(k === 'tv' ? 'live.kindTv' : 'live.kindMeet'),
      have: (eligibility.followers ?? 0).toLocaleString(),
    });
  };
  const blockedReason = shortBy(kind);

  // Lobby (pre-join) state
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [stream, setStream] = useState(null);
  const facingRef = useRef('user');
  const streamRef = useRef(null);

  const isVideo = kind === 'tv';
  const inExpoGo = Constants.executionEnvironment === 'storeClient';

  const stopPreview = useCallback(() => {
    try { streamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch {}
    streamRef.current = null;
    setStream(null);
  }, []);

  // Acquire a local preview when entering the lobby; release it on leave.
  useEffect(() => {
    if (stage !== 'lobby' || inExpoGo) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const s = await mediaDevices.getUserMedia({
          audio: true,
          video: isVideo ? { facingMode: facingRef.current } : false,
        });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        setStream(s);
      } catch {
        if (!cancelled) Alert.alert(t('live.goLive'), t('live.permissionNeeded'));
      }
    })();
    return () => { cancelled = true; stopPreview(); };
  }, [stage, isVideo, inExpoGo, stopPreview, t, previewKey]);

  const toggleMicPreview = () => {
    const next = !micOn;
    try { streamRef.current?.getAudioTracks?.().forEach((t) => { t.enabled = next; }); } catch {}
    setMicOn(next);
  };
  const toggleCamPreview = () => {
    const next = !camOn;
    try { streamRef.current?.getVideoTracks?.().forEach((t) => { t.enabled = next; }); } catch {}
    setCamOn(next);
  };
  const flipPreview = () => {
    facingRef.current = facingRef.current === 'user' ? 'environment' : 'user';
    try {
      const vt = streamRef.current?.getVideoTracks?.()[0];
      if (vt?._switchCamera) vt._switchCamera();
    } catch {}
  };

  const goToLobby = async () => {
    Keyboard.dismiss();
    if (title.trim().length < 3) { Alert.alert(t('live.goLive'), t('live.titleRequired')); return; }
    if (blockedReason) { Alert.alert(t('live.goLive'), blockedReason); return; }
    // Camera (for video) and mic asked for here, with a way to Settings if
    // refused for good - not discovered after going live, muted and black.
    if (!(await ensureLivePermissions({ video: isVideo, t }))) return;
    setMicOn(true);
    setCamOn(isVideo);
    setStage('lobby');
  };

  const start = async () => {
    setBusy(true);
    // Release the preview camera/mic before LiveKit re-acquires them.
    stopPreview();
    try {
      const res = await createBroadcast(kind, title.trim());
      navigation.replace('LiveRoom', {
        url: res.url, token: res.token, broadcast: res.broadcast, role: 'host',
        initialMicOn: micOn, initialCamOn: camOn,
      });
    } catch (e) {
      const d = e?.response?.data;
      Alert.alert(t('live.goLive'), d?.code === 'followers_needed'
        ? t('live.followersNeeded', {
          n: Number(d.needed || 0).toLocaleString(),
          kind: t(kind === 'tv' ? 'live.kindTv' : 'live.kindMeet'),
          have: (eligibility?.followers ?? 0).toLocaleString(),
        })
        : d?.code === 'live_unavailable' ? t('live.unavailable') : t('live.startFailed'));
      setBusy(false);
      setPreviewKey((k) => k + 1);   // the camera back in the preview
    }
  };

  // ── Lobby (pre-join preview) ───────────────────────────────────────────────
  if (stage === 'lobby') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => setStage('setup')} hitSlop={10} accessibilityRole="button"
            accessibilityLabel={t('common.goBack')}>
            <Ionicons name="chevron-back" size={26} color={live.ink} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>{t('live.ready')}</Text>
          <View style={{ width: 26 }} />
        </View>

        <View style={styles.preview}>
          {isVideo && camOn && stream ? (
            <RTCView
              streamURL={stream.toURL()}
              style={styles.previewVideo}
              objectFit="cover"
              mirror={facingRef.current === 'user'}
              zOrder={1}
            />
          ) : (
            <View style={styles.previewPlaceholder}>
              <MaterialCommunityIcons name={isVideo ? 'video-off' : 'account-group'} size={56} color={live.inkDim} />
              <Text style={styles.previewHint}>{isVideo ? t('live.cameraOff') : t('live.audioOnly')}</Text>
            </View>
          )}
          <View style={styles.previewBadge}>
            <Text style={styles.previewBadgeText} numberOfLines={1}>{title.trim()}</Text>
          </View>
        </View>

        <View style={styles.lobbyControls}>
          <TouchableOpacity style={[styles.lobbyBtn, !micOn && styles.lobbyBtnOff]} onPress={toggleMicPreview}>
            <MaterialCommunityIcons name={micOn ? 'microphone' : 'microphone-off'} size={24} color="#fff" />
            <Text style={styles.lobbyBtnText}>{micOn ? t('live.micOn') : t('live.micOff')}</Text>
          </TouchableOpacity>
          {isVideo && (
            <TouchableOpacity style={[styles.lobbyBtn, !camOn && styles.lobbyBtnOff]} onPress={toggleCamPreview}>
              <MaterialCommunityIcons name={camOn ? 'video' : 'video-off'} size={24} color="#fff" />
              <Text style={styles.lobbyBtnText}>{camOn ? t('live.camOn') : t('live.camOff')}</Text>
            </TouchableOpacity>
          )}
          {isVideo && camOn && (
            <TouchableOpacity style={styles.lobbyBtn} onPress={flipPreview}>
              <MaterialCommunityIcons name="camera-flip-outline" size={24} color="#fff" />
              <Text style={styles.lobbyBtnText}>{t('live.flip')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <GoldButton onPress={start} disabled={busy}>
          {busy ? <ActivityIndicator color={live.onGold} /> : (
            <>
              <Ionicons name="radio" size={20} color={live.onGold} />
              <Text style={styles.goBtnText}>{t('live.goLive')}</Text>
            </>
          )}
        </GoldButton>
        <Text style={styles.note}>{t('live.notifyNote')}</Text>
      </View>
    );
  }

  // ── Setup (kind + title) ───────────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button"
          accessibilityLabel={t('common.goBack')}>
          <Ionicons name="chevron-back" size={26} color={live.ink} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('live.goLive')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <Text style={styles.label}>{t('live.broadcastType')}</Text>
      <View style={styles.kindRow}>
        {KINDS.map((k) => {
          const active = kind === k.key;
          return (
            <TouchableOpacity key={k.key} style={[styles.kindCard, active && styles.kindCardActive]}
              onPress={() => setKind(k.key)} activeOpacity={0.85} accessibilityRole="button"
              accessibilityState={{ selected: active }} testID={`golive-kind-${k.key}`}>
              <MaterialCommunityIcons name={k.icon} size={26} color={active ? live.onGold : live.gold} />
              <Text style={[styles.kindLabel, active && styles.kindLabelActive]}>{t(k.labelKey)}</Text>
              <Text style={[styles.kindHint, active && { color: live.onGold }]}>{t(k.hintKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>{t('live.broadcastTitle')}</Text>
      <TextInput
        style={styles.input}
        placeholder={t('live.titlePlaceholder')}
        placeholderTextColor={live.inkMute}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
        returnKeyType="next"
        onSubmitEditing={goToLobby}
      />
      {!!blockedReason && <Text style={styles.blocked} testID="golive-blocked">{blockedReason}</Text>}

      <GoldButton onPress={goToLobby}>
        <Ionicons name="arrow-forward" size={20} color={live.onGold} />
        <Text style={styles.goBtnText}>{t('common.continue')}</Text>
      </GoldButton>
      <Text style={styles.note}>{t(isVideo ? 'live.previewNextVideo' : 'live.previewNextAudio')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: live.bg, paddingHorizontal: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  topTitle: { ...typography.h3, color: live.ink },
  label: {
    ...typography.label, color: live.gold, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: spacing.sm, marginTop: spacing.md,
  },
  kindRow: { flexDirection: 'row', gap: spacing.sm },
  kindCard: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.md,
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  kindCardActive: { backgroundColor: live.gold, borderColor: live.gold },
  kindLabel: { ...typography.label, color: live.ink, fontWeight: '700' },
  kindLabelActive: { color: live.onGold },
  kindHint: { ...typography.caption, color: live.inkMute },
  input: {
    color: live.ink, fontSize: 16, backgroundColor: live.navyGlass,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },

  preview: {
    flex: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000',
    borderWidth: 1, borderColor: live.hair, marginBottom: spacing.md, ...goldGlow, shadowOpacity: 0.3,
  },
  previewVideo: { flex: 1, backgroundColor: '#000' },
  previewPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: live.navy },
  previewHint: { ...typography.body, color: live.inkDim },
  previewBadge: {
    position: 'absolute', left: spacing.sm, bottom: spacing.sm, backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: radius.full, maxWidth: '85%',
  },
  previewBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  lobbyControls: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  lobbyBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: spacing.sm + 2,
    backgroundColor: 'rgba(16,28,46,0.9)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  lobbyBtnOff: { opacity: 0.6 },
  lobbyBtnText: { ...typography.caption, color: '#fff', fontWeight: '700' },

  goBtnWrap: { borderRadius: radius.full, marginTop: spacing.lg, ...goldGlow },
  goBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: radius.full, paddingVertical: spacing.md,
  },
  goBtnText: { ...typography.button, color: live.onGold, fontWeight: '800' },
  note: { ...typography.caption, color: live.inkMute, textAlign: 'center', marginTop: spacing.md },
  blocked: { ...typography.caption, color: '#FFD9A0', marginTop: spacing.sm },
});

export default GoLive;
