// The caption box, with #hashtag and @mention autocomplete.
//
// As the author types a tag or a name, suggestions appear under the box:
// hashtags with how many posts use them, people with their avatar (the ones
// they follow first). Tapping one completes the word in place and puts the
// cursor after it.
//
// Two small chips under the box say what's possible without a paragraph of
// help text: tapping "# Hashtag" or "@ Mention" types the symbol at the cursor
// and opens the suggestions straight away.
import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useTokenSuggestions, useForcedSelection, SuggestionList } from './MentionSuggestions';
import { colors, radius, spacing } from '../constants/theme';

const CaptionComposer = ({ value, onChangeText, placeholder, maxLength, postsLabel, hints }) => {
  const inputRef = useRef(null);
  const [selection, setSelection] = useState({ start: value.length, end: value.length });
  const [forced, setCaret] = useForcedSelection();
  const { token, items, loading, pick, visible } = useTokenSuggestions(value, selection.end);

  const apply = (next) => {
    if (!next || (maxLength && next.text.length > maxLength)) return;
    onChangeText(next.text);
    setSelection({ start: next.cursor, end: next.cursor });
    setCaret(next.cursor);
  };

  // Type a trigger at the cursor, with a space before it when it would
  // otherwise glue onto a word (and so not count as a tag).
  const insertTrigger = (ch) => {
    const at = selection.end ?? value.length;
    const before = value.slice(0, at);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    const text = `${before}${pad}${ch}${value.slice(at)}`;
    if (maxLength && text.length > maxLength) return;
    apply({ text, cursor: at + pad.length + 1 });
    inputRef.current?.focus();
  };

  return (
    <View>
      <TextInput
        ref={inputRef}
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        value={value}
        onChangeText={onChangeText}
        onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
        selection={forced}
        multiline
        maxLength={maxLength}
        autoCorrect={!token}
        autoCapitalize={token ? 'none' : 'sentences'}
      />
      {visible && (
        <SuggestionList
          style={styles.list}
          token={token}
          items={items}
          loading={loading}
          postsLabel={postsLabel}
          onPick={(v) => apply(pick(v))}
        />
      )}
      <View style={styles.footer}>
        {hints ? (
          <View style={styles.hints}>
            <TouchableOpacity style={styles.hint} onPress={() => insertTrigger('#')} accessibilityLabel={hints.hashtag}>
              <Text style={styles.hintSymbol}>#</Text>
              <Text style={styles.hintText}>{hints.hashtag}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.hint} onPress={() => insertTrigger('@')} accessibilityLabel={hints.mention}>
              <Text style={styles.hintSymbol}>@</Text>
              <Text style={styles.hintText}>{hints.mention}</Text>
            </TouchableOpacity>
          </View>
        ) : <View />}
        {maxLength ? <Text style={styles.count}>{value.length}/{maxLength}</Text> : null}
      </View>
      {hints?.tip && !token && <Text style={styles.tip}>{hints.tip}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  input: { minHeight: 96, color: colors.textPrimary, fontSize: 16, lineHeight: 22, textAlignVertical: 'top', padding: 0 },
  list: { marginTop: spacing.sm },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  hints: { flexDirection: 'row', gap: spacing.xs },
  hint: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full, backgroundColor: 'rgba(29,161,242,0.12)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(29,161,242,0.45)',
  },
  hintSymbol: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  hintText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  count: { color: colors.textMuted, fontSize: 12 },
  tip: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
});

export default CaptionComposer;
