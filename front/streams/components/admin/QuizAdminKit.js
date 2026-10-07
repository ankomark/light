// Pieces the quiz's admin screens share: choosing a book and its chapters,
// for a story pack or a passage for Claude to draft questions from.
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { BIBLE_BOOKS } from '../../utils/bibleVersions';
import { ADMIN } from './AdminKit';

/** Book number (1–66) → its name and chapter count. */
export const bookAt = (number) => {
  const row = BIBLE_BOOKS[(number || 0) - 1];
  return row ? { number, name: row.name, chapters: row.chapters } : null;
};

/** One row of the 66 books, scrolled sideways; the chosen one in gold. */
export const BookPicker = ({ value, onPick, testID = 'book' }) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.books}
              keyboardShouldPersistTaps="handled" testID={`${testID}-picker`}>
    {BIBLE_BOOKS.map(({ id: code, name }, i) => (
      <TouchableOpacity key={code} style={[styles.book, value === i + 1 && styles.bookOn]}
                        onPress={() => onPick(i + 1)} testID={`${testID}-${i + 1}`}>
        <Text style={[styles.bookText, value === i + 1 && styles.bookTextOn]}>{name}</Text>
      </TouchableOpacity>
    ))}
  </ScrollView>
);

/** First and last chapter, as two short number boxes. */
export const ChapterRange = ({ first, last, onChange, max, label, testID = 'chapters' }) => (
  <View style={styles.range}>
    <Text style={styles.rangeLabel}>{label}</Text>
    <TextInput style={styles.num} value={first ? String(first) : ''} keyboardType="number-pad" maxLength={3}
               onChangeText={(v) => onChange(Number(v.replace(/\D/g, '')) || 0, last)} testID={`${testID}-first`} />
    <Text style={styles.rangeLabel}>–</Text>
    <TextInput style={styles.num} value={last ? String(last) : ''} keyboardType="number-pad" maxLength={3}
               onChangeText={(v) => onChange(first, Number(v.replace(/\D/g, '')) || 0)} testID={`${testID}-last`} />
    {!!max && <Text style={styles.rangeMax}>/ {max}</Text>}
  </View>
);

const styles = StyleSheet.create({
  books: { gap: 6, paddingVertical: 2 },
  book: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: ADMIN.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border,
  },
  bookOn: { backgroundColor: ADMIN.gold, borderColor: ADMIN.gold },
  bookText: { color: ADMIN.muted, fontSize: 12.5, fontWeight: '700' },
  bookTextOn: { color: ADMIN.onGold },
  range: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeLabel: { color: ADMIN.muted, fontSize: 13, fontWeight: '700' },
  rangeMax: { color: ADMIN.muted, fontSize: 12.5 },
  num: {
    width: 64, height: 44, borderRadius: 12, textAlign: 'center', color: ADMIN.text, fontSize: 15,
    backgroundColor: ADMIN.field, borderWidth: 1, borderColor: '#1E3150',
  },
});
