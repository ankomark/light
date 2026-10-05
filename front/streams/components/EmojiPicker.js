/**
 * Emojis for a caption: a quick row of favourites, and a panel of more,
 * grouped (smileys, love, faith, celebration, nature, hands). Pure views, so
 * nothing new is needed in the phone's build — the keyboard's own emoji key
 * keeps working too.
 *
 *   <EmojiPicker onPick={(e) => …} open={open} onToggle={() => …} />
 *
 * `insertAt` puts an emoji where the cursor is, within a length limit.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export const QUICK = ['🙏', '❤️', '😊', '😂', '🔥', '🎉', '✨', '🙌', '😍', '👏', '🕊️', '📖'];

export const GROUPS = [
  { key: 'smileys', icon: '😊', items: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😎', '🤩', '🥳', '😏', '😌', '😴', '🤔', '🤗', '🤭', '😮', '😢', '😭', '😤', '😡', '🥺', '😳'] },
  { key: 'love', icon: '❤️', items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤', '🤎', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💯', '💌'] },
  { key: 'faith', icon: '🙏', items: ['🙏', '✝️', '⛪', '📖', '🕊️', '🕯️', '👼', '🌅', '🙌', '🛐', '📜', '🎶', '🎵', '🎤', '🎹', '🎸', '⭐', '🌟'] },
  { key: 'celebrate', icon: '🎉', items: ['🎉', '🎊', '🥳', '🎂', '🎁', '🎈', '🏆', '🥇', '✨', '🎆', '🎇', '💐', '🌹', '🍰', '☕', '🍽️'] },
  { key: 'nature', icon: '🌿', items: ['🌿', '🌸', '🌺', '🌻', '🌼', '🌷', '🍀', '🌳', '🌴', '🌊', '⛰️', '🌈', '☀️', '🌙', '⭐', '❄️', '🔥', '💧'] },
  { key: 'hands', icon: '👍', items: ['👍', '👎', '👏', '🙌', '👐', '🤝', '✌️', '🤞', '👌', '🤲', '💪', '👋', '☝️', '👇', '👉', '👈'] },
];

/**
 * `text` with `emoji` put at the cursor (`selection`), or at the end; and the
 * cursor just after it. Refused (null) when it would pass `max` characters.
 */
export const insertAt = (text, emoji, selection, max) => {
  const value = text || '';
  const at = selection && Number.isFinite(selection.start)
    ? Math.min(Math.max(0, selection.start), value.length) : value.length;
  const end = selection && Number.isFinite(selection.end) ? Math.min(Math.max(at, selection.end), value.length) : at;
  const next = value.slice(0, at) + emoji + value.slice(end);
  if (max && next.length > max) return null;
  const cursor = at + emoji.length;
  return { text: next, selection: { start: cursor, end: cursor } };
};

const EmojiPicker = ({ onPick, open, onToggle, testID = 'emoji' }) => {
  const { t } = useI18n();
  const [group, setGroup] = useState(GROUPS[0].key);
  const items = (GROUPS.find((g) => g.key === group) || GROUPS[0]).items;

  return (
    <View testID={testID}>
      <View style={styles.quickRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
                    contentContainerStyle={styles.quick}>
          {QUICK.map((e) => (
            <TouchableOpacity key={e} onPress={() => onPick(e)} style={styles.quickBtn} accessibilityRole="button"
                              accessibilityLabel={t('emoji.add', { emoji: e })} testID={`${testID}-quick-${e}`}>
              <Text style={styles.quickText}>{e}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity onPress={onToggle} style={[styles.toggle, open && styles.toggleOn]} accessibilityRole="button"
                          accessibilityState={{ expanded: !!open }} accessibilityLabel={t('emoji.more')}
                          testID={`${testID}-more`}>
          <Text style={styles.quickText}>{open ? '⌨️' : '😊'}</Text>
        </TouchableOpacity>
      </View>

      {open && (
        <View style={styles.panel} testID={`${testID}-panel`}>
          <View style={styles.tabs} accessibilityRole="tablist">
            {GROUPS.map((g) => (
              <TouchableOpacity key={g.key} onPress={() => setGroup(g.key)} accessibilityRole="tab"
                                accessibilityState={{ selected: group === g.key }}
                                accessibilityLabel={t(`emoji.group.${g.key}`)}
                                style={[styles.tab, group === g.key && styles.tabOn]} testID={`${testID}-tab-${g.key}`}>
                <Text style={styles.tabText}>{g.icon}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.grid}>
            {items.map((e, i) => (
              <TouchableOpacity key={`${e}-${i}`} onPress={() => onPick(e)} style={styles.cell} accessibilityRole="button"
                                accessibilityLabel={t('emoji.add', { emoji: e })} testID={`${testID}-cell-${e}`}>
                <Text style={styles.cellText}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  quick: { gap: 2, paddingRight: spacing.xs },
  quickBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  quickText: { fontSize: 22 },
  toggle: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  toggleOn: { borderColor: colors.primary },
  panel: {
    marginTop: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card, padding: spacing.sm,
  },
  tabs: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  tabOn: { backgroundColor: 'rgba(255,255,255,0.08)' },
  tabText: { fontSize: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '12.5%', aspectRatio: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  cellText: { fontSize: 26 },
});

export default EmojiPicker;
