// The caption box, with #hashtag and @mention autocomplete.
//
// As the author types a tag or a name, suggestions appear under the box:
// hashtags with how many posts use them, people with their avatar (the ones
// they follow first). Tapping one completes the word in place and puts the
// cursor after it. Lookups are debounced and stale answers dropped, so fast
// typing never flashes the wrong list.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { fetchHashtagSuggestions, fetchMentionSuggestions } from '../services/api';
import { activeToken, applySuggestion } from '../utils/richText';
import formatCount from '../utils/formatCount';
import { colors, radius, spacing } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const DEBOUNCE_MS = 220;

const CaptionComposer = ({ value, onChangeText, placeholder, maxLength, postsLabel }) => {
  const [selection, setSelection] = useState({ start: value.length, end: value.length });
  const [forced, setForced] = useState(null); // caret to impose once, after a completion
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const token = activeToken(value, selection.end);
  const tokenKey = token ? `${token.trigger}${token.query}` : '';
  const reqRef = useRef(0);

  useEffect(() => {
    if (!token) { setItems([]); setLoading(false); return undefined; }
    const req = ++reqRef.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = token.trigger === '#'
          ? await fetchHashtagSuggestions(token.query)
          : await fetchMentionSuggestions(token.query);
        if (req === reqRef.current) setItems(Array.isArray(res) ? res : []);
      } catch {
        if (req === reqRef.current) setItems([]);
      } finally {
        if (req === reqRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // tokenKey captures everything about the token that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenKey]);

  const pick = useCallback((val) => {
    if (!token) return;
    const next = applySuggestion(value, token, val);
    if (maxLength && next.text.length > maxLength) return;
    onChangeText(next.text);
    const caret = { start: next.cursor, end: next.cursor };
    setSelection(caret);
    setForced(caret);
    setItems([]);
  }, [token, value, onChangeText, maxLength]);

  // A controlled `selection` fights the user's own caret moves, so it's only
  // imposed for the render right after a completion, then released.
  useEffect(() => {
    if (!forced) return undefined;
    const id = setTimeout(() => setForced(null), 0);
    return () => clearTimeout(id);
  }, [forced]);

  const showList = !!token && (loading || items.length > 0);

  return (
    <View>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        value={value}
        onChangeText={onChangeText}
        onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
        selection={forced || undefined}
        multiline
        maxLength={maxLength}
        autoCorrect={!token}
        autoCapitalize={token ? 'none' : 'sentences'}
      />
      {showList && (
        <View style={styles.list}>
          {loading && !items.length ? (
            <ActivityIndicator style={styles.spinner} size="small" color={colors.primary} />
          ) : items.slice(0, 6).map((it) => (token.trigger === '#' ? (
            <TouchableOpacity key={`t_${it.tag}`} style={styles.row} onPress={() => pick(it.tag)}>
              <View style={styles.hashIcon}><Text style={styles.hash}>#</Text></View>
              <Text style={styles.name} numberOfLines={1}>{it.tag}</Text>
              <Text style={styles.meta}>{postsLabel(formatCount(it.count || 0))}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity key={`u_${it.id}`} style={styles.row} onPress={() => pick(it.username)}>
              <Image
                source={it.profile_picture ? { uri: it.profile_picture } : DEFAULT_AVATAR}
                placeholder={DEFAULT_AVATAR}
                cachePolicy="memory-disk"
                style={styles.avatar}
              />
              <Text style={styles.name} numberOfLines={1}>{it.username}</Text>
            </TouchableOpacity>
          )))}
        </View>
      )}
      {maxLength ? <Text style={styles.count}>{value.length}/{maxLength}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  input: { minHeight: 96, color: colors.textPrimary, fontSize: 16, lineHeight: 22, textAlignVertical: 'top', padding: 0 },
  list: {
    marginTop: spacing.sm, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: 'rgba(6,16,32,0.75)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  spinner: { paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, paddingHorizontal: spacing.sm },
  hashIcon: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(29,161,242,0.16)',
  },
  hash: { color: colors.primary, fontSize: 16, fontWeight: '800' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface },
  name: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 12 },
  count: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: spacing.xs },
});

export default CaptionComposer;
