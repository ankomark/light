/**
 * One verse a day, from the KJV already imported on the server.
 *
 * The layout is teal above, an open Bible along the foot.
 *
 * The Bible is a cut-out (assets/verse-book.png) rather than part of a
 * photograph, which is what lets it sit at the bottom edge at a size chosen
 * here instead of wherever a `cover` crop happens to leave it. The teal is the
 * original artwork's own (#004B51).
 *
 * The verse sits on frosted glass above it: text laid straight onto a
 * photograph is only legible by luck.
 *
 * The verse is the same for everyone on a given day and is chosen by date, not
 * stored — see songs/devotion.py on the server for why the selection is
 * curated rather than searched.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Share,
  Animated, Image, ScrollView, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import GlassView from '../components/GlassView';
import { format as fmt, subDays } from 'date-fns';
import { useI18n } from '../context/I18nContext';
import { fetchDailyVerse } from '../services/api';

// From the picture itself, so the screen and the image cannot disagree.
const TEAL = '#004B51';
const TEAL_DEEP = '#00343A';
const TEAL_LIFT = '#015C63';
const PARCHMENT = '#F2EFE6';
const GOLD_SOFT = '#E3C46A';
const DISPLAY = 'Cinzel_700Bold';
const DISPLAY_MID = 'Cinzel_600SemiBold';
const SERIF = 'Lora_400Regular';

// How far back the server will look. Matching it here keeps the arrow from
// offering a day that would only come back as an error.
const HISTORY_DAYS = 14;

const DailyVerse = () => {
  const { t } = useI18n();
  const { height } = useWindowDimensions();

  const [offset, setOffset] = useState(0);        // days back from today
  const [verse, setVerse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fade = useRef(new Animated.Value(0)).current;

  const load = useCallback(async (back) => {
    setLoading(true);
    setError('');
    fade.setValue(0);
    try {
      const day = back === 0 ? null : fmt(subDays(new Date(), back), 'yyyy-MM-dd');
      const data = await fetchDailyVerse(day);
      setVerse(data);
      // The verse arrives rather than appearing — a small thing, but this is a
      // screen someone opens once a day and looks at.
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }).start();
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || t('verse.failed'));
    } finally {
      setLoading(false);
    }
  }, [fade, t]);

  useEffect(() => { load(offset); }, [load, offset]);

  const share = useCallback(async () => {
    if (!verse) return;
    try {
      await Share.share({ message: `“${verse.text}”\n— ${verse.reference}` });
    } catch {
      // Dismissed. Nothing to report.
    }
  }, [verse]);

  // Long verses need room; short ones look better large.
  const size = !verse ? 22
    : verse.text.length > 210 ? 17
    : verse.text.length > 130 ? 19.5
    : 23;

  return (
    <View style={styles.root}>
      {/* Teal, deeper at the top so the verse has ground under it. */}
      <LinearGradient
        colors={[TEAL_DEEP, TEAL, TEAL_LIFT]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* The book along the foot: centred, 60% of the width, at its own ratio. */}
      <Image
        source={require('../assets/verse-book.png')}
        style={styles.book}
        resizeMode="contain"
        pointerEvents="none"
        accessibilityIgnoresInvertColors
      />

      {/* No bar of its own: the app header above names the screen and carries
          the way back. Sharing moved to the foot, next to the paging, where
          the three controls sit together instead of split across the screen. */}
      <SafeAreaView style={styles.flex} edges={['bottom']}>

        <ScrollView
          contentContainerStyle={[styles.scroll, { minHeight: height * 0.52 }]}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <ActivityIndicator size="large" color={GOLD_SOFT} />
          ) : error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={() => load(offset)}>
                <Text style={styles.retry}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : !!verse && (
            <Animated.View style={{ opacity: fade }}>
              {/* GlassView is a real blur on iOS and a plain View on Android,
                  so the card carries its own translucent teal: the frosted
                  look has to hold on both. */}
              <GlassView intensity={28} tint="dark" style={styles.card}>
                <Text style={styles.day}>
                  {offset === 0 ? t('verse.today') : fmt(subDays(new Date(), offset), 'EEEE d MMMM')}
                </Text>

                <Text style={styles.quoteMark}>“</Text>
                <Text style={[styles.verse, { fontSize: size, lineHeight: size * 1.62 }]}>
                  {verse.text}
                </Text>

                <LinearGradient
                  colors={['transparent', GOLD_SOFT, 'transparent']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.rule}
                />
                <Text style={styles.reference}>{verse.reference}</Text>
              </GlassView>
            </Animated.View>
          )}
        </ScrollView>

        {/* Paging back sits at the foot, over the book, where it does not
            compete with the verse. */}
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={() => setOffset((o) => Math.min(HISTORY_DAYS, o + 1))}
            disabled={offset >= HISTORY_DAYS}
            hitSlop={10}
            style={styles.pageBtn}
          >
            <Ionicons name="chevron-back" size={18}
                      color={offset >= HISTORY_DAYS ? 'rgba(242,239,230,0.25)' : PARCHMENT} />
            <Text style={[styles.pageText, offset >= HISTORY_DAYS && styles.pageTextOff]}>
              {t('verse.earlier')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={share}
            disabled={!verse}
            hitSlop={10}
            style={[styles.pageBtn, !verse && styles.pageBtnOff]}
            accessibilityLabel={t('verse.share')}
          >
            <Ionicons name="share-outline" size={17} color={verse ? GOLD_SOFT : 'rgba(242,239,230,0.25)'} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setOffset(0)}
            disabled={offset === 0}
            hitSlop={10}
            style={styles.pageBtn}
          >
            <Text style={[styles.pageText, offset === 0 && styles.pageTextOff]}>
              {t('verse.today')}
            </Text>
            <Ionicons name="chevron-forward" size={18}
                      color={offset === 0 ? 'rgba(242,239,230,0.25)' : PARCHMENT} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: TEAL },
  flex: { flex: 1 },
  // 900 x 339 in the file, drawn at 60% of the screen's width and centred —
  // 40% smaller than full bleed. Sitting flush with the bottom edge rather
  // than bled past it: six points of overhang was unnoticeable on a full-width
  // book and would clip the ribbon on one this size.
  book: {
    position: 'absolute', left: '8%', right: '10%', bottom: 0,
    aspectRatio: 600 / 239,
  },

  // Everything sits in the upper part of the picture; the book has the rest.
  // The card lives in the upper half; the book has the lower.
  scroll: { paddingHorizontal: 20, paddingTop: 16, justifyContent: 'center' },
  card: {
    padding: 24, paddingTop: 18, borderRadius: 26, overflow: 'hidden',
    // 0.55 was enough over teal, but a long verse on a short screen can
    // scroll this card down over the book's white pages, where parchment
    // text on a 55% card drops to 2:1. Denser, so it reads anywhere.
    backgroundColor: 'rgba(0,44,49,0.78)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(227,196,106,0.30)',
  },
  day: {
    fontFamily: DISPLAY_MID, fontSize: 10.5, letterSpacing: 1.6,
    textTransform: 'uppercase', color: GOLD_SOFT, textAlign: 'center',
  },
  quoteMark: {
    fontFamily: DISPLAY, fontSize: 54, color: 'rgba(227,196,106,0.35)',
    textAlign: 'center', marginTop: 4, marginBottom: -22,
  },
  verse: {
    fontFamily: SERIF, color: PARCHMENT, textAlign: 'center', letterSpacing: 0.2,
  },
  rule: { height: 1, marginTop: 20, opacity: 0.75 },
  reference: {
    fontFamily: DISPLAY, fontSize: 14, letterSpacing: 1.1,
    color: GOLD_SOFT, textAlign: 'center', marginTop: 12,
  },

  footer: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 6,
  },
  // These sit over the book now, and half of the book is white pages —
  // parchment text on those is invisible. A dark pill keeps them readable
  // wherever they land.
  pageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: 'rgba(0,39,44,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(227,196,106,0.22)',
  },
  pageBtnOff: { opacity: 0.5 },
  pageText: { fontFamily: DISPLAY_MID, fontSize: 11.5, letterSpacing: 0.8, color: PARCHMENT },
  pageTextOff: { color: 'rgba(242,239,230,0.25)' },

  errorBox: { alignItems: 'center', gap: 8 },
  errorText: { color: '#FFC9C0', fontSize: 14, textAlign: 'center' },
  retry: { color: GOLD_SOFT, fontFamily: DISPLAY_MID, fontSize: 13 },
});

export default DailyVerse;
