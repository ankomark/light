import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Image, Animated, Alert, useWindowDimensions,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchBroadcasts, fetchBroadcastToken, endBroadcast } from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { hasCapability } from '../../utils/roles';
import { peekCache, writeCache, userKey } from '../../utils/screenCache';
import useOnline from '../../hooks/useOnline';
import { spacing, radius, typography } from '../../constants/theme';
import { live, goldGlow, fmtCount } from '../../constants/liveTheme';
import { LiveBadge, GoldRing, ViewPill } from './LivePrimitives';
import useReducedMotion from '../../utils/useReducedMotion';
import { useI18n } from '../../context/I18nContext';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');
const KIND_KEY = { meet: 'live.kindMeet', tv: 'live.kindTv' };
// While the hub is open, who is live (and how many watch) is read again this
// often - a list from a minute ago shows rooms that already ended.
const REFRESH_MS = 30000;
const GRID_GAP = 8;

// Why a join was refused, in the viewer's language (server codes).
export const joinRefusal = (t, e) => {
  const code = e?.response?.data?.code;
  if (code === 'ended' || e?.response?.status === 410) return t('live.ended');
  if (code === 'removed') return t('live.removedYou');
  if (code === 'blocked') return t('live.blocked');
  if (code === 'singles_only') return t('live.singlesOnly');
  return t('live.notAvailable');
};

const EndBtn = ({ ending, onPress }) =>
  ending ? (
    <ActivityIndicator color={live.live} />
  ) : (
    <TouchableOpacity onPress={onPress} hitSlop={10} style={styles.endBtn} accessibilityRole="button" testID="live-hub-end">
      <Ionicons name="stop-circle" size={24} color={live.live} />
    </TouchableOpacity>
  );

