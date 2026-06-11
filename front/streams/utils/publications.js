import { colors, spacing } from '../constants/theme';

export const CATEGORIES = [
  { key: 'devotional', label: 'Devotional' },
  { key: 'doctrine', label: 'Doctrine' },
  { key: 'testimony', label: 'Testimony' },
  { key: 'health', label: 'Health' },
  { key: 'prophecy', label: 'Prophecy' },
  { key: 'family', label: 'Family' },
  { key: 'history', label: 'History' },
  { key: 'other', label: 'Other' },
];

export const categoryLabel = (key) =>
  CATEGORIES.find((c) => c.key === key)?.label || 'Other';

// Themed style map for react-native-markdown-display. `fontSize` scales the
// reading body so the reader's font control works.
export const markdownTheme = (fontSize = 17) => ({
  body: { color: colors.textPrimary, fontSize, lineHeight: Math.round(fontSize * 1.7) },
  heading1: { color: colors.textPrimary, fontSize: fontSize + 11, fontWeight: '800', marginTop: spacing.lg, marginBottom: spacing.sm },
  heading2: { color: colors.textPrimary, fontSize: fontSize + 7, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.sm },
  heading3: { color: colors.textPrimary, fontSize: fontSize + 3, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  paragraph: { color: colors.textPrimary, fontSize, lineHeight: Math.round(fontSize * 1.7), marginTop: 0, marginBottom: spacing.md },
  strong: { fontWeight: '800', color: colors.textPrimary },
  em: { fontStyle: 'italic' },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  blockquote: {
    backgroundColor: colors.card,
    borderLeftColor: colors.accent,
    borderLeftWidth: 3,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 6,
    marginBottom: spacing.md,
  },
  bullet_list: { marginBottom: spacing.md },
  ordered_list: { marginBottom: spacing.md },
  list_item: { color: colors.textPrimary, fontSize, lineHeight: Math.round(fontSize * 1.7) },
  code_inline: { backgroundColor: colors.inputBg, color: colors.accent, paddingHorizontal: 4, borderRadius: 4 },
  code_block: { backgroundColor: colors.inputBg, color: colors.textPrimary, padding: spacing.md, borderRadius: 8 },
  fence: { backgroundColor: colors.inputBg, color: colors.textPrimary, padding: spacing.md, borderRadius: 8 },
  hr: { backgroundColor: colors.border, height: 1, marginVertical: spacing.md },
  image: { borderRadius: 8, marginVertical: spacing.sm },
  table: { borderColor: colors.border },
  th: { color: colors.textPrimary },
  td: { color: colors.textPrimary, borderColor: colors.border },
});
