import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Image, Animated, Alert,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { fetchBroadcasts, fetchBroadcastToken, endBroadcast } from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { isSuperAdmin } from '../../utils/roles';
import { spacing, radius, typography } from '../../constants/theme';
import { live, goldGlow, fmtCount } from '../../constants/liveTheme';
import { LiveBadge, GoldRing, ViewPill } from './LivePrimitives';
import useReducedMotion from '../../utils/useReducedMotion';
import { useI18n } from '../../context/I18nContext';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');
const KIND_LABEL = { meet: 'Meet', tv: 'Go-Live' };

const EndBtn = ({ ending, onPress }) =>
  ending ? (
    <ActivityIndicator color={live.live} />
  ) : (
    <TouchableOpacity onPress={onPress} hitSlop={10} style={styles.endBtn}>
      <Ionicons name="stop-circle" size={24} color={live.live} />
    </TouchableOpacity>
  );

const LiveHub = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const isSuper = isSuperAdmin(currentUser);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);
  const [endingId, setEndingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchBroadcasts();
      setItems(res?.results || (Array.isArray(res) ? res : []));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openViewer = async (b) => {
    setOpening(b.id);
    try {
      const res = await fetchBroadcastToken(b.id);
      navigation.navigate('LiveRoom', { url: res.url, token: res.token, broadcast: res.broadcast, role: 'viewer' });
    } catch {
      Alert.alert(t('live.title'), t('live.notAvailable'));
      load();
    } finally {
      setOpening(null);
    }
  };

  // Super admins can terminate any live session straight from the hub.
  const endLive = (b) => {
    Alert.alert(
      'End live session',
      `End @${b.host?.username || 'host'}'s “${b.title}” for everyone?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End live',
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
      <TouchableOpacity style={styles.hero} activeOpacity={0.92} onPress={() => openViewer(item)} disabled={busy}>
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
            <Text style={styles.heroHost} numberOfLines={1}>@{host.username || 'host'} · {KIND_LABEL[item.kind] || 'Live'}</Text>
          </View>
          {busy ? (
            <ActivityIndicator color={live.gold} />
          ) : isSuper ? (
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
      <TouchableOpacity style={styles.mini} activeOpacity={0.92} onPress={() => openViewer(item)} disabled={busy}>
        <Image
          source={host.profile_picture ? { uri: host.profile_picture } : DEFAULT_AVATAR}
          defaultSource={DEFAULT_AVATAR}
          style={StyleSheet.absoluteFill}
          blurRadius={14}
          resizeMode="cover"
        />
        <LinearGradient colors={live.gradTile} style={StyleSheet.absoluteFill} />
        <View style={styles.miniBadge}><LiveBadge small /></View>
        {isSuper && (
          <View style={styles.miniEnd}><EndBtn ending={endingId === item.id} onPress={() => endLive(item)} /></View>
        )}
        <View style={styles.miniFoot}>
          <GoldRing uri={host.profile_picture} size={22} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.miniName} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.miniView} numberOfLines={1}>{fmtCount(item.viewer_count)} watching</Text>
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
            <HeroCard item={hero} />
            {rest.length > 0 && (
              <View style={styles.grid}>
                {rest.map((it) => <MiniCard key={String(it.id)} item={it} />)}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* One premium Go Live CTA — broadcast type is chosen in the next step. */}
      <TouchableOpacity activeOpacity={0.9} style={styles.ctaWrap} onPress={() => navigation.navigate('GoLive')}>
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
  scroll: { paddingHorizontal: spacing.md, paddingBottom: 96 },
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: spacing.sm },
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
