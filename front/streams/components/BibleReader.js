import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, FlatList,
  StyleSheet, ActivityIndicator, Linking, Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute } from '@react-navigation/native';
import useGridColumns from '../utils/useGridColumns';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import {
  BIBLE_BOOKS, BIBLE_LANGUAGES, OT_COUNT, DEFAULT_BIBLE_VERSION, getBibleVersion,
  webChapterUrl, staysInReader, styleWebChapter,
} from '../utils/bibleVersions';
import { fetchBibleBooks, fetchBibleChapter, fetchWebChapterPage } from '../services/bible';
import {
  useBibleLibrary, chapterMarks, findFavorite, findNote, formatRef,
  toggleFavorite, setHighlight, saveNote, toggleBookmark, recordReading,
} from '../services/bibleLibrary';
import BibleVerseActions, { HIGHLIGHT_WASH } from './BibleVerseActions';
import BibleNoteSheet from './BibleNoteSheet';

// Book search ignores case and accents ("gĩkũyũ" finds "Gikuyu").
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Jesus's words, as red-letter Bibles print them (a red that reads on the dark page).
const JESUS_RED = '#FF7A7A';

// A `web` version's page (eBible's own, for Ekegusii) dressed like our reader.
// eBible's stylesheet is made for a white page — black text, navy and blue
// notes, a yellow footnote pop-up — so rather than chase its classes one by
// one, every colour and size on the page is ours first (the `body *` rule),
// then our accents go back on with more specific rules. Its chapter arrows
// are hidden (Previous / Next are ours); its copyright notice stays.
const webReaderCss = (size = 18) => `
  html, body { background: transparent !important; margin: 0 !important; padding: 0 !important; }
  body { color: ${colors.textPrimary} !important; font-size: ${size}px !important; line-height: 1.75 !important;
         font-family: -apple-system, Roboto, 'Segoe UI', sans-serif !important; -webkit-text-size-adjust: 100%; }
  body * { color: inherit !important; background: transparent !important; border-color: rgba(255,255,255,0.12) !important;
           font-family: inherit !important; font-size: inherit !important; text-shadow: none !important; }
  body a, body a:link, body a:visited { text-decoration: none !important; }

  body .tnav, body .chapterlabel, body hr { display: none !important; }
  body .main { margin: 0 !important; padding: 0 0 8px !important; max-width: none !important; }
  body .p, body .m, body .q, body .q1, body .q2, body .pi, body .li, body .ip, body .im { margin: 0 0 12px !important; text-indent: 0 !important; }
  /* Poetry: a verse's lines together; stanzas apart (eBible's .b is the gap). */
  body .q, body .q1, body .q2, body .q3 { margin: 0 0 2px !important; }
  body .q2, body .q3 { padding-left: 1.2em !important; }
  body .b { margin: 0 0 12px !important; height: 0 !important; }

  /* Headings, book titles, Psalm titles, speakers: the accent. */
  body .s, body .s1, body .s2, body .s3, body .ms, body .ms2, body .mr, body .d, body .r, body .sp,
  body .is, body .is1, body .is2, body .iot, body .mt, body .mt1, body .mt2, body .mt3, body .imt, body .imt1, body .imt2 {
    color: ${colors.accent} !important; font-weight: 800 !important; text-align: left !important; text-indent: 0 !important;
    margin: 18px 0 8px !important; }
  body .s, body .s1, body .s2, body .ms, body .d, body .r, body .sp, body .iot { font-size: 16px !important; }
  body .mt, body .mt1, body .imt, body .imt1 { font-size: 22px !important; }
  body .mt2, body .imt2, body .is, body .is1 { font-size: 18px !important; }
  body .r, body .d { font-style: italic !important; font-weight: 600 !important; }

  /* Verse numbers and footnote marks: the app's blue, small. */
  body .verse { color: ${colors.primary} !important; font-weight: 800 !important; font-size: 13px !important; }
  body .notemark, body a.notemark { color: ${colors.primary} !important; font-size: 12px !important; }
  body .wj { color: #FF7A7A !important; }

  /* The book's introduction outline, and notes: quieter. */
  body .io, body .io1, body .io2, body .ior { color: ${colors.textSecondary} !important; font-size: 16px !important; }
  body .io2 { padding-left: 1.2em !important; }
  body .footnote, body .footnote *, body .f, body .x, body .fr, body .fk, body .ft, body .xo, body .xt, body .notebackref {
    color: ${colors.textSecondary} !important; font-size: 13px !important; line-height: 1.5 !important; }
  body .footnote { margin-top: 20px !important; }
  body .f, body .x { margin: 0 0 8px !important; }
  body .copyright, body .copyright * { color: ${colors.textSecondary} !important; font-size: 12px !important; }

  /* A tapped footnote: a dark card, not eBible's yellow box. */
  body .popup, body .crpopup {
    background: #13233B !important; color: ${colors.textPrimary} !important; font-size: 14px !important; line-height: 1.5 !important;
    border: 1px solid rgba(255,255,255,0.18) !important; border-radius: 10px !important; padding: 10px 12px !important;
    width: 14em !important; z-index: 10 !important; }
  body .popup *, body .crpopup * { color: ${colors.textPrimary} !important; font-size: 14px !important; }
`;
// Reading sizes the A / A buttons step through.
const TEXT_SIZES = [16, 18, 20, 22, 24, 26];
const DEFAULT_TEXT_SIZE = 18;

