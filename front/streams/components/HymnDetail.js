// One hymn, to sing from: verses with the refrain after each (as it is sung).
//
// - Opened by hymnal and number (older links pass the hymn itself), so it can
//   move on: ‹ › at the foot, or a swipe sideways, goes to the hymn before or
//   after, in place — Back still returns to the list, not through every hymn.
// - The words can be made larger or smaller (remembered, as in the Bible).
// - The screen stays on while it is open: no phone going dark mid-verse.
// - Share sends the words as text, for a WhatsApp group or a slide.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, ScrollView, View, Text, StyleSheet, TouchableOpacity, Share, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useHymnFavorites } from '../services/hymnFavorites';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import { HYMNALS } from '../utils/hymnals';
import { keepAwake } from '../utils/optionalNative';
import useBottomSpace from '../hooks/useBottomSpace';

const SIZE_MIN = 14;
const SIZE_MAX = 30;
const SIZE_STEP = 2;
const SWIPE = 60;               // how far sideways a swipe goes to turn the page
const AWAKE_TAG = 'hymn';

/** The words as text: title, then each verse with the refrain after it. */
export const hymnText = (hymn, hymnalName, t) => {
  const parts = [`${hymn.number}. ${hymn.title}`];
  (hymn.verses || []).forEach((verse, i) => {
    parts.push(`${i + 1}\n${verse}`);
    if (hymn.refrain) parts.push(`${t('hymns.refrain')}:\n${hymn.refrain}`);
  });
  if (hymnalName) parts.push(`— ${hymnalName}`);
  return parts.join('\n\n');
};

// Handed another hymn while open (navigate() to the screen already showing):
// it starts afresh on that one, rather than keeping the last one's place.
const HymnDetail = ({ route }) => {
  const p = route?.params || {};
  return <HymnPage key={`${p.lang || 'en'}:${p.number ?? p.hymn?.number ?? ''}`} route={route} />;
};

