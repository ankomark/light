// The look of Single & Searching: "Covenant Gold" — the menu's navy, gold
// for what matters and what can be tapped, Cormorant Garamond for names and
// titles, Figtree for the words (both loaded in App.js). Portraits sit in a
// gold ring; nothing flashes or counts down — this is not a game.
//
// Glass, as the menu: the app's rotating wallpaper (or plain navy when
// wallpapers are off in Settings) under a navy scrim and an edge vignette,
// with translucent cards over it.
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, useWindowDimensions, Animated,
  AccessibilityInfo, KeyboardAvoidingView, Platform,
} from 'react-native';
import RotatingBackground from '../RotatingBackground';
import ScreenVignette from '../ScreenVignette';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { FONT_SCALE } from '../../utils/layout';

export const GOLD = {
  bg: '#0A1628',
  // Glass: translucent navy over the wallpaper.
  card: 'rgba(19,35,59,0.78)',
  cardDeep: 'rgba(12,24,42,0.86)',
  border: 'rgba(255,255,255,0.12)',
  solidCard: '#13233B',
  text: '#FFFFFF',
  sub: '#C9D3E0',
  muted: '#93A0B2',
  gold: '#FFC46B',
  soft: 'rgba(255,196,107,0.13)',
  onGold: '#1A1206',
  danger: '#F28B82',
  photo: '#24395A',
};

export const FACE = {
  title: 'CormorantGaramond_600SemiBold',
  titleBold: 'CormorantGaramond_700Bold',
  body: 'Figtree_500Medium',
  semi: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
  heavy: 'Figtree_800ExtraBold',
};

export const MAX_WIDTH = 560;

/** A page: a bar (Back, a title, something on the right) and its content
 *  in a centred column. `scroll={false}` for a page that lays itself out. */
export function SinglesScreen({ title, right, children, scroll = true, footer, testID, onBack }) {
  const navigation = useNavigation();
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const column = { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' };
  return (
    <KeyboardAvoidingView style={s.root} testID={testID} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Backdrop />
      <SafeAreaView edges={['top', 'left', 'right']} style={s.bar}>
        <TouchableOpacity onPress={onBack || (() => navigation.goBack())} style={s.icon} accessibilityRole="button"
          accessibilityLabel={t('common.back')} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={GOLD.text} />
        </TouchableOpacity>
        <Text style={s.barTitle} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.chrome}>{title}</Text>
        <View style={s.icon}>{right}</View>
      </SafeAreaView>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[s.scroll, column, { paddingBottom: (footer ? 120 : 48) + insets.bottom,
            paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right }]}
          keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, width > MAX_WIDTH && column]}>{children}</View>
      )}
      {!!footer && (
        <View style={[s.footer, { paddingBottom: 14 + insets.bottom }]}>
          <View style={[s.footerRow, column]}>{footer}</View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/** A bottom sheet's own bottom padding: clear of the home indicator. */
export const useSheetPad = (base = 20) => base + useSafeAreaInsets().bottom;

/** The wallpaper, its navy scrim and the edge vignette — behind everything. */
export const Backdrop = () => (
  <>
    <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.66)" />
    <ScreenVignette tintRgb="6,16,34" strength={0.55} zIndex={0} />
  </>
);

/** A calm grey shape where content will be — instead of a spinner. */
export const Skeleton = ({ width = '100%', height = 16, radius = 8, style }) => (
  <View style={[{ width, height, borderRadius: radius, backgroundColor: 'rgba(255,255,255,0.08)' }, style]} />
);

/** A page of skeletons: a few cards' worth, for a first-ever open. */
export const SkeletonList = ({ rows = 3, testID }) => (
  <View style={{ padding: 16, gap: 12 }} testID={testID}>
    {Array.from({ length: rows }).map((_, i) => (
      <View key={i} style={[s.card, { gap: 10 }]}>
        <Skeleton width="55%" height={20} />
        <Skeleton height={14} />
        <Skeleton width="80%" height={14} />
      </View>
    ))}
  </View>
);

/** Content eases in once, unless the person asked for less motion. */
export const FadeIn = ({ children, style, delay = 0 }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((reduce) => {
      if (!live) return;
      if (reduce) opacity.setValue(1);
      else Animated.timing(opacity, { toValue: 1, duration: 260, delay, useNativeDriver: true }).start();
    }).catch(() => opacity.setValue(1));
    return () => { live = false; };
  }, [opacity, delay]);
  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
};

