// What to do with a paragraph a reader has long-pressed in a book: highlight
// it (five colours, or clear), write a note, share it — a bar over the
// bottom of the page, the same look as the Bible's verse tools.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HIGHLIGHT_SWATCH } from './BibleVerseActions';
import { colors, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export const BOOK_HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'];

const Action = ({ icon, label, onPress, testID }) => (
  <TouchableOpacity style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
    <Ionicons name={icon} size={22} color={colors.textPrimary} />
    <Text style={styles.actionText} numberOfLines={1}>{label}</Text>
  </TouchableOpacity>
);

const BookPassageActions = ({ quote, color, hasNote, onColor, onNote, onShare, onClose, bottom = 0 }) => {
  const { t } = useI18n();
  return (
    <View style={[styles.bar, { paddingBottom: spacing.sm + bottom }]} testID="book-passage-actions">
      <View style={styles.head}>
        <Text style={styles.quote} numberOfLines={2}>{quote}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('bible.clearSelection')}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <View style={styles.colors} accessibilityRole="radiogroup" accessibilityLabel={t('bible.highlight')}>
        {BOOK_HIGHLIGHT_COLORS.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => onColor(c)}
            style={[styles.swatch, { backgroundColor: HIGHLIGHT_SWATCH[c] }, color === c && styles.swatchOn]}
            accessibilityRole="radio"
            accessibilityState={{ checked: color === c }}
            accessibilityLabel={t(`bible.color.${c}`)}
            testID={`book-highlight-${c}`}
          >
            {color === c ? <Ionicons name="checkmark" size={16} color="#0A1628" /> : null}
          </TouchableOpacity>
        ))}
        {color ? (
          <TouchableOpacity onPress={() => onColor('')} style={styles.clear} accessibilityRole="button"
            accessibilityLabel={t('bible.removeHighlight')} testID="book-highlight-clear">
            <Ionicons name="close-circle-outline" size={30} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Action icon={hasNote ? 'document-text' : 'document-text-outline'}
          label={t(hasNote ? 'bible.editNote' : 'bible.addNote')} onPress={onNote} testID="book-action-note" />
        <Action icon="share-social-outline" label={t('bible.shareCopy')} onPress={onShare} testID="book-action-share" />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    backgroundColor: 'rgba(10,22,40,0.97)', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', ...shadows.md,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  quote: { flex: 1, color: colors.textSecondary, fontSize: 13, fontStyle: 'italic', lineHeight: 18 },
  colors: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  swatch: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 2, borderColor: colors.white },
  clear: { marginLeft: 'auto' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.sm },
  action: { alignItems: 'center', gap: 2, minWidth: 90, paddingVertical: spacing.xs },
  actionText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
});

export default BookPassageActions;
