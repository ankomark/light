import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, FlatList,
  StyleSheet, ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const API_URL = 'https://bible-api.com';
const { width } = Dimensions.get('window');

// Chapter chips: 5 per row.
const CHIP_COLS = 5;
const CHIP_SIZE = Math.floor((width - spacing.md * 2 - spacing.sm * (CHIP_COLS - 1)) / CHIP_COLS);

const OT_COUNT = 39; // first 39 books are the Old Testament

const BIBLE_BOOKS = [
  { name: 'Genesis', chapters: 50 }, { name: 'Exodus', chapters: 40 },
  { name: 'Leviticus', chapters: 27 }, { name: 'Numbers', chapters: 36 },
  { name: 'Deuteronomy', chapters: 34 }, { name: 'Joshua', chapters: 24 },
  { name: 'Judges', chapters: 21 }, { name: 'Ruth', chapters: 4 },
  { name: '1 Samuel', chapters: 31 }, { name: '2 Samuel', chapters: 24 },
  { name: '1 Kings', chapters: 22 }, { name: '2 Kings', chapters: 25 },
  { name: '1 Chronicles', chapters: 29 }, { name: '2 Chronicles', chapters: 36 },
  { name: 'Ezra', chapters: 10 }, { name: 'Nehemiah', chapters: 13 },
  { name: 'Esther', chapters: 10 }, { name: 'Job', chapters: 42 },
  { name: 'Psalms', chapters: 150 }, { name: 'Proverbs', chapters: 31 },
  { name: 'Ecclesiastes', chapters: 12 }, { name: 'Song of Solomon', chapters: 8 },
  { name: 'Isaiah', chapters: 66 }, { name: 'Jeremiah', chapters: 52 },
  { name: 'Lamentations', chapters: 5 }, { name: 'Ezekiel', chapters: 48 },
  { name: 'Daniel', chapters: 12 }, { name: 'Hosea', chapters: 14 },
  { name: 'Joel', chapters: 3 }, { name: 'Amos', chapters: 9 },
  { name: 'Obadiah', chapters: 1 }, { name: 'Jonah', chapters: 4 },
  { name: 'Micah', chapters: 7 }, { name: 'Nahum', chapters: 3 },
  { name: 'Habakkuk', chapters: 3 }, { name: 'Zephaniah', chapters: 3 },
  { name: 'Haggai', chapters: 2 }, { name: 'Zechariah', chapters: 14 },
  { name: 'Malachi', chapters: 4 },
  // New Testament (27)
  { name: 'Matthew', chapters: 28 }, { name: 'Mark', chapters: 16 },
  { name: 'Luke', chapters: 24 }, { name: 'John', chapters: 21 },
  { name: 'Acts', chapters: 28 }, { name: 'Romans', chapters: 16 },
  { name: '1 Corinthians', chapters: 16 }, { name: '2 Corinthians', chapters: 13 },
  { name: 'Galatians', chapters: 6 }, { name: 'Ephesians', chapters: 6 },
  { name: 'Philippians', chapters: 4 }, { name: 'Colossians', chapters: 4 },
  { name: '1 Thessalonians', chapters: 5 }, { name: '2 Thessalonians', chapters: 3 },
  { name: '1 Timothy', chapters: 6 }, { name: '2 Timothy', chapters: 4 },
  { name: 'Titus', chapters: 3 }, { name: 'Philemon', chapters: 1 },
  { name: 'Hebrews', chapters: 13 }, { name: 'James', chapters: 5 },
  { name: '1 Peter', chapters: 5 }, { name: '2 Peter', chapters: 3 },
  { name: '1 John', chapters: 5 }, { name: '2 John', chapters: 1 },
  { name: '3 John', chapters: 1 }, { name: 'Jude', chapters: 1 },
  { name: 'Revelation', chapters: 22 },
];

