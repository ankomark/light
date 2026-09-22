// #hashtag / @mention autocomplete, shared by the caption box and the comment
// box: a hook that watches the token under the cursor and fetches matches,
// and the list that renders them.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { fetchHashtagSuggestions, fetchMentionSuggestions } from '../services/api';
import { activeToken, applySuggestion } from '../utils/richText';
import formatCount from '../utils/formatCount';
import { colors, radius, spacing } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const DEBOUNCE_MS = 220;

/**
 * Watches `value` at `cursor` for a #tag / @name being typed and fetches
 * suggestions (debounced; stale answers dropped). `pick(value)` returns the
 * completed { text, cursor } for the caller to apply.
 */
export const useTokenSuggestions = (value, cursor) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const token = activeToken(value, cursor);
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
    if (!token) return null;
    setItems([]);
    return applySuggestion(value, token, val);
  }, [token, value]);

  return { token, items, loading, pick, visible: !!token && (loading || items.length > 0) };
};

/**
 * Imposing a caret on a TextInput fights the user's own moves, so it's done
 * for one render after a completion and then released. Returns
 * [selectionProp, setCaret].
 */
export const useForcedSelection = () => {
  const [forced, setForced] = useState(null);
  useEffect(() => {
    if (!forced) return undefined;
    const id = setTimeout(() => setForced(null), 0);
    return () => clearTimeout(id);
  }, [forced]);
  return [forced || undefined, (pos) => setForced({ start: pos, end: pos })];
};

export const SuggestionList = ({ token, items, loading, onPick, postsLabel, style }) => (
  <View style={[styles.list, style]}>
    {loading && !items.length ? (
      <ActivityIndicator style={styles.spinner} size="small" color={colors.primary} />
    ) : items.slice(0, 6).map((it) => (token.trigger === '#' ? (
      <TouchableOpacity key={`t_${it.tag}`} style={styles.row} onPress={() => onPick(it.tag)}>
        <View style={styles.hashIcon}><Text style={styles.hash}>#</Text></View>
        <Text style={styles.name} numberOfLines={1}>{it.tag}</Text>
        <Text style={styles.meta}>{postsLabel(formatCount(it.count || 0))}</Text>
      </TouchableOpacity>
    ) : (
      <TouchableOpacity key={`u_${it.id}`} style={styles.row} onPress={() => onPick(it.username)}>
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
);

const styles = StyleSheet.create({
  list: {
    borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: 'rgba(6,16,32,0.95)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
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
});
