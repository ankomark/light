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
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Animated, AccessibilityInfo, Image, ScrollView, PanResponder, useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
// expo-speech and expo-clipboard are native and may be missing from an older
// build; they load on first use (utils/optionalNative.js), never at launch.
import { speech } from '../utils/optionalNative';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import GlassView from '../components/GlassView';
import VerseShareSheet, { copyVerse, canCopy } from '../components/VerseShareSheet';
import { format as fmt, subDays } from 'date-fns';
import { useI18n } from '../context/I18nContext';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import { fetchDailyVerse } from '../services/api';
import useCachedData from '../utils/useCachedData';
import useReducedMotion from '../utils/useReducedMotion';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { useOptionalAuth } from '../context/useAuth';
import { bookIdFor, versionForVerse, translateVerse } from '../utils/dailyVerseText';
import { useBibleLibrary, findFavorite, toggleFavorite } from '../services/bibleLibrary';
import { publishWidgetVerse } from '../widgets/verseWidgetStore';

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

// A day's verse is the same for everyone and never changes, so the copy kept
// on the phone is simply right — not user-keyed, and good for as long as the
// server will still serve that day.
const KEEP_MS = (HISTORY_DAYS + 1) * 24 * 60 * 60 * 1000;
const dayFor = (back) => fmt(subDays(new Date(), back), 'yyyy-MM-dd');
// Per account: today's verse carries the reader's own streak, which must
// not show for the next person on a shared phone.
const keyFor = (uid, day) => userKey(uid, `verse:${day}`);
// Today is asked for without a date: the server's today, not the phone's, so
// a phone a timezone ahead is never refused for asking about "tomorrow".
const fetchFor = (back) => fetchDailyVerse(back === 0 ? null : dayFor(back));

export { bookIdFor };

// How long a first-ever translation may keep the card waiting before the
// server's KJV is shown instead. Read before, it is on the phone and instant.
const TRANSLATION_WAIT_MS = 2500;

