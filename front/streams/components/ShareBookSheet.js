// Share a book — or a passage from it — as a post in the social feed (drawn
// there as the book's card), with a few words of your own; or send it
// elsewhere through the phone's share sheet.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Share, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import { shareBookToFeed } from '../services/api';
import { notify } from '../utils/adminConfirm';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const ShareBookSheet = ({ visible, onClose, book, quote = '', chapterId = null, chapterTitle = '', block = null, onPosted }) => {
  const { t } = useI18n();
  const kbHeight = useKeyboardHeight();       // the sheet rises with the keyboard
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) setCaption(''); }, [visible]);

  const post = async () => {
    setBusy(true);
    try {
      const created = await shareBookToFeed(book.id, {
        caption: caption.trim(),
        ...(quote ? { quote, chapter_id: chapterId, block } : {}),
      });
      onClose();
      notify(t('shareBook.postedTitle'), t('shareBook.postedBody'));
      onPosted?.(created);
    } catch (err) {
      notify(t('common.error'), err?.data?.error || t('shareBook.failed'));
    } finally {
      setBusy(false);
    }
  };

  const elsewhere = () => {
    const where = [book?.title, chapterTitle].filter(Boolean).join(' · ');
    Share.share({ message: quote ? `“${quote}”\n— ${where}` : where }).catch(() => {});
    onClose();
  };

  return (
    <BottomSheet
      keyboardHeight={kbHeight}
      visible={visible}
      onClose={onClose}
      heightRatio={0.6}
      header={(
        <View style={styles.head}>
          <Text style={styles.title}>{t(quote ? 'shareBook.passageTitle' : 'shareBook.title')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity>
        </View>
      )}
    >
      <ScrollView contentContainerStyle={styles.body} testID="share-book-sheet" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.preview}>
          <Ionicons name="book" size={18} color={colors.accent} />
          <View style={styles.flex}>
            <Text style={styles.bookTitle} numberOfLines={1}>{book?.title}</Text>
            {quote ? <Text style={styles.quote} numberOfLines={3}>{`“${quote}”`}</Text> : null}
          </View>
        </View>
        <TextInput style={styles.input} value={caption} onChangeText={setCaption} multiline maxLength={2200}
          placeholder={t('shareBook.captionPlaceholder')} placeholderTextColor={colors.placeholder} testID="share-book-caption" />
        <TouchableOpacity style={styles.post} onPress={post} disabled={busy} testID="share-book-post" accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.white} /> : (
            <>
              <Ionicons name="paper-plane" size={16} color={colors.white} />
              <Text style={styles.postText}>{t('shareBook.post')}</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.elsewhere} onPress={elsewhere} testID="share-book-elsewhere" accessibilityRole="button">
          <Ionicons name="share-social-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.elsewhereText}>{t('shareBook.elsewhere')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary },
  body: { paddingHorizontal: spacing.md, gap: spacing.md },
  flex: { flex: 1 },
  preview: {
    flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  bookTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  quote: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic', marginTop: 2 },
  input: {
    minHeight: 72, color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, textAlignVertical: 'top',
  },
  post: {
    flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md,
  },
  postText: { ...typography.button, color: colors.white },
  elsewhere: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xs },
  elsewhereText: { ...typography.label, color: colors.textSecondary, fontWeight: '700' },
});

export default ShareBookSheet;
