/**
 * Sabbath School: this quarter's lessons, and the way into today's study.
 *
 * The content is Adventech's (services/sabbathSchool.js), in English or
 * Swahili. The EN | SW switch on the screen changes only the lessons, and is
 * remembered; until it is touched they follow the app's language.
 *
 * The screen takes the quarter's own colours, as the printed quarterly does,
 * so each quarter looks like itself rather than like every other screen.
 *
 * With no `quarterlyId` it opens the adult quarterly being studied now; an
 * earlier quarter opens this same screen with its id.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useI18n } from '../context/I18nContext';
import useCachedData from '../utils/useCachedData';
import { peekCache, readCache, writeCache } from '../utils/screenCache';
import LessonLanguageToggle from '../components/LessonLanguageToggle';
import {
  useLessonLanguage, fetchQuarterlies, fetchQuarterly, fetchLesson, fetchDay,
  currentQuarterly, currentLesson, guessQuarterlyId, guessDayId,
  isAdultQuarterly, isWithin, shortDate, quarterColors, cacheKeys,
} from '../services/sabbathSchool';

const PARCHMENT = '#F2EFE6';
const GOLD_SOFT = '#E3C46A';
const DISPLAY = 'Cinzel_700Bold';
const DISPLAY_MID = 'Cinzel_600SemiBold';
const SERIF = 'Lora_400Regular';
const SERIF_BOLD = 'Lora_700Bold';

// Enough to find last quarter's lesson again without turning into an archive.
const EARLIER_SHOWN = 8;

// As long as useCachedData keeps things.
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const tick = () => { Haptics.selectionAsync().catch(() => {}); };

// Fetched ahead and kept, unless the phone already has it. Never throws: it
// is only a head start.
const warm = async (key, fetcher) => {
  try {
    if (peekCache(key) || await readCache(key, KEEP_MS)) return;
    writeCache(key, await fetcher());
  } catch { /* loads normally when opened */ }
};