const BibleReader = () => {
  const [verses, setVerses] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [bookQuery, setBookQuery] = useState('');

  const fetchChapter = useCallback(async (book, chapter) => {
    try {
      setSelectedChapter(chapter);
      setError(null);
      setLoading(true);
      setVerses([]);
      const response = await fetch(
        `${API_URL}/${encodeURIComponent(book.name)}+${chapter}?translation=kjv`
      );
      const data = await response.json();
      if (data.verses && data.verses.length) {
        setVerses(data.verses);
      } else {
        setError('No verses found for this chapter.');
      }
    } catch {
      setError('Failed to load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleBookSelect = (book) => {
    setSelectedBook(book);
    setSelectedChapter(null);
    setVerses([]);
    setError(null);
  };

  const goToChapters = () => {
    setSelectedChapter(null);
    setVerses([]);
    setError(null);
  };

  const goToBooks = () => {
    setSelectedBook(null);
    setSelectedChapter(null);
    setVerses([]);
    setError(null);
    setBookQuery('');
  };

  const canPrev = selectedChapter > 1;
  const canNext = selectedBook && selectedChapter < selectedBook.chapters;

  const filteredBooks = useMemo(() => {
    const q = bookQuery.trim().toLowerCase();
    if (!q) return BIBLE_BOOKS;
    return BIBLE_BOOKS.filter((b) => b.name.toLowerCase().includes(q));
  }, [bookQuery]);

  // ── Books view ──────────────────────────────────────────────────────────
  const renderBookCard = (book) => (
    <TouchableOpacity
      key={book.name}
      style={styles.bookCard}
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

  const renderBooks = () => {
    const ot = filteredBooks.filter((b) => BIBLE_BOOKS.indexOf(b) < OT_COUNT);
    const nt = filteredBooks.filter((b) => BIBLE_BOOKS.indexOf(b) >= OT_COUNT);
    return (
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.placeholder} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search a book..."
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
        numColumns={CHIP_COLS}
        columnWrapperStyle={styles.chipRow}
        contentContainerStyle={styles.chipGrid}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<Text style={styles.pickPrompt}>Select a chapter</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.chip}
            onPress={() => fetchChapter(selectedBook, item)}
            activeOpacity={0.8}
          >
            <Text style={styles.chipText}>{item}</Text>
          </TouchableOpacity>
        )}
      />
    );
  };

  // ── Verses view ─────────────────────────────────────────────────────────
  const renderVerses = () => {
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
            onPress={() => fetchChapter(selectedBook, selectedChapter)}
          >
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <ScrollView style={styles.reader} showsVerticalScrollIndicator={false}>
        <Text style={styles.readerTitle}>{selectedBook.name} {selectedChapter}</Text>
        <View style={styles.titleRule} />
        {verses.map((verse, index) => (
          <Text key={index} style={styles.verseLine}>
            <Text style={styles.verseNumber}>{verse.verse} </Text>
            {verse.text.replace(/\s*\n\s*/g, ' ').trim()}
          </Text>
        ))}

        {/* Prev / Next chapter navigation */}
        <View style={styles.chapterNav}>
          <TouchableOpacity
            style={[styles.navBtn, !canPrev && styles.navBtnDisabled]}
            disabled={!canPrev}
            onPress={() => fetchChapter(selectedBook, selectedChapter - 1)}
            activeOpacity={0.8}
          >
            <Ionicons name="chevron-back" size={18} color={canPrev ? colors.white : colors.textMuted} />
            <Text style={[styles.navBtnText, !canPrev && styles.navBtnTextDisabled]}>Previous</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navBtn, !canNext && styles.navBtnDisabled]}
            disabled={!canNext}
            onPress={() => fetchChapter(selectedBook, selectedChapter + 1)}
            activeOpacity={0.8}
          >
            <Text style={[styles.navBtnText, !canNext && styles.navBtnTextDisabled]}>Next</Text>
            <Ionicons name="chevron-forward" size={18} color={canNext ? colors.white : colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={{ height: spacing.xl }} />
      </ScrollView>
    );
  };

  // ── Top bar (contextual) ────────────────────────────────────────────────
  const inVerses = selectedChapter && (verses.length > 0 || loading || error);
  const onBack = inVerses ? goToChapters : selectedBook ? goToBooks : null;

  let title = 'Holy Bible';
  let subtitle = 'King James Version';
  if (inVerses) {
    title = `${selectedBook.name} ${selectedChapter}`;
    subtitle = 'Tap Previous / Next to keep reading';
  } else if (selectedBook) {
    title = selectedBook.name;
    subtitle = `${selectedBook.chapters} chapters`;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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

      <View style={styles.body}>
        {inVerses ? renderVerses() : selectedBook ? renderChapters() : renderBooks()}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  topSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
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
  },
  bookGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md - spacing.xs,
  },
  bookCard: {
    width: (width - spacing.md * 2 - spacing.sm) / 2,
    margin: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    ...shadows.sm,
  },
  bookName: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  bookMeta: { ...typography.caption, color: colors.textMuted, marginTop: 4 },

  // Chapters
  pickPrompt: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  chipGrid: { padding: spacing.md },
  chipRow: { gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    width: CHIP_SIZE,
    height: CHIP_SIZE,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { ...typography.h3, color: colors.textPrimary, fontWeight: '600' },

  // Reader
  reader: { flex: 1, paddingHorizontal: spacing.lg },
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
  verseNumber: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },

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
  navBtnDisabled: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
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
  loadingText: { ...typography.body, color: colors.textSecondary },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
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
