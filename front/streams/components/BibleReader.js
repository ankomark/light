import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const BibleReader = () => {
  const [books, setBooks] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [verses, setVerses] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Free API endpoint - no key needed
  const API_URL = 'https://bible-api.com';

  // Predefined list of books (since the free API doesn't provide this)
  const BIBLE_BOOKS = [
    { name: "Genesis", chapters: 50 },
  { name: "Exodus", chapters: 40 },
  { name: "Leviticus", chapters: 27 },
  { name: "Numbers", chapters: 36 },
  { name: "Deuteronomy", chapters: 34 },
  { name: "Joshua", chapters: 24 },
  { name: "Judges", chapters: 21 },
  { name: "Ruth", chapters: 4 },
  { name: "1 Samuel", chapters: 31 },
  { name: "2 Samuel", chapters: 24 },
  { name: "1 Kings", chapters: 22 },
  { name: "2 Kings", chapters: 25 },
  { name: "1 Chronicles", chapters: 29 },
  { name: "2 Chronicles", chapters: 36 },
  { name: "Ezra", chapters: 10 },
  { name: "Nehemiah", chapters: 13 },
  { name: "Esther", chapters: 10 },
  { name: "Job", chapters: 42 },
  { name: "Psalms", chapters: 150 },
  { name: "Proverbs", chapters: 31 },
  { name: "Ecclesiastes", chapters: 12 },
  { name: "Song of Solomon", chapters: 8 },
  { name: "Isaiah", chapters: 66 },
  { name: "Jeremiah", chapters: 52 },
  { name: "Lamentations", chapters: 5 },
  { name: "Ezekiel", chapters: 48 },
  { name: "Daniel", chapters: 12 },
  { name: "Hosea", chapters: 14 },
  { name: "Joel", chapters: 3 },
  { name: "Amos", chapters: 9 },
  { name: "Obadiah", chapters: 1 },
  { name: "Jonah", chapters: 4 },
  { name: "Micah", chapters: 7 },
  { name: "Nahum", chapters: 3 },
  { name: "Habakkuk", chapters: 3 },
  { name: "Zephaniah", chapters: 3 },
  { name: "Haggai", chapters: 2 },
  { name: "Zechariah", chapters: 14 },
  { name: "Malachi", chapters: 4 },

  // New Testament (27)
  { name: "Matthew", chapters: 28 },
  { name: "Mark", chapters: 16 },
  { name: "Luke", chapters: 24 },
  { name: "John", chapters: 21 },
  { name: "Acts", chapters: 28 },
  { name: "Romans", chapters: 16 },
  { name: "1 Corinthians", chapters: 16 },
  { name: "2 Corinthians", chapters: 13 },
  { name: "Galatians", chapters: 6 },
  { name: "Ephesians", chapters: 6 },
  { name: "Philippians", chapters: 4 },
  { name: "Colossians", chapters: 4 },
  { name: "1 Thessalonians", chapters: 5 },
  { name: "2 Thessalonians", chapters: 3 },
  { name: "1 Timothy", chapters: 6 },
  { name: "2 Timothy", chapters: 4 },
  { name: "Titus", chapters: 3 },
  { name: "Philemon", chapters: 1 },
  { name: "Hebrews", chapters: 13 },
  { name: "James", chapters: 5 },
  { name: "1 Peter", chapters: 5 },
  { name: "2 Peter", chapters: 3 },
  { name: "1 John", chapters: 5 },
  { name: "2 John", chapters: 1 },
  { name: "3 John", chapters: 1 },
  { name: "Jude", chapters: 1 },
  { name: "Revelation", chapters: 22 }
  ];

  useEffect(() => {
    setBooks(BIBLE_BOOKS);
  }, []);

  const handleBookSelect = (book) => {
    setSelectedBook(book);
    setSelectedChapter(null);
    setVerses([]);
    
    // Generate chapter numbers array (1 to book.chapters)
    const chaptersArray = Array.from({ length: book.chapters }, (_, i) => i + 1);
    setChapters(chaptersArray);
  };

  const handleChapterSelect = async (chapter) => {
    try {
      setSelectedChapter(chapter);
      setLoading(true);
      
      const response = await fetch(
        `${API_URL}/${selectedBook.name}+${chapter}`
      );
      const data = await response.json();
      
      if (data.verses) {
        setVerses(data.verses);
      } else {
        setError('No verses found');
      }
    } catch (err) {
      setError('Failed to fetch verses');
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => {
    if (loading) {
      return <ActivityIndicator size="large" color="#0000ff" />;
    }

    if (error) {
      return <Text style={styles.error}>{error}</Text>;
    }

    if (verses.length > 0) {
      return (
        <ScrollView style={styles.contentContainer}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => {
              setSelectedChapter(null);
              setVerses([]);
            }}
          >
            <Text style={styles.backText}>&larr; Back to Chapters</Text>
          </TouchableOpacity>
          <Text style={styles.title}>
            {selectedBook.name} Chapter {selectedChapter}
          </Text>
          {verses.map((verse, index) => (
            <Text key={index} style={styles.verseText}>
              <Text style={styles.verseNumber}>{verse.verse}. </Text>
              {verse.text}
            </Text>
          ))}
        </ScrollView>
      );
    }

    if (selectedBook) {
      return (
        <View style={styles.contentContainer}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => setSelectedBook(null)}
          >
            <Ionicons name="arrow-back" size={24} color="#007AFF" />
            <Text style={styles.backText}></Text>
          </TouchableOpacity>
          <Text style={styles.title}>Chapters in {selectedBook.name}</Text>
          <ScrollView contentContainerStyle={styles.gridContainer}>
            {chapters.map((chapter) => (
              <TouchableOpacity
                key={chapter}
                style={styles.chapterButton}
                onPress={() => handleChapterSelect(chapter)}
              >
                <Text style={styles.chapterText}>Chapter {chapter}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.gridContainer}>
        {books.map((book, index) => (
          <TouchableOpacity
            key={index}
            style={styles.bookButton}
            onPress={() => handleBookSelect(book)}
          >
            <Text style={styles.bookText}>{book.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Bible (NKJV)</Text>
      {renderContent()}
    </SafeAreaView>
  );
};


const SPACING = 12;
const CARD_RADIUS = 8;
const PRIMARY = 'white';
const BACKGROUND = '#2a343d';
const SURFACE = '#FFFFFF';
const TEXT = '#333333';
const SUBTEXT = '#666666';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BACKGROUND,
    paddingHorizontal: SPACING,
    paddingTop: SPACING / 2,
  },
  header: {
    fontSize: 28,
    fontWeight: '700',
    color: PRIMARY,
    textAlign: 'center',
    marginBottom: SPACING * 1.5,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingBottom: SPACING,
  },
  bookButton: {
    width: 140,
    height: 70,
    margin: SPACING / 2,
    backgroundColor: SURFACE,
    borderRadius: CARD_RADIUS,
    justifyContent: 'center',
    alignItems: 'center',
    // Elevation / shadow
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  chapterButton: {
    width: 100,
    height: 50,
    margin: SPACING / 2,
    backgroundColor: SURFACE,
    borderRadius: CARD_RADIUS,
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowOffset: { width: 0, height: 1 },
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  bookText: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT,
    textAlign: 'center',
  },
  chapterText: {
    fontSize: 14,
    fontWeight: '500',
    color: TEXT,
  },
  contentContainer: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: CARD_RADIUS,
    padding: SPACING,
    // inner shadow effect
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowOffset: { width: 0, height: 1 },
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  backButton: {
    marginBottom: SPACING,
    paddingVertical: SPACING / 2,
    paddingHorizontal: SPACING,
    alignSelf: 'flex-start',
  },
  backText: {
    color: PRIMARY,
    fontSize: 16,
    fontWeight: '500',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: TEXT,
    marginBottom: SPACING,
    textAlign: 'center',
  },
  error: {
    color: '#BB0000',
    textAlign: 'center',
    marginVertical: SPACING * 2,
    fontSize: 16,
  },
  verseText: {
    fontSize: 16,
    lineHeight: 26,
    marginBottom: SPACING,
    color: TEXT,
  },
  verseNumber: {
    color: SUBTEXT,
    fontWeight: '700',
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});


export default BibleReader;