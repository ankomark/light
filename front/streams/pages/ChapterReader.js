import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Modal, Pressable, AppState, Share, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { setStatusBarStyle } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveReadingProgress, fetchPublication, askBookAi } from '../services/api';
import { loadChapter, peekBook, readBook, fetchBook } from '../services/publicationStore';
import { noteReading, flushReading } from '../services/readingTracker';
import { useBookHighlights, saveHighlight } from '../services/bookHighlights';
import { ProseSkeleton } from '../components/SkeletonLoader';
import ReportModal from '../components/ReportModal';
import ReaderSettingsSheet from '../components/ReaderSettingsSheet';
import BookPassageActions from '../components/BookPassageActions';
import BibleNoteSheet from '../components/BibleNoteSheet';
import AiAnswerSheet from '../components/AiAnswerSheet';
import HighlightCollectionSheet from '../components/HighlightCollectionSheet';
import ShareBookSheet from '../components/ShareBookSheet';
import { useAiEnabled } from '../services/bookAi';
import { HIGHLIGHT_WASH } from '../components/BibleVerseActions';
import { markdownTheme, markdownImageRule, resolveWritingTheme, fontFamilyFor, isLightBg } from '../utils/publications';
import { useReaderSettings, resolveReadingLook, SPEECH_RATES } from '../utils/readerSettings';
import { splitBlocks, splitFootnotes, plainText, quoteOf, findBlock } from '../utils/chapterBlocks';
import { confirmAction } from '../utils/adminConfirm';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

// expo-speech is a native module; on a dev client that hasn't been rebuilt since
// it was added it isn't present. Load it defensively so the reader still works
// (the Listen button just hides) instead of crashing on "native module" errors.
let Speech = null;
try { Speech = require('expo-speech'); } catch { Speech = null; }
const SPEECH_OK = !!(Speech && typeof Speech.speak === 'function');

const SAVE_SCROLL_MS = 400;
const SAVE_PROGRESS_MS = 1500;
const WORDS_PER_MIN = 200;
const TOP_BAR_H = 54;
const PROGRESS_H = 2.5;
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

/** How far through a book (0–1, by words) chapter `i` at `frac` is. */
export const bookFraction = (chapters, i, frac) => {
  const words = chapters.map((c) => Math.max(1, c.word_count || 0));
  const total = words.reduce((a, b) => a + b, 0);
  if (!total || i < 0 || i >= words.length) return 0;
  return Math.min(1, (words.slice(0, i).reduce((a, b) => a + b, 0) + frac * words[i]) / total);
};

// A book passed the old way (the whole publication, bodies included) → the
// shape the reader uses now.
const bookFrom = (params) => {
  if (params.book) return params.book;
  const p = params.publication;
  if (!p) return null;
  return { id: p.id, title: p.title, theme: p.theme, chapters: p.chapters || [] };
};

// One paragraph. Tap: the reading controls come and go. Long-press: its
// highlight / note / share tools. Memoised — a highlight or the progress bar
// changing doesn't redraw every paragraph.
const Block = memo(({ md, index, mdStyle, wash, selected, speaking, hasNote, onPress, onLongPress, onLayout, noteColor }) => (
  <Pressable
    onPress={onPress}
    onLongPress={() => onLongPress(index)}
    delayLongPress={350}
    onLayout={(e) => onLayout(index, e.nativeEvent.layout)}
    style={[styles.block, wash && { backgroundColor: wash }, selected && styles.blockSelected, speaking && styles.blockSpeaking]}
    accessibilityHint="Long-press to highlight or add a note"
    testID={`reader-block-${index}`}
  >
    <Markdown
      style={mdStyle}
      rules={markdownImageRule}
      onLinkPress={(url) => { Linking.openURL(url).catch(() => {}); return false; }}
    >
      {md}
    </Markdown>
    {hasNote ? <Ionicons name="document-text" size={14} color={noteColor} style={styles.noteMark} /> : null}
  </Pressable>
));