// A light tap under the finger where the phone has it; never an error.
const tick = () => { try { Haptics.selectionAsync?.()?.catch?.(() => {}); } catch { /* no haptics */ } };

const verseText = (item) => item.parts.map((p) => p.text).join('').replace(/\s+/g, ' ').trim();

// Every version, in language order, for the row of cards at the top.
const ALL_VERSIONS = BIBLE_LANGUAGES.flatMap((l) => l.versions.map((v) => ({ ...v, language: l.name })));

const BibleReader = () => {
  const { t } = useI18n();
  const { preferences, setPreference } = usePreferences();
  // Each step is its own screen of the 'bible' route, so back — the swipe,
  // the phone's button, our arrow — goes up one step at a time instead of
  // leaving the Bible:  {} the books · { bookId } its chapters ·
  // { bookId, chapter } reading. Previous / Next swap the chapter in place.
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const { bookId = null, chapter: selectedChapter = null } = params;
  // Opened from My Bible (or continue reading) at a verse: it's shown and flashed.
  const targetVerse = params.verse ? Number(params.verse) : null;
  const insets = useSafeAreaInsets();
  const lib = useBibleLibrary();
  const textSize = TEXT_SIZES.includes(preferences[PREF_KEYS.bibleTextSize])
    ? preferences[PREF_KEYS.bibleTextSize] : DEFAULT_TEXT_SIZE;
  const versionId = getBibleVersion(preferences[PREF_KEYS.bibleVersion] || DEFAULT_BIBLE_VERSION).id;
  const version = getBibleVersion(versionId);

  // Responsive chapter chips: 5 per row on a phone, more on tablets / landscape.
  const { cols: chipCols, tileSize: chipSize } = useGridColumns({
    target: 64, min: 5, max: 10, horizontalPadding: spacing.md * 2, gap: spacing.sm,
  });
  // Responsive book cards: 2 per row on a phone, more on tablets / landscape.
  const { tileSize: bookWidth } = useGridColumns({
    target: 165, min: 2, max: 5, horizontalPadding: spacing.md * 2, gap: spacing.sm,
  });
  // The version's books, named in its language (English names until they load).
  const [books, setBooks] = useState(BIBLE_BOOKS);
  const [items, setItems] = useState([]);           // headings and verses of the chapter
  const selectedBook = bookId
    ? books.find((b) => b.id === bookId) || BIBLE_BOOKS.find((b) => b.id === bookId) || null
    : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [bookQuery, setBookQuery] = useState('');
  const request = useRef(0);                        // only the latest load may land
  // A `web` version's chapter page: fetched, our style built in, then shown.
  const [webState, setWebState] = useState('loading');
  const [webKey, setWebKey] = useState(0);
  const [webPage, setWebPage] = useState(null);     // { url, html } — eBible's, unstyled

  // Verses the reader has tapped (for highlight / favourite / note / share).
  const [selected, setSelected] = useState([]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [flashVerse, setFlashVerse] = useState(null);
  const scrollRef = useRef(null);
  const panelY = useRef(0);
  const shownTarget = useRef(null);
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  useEffect(() => {
    setSelected([]);
    setNoteOpen(false);
  }, [bookId, selectedChapter, versionId]);

  // The version cards: scrolled so the chosen one is in view when the Bible
  // opens (and when the saved choice loads a moment later) — not after a
  // tap, where the card is already under the finger and a jump would jar.
  const cardsRef = useRef(null);
  const cardX = useRef({});
  const scrolledTo = useRef(null);
  const tapped = useRef(false);
  const showChosenCard = useCallback((animated) => {
    const x = cardX.current[versionId];
    if (x == null || scrolledTo.current === versionId) return;
    scrolledTo.current = versionId;
    if (tapped.current) { tapped.current = false; return; }
    cardsRef.current?.scrollTo?.({ x: Math.max(0, x - spacing.md), animated });
  }, [versionId]);
  useEffect(() => { showChosenCard(true); }, [showChosenCard]);

  useEffect(() => {
    let alive = true;
    fetchBibleBooks(versionId)
      .then((list) => { if (alive) setBooks(list); })
      .catch(() => { if (alive) setBooks(BIBLE_BOOKS); });
    return () => { alive = false; };
  }, [versionId]);

  const fetchChapter = useCallback(async (book, chapter, vid = versionId) => {
    const mine = ++request.current;
    setError(null);
    setItems([]);
    if (getBibleVersion(vid).web) {
      // eBible's page loads in the reader itself (see renderWebChapter).
      setLoading(false);
      setWebState('loading');
      return;
    }
    setLoading(true);
    try {
      const data = await fetchBibleChapter(vid, book.id, chapter);
      if (mine === request.current) {
        setItems(data.items);
        recordReading({ bookId: book.id, bookName: book.name || book.id, chapter, versionId: vid });
      }
    } catch {
      if (mine === request.current) setError(t('bible.loadFailed'));
    } finally {
      if (mine === request.current) setLoading(false);
    }
  }, [t, versionId]);

  // The reading step loads its chapter — again when the version changes, so
  // the same chapter comes up in the new one.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!bookId || !selectedChapter) return;
    fetchChapter({ id: bookId, name: selectedBook?.name }, selectedChapter, versionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, selectedChapter, versionId, reloadKey]);

  const webUrl = version.web && selectedBook && selectedChapter
    ? webChapterUrl(version, selectedBook.id, selectedChapter) : null;
  useEffect(() => {
    if (!webUrl) return undefined;
    let alive = true;
    setWebState('loading');
    setWebPage(null);
    fetchWebChapterPage(webUrl)
      .then((html) => { if (alive) setWebPage({ url: webUrl, html }); })
      .catch(() => { if (alive) setWebState('failed'); });
    return () => { alive = false; };
  }, [webUrl, webKey]);

  const styledWebHtml = useMemo(
    () => (webPage ? styleWebChapter(webPage.html, webReaderCss(textSize), webPage.url) : null),
    [webPage, textSize],
  );

  // ── Reading tools ──
  const changeSize = (step) => {
    const i = TEXT_SIZES.indexOf(textSize);
    const next = TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, i + step))];
    if (next !== textSize) setPreference(PREF_KEYS.bibleTextSize, next);
  };
  const bookmarked = !!(bookId && lib.bookmarks.some((b) => b.bookId === bookId && Number(b.chapter) === Number(selectedChapter)));
  const onBookmark = () => {
    tick();
    toggleBookmark({ bookId, bookName: selectedBook?.name || bookId, chapter: selectedChapter, versionId });
  };

  // ── Selected verses ──
  const marks = useMemo(
    () => (bookId && selectedChapter ? chapterMarks(lib, bookId, selectedChapter) : { highlight: {}, favorite: new Set(), notes: {} }),
    [lib, bookId, selectedChapter],
  );
  const verseItems = useMemo(() => items.filter((i) => i.type === 'verse'), [items]);
  const toggleVerse = (n) => {
    tick();
    setSelected((sel) => (sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n].sort((a, b) => a - b)));
  };
  const passage = useMemo(() => {
    if (!selected.length || !selectedBook) return null;
    const chosen = verseItems.filter((v) => selected.includes(v.number));
    const text = chosen.length === 1
      ? verseText(chosen[0])
      : chosen.map((v) => `${v.number} ${verseText(v)}`).join(' ');
    return {
      bookId, bookName: selectedBook.name, chapter: selectedChapter, verses: selected, text, versionId,
    };
  }, [selected, verseItems, selectedBook, bookId, selectedChapter, versionId]);
  const reference = passage ? formatRef(passage.bookName, passage.chapter, passage.verses) : '';
  const sameColor = selected.length && selected.every((n) => marks.highlight[n] && marks.highlight[n] === marks.highlight[selected[0]])
    ? marks.highlight[selected[0]] : null;
  const favorite = passage ? findFavorite(lib, passage) : null;
  const note = passage ? findNote(lib, passage) : null;
  const clearSelection = () => { setSelected([]); setNoteOpen(false); };

  const onHighlight = (color) => {
    const byNumber = new Map(verseItems.map((v) => [v.number, v]));
    setHighlight(selected.map((n) => ({
      bookId, bookName: selectedBook.name, chapter: selectedChapter, verse: n,
      text: byNumber.has(n) ? verseText(byNumber.get(n)) : '', versionId,
    })), color);
    clearSelection();
  };
  const onFavorite = () => { tick(); toggleFavorite(passage); clearSelection(); };
  const onShare = () => {
    const message = `“${passage.text}”\n— ${reference} (${version.abbr})`;
    Share.share({ message }).catch(() => {});
    clearSelection();
  };
  const onSaveNote = (text) => { saveNote(passage, text); clearSelection(); };
  const onDeleteNote = () => { saveNote(passage, ''); clearSelection(); };
  const openNote = (n) => { setSelected(n.verses); setNoteOpen(true); };

  // Opened at a verse: scroll to it once it's laid out, and flash it.
  const onVerseLayout = (n, y) => {
    if (n !== targetVerse) return;
    const key = `${bookId}.${selectedChapter}.${n}`;
    if (shownTarget.current === key) return;
    shownTarget.current = key;
    scrollRef.current?.scrollTo?.({ y: Math.max(0, panelY.current + y - 24), animated: true });
    setFlashVerse(n);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashVerse((f) => (f === n ? null : f)), 2200);
  };

  const readerTools = (
    <View style={styles.readerTools}>
      <View style={styles.sizeBtns}>
        <TouchableOpacity onPress={() => changeSize(-1)} disabled={textSize === TEXT_SIZES[0]} hitSlop={6}
          accessibilityRole="button" accessibilityLabel={t('bible.textSmaller')} testID="bible-text-smaller">
          <Text style={[styles.sizeA, styles.sizeASmall, textSize === TEXT_SIZES[0] && styles.sizeADisabled]}>A</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => changeSize(1)} disabled={textSize === TEXT_SIZES[TEXT_SIZES.length - 1]} hitSlop={6}
          accessibilityRole="button" accessibilityLabel={t('bible.textLarger')} testID="bible-text-larger">
          <Text style={[styles.sizeA, styles.sizeALarge, textSize === TEXT_SIZES[TEXT_SIZES.length - 1] && styles.sizeADisabled]}>A</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={onBookmark} hitSlop={8} accessibilityRole="button"
        accessibilityState={{ selected: bookmarked }}
        accessibilityLabel={t(bookmarked ? 'bible.removeBookmark' : 'bible.bookmark')} testID="bible-bookmark">
        <Ionicons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={22} color={bookmarked ? colors.accent : colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );

  const chooseVersion = (v) => {
    if (v.id === versionId) return;
    tapped.current = true;
    setPreference(PREF_KEYS.bibleVersion, v.id);   // the reading step reloads in it
  };

  const handleBookSelect = (book) => navigation.push('bible', { bookId: book.id });
  const openChapter = (n) => navigation.push('bible', { bookId, chapter: n });
  // Previous / Next: in place, so back still leads to the chapters. setParams
  // merges, so the verse this was opened at is dropped — else the next
  // chapter would jump to and flash that same verse number.
  const turnTo = (n) => navigation.setParams({ chapter: n, verse: undefined });

  const canPrev = selectedChapter > 1;
  const canNext = selectedBook && selectedChapter < selectedBook.chapters;

  const filteredBooks = useMemo(() => {
    const q = fold(bookQuery.trim());
    if (!q) return books;
    return books.filter((b) => fold(b.name).includes(q) || fold(b.english).includes(q));
  }, [bookQuery, books]);

  // ── Books view ──────────────────────────────────────────────────────────
  const renderBookCard = (book) => (
    <TouchableOpacity
      key={book.id}
      style={[styles.bookCard, { width: bookWidth }]}
      onPress={() => handleBookSelect(book)}
      activeOpacity={0.85}
    >
      <Text style={styles.bookName} numberOfLines={1}>{book.name}</Text>
      <Text style={styles.bookMeta}>{book.chapters} {book.chapters === 1 ? 'chapter' : 'chapters'}</Text>
    </TouchableOpacity>
  );

  const renderTestamentSection = (title, list) => {
    if (list.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.bookGrid}>{list.map(renderBookCard)}</View>
      </View>
    );
  };

  const last = lib.history[0];
  const continueReading = () => {
    const known = getBibleVersion(last.versionId);
    if (known.id === last.versionId && last.versionId !== versionId) setPreference(PREF_KEYS.bibleVersion, last.versionId);
    navigation.push('bible', { bookId: last.bookId, chapter: last.chapter });
  };
  const shelf = [
    { tab: 'favorites', icon: 'heart', label: t('bible.tab.favorites'), count: lib.favorites.length, tint: '#FF4D6D' },
    { tab: 'highlights', icon: 'color-fill', label: t('bible.tab.highlights'), count: Object.keys(lib.highlights).length, tint: '#FFD60A' },
    { tab: 'notes', icon: 'document-text', label: t('bible.tab.notes'), count: lib.notes.length, tint: colors.primary },
    { tab: 'bookmarks', icon: 'bookmark', label: t('bible.tab.bookmarks'), count: lib.bookmarks.length, tint: colors.accent },
    { tab: 'history', icon: 'time', label: t('bible.tab.history'), count: lib.history.length, tint: colors.textSecondary },
  ];

  const renderBooks = () => {
    const ot = filteredBooks.filter((b) => b.order <= OT_COUNT);
    const nt = filteredBooks.filter((b) => b.order > OT_COUNT);
    return (
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {last && !bookQuery ? (
          <TouchableOpacity style={styles.continueCard} onPress={continueReading} activeOpacity={0.85}
            accessibilityRole="button" testID="bible-continue">
            <View style={styles.continueIcon}><Ionicons name="book" size={20} color={colors.white} /></View>
            <View style={styles.continueText}>
              <Text style={styles.continueLabel}>{t('bible.continueReading')}</Text>
              <Text style={styles.continueRef} numberOfLines={1}>
                {`${last.bookName} ${last.chapter}`}
                <Text style={styles.continueVersion}>{`  ·  ${getBibleVersion(last.versionId).abbr}`}</Text>
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}

        {/* My Bible: what the reader has kept. */}
        {!bookQuery ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {shelf.map((s) => (
              <TouchableOpacity key={s.tab} style={styles.shelfItem}
                onPress={() => navigation.navigate('BibleLibrary', { tab: s.tab })}
                accessibilityRole="button" accessibilityLabel={`${s.label}, ${s.count}`} testID={`bible-shelf-${s.tab}`}>
                <Ionicons name={s.icon} size={18} color={s.tint} />
                <Text style={styles.shelfLabel}>{s.label}</Text>
                {s.count ? <Text style={styles.shelfCount}>{s.count}</Text> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.placeholder} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('bible.searchPlaceholder')}
            placeholderTextColor={colors.placeholder}
            value={bookQuery}
            onChangeText={setBookQuery}
            autoCorrect={false}
            returnKeyType="search"
          />
          {bookQuery.length > 0 && (
            <TouchableOpacity onPress={() => setBookQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {filteredBooks.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="book-outline" size={44} color={colors.textMuted} />
            <Text style={styles.emptyText}>No book matches “{bookQuery}”.</Text>
          </View>
        ) : (
          <>
            {renderTestamentSection('Old Testament', ot)}
            {renderTestamentSection('New Testament', nt)}
          </>
        )}
        <View style={{ height: spacing.xl }} />
      </ScrollView>
    );
  };

  // ── Chapters view ───────────────────────────────────────────────────────
  const renderChapters = () => {
    const chapters = Array.from({ length: selectedBook.chapters }, (_, i) => i + 1);
    return (
      <FlatList
        data={chapters}
        keyExtractor={(c) => `ch_${c}`}
        key={`chips-${chipCols}`}
        numColumns={chipCols}
        columnWrapperStyle={styles.chipRow}
        contentContainerStyle={styles.chipGrid}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<Text style={styles.pickPrompt}>{t('bible.selectChapter')}</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.chip, { width: chipSize, height: chipSize }]}
            onPress={() => openChapter(item)}
            activeOpacity={0.8}
          >
            <Text style={styles.chipText}>{item}</Text>
          </TouchableOpacity>
        )}
      />
    );
  };

  const chapterNav = (
    <View style={styles.chapterNav}>
      <TouchableOpacity
        style={[styles.navBtn, !canPrev && styles.navBtnDisabled]}
        disabled={!canPrev}
        onPress={() => turnTo(selectedChapter - 1)}
        activeOpacity={0.8}
      >
        <Ionicons name="chevron-back" size={18} color={canPrev ? colors.white : colors.textMuted} />
        <Text style={[styles.navBtnText, !canPrev && styles.navBtnTextDisabled]}>{t('common.previous')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.navBtn, !canNext && styles.navBtnDisabled]}
        disabled={!canNext}
        onPress={() => turnTo(selectedChapter + 1)}
        activeOpacity={0.8}
      >
        <Text style={[styles.navBtnText, !canNext && styles.navBtnTextDisabled]}>{t('common.next')}</Text>
        <Ionicons name="chevron-forward" size={18} color={canNext ? colors.white : colors.textMuted} />
      </TouchableOpacity>
    </View>
  );

  // ── A `web` version's chapter: eBible's page, in our panel ─────────────
  const renderWebChapter = () => {
    const url = webUrl;
    const page = webPage?.url === url ? webPage : null;
    return (
      <View style={styles.webReader}>
        <View style={[styles.readerPanel, styles.webPanel]}>
          {readerTools}
          <Text style={styles.readerTitle}>{selectedBook.name} {selectedChapter}</Text>
          <View style={styles.titleRule} />
          {webState === 'failed' ? (
            <View style={styles.centered}>
              <Ionicons name="cloud-offline-outline" size={44} color={colors.textMuted} />
              <Text style={styles.emptyText}>{t('bible.onlineOnly')}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => setWebKey((k) => k + 1)}>
                <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.webFrame}>
              {page && styledWebHtml ? (
              <WebView
                key={`${url}#${webKey}`}
                source={{ html: styledWebHtml, baseUrl: url }}
                // Opened at a verse: eBible marks each one (id="V16").
                injectedJavaScript={targetVerse
                  ? `(function(){var v=document.getElementById('V${targetVerse}');if(v){v.scrollIntoView({block:'center'});}})();true;`
                  : undefined}
                style={[styles.web, webState !== 'ready' && styles.webHidden]}
                containerStyle={styles.webContainer}
                originWhitelist={['*']}
                onLoadEnd={() => {
                  setWebState((st) => (st === 'failed' ? st : 'ready'));
                  recordReading({ bookId, bookName: selectedBook.name, chapter: selectedChapter, versionId });
                }}
                onError={() => setWebState('failed')}
                onHttpError={() => setWebState('failed')}
                // Only this chapter stays here; any other link opens outside.
                onShouldStartLoadWithRequest={(req) => {
                  if (staysInReader(req.url, url)) return true;
                  Linking.openURL(req.url).catch(() => {});
                  return false;
                }}
                setSupportMultipleWindows={false}
                allowsBackForwardNavigationGestures={false}
                showsVerticalScrollIndicator={false}
                testID="bible-web-chapter"
              />
              ) : null}
              {webState === 'loading' ? (
                <View style={[StyleSheet.absoluteFill, styles.webLoading]} pointerEvents="none">
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
              ) : null}
            </View>
          )}
          <Text style={styles.credit}>{version.credit}</Text>
        </View>
        {chapterNav}
      </View>
    );
  };

  // ── Verses view ─────────────────────────────────────────────────────────
  const renderVerses = () => {
    if (version.web) return renderWebChapter();
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading {selectedBook.name} {selectedChapter}…</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textMuted} />
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => setReloadKey((k) => k + 1)}
          >
            <Text style={styles.retryBtnText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <ScrollView
        key={`${bookId}_${selectedChapter}`}
        ref={scrollRef}
        style={styles.reader}
        contentContainerStyle={[styles.readerContent, selected.length > 0 && styles.readerContentWithBar]}
        showsVerticalScrollIndicator={false}
      >
        {/* Glass "page" so the scripture stays crisp over the wallpaper. */}
        <View style={styles.readerPanel} onLayout={(e) => { panelY.current = e.nativeEvent.layout.y; }}>
          {readerTools}
          <Text style={styles.readerTitle}>{selectedBook.name} {selectedChapter}</Text>
          <View style={styles.titleRule} />
          {selected.length === 0 && verseItems.length > 0 ? (
            <Text style={styles.tapHint}>{t('bible.tapVerseHint')}</Text>
          ) : null}
          {items.map((item, index) => {
            if (item.type === 'heading') {
              return <Text key={`h${index}`} style={[styles.heading, { fontSize: textSize - 2 }]}>{item.text}</Text>;
            }
            const n = item.number;
            const isSelected = selected.includes(n);
            const wash = marks.highlight[n] ? HIGHLIGHT_WASH[marks.highlight[n]] : null;
            const verseNote = marks.notes[n];
            return (
              <Text
                key={`v${n}_${index}`}
                onPress={() => toggleVerse(n)}
                onLayout={(e) => onVerseLayout(n, e.nativeEvent.layout.y)}
                suppressHighlighting
                style={[
                  styles.verseLine,
                  { fontSize: textSize, lineHeight: Math.round(textSize * 1.75) },
                  wash && { backgroundColor: wash },
                  isSelected && styles.verseSelected,
                  flashVerse === n && styles.verseFlash,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                testID={`bible-verse-${n}`}
              >
                <Text style={styles.verseNumber}>{n} </Text>
                {marks.favorite.has(n) ? <Text style={styles.favMark}>♥ </Text> : null}
                {item.parts.map((part, i) => (
                  <Text key={i} style={part.jesus ? styles.jesus : null}>{part.text}</Text>
                ))}
                {verseNote ? (
                  <Text style={styles.noteMark} onPress={() => openNote(verseNote)} accessibilityRole="button"
                    accessibilityLabel={t('bible.openNote')} testID={`bible-note-mark-${n}`}>{'  ✎'}</Text>
                ) : null}
              </Text>
            );
          })}
          {/* The version's credit: its licence asks for it under the text. */}
          <Text style={styles.credit}>{version.credit}</Text>
        </View>

        {/* Prev / Next chapter navigation */}
        {chapterNav}
        <View style={{ height: spacing.xl }} />
      </ScrollView>
    );
  };

  // ── Top bar (contextual) ────────────────────────────────────────────────
  const inVerses = !!(selectedBook && selectedChapter);
  const onBack = selectedBook && navigation.canGoBack?.() !== false ? () => navigation.goBack() : null;

  let title = t('bible.title');
  let subtitle = version.name;
  if (inVerses) {
    title = `${selectedBook.name} ${selectedChapter}`;
    subtitle = t('bible.keepReading');
  } else if (selectedBook) {
    title = selectedBook.name;
    subtitle = `${selectedBook.chapters} chapters`;
  }

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <View style={styles.topBar}>
        {onBack ? (
          <TouchableOpacity style={styles.backBtn} onPress={onBack} hitSlop={10}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn}>
            <Ionicons name="book" size={20} color={colors.primary} />
          </View>
        )}
        <View style={styles.titleWrap}>
          <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.topSubtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {/* Versions: a row of cards, one tap to switch. */}
      <ScrollView
        ref={cardsRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.cardsScroll}
        contentContainerStyle={styles.cards}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('bible.chooseVersion')}
      >
        {ALL_VERSIONS.map((v) => {
          const on = v.id === versionId;
          return (
            <TouchableOpacity
              key={v.id}
              style={[styles.card, on && styles.cardOn]}
              onPress={() => chooseVersion(v)}
              onLayout={(e) => {
                cardX.current[v.id] = e.nativeEvent.layout.x;
                if (v.id === versionId) showChosenCard(false);
              }}
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${v.name}, ${v.language}`}
              accessibilityHint={v.web ? t('bible.webHint') : undefined}
              testID={`bible-version-${v.id}`}
            >
              <View style={styles.cardTop}>
                <Text style={[styles.cardAbbr, on && styles.cardAbbrOn]} numberOfLines={1}>{v.abbr}</Text>
                {v.web ? <Ionicons name="globe-outline" size={12} color={on ? colors.white : colors.textSecondary} /> : null}
              </View>
              <Text style={[styles.cardLang, on && styles.cardLangOn]} numberOfLines={1}>{v.language}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.body}>
        {inVerses ? renderVerses() : selectedBook ? renderChapters() : renderBooks()}
      </View>

      {inVerses && !version.web && passage && !noteOpen ? (
        <BibleVerseActions
          reference={reference}
          currentColor={sameColor}
          isFavorite={!!favorite}
          hasNote={!!note}
          onHighlight={onHighlight}
          onFavorite={onFavorite}
          onNote={() => setNoteOpen(true)}
          onShare={onShare}
          onClose={clearSelection}
          bottom={insets.bottom}
        />
      ) : null}
      {passage ? (
        <BibleNoteSheet
          visible={noteOpen}
          reference={reference}
          verseText={passage.text}
          initialNote={note?.note || ''}
          onSave={onSaveNote}
          onDelete={onDeleteNote}
          onClose={() => setNoteOpen(false)}
        />
      ) : null}

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  body: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(13,35,64,0.78)',
  },
  backBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm },
  topTitle: {
    ...typography.h3, color: colors.textPrimary,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  topSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },

  // Version cards
  cardsScroll: { flexGrow: 0, marginTop: spacing.sm },
  cards: { paddingHorizontal: spacing.md, gap: spacing.sm },
  card: {
    minWidth: 76, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  cardOn: { backgroundColor: colors.primary, borderColor: colors.primary, ...shadows.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardAbbr: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  cardAbbrOn: { color: colors.white },
  cardLang: { color: colors.textSecondary, fontSize: 11.5, marginTop: 1 },
  cardLangOn: { color: 'rgba(255,255,255,0.85)' },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(13,35,64,0.78)',
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },

  // Books
  section: { marginTop: spacing.sm },
  sectionTitle: {
    ...typography.label,
    color: colors.accent,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  bookGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md - spacing.xs,
  },
  bookCard: {
    margin: spacing.xs,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    ...shadows.sm,
  },
  bookName: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  bookMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },

  // Chapters
  pickPrompt: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  chipGrid: { padding: spacing.md },
  chipRow: { gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    borderRadius: radius.md,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  chipText: { ...typography.h3, color: colors.textPrimary, fontWeight: '600' },

  // Reader
  reader: { flex: 1 },
  readerContent: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  readerPanel: {
    backgroundColor: 'rgba(11,24,42,0.92)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    ...shadows.md,
  },
  readerTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  titleRule: {
    width: 56,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  verseLine: {
    fontSize: 18,
    lineHeight: 32,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  heading: {
    ...typography.label,
    color: colors.accent,
    fontWeight: '800',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  jesus: { color: JESUS_RED },
  credit: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  verseNumber: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },

  // Reading tools, verse marks, selection
  readerTools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  sizeBtns: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  sizeA: { color: colors.textSecondary, fontWeight: '800' },
  sizeASmall: { fontSize: 14 },
  sizeALarge: { fontSize: 21 },
  sizeADisabled: { opacity: 0.35 },
  tapHint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: -spacing.sm, marginBottom: spacing.md },
  verseSelected: {
    textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: colors.primary,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  verseFlash: { backgroundColor: 'rgba(244,162,97,0.35)' },
  favMark: { color: '#FF4D6D', fontSize: 13 },
  noteMark: { color: colors.primary, fontWeight: '800' },
  readerContentWithBar: { paddingBottom: 240 },

  // Bible home: continue reading, My Bible
  continueCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, marginTop: spacing.md, padding: spacing.sm + 2, borderRadius: radius.md,
    backgroundColor: 'rgba(29,161,242,0.16)', borderWidth: 1, borderColor: 'rgba(29,161,242,0.45)',
  },
  continueIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  continueText: { flex: 1 },
  continueLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  continueRef: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', marginTop: 1 },
  continueVersion: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  shelf: { paddingHorizontal: spacing.md, gap: spacing.sm, marginTop: spacing.md },
  shelfItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 38,
    borderRadius: radius.full, backgroundColor: 'rgba(16,28,46,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  shelfLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  shelfCount: {
    color: colors.white, fontSize: 11, fontWeight: '800', minWidth: 20, textAlign: 'center',
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden',
  },

  // A `web` version's page
  webReader: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md },
  webPanel: { flex: 1, paddingBottom: spacing.sm },
  webFrame: { flex: 1, minHeight: 200 },
  webContainer: { flex: 1, backgroundColor: 'transparent' },
  web: { flex: 1, backgroundColor: 'transparent' },
  webHidden: { opacity: 0 },
  webLoading: { alignItems: 'center', justifyContent: 'center' },

  // Chapter nav
  chapterNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  navBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    ...shadows.sm,
  },
  navBtnDisabled: {
    backgroundColor: 'rgba(16,28,46,0.7)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  navBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  navBtnTextDisabled: { color: colors.textMuted },

  // Shared
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    ...typography.body, color: colors.textSecondary,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  emptyText: {
    ...typography.body, color: colors.textSecondary, textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  retryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  retryBtnText: { ...typography.label, color: colors.white, fontWeight: '600' },
});

export default BibleReader;
