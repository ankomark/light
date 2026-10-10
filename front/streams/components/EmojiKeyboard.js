/**
 * Emoji wherever people write to each other: a 😊 button by the text box
 * swaps the phone's keyboard for an emoji panel (⌨️ brings the keyboard back),
 * and a tapped emoji goes in where the cursor is. Pure views — nothing new in
 * the phone's build; the keyboard's own emoji key keeps working too.
 *
 * Chat bars (the panel goes under the bar, which only the bar's owner can
 * place):
 *   const emoji = useEmojiInput({ value, onChangeText, maxLength, inputRef });
 *   <TextInput ref={inputRef} {...emoji.inputProps} … />
 *   <EmojiToggle open={emoji.open} onPress={emoji.toggle} />
 *   {emoji.open && <EmojiPanel onPick={emoji.insert} />}
 *
 * Forms (captions, bios, reviews, descriptions): a drop-in TextInput with the
 * button inside it and the panel below:
 *   <EmojiTextInput value={…} onChangeText={…} style={…} … />
 */
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Keyboard,
} from 'react-native';
import { QUICK, GROUPS, insertAt } from './EmojiPicker';
import { useI18n } from '../context/I18nContext';

const PANEL_H = 250;

/**
 * State for one text box with an emoji panel: where the cursor is, whether the
 * panel is open, and putting an emoji in. `inputProps` goes on the TextInput.
 */
export const useEmojiInput = ({ value, onChangeText, maxLength, inputRef, onFocus, onSelectionChange }) => {
  const [open, setOpen] = useState(false);
  const selection = useRef(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const insert = useCallback((emoji) => {
    const out = insertAt(valueRef.current, emoji, selection.current, maxLength);
    if (!out) return;                          // would pass the length limit
    selection.current = out.selection;
    valueRef.current = out.text;               // two quick taps both land
    onChangeText?.(out.text);
  }, [onChangeText, maxLength]);

  const toggle = useCallback(() => {
    setOpen((was) => {
      if (was) {
        // Back to typing: the keyboard comes up where they were.
        requestAnimationFrame(() => inputRef?.current?.focus?.());
        return false;
      }
      Keyboard.dismiss();
      return true;
    });
  }, [inputRef]);

  const close = useCallback(() => setOpen(false), []);

  const inputProps = {
    onSelectionChange: (e) => {
      selection.current = e?.nativeEvent?.selection || null;
      onSelectionChange?.(e);
    },
    // Tapping into the box means typing: the keyboard takes the panel's place.
    onFocus: (e) => { setOpen(false); onFocus?.(e); },
  };

  return { open, toggle, close, insert, inputProps };
};

/** The 😊 / ⌨️ button — drawn as emoji, like the story picker's, so it looks
 *  the same on every screen whatever icon set that screen uses. (`color` is
 *  accepted for callers' symmetry; emoji carry their own colour.) */
export const EmojiToggle = ({ open, onPress, color, size = 24, style, testID = 'emoji-toggle' }) => {
  const { t } = useI18n();
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={8}
      style={[styles.toggle, style]}
      accessibilityRole="button"
      accessibilityState={{ expanded: !!open }}
      accessibilityLabel={open ? t('emoji.keyboard') : t('emoji.more')}
      testID={testID}
    >
      <Text style={{ fontSize: size - 2 }}>{open ? '⌨️' : '😊'}</Text>
    </TouchableOpacity>
  );
};

const TABS = [{ key: 'quick', icon: '⭐', items: QUICK }, ...GROUPS];

/** The panel: a tab per group, a grid of emoji to tap. */
export const EmojiPanel = ({ onPick, height = PANEL_H, style, testID = 'emoji-panel' }) => {
  const { t } = useI18n();
  const [tab, setTab] = useState(TABS[0].key);
  const items = (TABS.find((g) => g.key === tab) || TABS[0]).items;
  return (
    <View style={[styles.panel, { height }, style]} testID={testID}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((g) => (
          <TouchableOpacity
            key={g.key}
            onPress={() => setTab(g.key)}
            style={[styles.tab, tab === g.key && styles.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === g.key }}
            accessibilityLabel={t(`emoji.group.${g.key}`)}
            testID={`${testID}-tab-${g.key}`}
          >
            <Text style={styles.tabText}>{g.icon}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={styles.grid}>
        {items.map((e, i) => (
          <TouchableOpacity
            key={`${e}-${i}`}
            onPress={() => onPick(e)}
            style={styles.cell}
            accessibilityRole="button"
            accessibilityLabel={t('emoji.add', { emoji: e })}
            testID={`${testID}-cell-${e}`}
          >
            <Text style={styles.cellText}>{e}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

/**
 * A TextInput with emoji: the button sits inside the box (bottom right) and
 * the panel opens under it. Takes every TextInput prop; the ref is the input.
 */
export const EmojiTextInput = forwardRef(({
  value, onChangeText, maxLength, style, containerStyle, onFocus, onSelectionChange,
  emojiColor, panelHeight, testID, ...rest
}, ref) => {
  const inputRef = useRef(null);
  useImperativeHandle(ref, () => inputRef.current);
  const emoji = useEmojiInput({ value, onChangeText, maxLength, inputRef, onFocus, onSelectionChange });
  return (
    <View style={containerStyle}>
      <View>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          maxLength={maxLength}
          style={[style, styles.roomForToggle]}
          testID={testID}
          {...rest}
          {...emoji.inputProps}
        />
        <EmojiToggle
          open={emoji.open}
          onPress={emoji.toggle}
          color={emojiColor}
          size={22}
          style={styles.inside}
          testID={testID ? `${testID}-emoji` : 'emoji-toggle'}
        />
      </View>
      {emoji.open && (
        <EmojiPanel
          onPick={emoji.insert}
          height={panelHeight}
          style={styles.below}
          testID={testID ? `${testID}-emoji-panel` : 'emoji-panel'}
        />
      )}
    </View>
  );
});
EmojiTextInput.displayName = 'EmojiTextInput';

const styles = StyleSheet.create({
  toggle: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  inside: { position: 'absolute', right: 2, bottom: 2 },
  roomForToggle: { paddingRight: 44 },
  below: { marginTop: 8 },
  panel: {
    borderRadius: 14, overflow: 'hidden',
    backgroundColor: 'rgba(10,22,40,0.97)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  tabs: {
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)',
  },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  tabOn: { backgroundColor: 'rgba(255,255,255,0.1)' },
  tabText: { fontSize: 19 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 4 },
  cell: { width: '12.5%', aspectRatio: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  cellText: { fontSize: 26 },
});
