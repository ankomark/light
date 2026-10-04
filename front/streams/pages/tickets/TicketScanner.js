/**
 * The gate: scan a ticket's QR, see at once whether it lets someone in.
 *
 * Online, the server decides (it admits a ticket once, even with two gates
 * scanning it together). With no network, the phone decides from the event's
 * ticket list it keeps (pages/tickets/gate.js) and queues the check-in for
 * when the network is back. The list re-syncs every 30 s while the screen is
 * open; anything the server later says another gate had already let in is
 * listed under "Needs a look" for staff.
 *
 * The verdict fills the screen in one colour — green in, amber in (offline),
 * red not in — readable at arm's length in a crowd. A code can be typed when
 * a QR won't scan (a cracked screen, a printout in the rain).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, AppState, ActivityIndicator, Animated,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import KeyboardLift from '../../components/tickets/KeyboardLift';
import { useI18n } from '../../context/I18nContext';
import { checkIn } from '../../services/ticketsOrganiser';
import { T, F, tap, Kicker, GhostButton } from '../../components/tickets/TicketKit';
import {
  loadGate, saveGate, syncGate, scanOffline, recordOnline, flushQueue, gateCounts, cleanCode, codeTail,
} from './gate';

const SYNC_EVERY_MS = 30 * 1000;
const VERDICT_MS = 2200;
// The same code held in front of the camera fires many times a second.
const SAME_CODE_MS = 4000;

const VERDICT = {
  admitted: { color: '#2FA36B', icon: 'checkmark-circle', key: 'admitted' },
  admitted_offline: { color: '#D9952B', icon: 'checkmark-circle', key: 'admittedOffline' },
  already_used: { color: '#D2493C', icon: 'close-circle', key: 'used' },
  invalid: { color: '#D2493C', icon: 'alert-circle', key: 'invalid' },
};

const pad = (n) => String(n).padStart(2, '0');
const clock = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const TicketScanner = ({ navigation, route }) => {
  const kbScroll = useRef(null);
  const { t } = useI18n();
  const { id, title } = route.params;
  const [permission, requestPermission] = useCameraPermissions();

  const [gate, setGate] = useState(null);
  const gateRef = useRef(null);
  const keep = useCallback((next) => { gateRef.current = next; setGate(next); saveGate(id, next); }, [id]);

  const [syncState, setSyncState] = useState('syncing');   // syncing | ok | offline
  const syncing = useRef(false);
  const sync = useCallback(async () => {
    if (syncing.current || !gateRef.current) return;
    syncing.current = true;
    try {
      let next = await flushQueue(id, gateRef.current);
      next = await syncGate(id, next);
      keep(next);
      setSyncState('ok');
    } catch (err) {
      if (err?.code === 'signed_out') { navigation.replace('TicketHost', { next: 'TicketMyEvents' }); return; }
      setSyncState('offline');
    } finally {
      syncing.current = false;
    }
  }, [id, keep, navigation]);

  useEffect(() => {
    let live = true;
    loadGate(id).then((kept) => {
      if (!live) return;
      gateRef.current = kept;
      setGate(kept);
      sync();
    });
    const timer = setInterval(sync, SYNC_EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') sync(); });
    return () => { live = false; clearInterval(timer); sub.remove(); };
  }, [id, sync]);

  // ── A scan ───────────────────────────────────────────────────────────
  const [verdict, setVerdict] = useState(null);
  const lastScan = useRef({ code: '', at: 0 });
  const busy = useRef(false);
  const fade = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef(null);

  const show = useCallback((v) => {
    setVerdict(v);
    clearTimeout(hideTimer.current);
    fade.setValue(1);
    const good = v.result === 'admitted' || v.result === 'admitted_offline';
    Haptics.notificationAsync(good ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error)
      .catch(() => {});
    hideTimer.current = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setVerdict(null));
    }, VERDICT_MS);
  }, [fade]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const check = useCallback(async (raw) => {
    const code = cleanCode(raw);
    if (!code || busy.current || !gateRef.current) return;
    const now = Date.now();
    if (code === lastScan.current.code && now - lastScan.current.at < SAME_CODE_MS) return;
    lastScan.current = { code, at: now };
    busy.current = true;
    try {
      const result = await checkIn(id, code);
      const ticket = gateRef.current.tickets[code];
      keep(recordOnline(gateRef.current, code, result));
      setSyncState('ok');
      show({
        result: result.result,
        type: result.ticket_type || ticket?.t,
        name: result.buyer_name || ticket?.n,
        checkedInAt: result.checked_in_at,
        code,
      });
    } catch (err) {
      if (err?.code === 'signed_out') { navigation.replace('TicketHost', { next: 'TicketMyEvents' }); return; }
      // No network: the phone's own list decides.
      const { gate: next, outcome } = scanOffline(gateRef.current, code);
      keep(next);
      setSyncState('offline');
      show({ result: outcome.result, type: outcome.ticket?.t, name: outcome.ticket?.n, checkedInAt: outcome.checkedInAt, code });
    } finally {
      busy.current = false;
    }
  }, [id, keep, navigation, show]);

  const [typed, setTyped] = useState('');
  const [torch, setTorch] = useState(false);

  if (!gate) {
    return <View style={[styles.root, styles.centre]}><ActivityIndicator color={T.gold} size="large" /></View>;
  }

  const { admitted, total } = gateCounts(gate);
  const v = verdict && VERDICT[verdict.result];

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <KeyboardLift scrollRef={kbScroll}>
      <ScrollView ref={kbScroll} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Kicker>{t('tix.gate.kicker')}</Kicker>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>

        <View style={styles.counts}>
          <View style={styles.count}>
            <Text style={styles.countValue} testID="gate-admitted">{admitted}</Text>
            <Text style={styles.countLabel}>{t('tix.gate.in')}</Text>
          </View>
          <View style={styles.count}>
            <Text style={styles.countValue}>{Math.max(0, total - admitted)}</Text>
            <Text style={styles.countLabel}>{t('tix.gate.toCome')}</Text>
          </View>
          <View style={[styles.count, styles.syncBox]}>
            <View style={[styles.dot, syncState === 'ok' ? styles.dotOk : syncState === 'offline' ? styles.dotOff : styles.dotWait]} />
            <Text style={styles.syncText} numberOfLines={2} testID="gate-sync">
              {syncState === 'offline'
                ? t('tix.gate.offline', { n: gate.queue.length })
                : syncState === 'ok' && gate.syncedAt
                  ? t('tix.gate.synced', { at: clock(gate.syncedAt) })
                  : t('tix.gate.syncing')}
            </Text>
          </View>
        </View>

        {/* The camera, or the way to allow it. */}
        <View style={styles.cameraWrap}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={verdict ? undefined : ({ data }) => check(data)}
              testID="gate-camera"
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.centre, styles.noCamera]}>
              <Ionicons name="camera-outline" size={34} color={T.champagne} />
              <Text style={styles.noCameraText}>{t('tix.gate.cameraNeeded')}</Text>
              <GhostButton label={t('tix.gate.allowCamera')} onPress={requestPermission} style={styles.allow} />
            </View>
          )}
          {permission?.granted && (
            <>
              <View style={styles.frame} pointerEvents="none" />
              <TouchableOpacity onPress={() => { tap(); setTorch((x) => !x); }} style={styles.torch}
                                accessibilityRole="button" accessibilityLabel={t('tix.gate.torch')}>
                <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={20} color={T.ivory} />
              </TouchableOpacity>
            </>
          )}
          {!!v && (
            <Animated.View style={[StyleSheet.absoluteFill, styles.verdict, { backgroundColor: v.color, opacity: fade }]}
                           accessibilityLiveRegion="assertive" testID={`gate-verdict-${verdict.result}`}>
              <TouchableOpacity style={[StyleSheet.absoluteFill, styles.centre]} onPress={() => setVerdict(null)} activeOpacity={1}>
                <Ionicons name={v.icon} size={78} color="#fff" />
                <Text style={styles.verdictTitle}>{t(`tix.gate.v.${v.key}`)}</Text>
                {!!verdict.type && <Text style={styles.verdictLine}>{verdict.type}</Text>}
                {!!verdict.name && <Text style={styles.verdictLine}>{verdict.name}</Text>}
                {verdict.result === 'already_used' && !!verdict.checkedInAt && (
                  <Text style={styles.verdictLine}>{t('tix.gate.usedAt', { at: clock(verdict.checkedInAt) })}</Text>
                )}
                {verdict.result === 'invalid' && <Text style={styles.verdictLine}>{t('tix.gate.invalidHint')}</Text>}
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>

        {/* Typed, when the QR won't scan. */}
        <Text style={styles.label}>{t('tix.gate.typeCode')}</Text>
        <View style={styles.manual}>
          <TextInput value={typed} onChangeText={setTyped} placeholder={t('tix.gate.codePlaceholder')}
                     placeholderTextColor={T.faint} autoCapitalize="none" autoCorrect={false} style={styles.input}
                     onSubmitEditing={() => { check(typed); setTyped(''); }} returnKeyType="go"
                     accessibilityLabel={t('tix.gate.typeCode')} testID="gate-code" />
          <TouchableOpacity style={styles.go} onPress={() => { tap(); check(typed); setTyped(''); }}
                            accessibilityRole="button" testID="gate-check">
            <Text style={styles.goText}>{t('tix.gate.check')}</Text>
          </TouchableOpacity>
        </View>

        {gate.flags.length > 0 && (
          <>
            <Kicker style={styles.flagsKicker}>{t('tix.gate.flags')}</Kicker>
            <Text style={styles.flagsHint}>{t('tix.gate.flagsHint')}</Text>
            {gate.flags.map((f) => (
              <View key={`${f.code}-${f.at}`} style={styles.flag} testID="gate-flag">
                <Ionicons name="warning-outline" size={18} color={T.danger} />
                <View style={styles.flex}>
                  <Text style={styles.flagTitle}>{[f.type, f.name].filter(Boolean).join(' · ') || codeTail(f.code)}</Text>
                  <Text style={styles.flagText}>
                    {f.reason === 'already_used'
                      ? t('tix.gate.flagUsed', { at: clock(f.at), earlier: f.earlier ? clock(f.earlier) : '?' })
                      : t('tix.gate.flagInvalid', { at: clock(f.at) })}
                    {'  '}{codeTail(f.code)}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
      </KeyboardLift>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  centre: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  scroll: { padding: 16, paddingTop: 18, paddingBottom: 36, width: '100%', maxWidth: 620, alignSelf: 'center' },
  title: { fontFamily: F.display, fontSize: 26, lineHeight: 30, color: T.ivory, marginTop: 4 },

  counts: { flexDirection: 'row', gap: 8, marginTop: 14 },
  count: { flex: 1, padding: 12, borderRadius: 16, backgroundColor: T.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: T.line },
  countValue: { fontFamily: F.display, fontSize: 28, color: T.ivory },
  countLabel: { fontFamily: F.uiBold, fontSize: 10.5, letterSpacing: 1.1, textTransform: 'uppercase', color: T.faint },
  syncBox: { flex: 1.3, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotOk: { backgroundColor: T.success },
  dotOff: { backgroundColor: '#D9952B' },
  dotWait: { backgroundColor: T.faint },
  syncText: { flex: 1, fontFamily: F.uiSemi, fontSize: 12, lineHeight: 16, color: T.muted },

  cameraWrap: { marginTop: 14, aspectRatio: 1, borderRadius: 24, overflow: 'hidden', backgroundColor: '#000' },
  noCamera: { padding: 24, gap: 10, backgroundColor: T.surface },
  noCameraText: { fontFamily: F.ui, fontSize: 14, lineHeight: 20, color: T.muted, textAlign: 'center' },
  allow: { marginTop: 6 },
  frame: {
    position: 'absolute', top: '18%', left: '18%', right: '18%', bottom: '18%',
    borderRadius: 20, borderWidth: 3, borderColor: 'rgba(232,212,170,0.9)',
  },
  torch: {
    position: 'absolute', top: 12, right: 12, width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)',
  },
  verdict: { },
  verdictTitle: { fontFamily: F.uiHeavy, fontSize: 30, color: '#fff', marginTop: 8, textAlign: 'center' },
  verdictLine: { fontFamily: F.uiBold, fontSize: 17, color: '#fff', marginTop: 6, textAlign: 'center', paddingHorizontal: 16 },

  label: { fontFamily: F.uiBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: T.muted, marginTop: 20, marginBottom: 8 },
  manual: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1, height: 50, borderRadius: 14, paddingHorizontal: 14, fontFamily: F.uiSemi, fontSize: 15, color: T.ivory,
    backgroundColor: T.surface, borderWidth: 1, borderColor: T.line,
  },
  go: { height: 50, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: T.champagne },
  goText: { fontFamily: F.uiHeavy, fontSize: 14, color: T.paperInk },

  flagsKicker: { marginTop: 26 },
  flagsHint: { fontFamily: F.ui, fontSize: 13, lineHeight: 19, color: T.muted, marginTop: 6, marginBottom: 6 },
  flag: {
    flexDirection: 'row', gap: 10, padding: 12, marginTop: 8, borderRadius: 14,
    backgroundColor: 'rgba(240,144,127,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(240,144,127,0.4)',
  },
  flagTitle: { fontFamily: F.uiBold, fontSize: 14, color: T.ivory },
  flagText: { fontFamily: F.ui, fontSize: 12.5, color: T.muted, marginTop: 2 },
});

export default TicketScanner;
