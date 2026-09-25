// What to do with the verses a reader has selected: highlight them (five
// colours, or clear), keep them as a favourite, write a note, or share —
// the share sheet also has Copy. A bar over the bottom of the reading page.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HIGHLIGHT_COLORS } from '../services/bibleLibrary';
import { colors, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

// A colour's swatch, and the wash it leaves behind a verse on the dark page.
export const HIGHLIGHT_SWATCH = {
  yellow: '#FFD60A', green: '#34C759', blue: '#1DA1F2', pink: '#FF4D6D', orange: '#F4A261',
};
export const HIGHLIGHT_WASH = {
  yellow: 'rgba(255,214,10,0.24)', green: 'rgba(52,199,89,0.24)', blue: 'rgba(29,161,242,0.26)',
  pink: 'rgba(255,77,109,0.24)', orange: 'rgba(244,162,97,0.28)',
};

const Action = ({ icon, label, onPress, active, testID }) => (
  <TouchableOpacity style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
    <Ionicons name={icon} size={22} color={active ? '#FF4D6D' : colors.textPrimary} />
    <Text style={styles.actionText} numberOfLines={1}>{label}</Text>
  </TouchableOpacity>
);

const BibleVerseActions = ({
  reference, currentColor, isFavorite, hasNote, onHighlight, onFavorite, onNote, onShare, onClose, bottom = 0,
}) => {
  const { t } = useI18n();
  return (
    <View style={[styles.bar, { paddingBottom: spacing.sm + bottom }]} testID="bible-verse-actions">
      <View style={styles.head}>
        <Text style={styles.ref} numberOfLines={1}>{reference}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('bible.clearSelection')}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.colors} accessibilityRole="radiogroup" accessibilityLabel={t('bible.highlight')}>
        {HIGHLIGHT_COLORS.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => onHighlight(c)}
            style={[styles.swatch, { backgroundColor: HIGHLIGHT_SWATCH[c] }, currentColor === c && styles.swatchOn]}
            accessibilityRole="radio"
            accessibilityState={{ checked: currentColor === c }}
            accessibilityLabel={t(`bible.color.${c}`)}
            testID={`bible-highlight-${c}`}
          >
            {currentColor === c ? <Ionicons name="checkmark" size={16} color="#0A1628" /> : null}
          </TouchableOpacity>
        ))}
        {currentColor ? (
          <TouchableOpacity onPress={() => onHighlight(null)} style={styles.clear} accessibilityRole="button"
            accessibilityLabel={t('bible.removeHighlight')} testID="bible-highlight-clear">
            <Ionicons name="close-circle-outline" size={30} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Action icon={isFavorite ? 'heart' : 'heart-outline'} active={isFavorite}
          label={t(isFavorite ? 'bible.favorited' : 'bible.favorite')} onPress={onFavorite} testID="bible-action-favorite" />
        <Action icon={hasNote ? 'document-text' : 'document-text-outline'}
          label={t(hasNote ? 'bible.editNote' : 'bible.addNote')} onPress={onNote} testID="bible-action-note" />
        <Action icon="share-social-outline" label={t('bible.shareCopy')} onPress={onShare} testID="bible-action-share" />
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
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  ref: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '800', marginRight: spacing.sm },
  colors: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  swatch: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 2, borderColor: colors.white },
  clear: { marginLeft: 'auto' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.sm },
  action: { alignItems: 'center', gap: 2, minWidth: 80, paddingVertical: spacing.xs },
  actionText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
});

export default BibleVerseActions;
