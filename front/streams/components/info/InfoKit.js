// The look shared by the information pages (About, Help, User guide, Privacy
// Centre, the legal documents): "Midnight Bento" — a deep midnight ground,
// navy tiles in two-column grids, teal for icons, labels and what is open,
// Sora for titles and Manrope for the words (both loaded in App.js).
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { FONT_SCALE } from '../../utils/layout';

export const INFO = {
  bg: '#06101A',
  card: '#0F1D2C',
  cardDeep: '#132638',
  border: '#1C3247',
  text: '#EEF4F8',
  sub: '#B4C3D0',
  muted: '#8597A8',
  accent: '#45D0BC',
  accentSoft: 'rgba(69,208,188,0.12)',
  accentLine: 'rgba(69,208,188,0.35)',
  onAccent: '#04201C',
};

// A custom font carries its own weight, so styles name the face rather than
// setting fontWeight (Android ignores the weight on a custom family).
export const FONT = {
  title: 'Sora_600SemiBold',
  titleBold: 'Sora_700Bold',
  body: 'Manrope_500Medium',
  semi: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  heavy: 'Manrope_800ExtraBold',
};

export const MAX_WIDTH = 720;
export const RADIUS = 24;

const iconFor = (set) => (set === 'ion' ? Ionicons : MaterialCommunityIcons);

// Side padding of the page column, and the gap between tiles.
const GUTTER = 16;
const TILE_GAP = 10;
// A tile narrower than this (in the user's text size) can't hold its title
// without breaking words, so the grid drops to one column instead.
const MIN_TILE = 135;

/** How the grid lays out at this window width and text size: the width of a
 *  half tile ('48.5%', or '100%' when two would be too narrow) and how many
 *  tiles a row a feature grid may have (4 on a wide column, else 2 or 1). */
export const useGrid = () => {
  const { width, fontScale } = useWindowDimensions();
  const column = Math.min(width, MAX_WIDTH) - GUTTER * 2;
  const half = (column - TILE_GAP) / 2;
  const two = half / Math.max(1, fontScale) >= MIN_TILE;
  const four = two && (column - TILE_GAP * 3) / 4 / Math.max(1, fontScale) >= MIN_TILE;
  return { half: two ? '48.5%' : '100%', quarter: four ? '23.5%' : two ? '48.5%' : '100%' };
};

/** Which tiles take a whole row: any marked wide, and a half tile left
 *  without a partner. */
const wideFlags = (items) => {
  const flags = items.map((it) => !!it.wide);
  let run = 0;
  items.forEach((it, i) => {
    if (flags[i]) { run = 0; return; }
    run += 1;
    const next = items[i + 1];
    if (run % 2 === 1 && (!next || next.wide)) flags[i] = true;
  });
  return flags;
};

/** A page: a bar with Back and the title (shown once the hero has scrolled
 *  away), a centred hero, and the content in a reading-width column. */
