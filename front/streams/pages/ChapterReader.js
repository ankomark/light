import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Modal, Pressable, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveReadingProgress, fetchPublication } from '../services/api';
import { loadChapter, peekBook, readBook, fetchBook } from '../services/publicationStore';
import { noteReading, flushReading } from '../services/readingTracker';
import { ProseSkeleton } from '../components/SkeletonLoader';
import ReportModal from '../components/ReportModal';
import { markdownTheme, markdownImageRule, resolveWritingTheme, fontFamilyFor, isLightBg } from '../utils/publications';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

// expo-speech is a native module; on a dev client that hasn't been rebuilt since
// it was added it isn't present. Load it defensively so the reader still works
// (the Listen button just hides) instead of crashing on "native module" errors.
let Speech = null;
try { Speech = require('expo-speech'); } catch { Speech = null; }
const SPEECH_OK = !!(Speech && typeof Speech.speak === 'function');

const FONT_SIZES = [15, 17, 19, 22];
const FONT_KEY = 'reader:fontIdx';
const SAVE_SCROLL_MS = 400;
const SAVE_PROGRESS_MS = 1500;
// Reading time: counted in ticks, noted every half minute, and not counted
// once the reader has neither scrolled nor tapped for a few minutes.
export const TICK_MS = 5000;
export const COMMIT_MS = 30000;
export const IDLE_MS = 3 * 60 * 1000;

// Android's speech engine refuses text past ~4000 characters (it fails
// silently), so a chapter is read aloud in pieces, split between sentences.
export const SPEECH_CHUNK = 3500;