const ChapterReader = ({ route, navigation }) => {
  const { t, resolvedLanguage } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const aiOn = useAiEnabled();
  const insets = useSafeAreaInsets();
  // A narrow phone: the bar is all buttons (the chapter's title is on the page).
  const narrowBar = useWindowDimensions().width < 380;
  const uid = currentUser?.id;
  const params = route.params || {};
  const pubId = params.id ?? params.publication?.id;
  const settings = useReaderSettings();
  // A preview from the editor: the text passed in, nothing kept on the phone,
  // no reading time, progress or highlights recorded.
  const previewing = !!params.preview;
  const tracking = isAuthenticated && !previewing;

  const [book, setBook] = useState(() => bookFrom(params) || peekBook(uid, pubId));
  const chapters = book?.chapters || [];
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const initialIndex = () => {
    if (params.chapterId != null) {
      const i = (bookFrom(params) || peekBook(uid, pubId))?.chapters?.findIndex((c) => c.id === params.chapterId);
      if (i >= 0) return i;
    }
    return params.index ?? 0;
  };
  const [index, setIndex] = useState(initialIndex);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chromeOn, setChromeOn] = useState(true);
  const [speakingBlock, setSpeakingBlock] = useState(null);
  const [progress, setProgress] = useState(0); // scroll fraction of the chapter
  const [view, setView] = useState({ status: 'loading', chapter: null, stale: false });
  const [reloadKey, setReloadKey] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [selected, setSelected] = useState(null);   // a long-pressed paragraph
  const [noteOpen, setNoteOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [shareFor, setShareFor] = useState(null);           // a passage going to the feed
  const [aiAsk, setAiAsk] = useState(null);                 // { key, title, quote, ask } — the AI sheet

  const scrollRef = useRef(null);
  const request = useRef(0);
  const pendingY = useRef(0);         // where to put the reader once the text is tall enough
  const saving = useRef(false);       // a user scroll (not ours) may be remembered
  const scrollTimer = useRef(null);
  const speechRun = useRef(0);        // the current reading-aloud, so stopping ends it
  const listenNext = useRef(false);   // reading aloud carries on into the next chapter
  const shownRef = useRef(false);     // this chapter's text is on screen
  const contentH = useRef(0);
  const viewportH = useRef(0);
  const scrollY = useRef(0);
  const pageY = useRef(0);
  const blocksY = useRef(0);
  const blockLayout = useRef({});     // paragraph → { y, height } within the text
  // Opened at the reader's place from another phone: a fraction of the
  // chapter, used once, when this phone has no place of its own for it.
  const startFrac = useRef(params.position > 0 ? { index: params.index ?? 0, frac: params.position } : null);
  // Opened at a highlight (from the library): its paragraph, once.
  const startBlock = useRef(params.block != null ? { chapterId: params.chapterId, block: params.block } : null);

  const blockTop = (i) => pageY.current + blocksY.current + (blockLayout.current[i]?.y ?? 0);

  const restorePlace = () => {
    if (!shownRef.current) return;
    const sb = startBlock.current;
    // (Refs and the contents only: this runs from callbacks made once.)
    if (sb && (sb.chapterId == null || sb.chapterId === chaptersRef.current[indexRef.current]?.id)) {
      if (blockLayout.current[sb.block] == null) return;
      startBlock.current = null;
      pendingY.current = 0;
      startFrac.current = null;
      scrollRef.current?.scrollTo({ y: Math.max(0, blockTop(sb.block) - 24), animated: false });
      return;
    }
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
  // Counted while the reader is really reading (or listening): the app open,
  // the chapter on screen, and a scroll or tap in the last few minutes (a
  // phone left open on the table isn't reading). Noted every half minute, on
  // a new chapter, on leaving, and when the app goes to the background.
  const indexRef = useRef(index);
  const clock = useRef({ seconds: 0, furthest: 0, position: 0, lastTouch: Date.now() });
  const speakingRef = useRef(false);
  const touch = () => { clock.current.lastTouch = Date.now(); };
  const commitReading = useCallback((i, send = true) => {
    const c = clock.current;
    if (!tracking || pubId == null) return;
    if (c.seconds > 0 || c.furthest > 0) {
      noteReading(pubId, { index: i, seconds: c.seconds, furthest: c.furthest, position: c.position });
    }
    c.seconds = 0;
    if (send) flushReading().catch(() => {});
  }, [tracking, pubId]);

  // Opened with only an id (a link, a restored screen): the contents first.
  useEffect(() => {
    if (book || pubId == null) return undefined;
    let alive = true;
    readBook(uid, pubId)
      .then((kept) => kept || fetchBook(uid, pubId))
      .then((b) => {
        if (!alive || !b) return;
        setBook(b);
        if (params.chapterId != null) {
          const i = (b.chapters || []).findIndex((c) => c.id === params.chapterId);
          if (i >= 0) setIndex(i);
        }
      })
      .catch(() => { if (alive) setView({ status: 'failed', chapter: null, stale: false }); });
    return () => { alive = false; };
  }, [book, pubId, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // The look: the reader's own choices over the author's.
  const wt = resolveWritingTheme(book?.theme);
  const look = resolveReadingLook(settings, { bg: wt.bg, text: wt.text, fontFamily: fontFamilyFor(wt.font), scale: wt.scale });
  const light = isLightBg(look.bg);
  // The status bar reads on the page's colour (dark icons on Day / Sepia);
  // the app's light icons come back on leaving.
  useEffect(() => {
    setStatusBarStyle(light ? 'dark' : 'light');
    return () => setStatusBarStyle('light');
  }, [light]);
  const chrome = light ? '#1A1A1A' : colors.textPrimary;       // top-bar icons/title
  const subtleBorder = look.subtle || (light ? 'rgba(0,0,0,0.12)' : colors.border);

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
    if (previewing) return { chapter: { ...ch, body: ch?.body || '' }, stale: false };
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
    blockLayout.current = {};
    setSelected(null);
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
    if (!tracking || pubId == null || !book) return undefined;
    const h = setTimeout(() => saveReadingProgress(pubId, index).catch(() => {}), SAVE_PROGRESS_MS);
    return () => clearTimeout(h);
  }, [tracking, pubId, index, book]);

  // A new chapter: what was read of the last one is noted; this one starts fresh.
  useEffect(() => {
    indexRef.current = index;
    clock.current = { seconds: 0, furthest: 0, position: 0, lastTouch: Date.now() };
    return () => commitReading(index);
  }, [index, commitReading]);

  // The clock itself, and the half-minute / background notes.
  useEffect(() => {
    if (!tracking || pubId == null) return undefined;
    flushReading().catch(() => {});     // anything read while offline, now
    let sinceCommit = 0;
    const tick = setInterval(() => {
      const c = clock.current;
      // Not "=== 'active'": the state can be unknown for a moment at start.
      const reading = AppState.currentState !== 'background' && shownRef.current
        && (speakingRef.current || Date.now() - c.lastTouch < IDLE_MS);
      if (reading) c.seconds += TICK_MS / 1000;
      sinceCommit += TICK_MS;
      if (sinceCommit >= COMMIT_MS) { sinceCommit = 0; commitReading(indexRef.current); }
    }, TICK_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') commitReading(indexRef.current);
      else touch();
    });
    return () => { clearInterval(tick); sub.remove(); };
  }, [tracking, pubId, commitReading]);

  // ── The chapter as paragraphs, and the reader's marks on them ──
  const body = view.chapter?.body;
  // Footnotes: raised numbers in the text, the notes as a last paragraph —
  // after the others, so highlights keep their places.
  const blocks = useMemo(() => {
    if (!body) return [];
    const { body: text, notes } = splitFootnotes(body);
    const out = splitBlocks(text);
    if (notes.length) out.push(`---\n**${t('reader.notes')}**\n\n${notes.map((f) => `${f.n}. ${f.text}`).join('\n')}`);
    return out;
  }, [body, t]);
  const plainBlocks = useMemo(() => blocks.map(plainText), [blocks]);
  const allMarks = useBookHighlights(tracking ? pubId : null);
  const marks = useMemo(() => {
    const byBlock = {};
    const chId = view.chapter?.id;
    allMarks.filter((h) => h.chapter_id === chId).forEach((h) => {
      const at = findBlock(plainBlocks, h);
      if (at >= 0 && (!byBlock[at] || byBlock[at].at < h.at)) byBlock[at] = h;
    });
    return byBlock;
  }, [allMarks, plainBlocks, view.chapter?.id]);

  // ── Listening ──
  const stopSpeech = useCallback(() => {
    speechRun.current += 1;
    listenNext.current = false;
    speakingRef.current = false;
    if (SPEECH_OK) Speech.stop();
    setSpeakingBlock(null);
  }, []);

  // Stop narration when leaving the screen.
  useEffect(() => () => { speechRun.current += 1; if (SPEECH_OK) Speech.stop(); clearTimeout(scrollTimer.current); }, []);

  // Read aloud paragraph by paragraph from `from`, marking (and following)
  // the one being read; at the chapter's end, on into the next.
  const listenFrom = useCallback((from) => {
    if (!SPEECH_OK || !blocks.length) return;
    if (SPEECH_OK) Speech.stop();
    const run = ++speechRun.current;
    speakingRef.current = true;
    const rate = SPEECH_RATES[settings.speechRate] || 0.96;
    const sayBlock = (b) => {
      if (run !== speechRun.current) return;
      if (b >= blocks.length) {
        speakingRef.current = false;
        setSpeakingBlock(null);
        if (indexRef.current < chapters.length - 1) {
          listenNext.current = true;
          saving.current = false;
          setIndex(indexRef.current + 1);
          scrollRef.current?.scrollTo({ y: 0, animated: false });
        }
        return;
      }
      const pieces = speechChunks(plainBlocks[b] || '');
      if (!pieces.length) { sayBlock(b + 1); return; }
      setSpeakingBlock(b);
      if (blockLayout.current[b] != null) {
        scrollRef.current?.scrollTo({ y: Math.max(0, blockTop(b) - viewportH.current / 3), animated: true });
      }
      const sayPiece = (p) => {
        if (run !== speechRun.current) return;
        if (p >= pieces.length) { sayBlock(b + 1); return; }
        Speech.speak(pieces[p], {
          rate,
          onDone: () => sayPiece(p + 1),
          onStopped: () => { if (run === speechRun.current) { speakingRef.current = false; setSpeakingBlock(null); } },
          onError: () => { if (run === speechRun.current) { speakingRef.current = false; setSpeakingBlock(null); } },
        });
      };
      sayPiece(0);
    };
    sayBlock(Math.max(0, from));
  }, [blocks, plainBlocks, settings.speechRate, chapters.length]);

  // The next chapter arrived while listening: carry on from its start.
  useEffect(() => {
    if (view.status === 'ready' && listenNext.current && view.index === index) {
      listenNext.current = false;
      listenFrom(0);
    }
  }, [view, index, listenFrom]);

  // The first paragraph on screen — where listening starts.
  const firstVisibleBlock = () => {
    const top = scrollY.current;
    for (let i = 0; i < blocks.length; i += 1) {
      const l = blockLayout.current[i];
      if (l && blockTop(i) + l.height > top + 8) return i;
    }
    return 0;
  };

  const toggleListen = () => {
    if (!SPEECH_OK) return;
    if (speakingBlock != null || speakingRef.current) { stopSpeech(); return; }
    listenFrom(firstVisibleBlock());
  };

  // ── Scrolling ──
  const onScroll = useCallback((e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    scrollY.current = contentOffset.y;
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

  const onBlockLayout = useCallback((i, layout) => {
    blockLayout.current[i] = { y: layout.y, height: layout.height };
    if (startBlock.current && startBlock.current.block === i) restorePlace();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next) => {
    setTocOpen(false);
    clearTimeout(scrollTimer.current);
    saving.current = false;          // our jump to the top isn't the reader's place
    stopSpeech();
    setIndex(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const toggleChrome = useCallback(() => {
    touch();
    if (selected != null) { setSelected(null); return; }
    setChromeOn((on) => !on);
  }, [selected]);

  // ── Highlights and notes ──
  const onLongPress = useCallback(async (i) => {
    touch();
    if (previewing) return;                  // a preview: nothing to mark
    if (!isAuthenticated) {
      const ok = await confirmAction({
        title: t('reader.signInToHighlight'), confirmLabel: t('auth.login'), cancelLabel: t('common.cancel'),
      });
      if (ok) navigation.navigate('Login');
      return;
    }
    setSelected(i);
    setChromeOn(false);
  }, [isAuthenticated, previewing, navigation, t]);

  const selectedMark = selected != null ? marks[selected] : null;
  const selectedQuote = selected != null ? quoteOf(blocks[selected] || '') : '';

  const saveMark = (patch) => {
    if (selected == null || !view.chapter) return;
    saveHighlight(pubId, {
      client_id: selectedMark?.client_id,
      chapter_id: view.chapter.id,
      block: selected,
      quote: selectedQuote,
      color: selectedMark?.color || '',
      note: selectedMark?.note || '',
      collection: selectedMark?.collection || '',
      ...patch,
    });
  };
  const onColor = (c) => { saveMark({ color: c }); setSelected(null); };
  // A collection needs a highlight to hold: an unmarked paragraph is marked too.
  const onCollection = (name) => {
    saveMark({ collection: name, ...(name && !selectedMark?.color && !selectedMark?.note ? { color: 'yellow' } : {}) });
    setCollectOpen(false);
    setSelected(null);
  };

  // ── AI: explain / define a paragraph, summarise the chapter ──
  const lang = resolvedLanguage === 'sw' ? 'sw' : 'en';
  const aiAvailable = aiOn && isAuthenticated && !previewing && view.status === 'ready';
  const askAi = (kind, passage = '') => {
    const spec = { kind, chapter: index, passage, lang };
    setAiAsk({
      key: `book:${pubId}:${view.chapter?.id}:${view.chapter?.version ?? ''}:${kind}:${lang}:${passage}`,
      title: t(`ai.${kind}`),
      quote: kind === 'summary' ? '' : quoteOf(passage),
      ask: () => askBookAi(pubId, spec),
    });
    setSelected(null);
  };
  const onShare = () => {
    // A published book: to the feed as its card (or elsewhere from there).
    if (isAuthenticated && !previewing && book?.status !== 'draft' && view.chapter?.status !== 'draft' && view.chapter?.id) {
      setShareFor({ quote: selectedQuote, chapterId: view.chapter.id, chapterTitle: view.chapter.title || '', block: selected });
      setSelected(null);
      return;
    }
    const where = [book?.title, view.chapter?.title].filter(Boolean).join(' · ');
    Share.share({ message: `“${selectedQuote}”\n— ${where}` }).catch(() => {});
    setSelected(null);
  };

  // The chapter's paragraphs, drawn once per chapter / look / marks — not on
  // every scroll event (the progress bar updates many times a second).
  const mdStyle = useMemo(
    () => markdownTheme(look.size, { color: look.text, fontFamily: look.fontFamily, lineHeight: look.lineHeight }),
    [look.size, look.text, look.fontFamily, look.lineHeight],
  );
  const noteColor = light ? '#8A6D1F' : colors.accent;
  const text = useMemo(() => {
    if (body == null) return null;
    if (!blocks.length) return <Text style={[styles.empty, { color: look.text }]}>{t('reader.empty')}</Text>;
    return blocks.map((md, i) => (
      <Block
        key={i}
        md={md}
        index={i}
        mdStyle={mdStyle}
        wash={marks[i]?.color ? HIGHLIGHT_WASH[marks[i].color] : null}
        selected={selected === i}
        speaking={speakingBlock === i}
        hasNote={!!marks[i]?.note}
        noteColor={noteColor}
        onPress={toggleChrome}
        onLongPress={onLongPress}
        onLayout={onBlockLayout}
      />
    ));
  }, [body, blocks, mdStyle, marks, selected, speakingBlock, toggleChrome, onLongPress, onBlockLayout, noteColor, look.text, t]);

  const title = view.chapter?.title || entry?.title || t('pubDetail.chapterN', { n: index + 1 });
  const chapterWords = view.chapter?.word_count || entry?.word_count || 0;
  const minutesLeft = chapterWords ? Math.max(1, Math.round((chapterWords * (1 - progress)) / WORDS_PER_MIN)) : 0;
  const bookPct = chapters.length ? Math.round(bookFraction(chapters, index, progress) * 100) : 0;

  return (
    // Insets by hand: the tools float over the page (absolute), and absolute
    // children don't get a SafeAreaView's padding — they'd sit under the
    // status bar and the notch. The status bar reads on the page's colour.
    <SafeAreaView style={[styles.container, { backgroundColor: look.bg }]} edges={[]}>
      {/* Reading progress bar: always there, thin. */}
      <View style={[styles.progressTrack, { backgroundColor: subtleBorder, marginTop: insets.top }]}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, {
          paddingLeft: look.margin + (insets.left || 0), paddingRight: look.margin + (insets.right || 0),
          paddingTop: TOP_BAR_H + spacing.sm,
        }]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={64}
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          saving.current = true; pendingY.current = 0; startFrac.current = null; startBlock.current = null;
          touch();
          if (selected == null) setChromeOn(false);   // the text, not the tools, while reading
        }}
        onTouchStart={touch}
        onContentSizeChange={onContentSizeChange}
        onLayout={(e) => { viewportH.current = e.nativeEvent.layout.height; }}
      >
        <View style={styles.page} onLayout={(e) => { pageY.current = e.nativeEvent.layout.y; }}>
          {previewing ? (
            <View style={styles.staleBar} testID="reader-preview">
              <Ionicons name="eye-outline" size={14} color={chrome} />
              <Text style={[styles.staleText, { color: chrome }]}>{t('reader.previewing')}</Text>
            </View>
          ) : null}
          {view.stale ? (
            <View style={styles.staleBar} testID="reader-stale">
              <Ionicons name="cloud-offline-outline" size={14} color={chrome} />
              <Text style={[styles.staleText, { color: chrome }]}>{t('reader.stale')}</Text>
            </View>
          ) : null}
          {view.chapter?.status === 'draft' ? (
            <View style={styles.staleBar}>
              <Ionicons name="eye-off-outline" size={14} color={chrome} />
              <Text style={[styles.staleText, { color: chrome }]}>{t('reader.draftChapter')}</Text>
            </View>
          ) : null}
          {chapters.length ? (
            <Text style={styles.chapterEyebrow}>
              {t('reader.chapterOf', { n: index + 1, total: chapters.length })}
            </Text>
          ) : null}
          <Text style={[styles.chapterTitle, { color: look.text, fontFamily: look.fontFamily }]}>{title}</Text>
          <View style={styles.rule} />

          {view.status === 'failed' ? (
            <View style={styles.failed}>
              <Ionicons name="cloud-offline-outline" size={40} color={light ? '#555' : colors.textMuted} />
              <Text style={[styles.failedText, { color: look.text }]}>{t('reader.loadFailed')}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => setReloadKey((k) => k + 1)} testID="reader-retry">
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : text ? (
            <View onLayout={(e) => { blocksY.current = e.nativeEvent.layout.y; }}>{text}</View>
          ) : <ProseSkeleton lines={12} />}

          {/* The end of a chapter: what others made of it. */}
          {view.status === 'ready' && view.chapter?.status !== 'draft' && !previewing ? (
            <TouchableOpacity
              style={[styles.discussBtn, { borderColor: subtleBorder }]}
              onPress={() => navigation.navigate('ChapterDiscussion', {
                id: pubId, index, chapterTitle: title, isBookAuthor: !!book?.is_owner,
              })}
              accessibilityRole="button"
              testID="reader-discuss"
            >
              <Ionicons name="chatbubbles-outline" size={18} color={look.text} />
              <Text style={[styles.discussText, { color: look.text }]}>
                {entry?.comment_count ? t('reader.discussCount', { n: entry.comment_count }) : t('reader.discuss')}
              </Text>
            </TouchableOpacity>
          ) : null}

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
          <View style={{ height: spacing.xxl + insets.bottom }} />
        </View>
      </ScrollView>

      {/* The tools: over the page, gone while reading, back with a tap. */}
      {chromeOn ? (
        <>
          <View style={[styles.topBar, {
            top: insets.top + PROGRESS_H, backgroundColor: look.bg, borderBottomColor: subtleBorder,
            paddingLeft: spacing.md + (insets.left || 0), paddingRight: spacing.md + (insets.right || 0),
          }]} testID="reader-chrome">
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
              accessibilityRole="button" accessibilityLabel={t('common.back')}>
              <Ionicons name="arrow-back" size={22} color={chrome} />
            </TouchableOpacity>
            {narrowBar ? <View style={styles.flex} /> : (
              <Text style={[styles.topTitle, { color: chrome }]} numberOfLines={1}>{book?.title}</Text>
            )}
            {SPEECH_OK && (
              <TouchableOpacity onPress={toggleListen} style={styles.iconBtn} hitSlop={8} disabled={view.status !== 'ready'}
                accessibilityRole="button" accessibilityLabel={t(speakingBlock != null ? 'reader.stopListening' : 'reader.listen')}
                testID="reader-listen">
                <Ionicons name={speakingBlock != null ? 'stop-circle' : 'volume-high-outline'} size={21}
                  color={speakingBlock != null ? colors.accent : chrome} />
              </TouchableOpacity>
            )}
            {aiAvailable ? (
              <TouchableOpacity onPress={() => askAi('summary')} style={styles.iconBtn} hitSlop={8}
                accessibilityRole="button" accessibilityLabel={t('ai.summary')} testID="reader-summary">
                <Ionicons name="sparkles-outline" size={20} color={chrome} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => setSettingsOpen(true)} style={styles.iconBtn} hitSlop={8}
              accessibilityRole="button" accessibilityLabel={t('reader.settings')} testID="reader-font">
              <Text style={[styles.aa, { color: chrome }]}>Aa</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setTocOpen(true)} style={styles.iconBtn} hitSlop={8} disabled={!chapters.length}
              accessibilityRole="button" accessibilityLabel={t('common.contents')}>
              <Ionicons name="list" size={22} color={chrome} />
            </TouchableOpacity>
            {tracking && !book?.is_owner && view.chapter?.id ? (
              <TouchableOpacity onPress={() => setReportOpen(true)} style={styles.iconBtn} hitSlop={8}
                accessibilityRole="button" accessibilityLabel={t('reader.reportChapter')} testID="reader-report">
                <Ionicons name="flag-outline" size={19} color={chrome} />
              </TouchableOpacity>
            ) : null}
          </View>
          {view.status === 'ready' && selected == null ? (
            <View style={[styles.footer, { backgroundColor: look.bg, borderTopColor: subtleBorder, paddingBottom: spacing.xs + insets.bottom }]}
              testID="reader-footer">
              <Text style={[styles.footerText, { color: chrome }]} numberOfLines={1}>
                {[
                  minutesLeft ? t('reader.minutesLeft', { n: minutesLeft }) : null,
                  chapters.length ? t('reader.bookPercent', { n: bookPct }) : null,
                ].filter(Boolean).join('  ·  ')}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}

      {selected != null ? (
        <BookPassageActions
          quote={selectedQuote}
          color={selectedMark?.color || ''}
          hasNote={!!selectedMark?.note}
          onColor={onColor}
          onNote={() => setNoteOpen(true)}
          onShare={onShare}
          collection={selectedMark?.collection || ''}
          onCollect={() => setCollectOpen(true)}
          onExplain={aiAvailable ? () => askAi('explain', plainBlocks[selected] || '') : undefined}
          onDefine={aiAvailable ? () => askAi('define', plainBlocks[selected] || '') : undefined}
          onClose={() => setSelected(null)}
          bottom={insets.bottom}
        />
      ) : null}
      {selected != null ? (
        <BibleNoteSheet
          visible={noteOpen}
          reference={title}
          verseText={selectedQuote}
          initialNote={selectedMark?.note || ''}
          onSave={(note) => { saveMark({ note }); setNoteOpen(false); setSelected(null); }}
          onDelete={() => { saveMark({ note: '' }); setNoteOpen(false); setSelected(null); }}
          onClose={() => setNoteOpen(false)}
        />
      ) : null}
      {selected != null ? (
        <HighlightCollectionSheet
          visible={collectOpen}
          current={selectedMark?.collection || ''}
          onPick={onCollection}
          onClose={() => setCollectOpen(false)}
        />
      ) : null}
      <ShareBookSheet
        visible={!!shareFor}
        onClose={() => setShareFor(null)}
        book={{ id: pubId, title: book?.title }}
        quote={shareFor?.quote}
        chapterId={shareFor?.chapterId}
        chapterTitle={shareFor?.chapterTitle}
        block={shareFor?.block}
      />
      <AiAnswerSheet
        visible={!!aiAsk}
        onClose={() => setAiAsk(null)}
        title={aiAsk?.title}
        quote={aiAsk?.quote}
        requestKey={aiAsk?.key}
        ask={aiAsk?.ask}
      />

      <ReaderSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        authorLook={{ bg: wt.bg, text: wt.text }}
        showSpeech={SPEECH_OK}
      />

      {view.chapter?.id ? (
        <ReportModal
          visible={reportOpen}
          onClose={() => setReportOpen(false)}
          contentType="chapter"
          objectId={view.chapter.id}
        />
      ) : null}

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
  flex: { flex: 1 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, height: TOP_BAR_H,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.label, color: colors.textPrimary, flex: 1, textAlign: 'center', fontWeight: '600' },
  iconBtn: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  aa: { fontSize: 17, fontWeight: '700' },

  progressTrack: { height: PROGRESS_H, width: '100%' },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  staleBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 5, opacity: 0.8 },
  staleText: { ...typography.caption },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingTop: spacing.xs, alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerText: { ...typography.caption, opacity: 0.75 },

  tocBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  tocCard: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md, ...shadows.lg },
  tocTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm, letterSpacing: 0.4 },
  tocRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  tocRowActive: { backgroundColor: colors.card },
  tocNum: { ...typography.label, color: colors.textMuted, fontWeight: '800', width: 22, textAlign: 'center' },
  tocLabel: { ...typography.body, color: colors.textSecondary, flex: 1 },
  tocActiveText: { color: colors.textPrimary, fontWeight: '700' },

  content: { paddingTop: spacing.lg },
  // A comfortable line length on tablets and landscape, not edge to edge.
  page: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  chapterEyebrow: { ...typography.caption, color: colors.primary, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  chapterTitle: { ...typography.h1, color: colors.textPrimary, marginTop: spacing.xs },
  rule: { width: 48, height: 3, borderRadius: 2, backgroundColor: colors.accent, marginTop: spacing.md, marginBottom: spacing.lg },

  block: { borderRadius: 6, marginHorizontal: -6, paddingHorizontal: 6 },
  blockSelected: { borderWidth: 1.5, borderColor: colors.accent, borderStyle: 'dashed' },
  blockSpeaking: { backgroundColor: 'rgba(244,162,97,0.14)' },
  noteMark: { position: 'absolute', right: -2, top: 2 },
  empty: { ...typography.body, fontStyle: 'italic', opacity: 0.7 },

  failed: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  failedText: { ...typography.body, textAlign: 'center', opacity: 0.8 },
  retryBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { ...typography.label, color: colors.white, fontWeight: '700' },

  discussBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    marginTop: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1,
  },
  discussText: { ...typography.label, fontWeight: '700', opacity: 0.85 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.md },
  navBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm + 2, ...shadows.sm,
  },
  navBtnDisabled: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  navBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  navBtnTextDisabled: { color: colors.textMuted },
});

export default ChapterReader;