export function InfoScreen({
  title, eyebrow, subtitle, icon, iconSet = 'mci', children, scrollRef, onScroll, below, testID, footer, hero,
}) {
  const navigation = useNavigation();
  const { t } = useI18n();
  const [barTitle, setBarTitle] = React.useState(false);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const Icon = iconFor(iconSet);
  const scrolled = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    if ((y > 140) !== barTitle) setBarTitle(y > 140);
    onScroll?.(e);
  };
  return (
    <View style={s.root} testID={testID}>
      <SafeAreaView edges={['top', 'left', 'right']} style={s.bar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back} accessibilityRole="button"
          accessibilityLabel={t('common.back')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={INFO.text} />
        </TouchableOpacity>
        <Text style={[s.barTitle, { opacity: barTitle ? 1 : 0 }]} numberOfLines={1}
          maxFontSizeMultiplier={FONT_SCALE.chrome}>{title}</Text>
        <View style={s.back} />
      </SafeAreaView>
      {below}
      <ScrollView
        ref={scrollRef}
        onScroll={scrolled}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          s.scroll,
          // Clear the home indicator, and a notch or camera cut-out at the
          // sides when the phone or tablet is turned.
          {
            paddingBottom: 48 + insets.bottom,
            paddingLeft: GUTTER + insets.left,
            paddingRight: GUTTER + insets.right,
          },
          width > MAX_WIDTH + GUTTER * 2 && s.scrollWide,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {hero ?? (
          <View style={s.hero}>
            {!!icon && (
              <View style={s.heroFrame}>
                <View style={s.heroIcon}><Icon name={icon} size={28} color={INFO.accent} /></View>
              </View>
            )}
            {!!eyebrow && <Text style={s.eyebrow} maxFontSizeMultiplier={FONT_SCALE.chrome}>{eyebrow}</Text>}
            <Text style={s.title} accessibilityRole="header">{title}</Text>
            {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
          </View>
        )}
        {children}
        {footer}
      </ScrollView>
    </View>
  );
}

/** A labelled group: a small teal label over its content (a card unless plain). */
export const Section = ({ label, children, style, onLayout, plain }) => (
  <View style={[s.section, style]} onLayout={onLayout}>
    {!!label && <Text style={s.label}>{label}</Text>}
    {plain ? children : <View style={s.card}>{children}</View>}
  </View>
);

/** A padded navy card. */
export const Card = ({ children, style, testID }) => (
  <View style={[s.card, s.cardPad, style]} testID={testID}>{children}</View>
);

/** The bento grid: two tiles a row (one when the screen or the text size
 *  leaves too little room), a tile without a partner across the whole row.
 *  Each item: { icon, iconSet?, title, sub?, onPress, testID?, wide? } —
 *  `wide` for one whose words can't break, like an email address. */
export const Tiles = ({ items }) => {
  const { half } = useGrid();
  const wide = wideFlags(items);
  return (
    <View style={s.tiles}>
      {items.map((it, i) => {
        const Icon = iconFor(it.iconSet);
        return (
          <TouchableOpacity key={it.testID || it.title} onPress={it.onPress} activeOpacity={0.8}
            accessibilityRole="button" accessibilityLabel={it.title} testID={it.testID}
            style={[s.tile, { width: wide[i] ? '100%' : half }]}>
            <View style={s.tileTop}>
              <View style={s.tileIcon}><Icon name={it.icon} size={21} color={INFO.accent} /></View>
              <MaterialCommunityIcons name="arrow-top-right" size={18} color={INFO.muted} />
            </View>
            <Text style={s.tileTitle}>{it.title}</Text>
            {!!it.sub && <Text style={s.tileSub}>{it.sub}</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

/** A question (or any heading) that opens to show what is under it. */
export const Fold = ({ title, open, onToggle, children, testID }) => (
  <View style={[s.fold, open && s.foldOpen]}>
    <TouchableOpacity style={s.foldHead} onPress={onToggle} accessibilityRole="button"
      accessibilityState={{ expanded: open }} testID={testID}>
      <Text style={s.foldTitle}>{title}</Text>
      <View style={[s.foldSign, open && s.foldSignOpen]}>
        <Ionicons name={open ? 'remove' : 'add'} size={18} color={open ? INFO.onAccent : INFO.accent} />
      </View>
    </TouchableOpacity>
    {open && <View style={s.foldBody}>{children}</View>}
  </View>
);

/** The search field at the top of Help and the guide. */
export const SearchField = ({ value, onChangeText, placeholder, testID }) => {
  const { t } = useI18n();
  return (
    <View style={s.search}>
      <Ionicons name="search" size={18} color={INFO.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={INFO.muted}
        style={s.input}
        returnKeyType="search"
        testID={testID}
        accessibilityLabel={placeholder}
      />
      {!!value && (
        <TouchableOpacity onPress={() => onChangeText('')} accessibilityLabel={t('common.clear')} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={INFO.muted} />
        </TouchableOpacity>
      )}
    </View>
  );
};

/** A teal button (primary) or an outlined one. */
export const InfoButton = ({ icon, label, onPress, outline, testID }) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.85} testID={testID} accessibilityRole="button"
    style={[s.btn, outline ? s.btnOutline : s.btnSolid]}>
    {!!icon && <Ionicons name={icon} size={18} color={outline ? INFO.accent : INFO.onAccent} />}
    <Text style={[s.btnText, { color: outline ? INFO.accent : INFO.onAccent }]}>{label}</Text>
  </TouchableOpacity>
);

export const Para = ({ children, style }) => <Text style={[s.para, style]}>{children}</Text>;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: INFO.bg },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 4, backgroundColor: INFO.bg },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, color: INFO.text, fontSize: 16, fontFamily: FONT.bold, textAlign: 'center' },
  scroll: {},
  scrollWide: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },

  hero: { alignItems: 'center', paddingTop: 14, paddingBottom: 8, paddingHorizontal: 8, gap: 8 },
  heroFrame: {
    width: 76, height: 76, borderRadius: 26, backgroundColor: INFO.card, borderWidth: 1, borderColor: INFO.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  heroIcon: {
    width: 52, height: 52, borderRadius: 18, backgroundColor: INFO.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: { color: INFO.accent, fontSize: 12, fontFamily: FONT.bold, letterSpacing: 1.6, textTransform: 'uppercase' },
  title: { color: INFO.text, fontSize: 28, fontFamily: FONT.title, lineHeight: 34, textAlign: 'center', letterSpacing: -0.4 },
  subtitle: { color: INFO.sub, fontSize: 15, fontFamily: FONT.body, lineHeight: 22, textAlign: 'center', maxWidth: 320 },

  section: { marginTop: 24, gap: 10 },
  label: {
    color: INFO.accent, fontSize: 12, fontFamily: FONT.heavy, letterSpacing: 1.3,
    textTransform: 'uppercase', marginLeft: 4,
  },
  card: {
    backgroundColor: INFO.card, borderRadius: RADIUS, borderWidth: 1, borderColor: INFO.border, overflow: 'hidden',
  },
  cardPad: { padding: 18, gap: 14 },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  tile: {
    backgroundColor: INFO.card, borderRadius: RADIUS, borderWidth: 1, borderColor: INFO.border,
    padding: 16, gap: 10, minHeight: 124,
  },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tileIcon: {
    width: 40, height: 40, borderRadius: 14, backgroundColor: INFO.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  tileTitle: { color: INFO.text, fontSize: 15, fontFamily: FONT.bold, lineHeight: 20 },
  tileSub: { color: INFO.muted, fontSize: 12.5, fontFamily: FONT.body, lineHeight: 18 },

  fold: { backgroundColor: INFO.card, borderRadius: 20, borderWidth: 1, borderColor: INFO.border },
  foldOpen: { backgroundColor: INFO.cardDeep, borderColor: INFO.accent },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 56 },
  foldTitle: { flex: 1, color: INFO.text, fontSize: 15, fontFamily: FONT.bold, lineHeight: 21 },
  foldSign: {
    width: 30, height: 30, borderRadius: 10, backgroundColor: INFO.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  foldSignOpen: { backgroundColor: INFO.accent },
  foldBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 14 },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, paddingHorizontal: 14, minHeight: 50,
    backgroundColor: INFO.card, borderRadius: 18, borderWidth: 1, borderColor: INFO.border,
  },
  input: { flex: 1, color: INFO.text, fontSize: 15, fontFamily: FONT.body, paddingVertical: 10 },

  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 48, borderRadius: 16, paddingHorizontal: 18, paddingVertical: 10,
  },
  btnSolid: { backgroundColor: INFO.accent },
  btnOutline: { borderWidth: 1.5, borderColor: INFO.accent, backgroundColor: 'transparent' },
  btnText: { flexShrink: 1, textAlign: 'center', fontSize: 15, fontFamily: FONT.heavy },
  para: { color: INFO.sub, fontSize: 15, fontFamily: FONT.body, lineHeight: 23 },
});