const HymnPage = ({ route }) => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const params = route?.params || {};
  const lang = HYMNALS[params.lang] ? params.lang : 'en';
  const hymnal = HYMNALS[lang];
  const hymns = hymnal.data.hymns;
  const hymnalName = params.hymnalName || hymnal.name;

  // Where it is in the hymnal; moving on changes this, not the screen.
  const startNumber = params.number ?? params.hymn?.number;
  const [at, setAt] = useState(() => hymns.findIndex((h) => String(h.number) === String(startNumber)));
  // An older link's own copy, when the hymnal no longer has that number.
  const hymn = at >= 0 ? hymns[at] : params.hymn || null;
  const verses = Array.isArray(hymn?.verses) ? hymn.verses : [];

  const { preferences, setPreference } = usePreferences();
  const size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(preferences[PREF_KEYS.hymnTextSize]) || 18));
  const resize = (by) => setPreference(PREF_KEYS.hymnTextSize, Math.min(SIZE_MAX, Math.max(SIZE_MIN, size + by)));

  const bottomSpace = useBottomSpace(0);
  const scroll = useRef(null);

  // ── keep the screen on while singing ───────────────────────────────────────
  useEffect(() => {
    const awake = keepAwake();
    if (!awake) return undefined;
    const on = () => { awake.activateKeepAwakeAsync?.(AWAKE_TAG)?.catch?.(() => {}); };
    const off = () => { try { awake.deactivateKeepAwake?.(AWAKE_TAG); } catch { /* already off */ } };
    on();
    const subs = [navigation.addListener?.('focus', on), navigation.addListener?.('blur', off)];
    return () => { off(); subs.forEach((u) => typeof u === 'function' && u()); };
  }, [navigation]);

  // ── moving on, with the page sliding the way it went ───────────────────────
  const slide = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(1)).current;
  const atRef = useRef(at);
  atRef.current = at;
  const go = useCallback((dir) => {
    const i = atRef.current;
    const next = i + dir;
    if (i < 0 || next < 0 || next >= hymns.length) return;
    atRef.current = next;            // a second quick swipe goes on from here
    setAt(next);
    slide.setValue(dir * 36);
    fadeIn.setValue(0);
    Animated.parallel([
      Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(fadeIn, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
    scroll.current?.scrollTo?.({ y: 0, animated: false });
  }, [hymns.length, slide, fadeIn]);

  const pan = useMemo(() => PanResponder.create({
    // A clear sideways swipe only; reading is scrolling up and down.
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderRelease: (_, g) => {
      if (g.dx <= -SWIPE) go(1);
      else if (g.dx >= SWIPE) go(-1);
    },
  }), [go]);

  // ── favourite ──────────────────────────────────────────────────────────────
  const { isFavorite, toggle } = useHymnFavorites();
  const favorite = hymn ? isFavorite(lang, hymn.number) : false;
  const [note, setNote] = useState(null);
  const fade = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onFavorite = async () => {
    const on = await toggle(lang, hymn.number);
    setNote(t(on ? 'hymns.favAdded' : 'hymns.favRemoved'));
    fade.setValue(1);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setNote(null));
    }, 1800);
  };

  const onShare = () => {
    Share.share({ message: hymnText(hymn, hymnalName, t) }).catch(() => {});
  };

  const topBar = (
    <View style={styles.topBar}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
                        accessibilityRole="button" accessibilityLabel={t('common.back')}>
        <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.topBarTitle} numberOfLines={1}>{hymnalName}</Text>
      {hymn ? (
        <>
          <TouchableOpacity onPress={onShare} style={styles.iconBtn} hitSlop={8}
                            accessibilityRole="button" accessibilityLabel={t('hymns.share')} testID="hymn-share">
            <Ionicons name="share-social-outline" size={21} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onFavorite}
            style={styles.iconBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: favorite }}
            accessibilityLabel={t(favorite ? 'hymns.removeFavorite' : 'hymns.addFavorite')}
            testID="hymn-favorite"
          >
            <Ionicons name={favorite ? 'heart' : 'heart-outline'} size={24} color={favorite ? '#FF4D6D' : colors.textPrimary} />
          </TouchableOpacity>
        </>
      ) : <View style={styles.iconBtn} />}
    </View>
  );

  if (!hymn) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {topBar}
        <View style={styles.missing} testID="hymn-missing">
          <Ionicons name="musical-notes-outline" size={44} color={colors.textMuted} />
          <Text style={styles.missingText}>{t('hymns.notFound')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const lineStyle = { fontSize: size, lineHeight: Math.round(size * 1.65) };
  const refrainStyle = { fontSize: size - 1, lineHeight: Math.round((size - 1) * 1.65) };
  const hasPrev = at > 0;
  const hasNext = at >= 0 && at < hymns.length - 1;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {topBar}
      {note ? (
        <Animated.View style={[styles.note, { opacity: fade }]} pointerEvents="none">
          <Ionicons name={favorite ? 'heart' : 'heart-dislike-outline'} size={14} color="#fff" />
          <Text style={styles.noteText}>{note}</Text>
        </Animated.View>
      ) : null}

      <View style={styles.flex} {...pan.panHandlers}>
        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          testID="hymn-scroll"
        >
          <Animated.View style={[styles.page, { opacity: fadeIn, transform: [{ translateX: slide }] }]}>
            {/* Title block */}
            <Text style={styles.hymnNumber} testID="hymn-number">{t('hymns.number', { n: hymn.number })}</Text>
            <Text style={styles.hymnTitle} accessibilityRole="header" testID="hymn-title">{hymn.title}</Text>
            <View style={styles.titleRule} />

            {/* Verses, with the refrain repeated after each (as it's sung) */}
            {verses.map((verse, idx) => (
              <View key={`verse-${idx}`}>
                <View style={styles.verseBlock}>
                  <Text style={styles.verseNumber}>{idx + 1}</Text>
                  <View style={styles.verseTextWrap}>
                    {verse.split('\n').map((line, i) => (
                      <Text key={i} style={[styles.verseLine, lineStyle]} selectable>{line}</Text>
                    ))}
                  </View>
                </View>

                {hymn.refrain ? (
                  <View style={styles.refrainBlock}>
                    <View style={styles.refrainLabelRow}>
                      <Ionicons name="musical-notes" size={15} color={colors.accent} />
                      <Text style={styles.refrainLabel}>{t('hymns.refrain')}</Text>
                    </View>
                    {hymn.refrain.split('\n').map((line, i) => (
                      <Text key={i} style={[styles.refrainLine, refrainStyle]} selectable>{line}</Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
          </Animated.View>
        </ScrollView>
      </View>

      {/* The foot: the hymn before, the size of the words, the hymn after. */}
      <View style={[styles.footBar, { paddingBottom: spacing.sm + bottomSpace }]}>
        <TouchableOpacity style={[styles.footBtn, !hasPrev && styles.footOff]} onPress={() => go(-1)}
                          disabled={!hasPrev} accessibilityRole="button" accessibilityLabel={t('hymns.prev')}
                          testID="hymn-prev">
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          {hasPrev ? <Text style={styles.footNum}>{hymns[at - 1].number}</Text> : null}
        </TouchableOpacity>
        <View style={styles.sizeGroup}>
          <TouchableOpacity style={styles.sizeBtn} onPress={() => resize(-SIZE_STEP)} disabled={size <= SIZE_MIN}
                            accessibilityRole="button" accessibilityLabel={t('hymns.textSmaller')} testID="hymn-smaller">
            <Text style={[styles.sizeText, size <= SIZE_MIN && styles.sizeOff]}>A−</Text>
          </TouchableOpacity>
          <View style={styles.sizeRule} />
          <TouchableOpacity style={styles.sizeBtn} onPress={() => resize(SIZE_STEP)} disabled={size >= SIZE_MAX}
                            accessibilityRole="button" accessibilityLabel={t('hymns.textLarger')} testID="hymn-larger">
            <Text style={[styles.sizeTextBig, size >= SIZE_MAX && styles.sizeOff]}>A+</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[styles.footBtn, !hasNext && styles.footOff]} onPress={() => go(1)}
                          disabled={!hasNext} accessibilityRole="button" accessibilityLabel={t('hymns.next')}
                          testID="hymn-next">
          {hasNext ? <Text style={styles.footNum}>{hymns[at + 1].number}</Text> : null}
          <Ionicons name="chevron-forward" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  // A tablet keeps lines a readable length, in the middle.
  page: { width: '100%', maxWidth: 720, alignSelf: 'center' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  topBarTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  note: {
    position: 'absolute', top: 64, alignSelf: 'center', zIndex: 5,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  noteText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  missingText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },

  hymnNumber: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  hymnTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  titleRule: {
    width: 56, height: 3, borderRadius: 2,
    backgroundColor: colors.accent,
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },

  verseBlock: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  verseNumber: {
    ...typography.h3,
    color: colors.primary,
    fontWeight: '800',
    width: 28,
  },
  verseTextWrap: { flex: 1 },
  verseLine: { color: colors.textPrimary },

  refrainBlock: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    padding: spacing.md,
    marginBottom: spacing.lg,
    marginLeft: 28,
    ...shadows.sm,
  },
  refrainLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs,
  },
  refrainLabel: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    fontStyle: 'italic',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  refrainLine: { color: colors.textSecondary, fontStyle: 'italic' },

  footBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 64, height: 40,
    paddingHorizontal: 10, borderRadius: radius.full, justifyContent: 'center',
    backgroundColor: colors.card,
  },
  footOff: { opacity: 0.35 },
  footNum: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  sizeGroup: {
    flexDirection: 'row', alignItems: 'center', height: 40, borderRadius: radius.full,
    backgroundColor: colors.card, paddingHorizontal: 4,
  },
  sizeBtn: { paddingHorizontal: 14, height: 40, justifyContent: 'center' },
  sizeRule: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: colors.border },
  sizeText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  sizeTextBig: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  sizeOff: { opacity: 0.35 },
});

export default HymnDetail;
