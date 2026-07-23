import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { mediaDevices, RTCView } from '@livekit/react-native-webrtc';
import { createBroadcast } from '../../services/api';
import { colors, typography, spacing, radius } from '../../constants/theme';
import { useI18n } from '../../context/I18nContext';

const KINDS = [
  { key: 'meet', label: 'Meet', icon: 'account-group', hint: 'Audio · 100 followers' },
  { key: 'tv', label: 'Go-Live', icon: 'television-classic', hint: 'Video · 1,000 followers' },
];

const GoLive = ({ navigation, route }) => {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState('setup'); // setup | lobby
  const [kind, setKind] = useState(route.params?.kind || 'meet');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

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
  }, [stage, isVideo, inExpoGo, stopPreview, t]);

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

  const goToLobby = () => {
    if (title.trim().length < 3) { Alert.alert(t('live.goLive'), t('live.titleRequired')); return; }
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
      Alert.alert(t('live.goLive'), e?.response?.data?.error || t('live.startFailed'));
      setBusy(false);
    }
  };

  // ── Lobby (pre-join preview) ───────────────────────────────────────────────
  if (stage === 'lobby') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => setStage('setup')} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
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
              <MaterialCommunityIcons name={isVideo ? 'video-off' : 'account-group'} size={56} color={colors.textSecondary} />
              <Text style={styles.previewHint}>{isVideo ? 'Camera off' : 'Audio broadcast'}</Text>
            </View>
          )}
          <View style={styles.previewBadge}>
            <Text style={styles.previewBadgeText} numberOfLines={1}>{title.trim()}</Text>
          </View>
        </View>

        <View style={styles.lobbyControls}>
          <TouchableOpacity style={[styles.lobbyBtn, !micOn && styles.lobbyBtnOff]} onPress={toggleMicPreview}>
            <MaterialCommunityIcons name={micOn ? 'microphone' : 'microphone-off'} size={24} color="#fff" />
            <Text style={styles.lobbyBtnText}>{micOn ? 'Mic on' : 'Mic off'}</Text>
          </TouchableOpacity>
          {isVideo && (
            <TouchableOpacity style={[styles.lobbyBtn, !camOn && styles.lobbyBtnOff]} onPress={toggleCamPreview}>
              <MaterialCommunityIcons name={camOn ? 'video' : 'video-off'} size={24} color="#fff" />
              <Text style={styles.lobbyBtnText}>{camOn ? 'Cam on' : 'Cam off'}</Text>
            </TouchableOpacity>
          )}
          {isVideo && camOn && (
            <TouchableOpacity style={styles.lobbyBtn} onPress={flipPreview}>
              <MaterialCommunityIcons name="camera-flip-outline" size={24} color="#fff" />
              <Text style={styles.lobbyBtnText}>{t('live.flip')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity style={[styles.goBtn, busy && { opacity: 0.6 }]} onPress={start} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#0A1628" /> : (
            <>
              <Ionicons name="radio" size={20} color="#0A1628" />
              <Text style={styles.goBtnText}>{t('live.goLive')}</Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.note}>{t('live.notifyNote')}</Text>
      </View>
    );
  }

  // ── Setup (kind + title) ───────────────────────────────────────────────────
  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
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
              onPress={() => setKind(k.key)} activeOpacity={0.85}>
              <MaterialCommunityIcons name={k.icon} size={26} color={active ? '#0A1628' : colors.accent} />
              <Text style={[styles.kindLabel, active && styles.kindLabelActive]}>{k.label}</Text>
              <Text style={[styles.kindHint, active && { color: '#0A1628' }]}>{k.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>{t('live.broadcastTitle')}</Text>
      <TextInput
        style={styles.input}
        placeholder={t('live.titlePlaceholder')}
        placeholderTextColor={colors.placeholder}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
      />

      <TouchableOpacity style={styles.goBtn} onPress={goToLobby} activeOpacity={0.85}>
        <Ionicons name="arrow-forward" size={20} color="#0A1628" />
        <Text style={styles.goBtnText}>{t('common.continue')}</Text>
      </TouchableOpacity>
      <Text style={styles.note}>Next you’ll preview your {isVideo ? 'camera and mic' : 'mic'} before going live.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628', paddingHorizontal: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  label: {
    ...typography.label, color: colors.accent, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: spacing.sm, marginTop: spacing.md,
  },
  kindRow: { flexDirection: 'row', gap: spacing.sm },
  kindCard: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.md,
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  kindCardActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  kindLabel: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  kindLabelActive: { color: '#0A1628' },
  kindHint: { ...typography.caption, color: colors.textMuted },
  input: {
    color: colors.textPrimary, fontSize: 16, backgroundColor: colors.inputBg,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },

  preview: {
    flex: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)', marginBottom: spacing.md,
  },
  previewVideo: { flex: 1, backgroundColor: '#000' },
  previewPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.surface },
  previewHint: { ...typography.body, color: colors.textSecondary },
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

  goBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.accent, borderRadius: radius.full, paddingVertical: spacing.md, marginTop: spacing.lg,
  },
  goBtnText: { ...typography.button, color: '#0A1628', fontWeight: '800' },
  note: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});

export default GoLive;
