// A note on a passage: the verses above, the reader's own words below.
// Saving an empty note deletes it.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import BottomSheet from './BottomSheet';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const MAX_NOTE = 2000;

const BibleNoteSheet = ({ visible, reference, verseText, initialNote = '', onSave, onDelete, onClose }) => {
  const { t } = useI18n();
  const kb = useKeyboardHeight();
  const [text, setText] = useState(initialNote);
  useEffect(() => { if (visible) setText(initialNote); }, [visible, initialNote]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      heightRatio={0.6}
      keyboardHeight={kb || 0}
      header={(
        <View style={styles.head}>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{reference}</Text>
          <TouchableOpacity onPress={() => onSave(text)} hitSlop={8} accessibilityRole="button" testID="bible-note-save">
            <Text style={styles.save}>{t('common.save')}</Text>
          </TouchableOpacity>
        </View>
      )}
    >
      <View style={styles.body}>
        {verseText ? <Text style={styles.quote} numberOfLines={4}>{verseText}</Text> : null}
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={t('bible.notePlaceholder')}
          placeholderTextColor={colors.placeholder}
          multiline
          maxLength={MAX_NOTE}
          autoFocus
          textAlignVertical="top"
          testID="bible-note-input"
        />
        {initialNote && onDelete ? (
          <TouchableOpacity onPress={onDelete} style={styles.delete} accessibilityRole="button" testID="bible-note-delete">
            <Text style={styles.deleteText}>{t('bible.deleteNote')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm,
  },
  title: { flex: 1, ...typography.h3, color: colors.textPrimary, textAlign: 'center' },
  cancel: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  save: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  body: { flex: 1, paddingHorizontal: spacing.md },
  quote: {
    color: colors.textSecondary, fontSize: 14, lineHeight: 21, fontStyle: 'italic',
    borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: spacing.sm, marginBottom: spacing.sm,
  },
  input: {
    flex: 1, minHeight: 140, color: colors.textPrimary, fontSize: 16, lineHeight: 23,
    backgroundColor: 'rgba(6,16,32,0.6)', borderRadius: radius.md, padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  delete: { alignSelf: 'center', paddingVertical: spacing.md },
  deleteText: { color: colors.error, fontSize: 14, fontWeight: '700' },
});

export default BibleNoteSheet;