const LiveHub = ({ navigation, route }) => {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  // Two cards a row on a phone, three or four on a tablet.
  const { width } = useWindowDimensions();
  const cols = width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const tileW = Math.floor((width - spacing.md * 2 - (cols - 1) * GRID_GAP) / cols);
  const { currentUser } = useAuth();
  // Any admin who may take content down can end a broadcast (the server
  // checks the same power, through the admin gate).
  const canEnd = hasCapability(currentUser, 'remove_content');
  const cacheKey = userKey(currentUser?.id, 'live:hub');
  // The last list shows at once (and offline); the fresh one replaces it.
  const [items, setItems] = useState(() => peekCache(cacheKey) || []);
  const [loading, setLoading] = useState(() => !peekCache(cacheKey));
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(null);
  const [endingId, setEndingId] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetchBroadcasts();
      const list = res?.results || (Array.isArray(res) ? res : []);
      setItems(list);
      setFailed(false);
      writeCache(cacheKey, list);
    } catch {
      // Keep what is on screen: wiping it read as "nobody is live".
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [cacheKey]);

  useFocusEffect(useCallback(() => {
    load();
    const id = setInterval(() => load({ quiet: true }), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]));

  const openViewer = useCallback(async (b) => {
    setOpening(b.id);
    try {
      const res = await fetchBroadcastToken(b.id);
      navigation.navigate('LiveRoom', { url: res.url, token: res.token, broadcast: res.broadcast, role: 'viewer' });
    } catch (e) {
      Alert.alert(t('live.title'), joinRefusal(t, e));
      load({ quiet: true });
    } finally {
      setOpening(null);
    }
  }, [navigation, t, load]);

  // Opened from a "someone is live" push: straight into that broadcast.
  // Once per push, however often the screen re-renders.
  const pushed = route?.params?.openBroadcast;
  const openedRef = useRef(null);
  useEffect(() => {
    if (!pushed || openedRef.current === pushed) return;
    openedRef.current = pushed;
    navigation.setParams?.({ openBroadcast: undefined });
    openViewer({ id: pushed });
  }, [pushed, navigation, openViewer]);

  // Admins can end any live session straight from the hub.
  const endLive = (b) => {
    Alert.alert(
      t('live.endSessionTitle'),
      t('live.endSessionBody', { name: b.host?.username || '', title: b.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('live.endAction'),
          style: 'destructive',
          onPress: async () => {
            setEndingId(b.id);
            try {
              await endBroadcast(b.id);
              setItems((prev) => prev.filter((x) => x.id !== b.id));
            } catch {
              Alert.alert(t('live.title'), t('live.endSessionFailed'));
            } finally {
              setEndingId(null);
            }
          },
        },
      ],
    );
  };

  const hero = items[0];
  const rest = items.slice(1);

  const HeroCard = ({ item }) => {
    const host = item.host || {};
    const busy = opening === item.id;
    return (
      <TouchableOpacity style={[styles.hero, width >= 600 && { height: 300 }]} activeOpacity={0.92} onPress={() => openViewer(item)} disabled={busy}>
        <Image
          source={host.profile_picture ? { uri: host.profile_picture } : DEFAULT_AVATAR}
          defaultSource={DEFAULT_AVATAR}
          style={StyleSheet.absoluteFill}
          blurRadius={18}
          resizeMode="cover"
        />
        <LinearGradient colors={live.gradHero} style={StyleSheet.absoluteFill} />
        <View style={styles.heroTop}>
          <LiveBadge />
          <ViewPill count={item.viewer_count} />
        </View>
        <View style={styles.heroBottom}>
          <GoldRing uri={host.profile_picture} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.heroName} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.heroHost} numberOfLines={1}>@{host.username || ''} · {t(KIND_KEY[item.kind] || 'live.title')}</Text>
          </View>
          {busy ? (
            <ActivityIndicator color={live.gold} />
          ) : canEnd ? (
            <EndBtn ending={endingId === item.id} onPress={() => endLive(item)} />
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const MiniCard = ({ item }) => {
    const host = item.host || {};
    const busy = opening === item.id;
    return (
      <TouchableOpacity style={[styles.mini, { width: tileW }]} activeOpacity={0.92} onPress={() => openViewer(item)} disabled={busy}>
        <Image
          source={host.profile_picture ? { uri: host.profile_picture } : DEFAULT_AVATAR}
          defaultSource={DEFAULT_AVATAR}
          style={StyleSheet.absoluteFill}
          blurRadius={14}
          resizeMode="cover"
        />
        <LinearGradient colors={live.gradTile} style={StyleSheet.absoluteFill} />
        <View style={styles.miniBadge}><LiveBadge small /></View>
        {canEnd && (
          <View style={styles.miniEnd}><EndBtn ending={endingId === item.id} onPress={() => endLive(item)} /></View>
        )}
        <View style={styles.miniFoot}>
          <GoldRing uri={host.profile_picture} size={22} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.miniName} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.miniView} numberOfLines={1}>{t('live.watching', { n: fmtCount(item.viewer_count) })}</Text>
          </View>
        </View>
        {busy && (
          <View style={styles.busyOverlay}><ActivityIndicator color={live.gold} /></View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('live.title')}</Text>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={live.gold} />}
      >
        <Text style={styles.sectionTitle}>{t('live.now')}</Text>
        {(failed || !online) && (
          <Text style={styles.notice} testID="live-hub-notice">
            {!online ? t('live.offline') : t('live.loadFailed')}
          </Text>
        )}

        {loading && items.length === 0 ? (
          <LiveSkeleton />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="broadcast-off" size={48} color={live.inkMute} />
            <Text style={styles.emptyText}>{t('live.noOneLive')}</Text>
            <Text style={styles.emptySub}>{t('live.startYourOwn')}</Text>
          </View>
        ) : (
          <>
            {HeroCard({ item: hero })}
            {rest.length > 0 && (
              <View style={styles.grid}>
                {rest.map((it) => <React.Fragment key={String(it.id)}>{MiniCard({ item: it })}</React.Fragment>)}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* One premium Go Live CTA — broadcast type is chosen in the next step. */}
      <TouchableOpacity activeOpacity={0.9} style={[styles.ctaWrap, { bottom: spacing.lg + insets.bottom }]}
        onPress={() => navigation.navigate('GoLive')} accessibilityRole="button" testID="live-hub-go">
        <LinearGradient colors={live.gradCta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cta}>
          <MaterialCommunityIcons name="broadcast" size={20} color={live.onGold} />
          <Text style={styles.ctaText}>{t('live.goLive')}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
};

// Lightweight loading placeholder that gently breathes (static if reduce-motion).
const LiveSkeleton = () => {
  const reduced = useReducedMotion();
  const a = useRef(new Animated.Value(reduced ? 0.6 : 0.4)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 0.8, duration: 700, useNativeDriver: true }),
      Animated.timing(a, { toValue: 0.4, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [a, reduced]);
  return (
    <Animated.View style={{ opacity: a }}>
      <View style={styles.skHero} />
      <View style={styles.grid}>
        <View style={styles.skMini} />
        <View style={styles.skMini} />
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  scroll: { paddingHorizontal: spacing.md, paddingBottom: 120 },
  notice: {
    color: '#FFD9A0', fontSize: 12.5, marginBottom: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 6,
    backgroundColor: 'rgba(6,13,26,0.6)', borderRadius: radius.md, overflow: 'hidden',
  },
  title: {
    ...typography.h1, color: live.ink, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  sectionTitle: {
    ...typography.label, color: live.gold, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2,
    marginTop: spacing.xs, marginBottom: spacing.sm, fontSize: 11,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },

  // Hero
  hero: {
    height: 210, borderRadius: radius.xl, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
    backgroundColor: live.navy, ...goldGlow, shadowOpacity: 0.32,
  },
  heroTop: {
    position: 'absolute', top: 10, left: 10, right: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  heroBottom: {
    position: 'absolute', left: 12, right: 12, bottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  heroName: { color: '#fff', fontSize: 15, fontWeight: '800' },
  heroHost: { color: live.gold, fontSize: 12, marginTop: 1 },

  // Grid of remaining broadcasts
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GRID_GAP, marginTop: spacing.sm },
  mini: {
    width: '48.5%', height: 118, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair, backgroundColor: live.navy,
  },
  miniBadge: { position: 'absolute', top: 8, left: 8 },
  miniEnd: { position: 'absolute', top: 4, right: 4 },
  miniFoot: {
    position: 'absolute', left: 8, right: 8, bottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  miniName: { color: '#fff', fontSize: 12, fontWeight: '700' },
  miniView: { color: live.inkDim, fontSize: 9.5, marginTop: 1 },
  busyOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,13,26,0.35)' },

  endBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  // Go Live CTA
  ctaWrap: {
    position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.lg,
    borderRadius: radius.full, ...goldGlow,
  },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    height: 52, borderRadius: radius.full,
  },
  ctaText: { color: live.onGold, fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },

  // Empty + skeleton
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.xs },
  emptyText: { ...typography.body, color: live.inkDim },
  emptySub: { ...typography.caption, color: live.inkMute },
  skHero: { height: 210, borderRadius: radius.xl, backgroundColor: 'rgba(16,46,80,0.5)', borderWidth: StyleSheet.hairlineWidth, borderColor: live.hairSoft },
  skMini: { width: '48.5%', height: 118, borderRadius: radius.lg, backgroundColor: 'rgba(16,46,80,0.5)', borderWidth: StyleSheet.hairlineWidth, borderColor: live.hairSoft, marginBottom: spacing.sm },
});

export default LiveHub;
