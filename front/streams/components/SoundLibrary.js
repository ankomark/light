// The sound picker: what's trending on posts right now, the full library, and
// search across both. Trending shows how many recent posts use each sound.
//
// Both lists paint from this session's cache first (the Music tab already
// loaded the library), and search is debounced with stale answers dropped.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { fetchTracks, fetchTrendingSounds } from '../services/api';
import { peekCache, readCache, writeCache } from '../utils/screenCache';
import formatCount from '../utils/formatCount';
import { colors, radius, spacing } from '../constants/theme';

const artistName = (s) => (typeof s?.artist === 'string' ? s.artist : s?.artist?.username || '');
const TRENDING_KEY = 'sounds:trending';

const SoundRow = React.memo(({ item, selected, onPick, usesLabel }) => (
  <TouchableOpacity style={[styles.row, selected && styles.rowActive]} onPress={() => onPick(item)}>
    {item.cover_image ? (
      <Image source={{ uri: item.cover_image }} style={styles.cover} contentFit="cover" cachePolicy="memory-disk" />
    ) : (
      <View style={[styles.cover, styles.coverEmpty]}><MaterialIcons name="music-note" size={20} color={colors.accent} /></View>
    )}
    <View style={styles.flex}>
      <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
      <Text style={styles.meta} numberOfLines={1}>
        {artistName(item)}
        {item.recent_uses ? `  ·  ${usesLabel(formatCount(item.recent_uses))}` : ''}
      </Text>
    </View>
    <Feather name="chevron-right" size={20} color={colors.textMuted} />
  </TouchableOpacity>
));
SoundRow.displayName = 'SoundRow';

const SoundLibrary = ({ tracksKey, selectedId, onPick, t }) => {
  const [tab, setTab] = useState('trending');
  const [trending, setTrending] = useState(() => peekCache(TRENDING_KEY) ?? []);
  const [library, setLibrary] = useState(() => peekCache(tracksKey) ?? []);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    if (!library.length) {
      readCache(tracksKey).then((c) => { if (!cancelled && Array.isArray(c) && c.length) setLibrary((p) => (p.length ? p : c)); });
    }
    fetchTrendingSounds()
      .then((rows) => { if (!cancelled && Array.isArray(rows)) { setTrending(rows); writeCache(TRENDING_KEY, rows, { persist: false }); } })
      .catch(() => {});
    fetchTracks()
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.results ?? [];
        if (!cancelled && list.length) { setLibrary(list); writeCache(tracksKey, list); }
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksKey]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setLoading(false); return undefined; }
    const req = ++reqRef.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const data = await fetchTracks(1, q);
        if (req === reqRef.current) setResults(Array.isArray(data) ? data : data?.results ?? []);
      } catch {
        if (req === reqRef.current) setResults([]);
      } finally {
        if (req === reqRef.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const usesLabel = useCallback((n) => t('sound.uses', { count: n }), [t]);
  const searching = query.trim().length > 0;
  const data = searching ? results : tab === 'trending' ? trending : library;
  const renderItem = useCallback(({ item }) => (
    <SoundRow item={item} selected={item.id === selectedId} onPick={onPick} usesLabel={usesLabel} />
  ), [selectedId, onPick, usesLabel]);

  return (
    <View style={styles.flex}>
      <View style={styles.search}>
        <Feather name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={t('sound.search')}
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          autoCorrect={false}
        />
        {searching && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Feather name="x-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {!searching && (
        <View style={styles.tabs}>
          {[['trending', t('sound.trending')], ['library', t('sound.library')]].map(([key, label]) => (
            <TouchableOpacity key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabActive]}>
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {searching && loading && !results.length ? (
        <ActivityIndicator style={styles.spinner} color={colors.primary} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          ListEmptyComponent={
            <Text style={styles.empty}>{searching ? t('sound.noResults') : t('sound.empty')}</Text>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md,
    paddingHorizontal: spacing.md, height: 42, borderRadius: radius.full,
    backgroundColor: 'rgba(14,30,52,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15, padding: 0 },
  tabs: { flexDirection: 'row', gap: spacing.lg, marginHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.xs },
  tab: { paddingBottom: 6, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
  tabTextActive: { color: colors.textPrimary },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, paddingTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, paddingHorizontal: spacing.xs, borderRadius: radius.md },
  rowActive: { backgroundColor: 'rgba(29,161,242,0.14)' },
  cover: { width: 46, height: 46, borderRadius: radius.sm, backgroundColor: colors.surface },
  coverEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(244,162,97,0.14)' },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  spinner: { marginTop: spacing.xl },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
});

export default SoundLibrary;