// A swipe, not a wobble: far enough, and clearly more across than down, so a
// long verse can still be scrolled without the day changing under it.
const SWIPE_MIN = 60;
const isAcross = (g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 2;

// Stopping a voice that may not exist (no expo-speech in this build).
const hush = () => { try { speech()?.stop(); } catch { /* nothing speaking */ } };

// Feedback that must never fail the thing it accompanies.
const tick = () => { Haptics.selectionAsync().catch(() => {}); };

// The server's verses are the KJV it imported: the version a verse is filed
// under in My Bible when it is shown as the server sent it.
const VERSE_VERSION = 'eng_kjv';

// "Psalms 23:1" read out is "twenty-three colon one"; say it as a reader would.
const spokenReference = (v) => (v.lang === 'sw'
  ? `${v.bookName}, sura ${v.chapter}, mstari ${v.verse}.`
  : `${v.bookName}, chapter ${v.chapter}, verse ${v.verse}.`);

// A streak of one is just today; from two it is something to keep.
const STREAK_SHOWN_FROM = 2;

const DailyVerse = ({ navigation }) => {
  const { t, resolvedLanguage } = useI18n();
  const { height } = useWindowDimensions();

  const reduceMotion = useReducedMotion();

  const uid = useOptionalAuth()?.currentUser?.id;
  const [offset, setOffset] = useState(0);        // days back from today
  // The last copy is painted at once and refreshed behind it — the pattern
  // Home and Music use — so opening from the morning push shows the verse, not
  // a spinner.
  const { data: verse, failed, reload } = useCachedData(
    keyFor(uid, dayFor(offset)),
    () => fetchFor(offset),
  );

  // The verse in the reader's own Bible (Swahili, or whichever version they
  // chose in the reader). See utils/dailyVerseText.js.
  const { preferences } = usePreferences();
  const versionId = versionForVerse(preferences?.[PREF_KEYS.bibleVersion], resolvedLanguage);
  const verseKey = verse ? `${verse.book}|${verse.chapter}|${verse.verse}|${versionId}` : null;
  const [translation, setTranslation] = useState({ key: null, state: 'idle', data: null });
  useEffect(() => {
    if (!verse || versionId === VERSE_VERSION) return undefined;
    let live = true;
    setTranslation((cur) => (cur.key === verseKey ? cur : { key: verseKey, state: 'loading', data: null }));
    // Waited for, but not for ever: past this the KJV is shown, and the
    // translation still replaces it if it arrives.
    const late = setTimeout(() => {
      if (live) setTranslation((cur) => (cur.key === verseKey && cur.state === 'loading' ? { ...cur, state: 'late' } : cur));
    }, TRANSLATION_WAIT_MS);
    translateVerse(verse, versionId)
      .then((data) => { if (live) setTranslation({ key: verseKey, state: data ? 'done' : 'failed', data }); })
      .catch(() => { if (live) setTranslation({ key: verseKey, state: 'failed', data: null }); });
    return () => { live = false; clearTimeout(late); };
  }, [verseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the screen, the picture, the copy and the voice all use.
  const translated = translation.key === verseKey && translation.data;
  const waiting = !!verse && versionId !== VERSE_VERSION && !translated
    && !(translation.key === verseKey && (translation.state === 'failed' || translation.state === 'late'));
  const shownVerse = !verse || waiting ? null : translated ? {
    ...verse,
    text: translated.text,
    reference: `${translated.reference} · ${translated.abbr}`,
    bookName: translated.bookName,
    versionId: translated.versionId,
    lang: translated.lang,
  } : { ...verse, bookName: verse.book, versionId: VERSE_VERSION, lang: 'en' };
  const fade = useRef(new Animated.Value(0)).current;
  // Which way the new day came from, so it slides in from that side.
  const slide = useRef(new Animated.Value(0)).current;
  const cameFrom = useRef(0);

  // The verse arrives rather than appearing — a small thing, but this is a
  // screen someone opens once a day and looks at. Keyed on what is shown, so
  // a background refresh that brings the same verse back does not flicker it.
  const shown = shownVerse ? `${shownVerse.date}|${shownVerse.reference}` : null;
  useEffect(() => {
    if (!shown) return;
    if (reduceMotion) { fade.setValue(1); slide.setValue(0); return; }
    fade.setValue(0);
    slide.setValue(cameFrom.current * 28);
    cameFrom.current = 0;
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, friction: 9, tension: 60, useNativeDriver: true }),
    ]).start();
  }, [shown, reduceMotion, fade, slide]);

  // Today's verse, in the words shown here, goes to the home-screen widget
  // (Android; a no-op elsewhere), so the widget and the screen agree.
  const widgetTitle = t('verse.title');
  useEffect(() => {
    if (offset !== 0 || !shownVerse) return;
    publishWidgetVerse({
      date: shownVerse.date, book: shownVerse.book, chapter: shownVerse.chapter, verse: shownVerse.verse,
      text: shownVerse.text, reference: shownVerse.reference, versionId: shownVerse.versionId,
      title: widgetTitle,
    }).catch(() => {});
  }, [shown, offset, widgetTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  // One way to change day, whether by arrow, by swipe or by "Today".
  // A larger `back` is further into the past.
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const goTo = useCallback((back) => {
    const next = Math.max(0, Math.min(HISTORY_DAYS, back));
    const cur = offsetRef.current;
    if (next === cur) return;
    cameFrom.current = next > cur ? -1 : 1;   // older comes in from the left
    tick();
    setOffset(next);
  }, []);

  // Swipe right for the day before, left for the day after, the way a book's
  // pages turn. The arrows stay: a swipe is a shortcut, not the only way.
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => isAcross(g),
    onPanResponderRelease: (_, g) => {
      if (g.dx > SWIPE_MIN) goTo(offsetRef.current + 1);
      else if (g.dx < -SWIPE_MIN) goTo(offsetRef.current - 1);
    },
    onPanResponderTerminationRequest: () => true,
  })).current;

  // Read aloud, in the morning or with eyes closed. One voice at a time: a
  // new day, or leaving the screen, stops the old one.
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    hush();
    setSpeaking(false);
  }, [shown]);
  useEffect(() => () => { hush(); }, []);
  const canSpeak = !!speech();
  const listen = useCallback(() => {
    if (!shownVerse) return;
    tick();
    if (speaking) { hush(); setSpeaking(false); return; }
    setSpeaking(true);
    const done = () => setSpeaking(false);
    // In the verse's own language, so a Swahili verse is not read in English.
    speech()?.speak(`${shownVerse.text} ... ${spokenReference(shownVerse)}`, {
      language: shownVerse.lang || 'en', rate: 0.92, onDone: done, onStopped: done, onError: done,
    });
  }, [shownVerse, speaking]);

  // The verse in its chapter, in the reader's own Bible version: the same
  // route My Bible uses, so it opens at the verse and flashes it.
  const bookId = verse ? bookIdFor(verse.book) : null;
  const readChapter = useCallback(() => {
    if (!verse || !bookId) return;
    hush();
    navigation?.push?.('bible', { bookId, chapter: verse.chapter, verse: verse.verse });
  }, [verse, bookId, navigation]);

  // "Earlier" is the next thing anyone presses: have that day ready before
  // they do, so paging back is as instant as opening.
  const hasVerse = !!verse;
  useEffect(() => {
    if (!hasVerse || offset >= HISTORY_DAYS) return undefined;
    let live = true;
    const key = keyFor(uid, dayFor(offset + 1));
    (async () => {
      try {
        let data = peekCache(key) || await readCache(key, KEEP_MS);
        if (!data) {
          data = await fetchFor(offset + 1);
          if (live) writeCache(key, data);
        }
        // And its chapter in the reader's version, so that is on the phone too.
        if (live && versionId !== VERSE_VERSION) await translateVerse(data, versionId);
      } catch {
        // Only a head start; the day loads normally when asked for.
      }
    })();
    return () => { live = false; };
  }, [hasVerse, offset, versionId]);

  // Sharing opens a sheet: the verse as a picture first, then text, save and
  // copy. See components/VerseShareSheet.js.
  const [sharing, setSharing] = useState(false);
  const share = useCallback(() => {
    if (!shownVerse) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    hush();
    setSharing(true);
  }, [shownVerse]);
  const closeShare = useCallback(() => setSharing(false), []);

  // A word that something happened (copied, saved), then gone. Announced too,
  // since a screen reader cannot see it appear.
  const [toast, setToast] = useState('');
  const toastFade = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef(null);
  const showToast = useCallback((text) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    AccessibilityInfo.announceForAccessibility?.(text);
    toastFade.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) Animated.timing(toastFade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => setToast(''), 1900);
  }, [reduceMotion, toastFade]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Kept verses go to My Bible's favourites, beside everything else kept from
  // the reader: one place to find them, and the reader marks the verse too.
  const lib = useBibleLibrary();
  const passage = shownVerse && bookId ? {
    bookId, bookName: shownVerse.bookName, chapter: shownVerse.chapter, verses: [shownVerse.verse],
    text: shownVerse.text, versionId: shownVerse.versionId,
  } : null;
  const kept = !!(passage && findFavorite(lib, passage));
  const keep = useCallback(async () => {
    if (!passage) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const now = await toggleFavorite(passage);
    showToast(now ? t('verse.kept') : t('verse.unkept'));
  }, [passage, showToast, t]);

  // Long-press the verse to copy it: the gesture people already try on text.
  const copy = useCallback(async () => {
    if (!shownVerse) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    showToast((await copyVerse(shownVerse)) ? t('verse.copied') : t('common.error'));
  }, [shownVerse, showToast, t]);

  const reflection = verse?.reflection
    ? (verse.reflection[resolvedLanguage] || verse.reflection.en || '')
    : '';

  // Long verses need room; short ones look better large.
  const size = !shownVerse ? 22
    : shownVerse.text.length > 210 ? 17
    : shownVerse.text.length > 130 ? 19.5
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
      <SafeAreaView style={styles.flex} edges={['bottom']} {...swipe.panHandlers}>

        <ScrollView
          contentContainerStyle={[styles.scroll, { minHeight: height * 0.52 }]}
          showsVerticalScrollIndicator={false}
        >
          {shownVerse ? null : failed && !verse ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t('verse.failed')}</Text>
              <TouchableOpacity onPress={reload} accessibilityRole="button">
                <Text style={styles.retry}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ActivityIndicator size="large" color={GOLD_SOFT} />
          )}
          {!!shownVerse && (
            <Animated.View style={{ opacity: fade, transform: [{ translateX: slide }] }}>
              {/* GlassView is a real blur on iOS and a plain View on Android,
                  so the card carries its own translucent teal: the frosted
                  look has to hold on both. */}
              <GlassView intensity={28} tint="dark" style={styles.card}>
                <Text style={styles.day}>
                  {offset === 0 ? t('verse.today') : fmt(subDays(new Date(), offset), 'EEEE d MMMM')}
                </Text>
                {/* Quietly, and only from the second day: a nudge, not a
                    scoreboard. Today's card only — the server sends none for
                    earlier days. */}
                {offset === 0 && shownVerse.streak?.current >= STREAK_SHOWN_FROM && (
                  <View style={styles.streak} accessible accessibilityLabel={t('verse.streak', { count: shownVerse.streak.current })}>
                    <Ionicons name="flame" size={11} color={GOLD_SOFT} />
                    <Text style={styles.streakText}>{t('verse.streak', { count: shownVerse.streak.current })}</Text>
                  </View>
                )}

                <Text style={styles.quoteMark}>“</Text>
                <Text
                  style={[styles.verse, { fontSize: size, lineHeight: size * 1.62 }]}
                  {...(canCopy() ? {
                    onLongPress: copy,
                    accessibilityHint: t('verse.copyHint'),
                    accessibilityActions: [{ name: 'longpress', label: t('verse.copy') }],
                    onAccessibilityAction: copy,
                  } : {})}
                >
                  {shownVerse.text}
                </Text>

                <LinearGradient
                  colors={['transparent', GOLD_SOFT, 'transparent']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.rule}
                />
                <Text style={styles.reference}>{shownVerse.reference}</Text>

                {/* One line to carry the verse into the day, in the reader's
                    language. Older servers send none; the card is whole without. */}
                {!!reflection && <Text style={styles.reflection}>{reflection}</Text>}

                {/* Quiet, inside the card: they belong to this verse, and the
                    foot already carries the screen's one loud action. */}
                <View style={styles.cardActions}>
                  {canSpeak && (
                    <TouchableOpacity
                      onPress={listen}
                      hitSlop={8}
                      style={styles.cardAction}
                      accessibilityRole="button"
                      accessibilityLabel={speaking ? t('verse.stop') : t('verse.listen')}
                    >
                      <Ionicons name={speaking ? 'stop-circle-outline' : 'volume-high-outline'} size={16} color={GOLD_SOFT} />
                      <Text style={styles.cardActionText}>{speaking ? t('verse.stop') : t('verse.listen')}</Text>
                    </TouchableOpacity>
                  )}
                  {!!passage && (
                    <TouchableOpacity
                      onPress={keep}
                      hitSlop={8}
                      style={styles.cardAction}
                      accessibilityRole="button"
                      accessibilityState={{ selected: kept }}
                      accessibilityLabel={t('verse.keep')}
                    >
                      <Ionicons name={kept ? 'heart' : 'heart-outline'} size={16} color={GOLD_SOFT} />
                      <Text style={styles.cardActionText}>{t('verse.keep')}</Text>
                    </TouchableOpacity>
                  )}
                  {!!bookId && (
                    <TouchableOpacity
                      onPress={readChapter}
                      hitSlop={8}
                      style={styles.cardAction}
                      accessibilityRole="button"
                      accessibilityLabel={t('verse.readChapter')}
                    >
                      <Ionicons name="book-outline" size={16} color={GOLD_SOFT} />
                      <Text style={styles.cardActionText}>{t('verse.readChapter')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </GlassView>
            </Animated.View>
          )}
        </ScrollView>

        {!!toast && (
          <Animated.View style={[styles.toast, { opacity: toastFade }]} pointerEvents="none"
                         accessibilityLiveRegion="polite">
            <Text style={styles.toastText}>{toast}</Text>
          </Animated.View>
        )}

        {/* Paging back sits at the foot, over the book, where it does not
            compete with the verse. */}
        <View style={styles.footer}>
          <TouchableOpacity
            onPress={() => goTo(offset + 1)}
            disabled={offset >= HISTORY_DAYS}
            hitSlop={10}
            style={styles.pageBtn}
            accessibilityRole="button"
            accessibilityState={{ disabled: offset >= HISTORY_DAYS }}
          >
            <Ionicons name="chevron-back" size={18}
                      color={offset >= HISTORY_DAYS ? 'rgba(242,239,230,0.25)' : PARCHMENT} />
            <Text style={[styles.pageText, offset >= HISTORY_DAYS && styles.pageTextOff]}>
              {t('verse.earlier')}
            </Text>
          </TouchableOpacity>

          {/* The one action on the screen, so it is filled and labelled: a bare
              glyph read as "export", not "share". The icon is the app's usual
              share-social, as on the Bible reader and About. */}
          <TouchableOpacity
            onPress={share}
            disabled={!shownVerse}
            hitSlop={10}
            style={[styles.shareBtn, !shownVerse && styles.pageBtnOff]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !shownVerse }}
            accessibilityLabel={t('verse.share')}
          >
            <Ionicons name="share-social" size={16} color={TEAL_DEEP} />
            <Text style={styles.shareText}>{t('verse.shareShort')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => goTo(0)}
            disabled={offset === 0}
            hitSlop={10}
            style={styles.pageBtn}
            accessibilityRole="button"
            accessibilityState={{ disabled: offset === 0 }}
          >
            <Text style={[styles.pageText, offset === 0 && styles.pageTextOff]}>
              {t('verse.today')}
            </Text>
            <Ionicons name="chevron-forward" size={18}
                      color={offset === 0 ? 'rgba(242,239,230,0.25)' : PARCHMENT} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <VerseShareSheet visible={sharing} onClose={closeShare} verse={shownVerse} onToast={showToast} />
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
  reflection: {
    fontFamily: SERIF, fontStyle: 'italic', fontSize: 13.5, lineHeight: 20,
    color: 'rgba(242,239,230,0.78)', textAlign: 'center', marginTop: 14,
  },
  streak: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 5,
  },
  streakText: { fontFamily: SERIF, fontSize: 11.5, color: 'rgba(227,196,106,0.85)' },
  // Three quiet actions: wrap to a second line on a narrow phone rather than
  // squeezing the labels.
  cardActions: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    columnGap: 18, rowGap: 6, marginTop: 16,
  },
  cardAction: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  cardActionText: { fontFamily: DISPLAY_MID, fontSize: 11, letterSpacing: 0.8, color: GOLD_SOFT },
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
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 18,
    backgroundColor: GOLD_SOFT,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  shareText: { fontFamily: DISPLAY, fontSize: 12, letterSpacing: 0.9, color: TEAL_DEEP },
  pageText: { fontFamily: DISPLAY_MID, fontSize: 11.5, letterSpacing: 0.8, color: PARCHMENT },
  pageTextOff: { color: 'rgba(242,239,230,0.25)' },

  toast: {
    alignSelf: 'center', marginBottom: 10,
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 16,
    backgroundColor: 'rgba(0,39,44,0.92)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(227,196,106,0.35)',
  },
  toastText: { fontFamily: SERIF, fontSize: 13, color: PARCHMENT },

  errorBox: { alignItems: 'center', gap: 8 },
  errorText: { color: '#FFC9C0', fontSize: 14, textAlign: 'center' },
  retry: { color: GOLD_SOFT, fontFamily: DISPLAY_MID, fontSize: 13 },
});

export default DailyVerse;