// Strip markdown/images down to plain prose for text-to-speech.
export const toSpeech = (md = '') => md
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')       // images
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')      // links → text
  .replace(/[#>*_`~-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Prose → pieces no longer than `max`, broken after a sentence where it can. */
export const speechChunks = (text, max = SPEECH_CHUNK) => {
  const out = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
    if (cut < max * 0.5) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
};

// A book passed the old way (the whole publication, bodies included) → the
// shape the reader uses now.
const bookFrom = (params) => {
  if (params.book) return params.book;
  const p = params.publication;
  if (!p) return null;
  return { id: p.id, title: p.title, theme: p.theme, chapters: p.chapters || [] };
};

const ChapterReader = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const uid = currentUser?.id;
  const params = route.params || {};
  const pubId = params.id ?? params.publication?.id;

  const [book, setBook] = useState(() => bookFrom(params) || peekBook(uid, pubId));
  const chapters = book?.chapters || [];
  const [index, setIndex] = useState(params.index ?? 0);
  const [fontIdx, setFontIdx] = useState(1);
  const [tocOpen, setTocOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [progress, setProgress] = useState(0); // scroll fraction of the chapter
  const [view, setView] = useState({ status: 'loading', chapter: null, stale: false });
  const [reloadKey, setReloadKey] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);

  const scrollRef = useRef(null);
  const request = useRef(0);
  const pendingY = useRef(0);         // where to put the reader once the text is tall enough
  const saving = useRef(false);       // a user scroll (not ours) may be remembered
  const scrollTimer = useRef(null);
  const speechRun = useRef(0);        // the current reading-aloud, so stopping ends it
  const shownRef = useRef(false);     // this chapter's text is on screen
  const contentH = useRef(0);
  const viewportH = useRef(0);
  // Opened at the reader's place from another phone: a fraction of the
  // chapter, used once, when this phone has no place of its own for it.
  const startFrac = useRef(params.position > 0 ? { index: params.index ?? 0, frac: params.position } : null);

  const restorePlace = () => {
    if (!shownRef.current) return;
    const y = pendingY.current;
    if (y) {
      if (contentH.current < y) return;
      pendingY.current = 0;
      startFrac.current = null;
      scrollRef.current?.scrollTo({ y, animated: false });
      return;
    }
    const start = startFrac.current;
    const room = contentH.current - viewportH.current;
    if (start && start.index === indexRef.current && room > 0) {
      startFrac.current = null;
      scrollRef.current?.scrollTo({ y: Math.round(start.frac * room), animated: false });
    }
  };

  // ── Reading time ──
  // Counted while the reader is really reading: the app open, the chapter on
  // screen, and a scroll or tap in the last few minutes (a phone left open
  // on the table isn't reading). Noted every half minute, on a new chapter,
  // on leaving, and when the app goes to the background — and sent.
  const indexRef = useRef(index);
  const clock = useRef({ seconds: 0, furthest: 0, position: 0, lastTouch: Date.now() });
  const touch = () => { clock.current.lastTouch = Date.now(); };
  const commitReading = useCallback((i, send = true) => {
    const c = clock.current;
    if (!isAuthenticated || pubId == null) return;
    if (c.seconds > 0 || c.furthest > 0) {
      noteReading(pubId, { index: i, seconds: c.seconds, furthest: c.furthest, position: c.position });
    }
    c.seconds = 0;
    if (send) flushReading().catch(() => {});
  }, [isAuthenticated, pubId]);

  // Opened with only an id (a link, a restored screen): the contents first.
  useEffect(() => {
    if (book || pubId == null) return undefined;
    let alive = true;
    readBook(uid, pubId)
      .then((kept) => kept || fetchBook(uid, pubId))
      .then((b) => { if (alive && b) setBook(b); })
      .catch(() => { if (alive) setView({ status: 'failed', chapter: null, stale: false }); });
    return () => { alive = false; };
  }, [book, pubId, uid]);

  // The reading size the reader chose last time.
  useEffect(() => {
    AsyncStorage.getItem(FONT_KEY).then((v) => {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n < FONT_SIZES.length) setFontIdx(n);
    }).catch(() => {});
  }, []);

  // Author's reading look (background / text colour / font / size nudge).
  const wt = resolveWritingTheme(book?.theme);
  const wtFont = fontFamilyFor(wt.font);
  const light = isLightBg(wt.bg);
  const chrome = light ? '#1A1A1A' : colors.textPrimary;       // top-bar icons/title
  const subtleBorder = light ? 'rgba(0,0,0,0.12)' : colors.border;

  const entry = chapters[index] || null;
  const canPrev = index > 0;
  const canNext = index < chapters.length - 1;
  const scrollKey = (i) => `read:${pubId}:${chapters[i]?.id ?? i}`;

  // A chapter's body when the book page carried bodies (a server from before
  // chapters were served one at a time, or the old way of opening the reader).
  const fallbackFor = useCallback((i) => {
    const full = params.publication?.chapters?.[i] || peekBook(uid, pubId)?.chapters?.[i];
    return full && typeof full.body === 'string' ? full : null;
  }, [params.publication, uid, pubId]);

  const fetchInto = useCallback(async (i) => {
    const ch = chapters[i];
    try {
      return await loadChapter(pubId, i, ch, fallbackFor(i));
    } catch (err) {
      // A server without the one-chapter endpoint: the whole book, once.
      if (err?.status === 404 && ch) {
        const full = await fetchPublication(pubId);
        const f = full?.chapters?.[i];
        if (f && typeof f.body === 'string') return loadChapter(pubId, i, ch, f);
      }
      throw err;
    }
  }, [chapters, pubId, fallbackFor]);

  // An edit changes a chapter's version, not its id: both decide a reload.
  const chapterIds = chapters.map((c) => `${c.id}:${c.version ?? ''}`).join(',');

  // Load the chapter (kept → instant; else fetched and kept), then the next
  // one quietly, so turning the page doesn't wait.
  useEffect(() => {
    if (!book || !chapters.length) return undefined;
    const mine = ++request.current;
    saving.current = false;
    shownRef.current = false;
    contentH.current = 0;
    pendingY.current = 0;
    setProgress(0);
    setView((v) => ({ status: 'loading', chapter: v.chapter && v.index === index ? v.chapter : null, stale: false }));
    AsyncStorage.getItem(scrollKey(index))
      .then((y) => {
        if (mine !== request.current) return;
        pendingY.current = parseFloat(y) > 0 ? parseFloat(y) : 0;
        restorePlace();                      // the text may already be there
      })
      .catch(() => {});
    fetchInto(index)
      .then(({ chapter, stale }) => {
        if (mine !== request.current) return;
        shownRef.current = true;
        setView({ status: 'ready', chapter, stale, index });
        if (!stale && index + 1 < chapters.length) fetchInto(index + 1).catch(() => {});
      })
      .catch(() => {
        if (mine === request.current) setView({ status: 'failed', chapter: null, stale: false });
      });
    return undefined;
  }, [book, index, chapterIds, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember the chapter reached (signed in only), once the reader settles on it.
  useEffect(() => {
    if (!isAuthenticated || pubId == null || !book) return undefined;
    const h = setTimeout(() => saveReadingProgress(pubId, index).catch(() => {}), SAVE_PROGRESS_MS);
    return () => clearTimeout(h);
  }, [isAuthenticated, pubId, index, book]);

  // A new chapter: what was read of the last one is noted; this one starts fresh.
  useEffect(() => {
    indexRef.current = index;
    clock.current = { seconds: 0, furthest: 0, position: 0, lastTouch: Date.now() };
    return () => commitReading(index);
  }, [index, commitReading]);

  // The clock itself, and the half-minute / background notes.
  useEffect(() => {
    if (!isAuthenticated || pubId == null) return undefined;
    flushReading().catch(() => {});     // anything read while offline, now
    let sinceCommit = 0;
    const tick = setInterval(() => {
      const c = clock.current;
      // Not "=== 'active'": the state can be unknown for a moment at start.
      const reading = AppState.currentState !== 'background' && shownRef.current
        && Date.now() - c.lastTouch < IDLE_MS;
      if (reading) c.seconds += TICK_MS / 1000;
      sinceCommit += TICK_MS;
      if (sinceCommit >= COMMIT_MS) { sinceCommit = 0; commitReading(indexRef.current); }
    }, TICK_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') commitReading(indexRef.current);
      else touch();
    });
    return () => { clearInterval(tick); sub.remove(); };
  }, [isAuthenticated, pubId, commitReading]);

  const stopSpeech = useCallback(() => {
    speechRun.current += 1;
    if (SPEECH_OK) Speech.stop();
    setSpeaking(false);
  }, []);

  // Stop narration when leaving the screen or changing chapter.
  useEffect(() => () => { speechRun.current += 1; if (SPEECH_OK) Speech.stop(); clearTimeout(scrollTimer.current); }, []);
  useEffect(() => { stopSpeech(); }, [index, stopSpeech]);

  const onScroll = useCallback((e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const max = Math.max(1, contentSize.height - layoutMeasurement.height);
    const frac = Math.min(1, Math.max(0, contentOffset.y / max));
    setProgress(frac);
    if (shownRef.current) {
      clock.current.position = frac;
      clock.current.furthest = Math.max(clock.current.furthest, frac);
    }
    if (!saving.current) return;
    const key = scrollKey(index);
    const y = contentOffset.y;
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => AsyncStorage.setItem(key, String(y)).catch(() => {}), SAVE_SCROLL_MS);
  }, [index, chapterIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // The saved place, once the text (and its pictures) is tall enough to reach
  // it — whichever comes second, the saved place or the text, puts it there.
  const onContentSizeChange = useCallback((w, h) => {
    contentH.current = h;
    // A chapter short enough to fit on the screen is read once it's shown.
    if (shownRef.current && viewportH.current && h <= viewportH.current + 8) clock.current.furthest = 1;
    restorePlace();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next) => {
    setTocOpen(false);
    clearTimeout(scrollTimer.current);
    saving.current = false;          // our jump to the top isn't the reader's place
    setIndex(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const toggleListen = () => {
    if (!SPEECH_OK) return;
    if (speaking) { stopSpeech(); return; }
    const pieces = speechChunks(toSpeech(view.chapter?.body || ''));
    if (!pieces.length) return;
    const run = ++speechRun.current;
    setSpeaking(true);
    const say = (i) => {
      if (run !== speechRun.current) return;
      if (i >= pieces.length) { setSpeaking(false); return; }
      Speech.speak(pieces[i], {
        rate: 0.96,
        onDone: () => say(i + 1),
        onStopped: () => { if (run === speechRun.current) setSpeaking(false); },
        onError: () => { if (run === speechRun.current) setSpeaking(false); },
      });
    };
    say(0);
  };

  const cycleFont = () => setFontIdx((i) => {
    const n = (i + 1) % FONT_SIZES.length;
    AsyncStorage.setItem(FONT_KEY, String(n)).catch(() => {});
    return n;
  });

  // The chapter's text, drawn once per chapter / size — not on every scroll
  // event (the progress bar updates many times a second).
  const body = view.chapter?.body;
  const markdown = useMemo(() => (
    body == null ? null : (
      <Markdown
        style={markdownTheme(FONT_SIZES[fontIdx] + wt.scale, { color: wt.text, fontFamily: wtFont })}
        rules={markdownImageRule}
        onLinkPress={(url) => { Linking.openURL(url).catch(() => {}); return false; }}
      >
        {body || `_${t('reader.empty')}_`}
      </Markdown>
    )
  ), [body, fontIdx, wt.scale, wt.text, wtFont, t]);

  const title = view.chapter?.title || entry?.title || t('pubDetail.chapterN', { n: index + 1 });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: wt.bg }]} edges={['top']}>
      <View style={[styles.topBar, { borderBottomColor: subtleBorder }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={chrome} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: chrome }]} numberOfLines={1}>{book?.title}</Text>
        {SPEECH_OK && (
          <TouchableOpacity onPress={toggleListen} style={styles.iconBtn} hitSlop={8} disabled={view.status !== 'ready'}
            accessibilityRole="button" accessibilityLabel={t(speaking ? 'reader.stopListening' : 'reader.listen')}>
            <Ionicons name={speaking ? 'stop-circle' : 'volume-high-outline'} size={21} color={speaking ? colors.accent : chrome} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={cycleFont} style={styles.iconBtn} hitSlop={8}
          accessibilityRole="button" accessibilityLabel={t('reader.textSize')} testID="reader-font">
          <Ionicons name="text" size={20} color={chrome} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTocOpen(true)} style={styles.iconBtn} hitSlop={8} disabled={!chapters.length}
          accessibilityRole="button" accessibilityLabel={t('common.contents')}>
          <Ionicons name="list" size={22} color={chrome} />
        </TouchableOpacity>
        {isAuthenticated && !book?.is_owner && view.chapter?.id ? (
          <TouchableOpacity onPress={() => setReportOpen(true)} style={styles.iconBtn} hitSlop={8}
            accessibilityRole="button" accessibilityLabel={t('reader.reportChapter')} testID="reader-report">
            <Ionicons name="flag-outline" size={19} color={chrome} />
          </TouchableOpacity>
        ) : null}
      </View>

      {view.chapter?.id ? (
        <ReportModal
          visible={reportOpen}
          onClose={() => setReportOpen(false)}
          contentType="chapter"
          objectId={view.chapter.id}
        />
      ) : null}

      {view.chapter?.status === 'draft' ? (
        <View style={styles.staleBar}>
          <Ionicons name="eye-off-outline" size={14} color={chrome} />
          <Text style={[styles.staleText, { color: chrome }]}>{t('reader.draftChapter')}</Text>
        </View>
      ) : null}

      {/* Reading progress bar */}
      <View style={[styles.progressTrack, { backgroundColor: subtleBorder }]}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      {view.stale ? (
        <View style={styles.staleBar} testID="reader-stale">
          <Ionicons name="cloud-offline-outline" size={14} color={chrome} />
          <Text style={[styles.staleText, { color: chrome }]}>{t('reader.stale')}</Text>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={64}
        onScroll={onScroll}
        onScrollBeginDrag={() => { saving.current = true; pendingY.current = 0; startFrac.current = null; touch(); }}
        onTouchStart={touch}
        onContentSizeChange={onContentSizeChange}
        onLayout={(e) => { viewportH.current = e.nativeEvent.layout.height; }}
      >
        <View style={styles.page}>
          {chapters.length ? (
            <Text style={styles.chapterEyebrow}>
              {t('reader.chapterOf', { n: index + 1, total: chapters.length })}
            </Text>
          ) : null}
          <Text style={[styles.chapterTitle, { color: wt.text, fontFamily: wtFont }]}>{title}</Text>
          <View style={styles.rule} />

          {view.status === 'failed' ? (
            <View style={styles.failed}>
              <Ionicons name="cloud-offline-outline" size={40} color={light ? '#555' : colors.textMuted} />
              <Text style={[styles.failedText, { color: wt.text }]}>{t('reader.loadFailed')}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => setReloadKey((k) => k + 1)} testID="reader-retry">
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : markdown || <ProseSkeleton lines={12} />}

          {chapters.length > 1 ? (
            <View style={styles.nav}>
              <TouchableOpacity
                style={[styles.navBtn, !canPrev && styles.navBtnDisabled]}
                disabled={!canPrev}
                onPress={() => go(index - 1)}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <Ionicons name="chevron-back" size={18} color={canPrev ? colors.white : colors.textMuted} />
                <Text style={[styles.navBtnText, !canPrev && styles.navBtnTextDisabled]}>{t('common.previous')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.navBtn, !canNext && styles.navBtnDisabled]}
                disabled={!canNext}
                onPress={() => go(index + 1)}
                activeOpacity={0.85}
                accessibilityRole="button"
                testID="reader-next"
              >
                <Text style={[styles.navBtnText, !canNext && styles.navBtnTextDisabled]}>{t('common.next')}</Text>
                <Ionicons name="chevron-forward" size={18} color={canNext ? colors.white : colors.textMuted} />
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={{ height: spacing.xxl }} />
        </View>
      </ScrollView>

      {/* Table of contents */}
      <Modal visible={tocOpen} transparent animationType="fade" onRequestClose={() => setTocOpen(false)}>
        <Pressable style={styles.tocBackdrop} onPress={() => setTocOpen(false)}>
          <Pressable style={styles.tocCard}>
            <Text style={styles.tocTitle}>{t('common.contents')}</Text>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {chapters.map((c, i) => {
                const active = i === index;
                return (
                  <TouchableOpacity key={c.id ?? i} style={[styles.tocRow, active && styles.tocRowActive]} onPress={() => go(i)} activeOpacity={0.8}>
                    <Text style={[styles.tocNum, active && styles.tocActiveText]}>{i + 1}</Text>
                    <Text style={[styles.tocLabel, active && styles.tocActiveText]} numberOfLines={1}>{c.title || t('pubDetail.chapterN', { n: i + 1 })}</Text>
                    {active && <Ionicons name="bookmark" size={14} color={colors.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.label, color: colors.textPrimary, flex: 1, textAlign: 'center', fontWeight: '600' },
  iconBtn: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center' },

  progressTrack: { height: 2.5, width: '100%' },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  staleBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 5, opacity: 0.8 },
  staleText: { ...typography.caption },

  tocBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  tocCard: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md, ...shadows.lg },
  tocTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm, letterSpacing: 0.4 },
  tocRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  tocRowActive: { backgroundColor: colors.card },
  tocNum: { ...typography.label, color: colors.textMuted, fontWeight: '800', width: 22, textAlign: 'center' },
  tocLabel: { ...typography.body, color: colors.textSecondary, flex: 1 },
  tocActiveText: { color: colors.textPrimary, fontWeight: '700' },

  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  // A comfortable line length on tablets and landscape, not edge to edge.
  page: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  chapterEyebrow: { ...typography.caption, color: colors.primary, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  chapterTitle: { ...typography.h1, color: colors.textPrimary, marginTop: spacing.xs },
  rule: { width: 48, height: 3, borderRadius: 2, backgroundColor: colors.accent, marginTop: spacing.md, marginBottom: spacing.lg },

  failed: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  failedText: { ...typography.body, textAlign: 'center', opacity: 0.8 },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { ...typography.label, color: colors.white, fontWeight: '700' },

  nav: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.xl },
  navBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm + 2, ...shadows.sm,
  },
  navBtnDisabled: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  navBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  navBtnTextDisabled: { color: colors.textMuted },
});

export default ChapterReader;
