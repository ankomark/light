/**
 * One week's Sabbath School lesson, a day at a time.
 *
 * The seven days (Sabbath to Friday) sit along the top; it opens on today's
 * when today is in this week. Each day's study is HTML from Adventech, drawn
 * with react-native-render-html (pure JS, so nothing for an older native build
 * to lack).
 *
 * A Bible reference in the text opens the passage in a sheet. The day's file
 * already carries every passage it links to, in several versions, so the
 * sheet works offline and needs no request of its own.
 *
 * Opening a week fetches all seven days behind the first, so the rest of the
 * week reads without a connection. Today's day is asked for alongside the
 * week's index rather than after it: its id follows from the week's start
 * date, which the quarter screen passes along.
 *
 * The EN | SW switch in the footer keeps the place: lesson and day ids are
 * the same in both editions.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Modal, Pressable,
  Linking, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import RenderHTML, { defaultSystemFonts } from 'react-native-render-html';
import { useI18n } from '../context/I18nContext';
import useCachedData from '../utils/useCachedData';
import { peekCache, readCache, writeCache } from '../utils/screenCache';
import LessonLanguageToggle from '../components/LessonLanguageToggle';
import {
  useLessonLanguage, fetchLesson, fetchDay, currentDay, guessDayId, parseDate, prepareLessonHtml,
  isHiddenNode, defaultVersionIndex, quarterColors, shortDate, cacheKeys,
} from '../services/sabbathSchool';

const PARCHMENT = '#F2EFE6';
const GOLD_SOFT = '#E3C46A';
const DISPLAY = 'Cinzel_700Bold';
const DISPLAY_MID = 'Cinzel_600SemiBold';
const SERIF = 'Lora_400Regular';
const SERIF_BOLD = 'Lora_700Bold';

// The renderer only uses a font family it has been told exists.
const FONTS = [...defaultSystemFonts, SERIF, SERIF_BOLD, DISPLAY, DISPLAY_MID];

// As long as useCachedData keeps things: a week's days are fixed once published.
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const NONE = [];

// A line of print longer than this is hard to follow back to its start, so on
// a tablet the text keeps a book's measure rather than the screen's width.
const READING_WIDTH = 720;

const tick = () => { Haptics.selectionAsync().catch(() => {}); };

// Declared once, outside the component: the renderer rebuilds its styles
// whenever these objects change identity.
const BASE_STYLE = { fontFamily: SERIF, fontSize: 16.5, lineHeight: 27, color: PARCHMENT };
const TAGS = {
  p: { marginTop: 0, marginBottom: 14 },
  h2: { fontFamily: DISPLAY, fontSize: 18, color: GOLD_SOFT, marginTop: 6, marginBottom: 10 },
  h3: { fontFamily: DISPLAY, fontSize: 16, lineHeight: 22, color: GOLD_SOFT, marginTop: 6, marginBottom: 10 },
  h4: { fontFamily: DISPLAY_MID, fontSize: 14.5, color: GOLD_SOFT, marginBottom: 8 },
  a: { color: GOLD_SOFT, textDecorationLine: 'none', fontFamily: SERIF_BOLD },
  strong: { fontFamily: SERIF_BOLD },
  b: { fontFamily: SERIF_BOLD },
  em: { fontStyle: 'italic' },
  small: { fontSize: 13, color: 'rgba(242,239,230,0.65)' },
  blockquote: {
    marginTop: 4, marginBottom: 18, marginLeft: 0, marginRight: 0,
    paddingLeft: 14, paddingVertical: 6,
    borderLeftWidth: 3, borderLeftColor: GOLD_SOFT,
    backgroundColor: 'rgba(227,196,106,0.08)',
    fontStyle: 'italic',
  },
  hr: { backgroundColor: 'rgba(242,239,230,0.2)', height: 1, marginVertical: 18 },
  ul: { marginBottom: 12 },
  ol: { marginBottom: 12 },
  li: { marginBottom: 6 },
};
const VERSE_TAGS = {
  h2: { fontFamily: DISPLAY_MID, fontSize: 14, color: GOLD_SOFT, marginTop: 10, marginBottom: 6 },
  sup: { fontSize: 11, color: GOLD_SOFT },
  p: { marginTop: 0, marginBottom: 8 },
};

// The day's text, apart from the screen around it: opening a verse, or any
// other state of the screen, must not make the renderer walk the whole day
// again. Every prop it takes is kept stable for that reason.
const LessonBody = memo(function LessonBody({ source, contentWidth, renderersProps }) {
  return (
    <RenderHTML
      contentWidth={contentWidth}
      source={source}
      baseStyle={BASE_STYLE}
      tagsStyles={TAGS}
      systemFonts={FONTS}
      renderersProps={renderersProps}
      ignoreDomNode={isHiddenNode}
      enableExperimentalMarginCollapsing
    />
  );
});

const SabbathSchoolLesson = ({ navigation, route }) => {
  const { t, resolvedLanguage } = useI18n();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { lang, setLang } = useLessonLanguage(resolvedLanguage);
  const { quarterlyId, lessonId, startDate } = route.params;
  const { primary, dark } = route.params.colors || quarterColors(null);
  const months = t('ss.months').split(',');

  const lesson = useCachedData(
    lang ? cacheKeys.lesson(lang, quarterlyId, lessonId) : null,
    () => fetchLesson(lang, quarterlyId, lessonId),
    { enabled: !!lang },
  );
  const days = lesson.data?.days || NONE;
  const pdf = (lesson.data?.pdfs || [])[0];

  const [picked, setPicked] = useState(route.params.dayId || null);
  const dayId = picked || currentDay(days)?.id || (startDate ? guessDayId(startDate) : null);
  const dayIndex = days.findIndex((d) => d.id === dayId);
  const day = useCachedData(
    lang && dayId ? cacheKeys.day(lang, quarterlyId, lessonId, dayId) : null,
    () => fetchDay(lang, quarterlyId, lessonId, dayId),
    { enabled: !!(lang && dayId) },
  );
  const openDayRef = useRef(dayId);
  openDayRef.current = dayId;

  // The rest of the week, quietly, one at a time so the open day is not
  // competing with six others for the connection. The open day is skipped:
  // it is already being fetched on its own.
  const dayIds = days.map((d) => d.id).join(',');
  useEffect(() => {
    if (!dayIds || !lang) return undefined;
    let live = true;
    (async () => {
      for (const id of dayIds.split(',')) {
        if (!live) return;
        if (id === openDayRef.current) continue;
        const key = cacheKeys.day(lang, quarterlyId, lessonId, id);
        try {
          if (peekCache(key) || await readCache(key, KEEP_MS)) continue;
          const data = await fetchDay(lang, quarterlyId, lessonId, id);
          if (live) writeCache(key, data);
        } catch {
          // Only a head start; the day loads normally when opened.
        }
      }
    })();
    return () => { live = false; };
  }, [dayIds, lang, quarterlyId, lessonId]);

  const scrollRef = useRef(null);
  const goToDay = useCallback((id) => {
    if (!id || id === dayId) return;
    tick();
    setPicked(id);
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }, [dayId]);

  // A tapped reference: the passage, in the first version we prefer.
  const [verseKey, setVerseKey] = useState(null);
  const [versionIdx, setVersionIdx] = useState(0);
  const bible = day.data?.bible || NONE;
  // Read through a ref so the link handler, and with it the renderer's props,
  // never change: a new handler makes RenderHTML rebuild the whole day.
  const bibleRef = useRef(bible);
  bibleRef.current = bible;
  const openVerse = useCallback((key) => {
    tick();
    setVersionIdx(defaultVersionIndex(bibleRef.current, lang));
    setVerseKey(key);
  }, [lang]);
  const closeVerse = useCallback(() => setVerseKey(null), []);

  const renderersProps = useMemo(() => ({
    a: {
      onPress: (_e, href, attribs) => {
        if (attribs?.verse) openVerse(attribs.verse);
        else if (/^https?:/i.test(href || '')) Linking.openURL(href).catch(() => {});
      },
    },
  }), [openVerse]);

  const source = useMemo(() => ({ html: prepareLessonHtml(day.data?.content) }), [day.data?.content]);
  const contentWidth = Math.min(width, READING_WIDTH) - 40;

  const openPdf = useCallback(() => {
    if (!pdf?.src) return;
    tick();
    Linking.openURL(pdf.src).catch(() => {});
  }, [pdf]);

  const weekday = (d) => {
    const date = parseDate(d?.date);
    return date ? t(`ss.wd.${date.getDay()}`) : '';
  };
  const todayIs = (d) => {
    const date = parseDate(d?.date);
    const now = new Date();
    return !!date && date.toDateString() === now.toDateString();
  };

  const verseHtml = verseKey ? bible[versionIdx]?.verses?.[verseKey] : null;
  const verseSource = useMemo(() => ({ html: verseHtml || '' }), [verseHtml]);

  return (
    <View style={[styles.root, { backgroundColor: dark }]}>
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        {/* The week, Sabbath to Friday. */}
        <View style={[styles.tabs, { backgroundColor: primary }]} accessibilityRole="tablist">
          {days.map((d) => {
            const on = d.id === dayId;
            const date = parseDate(d.date);
            return (
              <TouchableOpacity
                key={d.id}
                onPress={() => goToDay(d.id)}
                style={[styles.tab, on && styles.tabOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${weekday(d)} ${date ? date.getDate() : ''}, ${d.title}`}
              >
                <Text style={[styles.tabDay, on && { color: dark }]} maxFontSizeMultiplier={1.25} numberOfLines={1}>
                  {weekday(d)}
                </Text>
                <Text style={[styles.tabNum, on && { color: dark }]} maxFontSizeMultiplier={1.25}>
                  {date ? date.getDate() : ''}
                </Text>
                {todayIs(d) && <View style={[styles.todayDot, on && { backgroundColor: dark }]} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* The day first: fetched alongside the index, it can be here even
              when the index is not. */}
          {day.data ? (
            <>
              <View style={styles.head}>
                <View style={styles.flex}>
                  <Text style={styles.kicker}>
                    {t('ss.lessonN', { n: Number(lessonId) })} · {weekday(day.data)} {shortDate(day.data.date, months)}
                  </Text>
                  <Text style={styles.title} accessibilityRole="header">{day.data.title}</Text>
                </View>
                {!!pdf && (
                  <TouchableOpacity
                    onPress={openPdf}
                    style={styles.pdfBtn}
                    hitSlop={8}
                    accessibilityRole="link"
                    accessibilityLabel={`${t('ss.pdf')}: ${pdf.title || ''}`}
                  >
                    <Ionicons name="document-text-outline" size={15} color={GOLD_SOFT} />
                    <Text style={styles.pdfText}>{t('ss.pdf')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <LessonBody source={source} contentWidth={contentWidth} renderersProps={renderersProps} />
            </>
          ) : lesson.failed && !lesson.data ? (
            <ErrorBox text={t('ss.failed')} retry={lesson.reload} t={t} />
          ) : day.failed ? (
            <ErrorBox text={t('ss.dayFailed')} retry={day.reload} t={t} />
          ) : (
            <ActivityIndicator style={styles.spinner} size="large" color={GOLD_SOFT} />
          )}
        </ScrollView>

        {!!lang && (
          <View style={[styles.footer, { borderTopColor: primary }]}>
            <TouchableOpacity
              onPress={() => goToDay(days[dayIndex - 1]?.id)}
              disabled={dayIndex <= 0}
              style={[styles.pageBtn, dayIndex <= 0 && styles.off]}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('ss.prev')}
              accessibilityState={{ disabled: dayIndex <= 0 }}
            >
              <Ionicons name="chevron-back" size={18} color={PARCHMENT} />
              <Text style={styles.pageText}>{weekday(days[dayIndex - 1]) || ' '}</Text>
            </TouchableOpacity>
            <LessonLanguageToggle value={lang} onChange={setLang} ink={dark} />
            <TouchableOpacity
              onPress={() => goToDay(days[dayIndex + 1]?.id)}
              disabled={dayIndex < 0 || dayIndex >= days.length - 1}
              style={[styles.pageBtn, (dayIndex < 0 || dayIndex >= days.length - 1) && styles.off]}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('ss.next')}
              accessibilityState={{ disabled: dayIndex < 0 || dayIndex >= days.length - 1 }}
            >
              <Text style={styles.pageText}>{weekday(days[dayIndex + 1]) || ' '}</Text>
              <Ionicons name="chevron-forward" size={18} color={PARCHMENT} />
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>

      {/* The passage behind a tapped reference. */}
      {/* Faded, not slid: sliding carries the dimmed backdrop up with the
          sheet, as one dark block. */}
      <Modal visible={!!verseKey} transparent animationType="fade" onRequestClose={closeVerse}>
        <Pressable style={styles.backdrop} onPress={closeVerse} accessibilityLabel={t('ss.close')} />
        <View style={[styles.sheet, { backgroundColor: dark, paddingBottom: 16 + insets.bottom }]}>
          <View style={styles.grabber} />
          {bible.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.versions}>
              {bible.map((b, i) => (
                <TouchableOpacity
                  key={b.name}
                  onPress={() => { tick(); setVersionIdx(i); }}
                  style={[styles.chip, i === versionIdx && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: i === versionIdx }}
                >
                  <Text style={[styles.chipText, i === versionIdx && { color: dark }]}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody}>
            {verseHtml ? (
              <RenderHTML
                contentWidth={contentWidth}
                source={verseSource}
                baseStyle={BASE_STYLE}
                tagsStyles={VERSE_TAGS}
                systemFonts={FONTS}
              />
            ) : (
              <Text style={styles.missing}>{t('ss.verseMissing')}</Text>
            )}
          </ScrollView>
          <TouchableOpacity onPress={closeVerse} style={styles.closeBtn} accessibilityRole="button">
            <Text style={[styles.closeText, { color: dark }]}>{t('ss.close')}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

const ErrorBox = ({ text, retry, t }) => (
  <View style={styles.errorBox}>
    <Text style={styles.errorText}>{text}</Text>
    <TouchableOpacity onPress={retry} accessibilityRole="button" hitSlop={10}>
      <Text style={styles.retry}>{t('common.retry')}</Text>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },

  tabs: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 8, gap: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 12 },
  tabOn: { backgroundColor: GOLD_SOFT },
  tabDay: { fontFamily: DISPLAY_MID, fontSize: 10, letterSpacing: 0.6, color: 'rgba(242,239,230,0.75)' },
  tabNum: { fontFamily: DISPLAY, fontSize: 16, color: PARCHMENT, marginTop: 1 },
  todayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: GOLD_SOFT, marginTop: 3 },

  scroll: {
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32,
    width: '100%', maxWidth: READING_WIDTH, alignSelf: 'center',
  },
  spinner: { marginTop: 60 },

  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  kicker: {
    fontFamily: DISPLAY_MID, fontSize: 10.5, letterSpacing: 1.4,
    textTransform: 'uppercase', color: GOLD_SOFT,
  },
  title: { fontFamily: DISPLAY, fontSize: 22, lineHeight: 29, color: PARCHMENT, marginTop: 6 },
  pdfBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(227,196,106,0.5)',
  },
  pdfText: { fontFamily: DISPLAY_MID, fontSize: 11, color: GOLD_SOFT },

  footer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth,
  },
  pageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  pageText: { fontFamily: DISPLAY_MID, fontSize: 12, letterSpacing: 0.8, color: PARCHMENT },
  off: { opacity: 0.3 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '70%', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(227,196,106,0.35)',
  },
  grabber: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(242,239,230,0.3)', marginBottom: 10,
  },
  versions: { gap: 8, paddingHorizontal: 20, paddingBottom: 6 },
  chip: {
    paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(227,196,106,0.5)',
  },
  chipOn: { backgroundColor: GOLD_SOFT, borderColor: GOLD_SOFT },
  chipText: { fontFamily: DISPLAY_MID, fontSize: 11.5, color: GOLD_SOFT },
  sheetScroll: { flexGrow: 0 },
  sheetBody: { paddingHorizontal: 20, paddingVertical: 8 },
  missing: { fontFamily: SERIF, fontSize: 15, color: 'rgba(242,239,230,0.7)', textAlign: 'center', marginVertical: 20 },
  closeBtn: {
    alignSelf: 'center', marginTop: 10, paddingVertical: 9, paddingHorizontal: 28,
    borderRadius: 18, backgroundColor: GOLD_SOFT,
  },
  closeText: { fontFamily: DISPLAY, fontSize: 12.5, letterSpacing: 0.9 },

  errorBox: { alignItems: 'center', gap: 10, marginTop: 60 },
  errorText: { color: '#FFC9C0', fontSize: 14, textAlign: 'center', fontFamily: SERIF },
  retry: { color: GOLD_SOFT, fontFamily: DISPLAY_MID, fontSize: 13 },
});

export default SabbathSchoolLesson;