/** A gold button, an outlined one, or a quiet text one. */
export const GoldButton = ({ label, icon, onPress, kind = 'solid', busy, disabled, testID, style }) => {
  const solid = kind === 'solid';
  const quiet = kind === 'quiet';
  const color = solid ? GOLD.onGold : quiet ? GOLD.sub : GOLD.text;
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled || busy} activeOpacity={0.85} testID={testID}
      accessibilityRole="button" accessibilityState={{ disabled: !!(disabled || busy) }}
      style={[s.btn, solid ? s.btnSolid : quiet ? s.btnQuiet : s.btnOutline, (disabled || busy) && { opacity: 0.55 }, style]}>
      {busy ? <ActivityIndicator color={color} /> : (
        <>
          {!!icon && <Ionicons name={icon} size={19} color={color} />}
          <Text style={[s.btnText, { color }]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

/** A small label in gold capitals. */
export const Label = ({ children, style }) => (
  <Text style={[s.label, style]} maxFontSizeMultiplier={FONT_SCALE.chrome}>{children}</Text>
);

export const Card = ({ children, style, testID }) => <View style={[s.card, style]} testID={testID}>{children}</View>;

/** A rounded fact: an icon and a few words. */
export const Chip = ({ icon, text, on, onPress, testID }) => {
  const Body = onPress ? TouchableOpacity : View;
  return (
    <Body onPress={onPress} testID={testID} accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: !!on } : undefined}
      style={[s.chip, on && s.chipOn]}>
      {!!icon && <MaterialCommunityIcons name={icon} size={15} color={on ? GOLD.onGold : GOLD.gold} />}
      <Text style={[s.chipText, on && { color: GOLD.onGold }]} maxFontSizeMultiplier={FONT_SCALE.chrome}>{text}</Text>
    </Body>
  );
};

/** A photo, or a calm placeholder while there is none. */
export const Portrait = ({ uri, size, radius, style, label }) => (
  uri ? (
    <Image source={{ uri }} style={[{ width: size, height: size, borderRadius: radius ?? size / 2 }, style]}
      contentFit="cover" accessibilityLabel={label} transition={150} />
  ) : (
    <View style={[{ width: size, height: size, borderRadius: radius ?? size / 2 }, s.placeholder, style]}
      accessibilityLabel={label}>
      <Ionicons name="person-outline" size={Math.round(size / 3)} color="#5B7397" />
    </View>
  )
);

/** The gold ring a portrait sits in. */
export const Ring = ({ children, style }) => <View style={[s.ring, style]}>{children}</View>;

/** A thin gold rule under a name. */
export const Rule = () => <View style={s.rule} />;

export const Title = ({ children, size = 34, style }) => (
  <Text style={[s.title, { fontSize: size, lineHeight: Math.round(size * 1.12) }, style]} accessibilityRole="header">
    {children}
  </Text>
);

export const Body = ({ children, style }) => <Text style={[s.body, style]}>{children}</Text>;

export const Centered = ({ children }) => <View style={s.centered}>{children}</View>;

// Nothing kept and no answer from the network: say so and offer to try
// again - not "nobody here" / "no matches yet", which was untrue offline.
export const Offline = ({ onRetry, testID = 'singles-offline' }) => {
  const { t } = useI18n();
  return (
    <View style={s.centered} testID={testID}>
      <Ionicons name="cloud-offline-outline" size={30} color={GOLD.muted} />
      <Text style={[s.body, { textAlign: 'center' }]}>{t('singles.loadFailed')}</Text>
      {onRetry ? <GoldButton label={t('common.retry')} icon="refresh" kind="outline" onPress={onRetry} /> : null}
    </View>
  );
};

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: GOLD.bg },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 4, zIndex: 2 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, textAlign: 'center', color: GOLD.text, fontSize: 16, fontFamily: FACE.bold },
  scroll: { paddingTop: 8 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 16, zIndex: 3,
    backgroundColor: 'rgba(10,22,40,0.92)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GOLD.border,
  },
  footerRow: { flexDirection: 'row', gap: 12 },
  btn: {
    flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 50, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8,
  },
  btnSolid: { backgroundColor: GOLD.gold },
  btnOutline: { borderWidth: 1.5, borderColor: GOLD.border },
  btnQuiet: { backgroundColor: 'transparent' },
  btnText: { flexShrink: 1, textAlign: 'center', fontSize: 15, fontFamily: FACE.heavy },
  label: { color: GOLD.gold, fontSize: 12, fontFamily: FACE.heavy, letterSpacing: 1.3, textTransform: 'uppercase' },
  card: { backgroundColor: GOLD.card, borderRadius: 18, borderWidth: 1, borderColor: GOLD.border, padding: 16, gap: 10 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 34, borderRadius: 999,
    backgroundColor: GOLD.soft, borderWidth: 1, borderColor: 'transparent',
  },
  chipOn: { backgroundColor: GOLD.gold },
  chipText: { color: GOLD.text, fontSize: 13, fontFamily: FACE.semi },
  placeholder: { backgroundColor: GOLD.photo, alignItems: 'center', justifyContent: 'center' },
  ring: { padding: 5, borderRadius: 999, borderWidth: 1.5, borderColor: GOLD.gold, alignSelf: 'center' },
  rule: { width: 48, height: 1, backgroundColor: GOLD.gold, alignSelf: 'center' },
  title: { color: GOLD.text, fontFamily: FACE.title, textAlign: 'center' },
  body: { color: GOLD.sub, fontSize: 15, lineHeight: 23, fontFamily: FACE.body },
  centered: { alignItems: 'center', gap: 12 },
});