const SabbathSchool = ({ navigation, route }) => {
  const { t, resolvedLanguage } = useI18n();
  const { lang, setLang } = useLessonLanguage(resolvedLanguage);
  const months = t('ss.months').split(',');
  const pinned = route?.params?.quarterlyId || null;

  const list = useCachedData(
    lang ? cacheKeys.list(lang) : null,
    () => fetchQuarterlies(lang),
    { enabled: !!lang },
  );
  const quarterlyId = pinned || currentQuarterly(list.data)?.id || null;
  const one = useCachedData(
    lang && quarterlyId ? cacheKeys.quarterly(lang, quarterlyId) : null,
    () => fetchQuarterly(lang, quarterlyId),
    { enabled: !!(lang && quarterlyId) },
  );

  // A first open has no list to pick the quarter from, and waiting for it
  // before asking for the quarter doubles the wait. Ask for the likely one
  // alongside; when the list agrees, its request is already under way
  // (services/sabbathSchool.js shares it) or done.
  const listMissing = !!lang && !pinned && !list.data;
  useEffect(() => {
    if (!listMissing) return;
    const guess = guessQuarterlyId();
    warm(cacheKeys.quarterly(lang, guess), () => fetchQuarterly(lang, guess));
  }, [listMissing, lang]);

  const failed = (list.failed && !list.data) || (one.failed && !one.data);

  // While the other language loads, the one already on screen stays there
  // rather than the whole screen blinking to a spinner and back. Checked by
  // the data's own language: with no key yet, useCachedData still hands back
  // the last language's copy.
  const fresh = one.data && (one.data.quarterly?.lang || lang) === lang ? one.data : null;
  const held = useRef(null);
  if (fresh) held.current = fresh;
  const shown = fresh || (failed ? null : held.current);
  const switching = !fresh && !!shown;

  const quarterly = shown?.quarterly;
  const lessons = shown?.lessons || [];
  const thisWeek = currentLesson(lessons);
  const { primary, dark } = quarterColors(quarterly);
  const [introOpen, setIntroOpen] = useState(false);

  // "Continue" is what most people press: have this week, and today in it,
  // on the phone before they do.
  const weekId = fresh ? thisWeek?.id : null;
  const weekStart = thisWeek?.start_date;
  useEffect(() => {
    if (!weekId || !lang || !quarterlyId) return;
    warm(cacheKeys.lesson(lang, quarterlyId, weekId), () => fetchLesson(lang, quarterlyId, weekId));
    const dayId = guessDayId(weekStart);
    warm(cacheKeys.day(lang, quarterlyId, weekId, dayId), () => fetchDay(lang, quarterlyId, weekId, dayId));
  }, [weekId, weekStart, lang, quarterlyId]);

  const openLesson = useCallback((lesson) => {
    if (!lesson || !quarterlyId) return;
    tick();
    navigation.push('SabbathSchoolLesson', {
      quarterlyId, lessonId: lesson.id, startDate: lesson.start_date, colors: { primary, dark },
    });
  }, [navigation, quarterlyId, primary, dark]);

  const openQuarter = useCallback((q) => {
    tick();
    navigation.push('SabbathSchool', { quarterlyId: q.id });
  }, [navigation]);

  const listReload = list.reload;
  const oneReload = one.reload;
  const reload = useCallback(() => Promise.all([listReload(), oneReload()]), [listReload, oneReload]);
  const [pulling, setPulling] = useState(false);
  const pull = useCallback(async () => {
    setPulling(true);
    try { await reload(); } finally { setPulling(false); }
  }, [reload]);

  const earlier = pinned ? [] : (list.data || [])
    .filter((q) => isAdultQuarterly(q) && q.id !== quarterlyId)
    .slice(0, EARLIER_SHOWN);

  // On every state of the screen, the error one included: a quarter missing
  // in one language is a tap away in the other.
  const toggle = lang ? (
    <View style={styles.toggleRow} pointerEvents="box-none">
      {switching && <ActivityIndicator size="small" color={GOLD_SOFT} />}
      <LessonLanguageToggle value={lang} onChange={setLang} ink={dark} />
    </View>
  ) : null;

  if (!quarterly) {
    return (
      <View style={[styles.root, { backgroundColor: dark }]}>
        {toggle}
        <View style={[styles.flex, styles.centre]}>
          {failed ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t('ss.failed')}</Text>
              <TouchableOpacity onPress={reload} accessibilityRole="button" hitSlop={10}>
                <Text style={styles.retry}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ActivityIndicator size="large" color={GOLD_SOFT} />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: dark }]}>
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={(
            <RefreshControl refreshing={pulling} onRefresh={pull} tintColor={GOLD_SOFT} colors={[primary]} />
          )}
        >
          {/* The quarter's own artwork, fading into its own colour. */}
          <View style={styles.hero}>
            {!!quarterly.splash && (
              <Image
                source={{ uri: quarterly.splash }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
                accessibilityIgnoresInvertColors
              />
            )}
            <LinearGradient
              colors={['rgba(0,0,0,0.05)', `${dark}CC`, dark]}
              locations={[0, 0.65, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            {toggle}
            <View style={[styles.heroText, styles.bodyWrap]}>
              <Text style={styles.kicker}>{t('ss.title')} · {quarterly.human_date}</Text>
              <Text style={styles.title} accessibilityRole="header">{quarterly.title}</Text>
            </View>
          </View>

          <View style={[styles.body, styles.bodyWrap]}>
            {!!thisWeek && (
              <TouchableOpacity
                onPress={() => openLesson(thisWeek)}
                style={styles.continueBtn}
                accessibilityRole="button"
                accessibilityLabel={`${t('ss.continue')}: ${thisWeek.title}`}
              >
                <View style={styles.flex}>
                  <Text style={[styles.continueKicker, { color: dark }]}>{t('ss.continue')}</Text>
                  <Text style={[styles.continueTitle, { color: dark }]} numberOfLines={2}>
                    {thisWeek.title}
                  </Text>
                </View>
                <Ionicons name="arrow-forward-circle" size={34} color={dark} />
              </TouchableOpacity>
            )}

            {!!quarterly.description && (
              <View style={styles.intro}>
                <TouchableOpacity
                  onPress={() => { tick(); setIntroOpen((o) => !o); }}
                  style={styles.introHead}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: introOpen }}
                >
                  <Text style={styles.sectionTitle}>{t('ss.intro')}</Text>
                  <Ionicons name={introOpen ? 'chevron-up' : 'chevron-down'} size={16} color={GOLD_SOFT} />
                </TouchableOpacity>
                <Text style={styles.introText} numberOfLines={introOpen ? undefined : 3}>
                  {quarterly.description}
                </Text>
              </View>
            )}

            <Text style={[styles.sectionTitle, styles.sectionGap]}>{t('ss.lessons')}</Text>
            <View style={[styles.group, { backgroundColor: `${primary}55` }]}>
              {lessons.map((lesson, i) => {
                const now = isWithin(lesson.start_date, lesson.end_date);
                return (
                  <TouchableOpacity
                    key={lesson.id}
                    onPress={() => openLesson(lesson)}
                    style={[styles.row, i < lessons.length - 1 && styles.rowDivider, now && styles.rowNow]}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('ss.lessonN', { n: Number(lesson.id) })}: ${lesson.title}`}
                  >
                    <View style={[styles.num, now && styles.numNow]}>
                      <Text style={[styles.numText, now && { color: dark }]} maxFontSizeMultiplier={1.3}>
                        {Number(lesson.id)}
                      </Text>
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle} numberOfLines={2}>{lesson.title}</Text>
                      <Text style={styles.rowDate}>
                        {shortDate(lesson.start_date, months)} – {shortDate(lesson.end_date, months)}
                        {now ? `  ·  ${t('ss.thisWeek')}` : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="rgba(242,239,230,0.45)" />
                  </TouchableOpacity>
                );
              })}
            </View>

            {earlier.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, styles.sectionGap]}>{t('ss.earlier')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
                  {earlier.map((q) => (
                    <TouchableOpacity
                      key={q.id}
                      onPress={() => openQuarter(q)}
                      style={styles.book}
                      accessibilityRole="button"
                      accessibilityLabel={`${q.title}, ${q.human_date}`}
                    >
                      <Image
                        source={{ uri: q.cover }}
                        style={[styles.cover, { backgroundColor: q.color_primary || primary }]}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        recyclingKey={q.id}
                        accessibilityIgnoresInvertColors
                      />
                      <Text style={styles.bookTitle} numberOfLines={2}>{q.title}</Text>
                      <Text style={styles.bookDate} numberOfLines={1}>{q.human_date}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            {/* Credit for the content, which is Adventech's work, not ours. */}
            <Text style={styles.source}>{t('ss.source')}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  centre: { alignItems: 'center', justifyContent: 'center', padding: 24 },

  hero: { height: 250, justifyContent: 'flex-end' },
  toggleRow: {
    position: 'absolute', top: 12, right: 16, zIndex: 2,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  heroText: { paddingHorizontal: 20, paddingBottom: 14 },
  kicker: {
    fontFamily: DISPLAY_MID, fontSize: 10.5, letterSpacing: 1.6,
    textTransform: 'uppercase', color: GOLD_SOFT,
  },
  title: { fontFamily: DISPLAY, fontSize: 26, lineHeight: 33, color: PARCHMENT, marginTop: 6 },

  // Phones and tablets alike: the list reads best at a book's width.
  bodyWrap: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  body: { paddingHorizontal: 16, paddingBottom: 24 },

  continueBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: PARCHMENT, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 18,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  continueKicker: { fontFamily: DISPLAY_MID, fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase' },
  continueTitle: { fontFamily: SERIF_BOLD, fontSize: 17, lineHeight: 23, marginTop: 2 },

  intro: { marginTop: 20 },
  introHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  introText: { fontFamily: SERIF, fontSize: 14.5, lineHeight: 22, color: 'rgba(242,239,230,0.82)', marginTop: 6 },

  sectionTitle: {
    fontFamily: DISPLAY_MID, fontSize: 11.5, letterSpacing: 1.5,
    textTransform: 'uppercase', color: GOLD_SOFT,
  },
  sectionGap: { marginTop: 24, marginBottom: 10 },

  group: {
    borderRadius: 18, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(242,239,230,0.14)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 14 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(242,239,230,0.12)' },
  rowNow: { backgroundColor: 'rgba(227,196,106,0.12)' },
  num: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(227,196,106,0.5)',
  },
  numNow: { backgroundColor: GOLD_SOFT, borderColor: GOLD_SOFT },
  numText: { fontFamily: DISPLAY, fontSize: 14, color: GOLD_SOFT },
  rowTitle: { fontFamily: SERIF_BOLD, fontSize: 15.5, lineHeight: 21, color: PARCHMENT },
  rowDate: { fontFamily: SERIF, fontSize: 12.5, color: 'rgba(242,239,230,0.6)', marginTop: 2 },

  shelf: { gap: 12, paddingRight: 8 },
  book: { width: 108 },
  cover: { width: 108, height: 148, borderRadius: 10 },
  bookTitle: { fontFamily: SERIF_BOLD, fontSize: 12.5, lineHeight: 16, color: PARCHMENT, marginTop: 6 },
  bookDate: { fontFamily: SERIF, fontSize: 11, color: 'rgba(242,239,230,0.55)', marginTop: 2 },

  source: {
    fontFamily: SERIF, fontStyle: 'italic', fontSize: 11.5, textAlign: 'center',
    color: 'rgba(242,239,230,0.45)', marginTop: 28,
  },

  errorBox: { alignItems: 'center', gap: 10 },
  errorText: { color: '#FFC9C0', fontSize: 14, textAlign: 'center', fontFamily: SERIF },
  retry: { color: GOLD_SOFT, fontFamily: DISPLAY_MID, fontSize: 13 },
});

export default SabbathSchool;
