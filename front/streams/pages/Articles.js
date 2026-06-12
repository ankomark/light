import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, Image,
  ActivityIndicator, ScrollView, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchPublications, fetchMyPublications } from '../services/api';
import { CATEGORIES, categoryLabel } from '../utils/publications';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const { width } = Dimensions.get('window');
const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

const TABS = [
  { key: 'discover', label: 'Discover' },
  { key: 'saved', label: 'Saved' },
  { key: 'mine', label: 'My Work' },
];

const AuthorAvatar = ({ uri, size = 18 }) => (
  <Image
    source={uri ? { uri } : DEFAULT_AVATAR}
    defaultSource={DEFAULT_AVATAR}
    style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface }}
  />
);

const Articles = ({ navigation }) => {
  const [tab, setTab] = useState('discover');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const debounceRef = useRef(null);

  const load = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true); else setLoading(true);
      let res;
      if (tab === 'mine') {
        res = await fetchMyPublications();
      } else if (tab === 'saved') {
        res = await fetchPublications({ saved: 1 });
      } else {
        const params = {};
        if (query.trim()) params.search = query.trim();
        if (category !== 'all') params.category = category;
        res = await fetchPublications(params);
      }
      setItems(Array.isArray(res) ? res : (res?.results ?? []));
    } catch (err) {
      console.error('Error loading publications:', err);
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, query, category]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (tab !== 'discover') return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(), 350);
    return () => clearTimeout(debounceRef.current);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (item) => navigation.navigate('PublicationDetail', { id: item.id });

  // ── Featured hero (top story in Discover) ──
  const renderFeatured = (item) => (
    <TouchableOpacity style={styles.featured} activeOpacity={0.9} onPress={() => open(item)}>
      {item.cover ? (
        <Image source={{ uri: item.cover }} style={styles.featuredCover} />
      ) : (
        <View style={[styles.featuredCover, styles.coverFallback]}>
          <MaterialIcons name="auto-stories" size={48} color={colors.textMuted} />
        </View>
      )}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.featuredOverlay}>
        <Text style={styles.featuredKicker}>
          {categoryLabel(item.category)}{item.status === 'draft' ? '  ·  DRAFT' : ''}
        </Text>
        <Text style={styles.featuredTitle} numberOfLines={2}>{item.title}</Text>
        <View style={styles.featuredMeta}>
          <AuthorAvatar uri={item.author?.profile_picture} size={20} />
          <Text style={styles.featuredAuthor} numberOfLines={1}>{item.author?.username || 'Unknown'}</Text>
          <Text style={styles.featuredDot}>·</Text>
          <Text style={styles.featuredAuthor}>{item.chapter_count || 0} ch.</Text>
          {item.likes_count > 0 && (
            <>
              <Text style={styles.featuredDot}>·</Text>
              <Ionicons name="heart" size={12} color="#fff" />
              <Text style={styles.featuredAuthor}> {item.likes_count}</Text>
            </>
          )}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  const renderItem = ({ item }) => {
    const isDraft = item.status === 'draft';
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => open(item)}>
        {item.cover ? (
          <Image source={{ uri: item.cover }} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverFallback]}>
            <MaterialIcons name="menu-book" size={28} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.cardBody}>
          <View style={styles.cardTopRow}>
            <Text style={styles.catBadge}>{categoryLabel(item.category)}</Text>
            {isDraft && <Text style={styles.draftBadge}>DRAFT</Text>}
            {item.is_bookmarked && <Ionicons name="bookmark" size={13} color={colors.primary} />}
          </View>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
          {item.summary ? (
            <Text style={styles.cardSummary} numberOfLines={2}>{item.summary}</Text>
          ) : null}
          <View style={styles.cardMeta}>
            <AuthorAvatar uri={item.author?.profile_picture} />
            <Text style={styles.cardMetaText} numberOfLines={1}>{item.author?.username || 'Unknown'}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.cardMetaText}>{item.chapter_count || 0} ch.</Text>
            {item.likes_count > 0 && (
              <>
                <Ionicons name="heart" size={12} color={colors.textMuted} style={{ marginLeft: spacing.xs }} />
                <Text style={styles.cardMetaText}> {item.likes_count}</Text>
              </>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const showFeatured = tab === 'discover' && category === 'all' && !query.trim() && items.length > 0;
  const featured = showFeatured ? items[0] : null;
  const listData = showFeatured ? items.slice(1) : items;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Publish Books &amp; Articles</Text>
        <Text style={styles.headerSub}>Read and publish long-form writing</Text>
      </View>

      {/* Segmented tabs */}
      <View style={styles.segment}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
              onPress={() => setTab(t.key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === 'discover' && (
        <>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.placeholder} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search titles…"
              placeholderTextColor={colors.placeholder}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catRow}>
            {[{ key: 'all', label: 'All' }, ...CATEGORIES].map((c) => {
              const active = c.key === category;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.catChip, active && styles.catChipActive]}
                  onPress={() => setCategory(c.key)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.catChipText, active && styles.catChipTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={() => load(true)}
          extraData={category}
          ListHeaderComponent={featured ? renderFeatured(featured) : null}
          ListEmptyComponent={
            !featured ? (
              <View style={styles.empty}>
                <MaterialIcons name="library-books" size={46} color={colors.textMuted} />
                <Text style={styles.emptyText}>
                  {tab === 'mine'
                    ? "You haven't written anything yet"
                    : tab === 'saved'
                      ? 'No saved publications yet'
                      : 'No publications found'}
                </Text>
                {tab === 'mine' && (
                  <TouchableOpacity style={styles.writeNow} onPress={() => navigation.navigate('PublicationEditor', {})}>
                    <Text style={styles.writeNowText}>Start writing</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null
          }
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('PublicationEditor', {})}
        activeOpacity={0.9}
      >
        <Ionicons name="create-outline" size={20} color={colors.white} />
        <Text style={styles.fabText}>Write</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headerTitle: { ...typography.h1, color: colors.textPrimary },
  headerSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

  // Segmented control
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    padding: 4,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  segmentItem: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.full, alignItems: 'center' },
  segmentItemActive: { backgroundColor: colors.primary, ...shadows.sm },
  segmentText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  segmentTextActive: { color: colors.white },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.card, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    marginHorizontal: spacing.md, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  catScroll: { flexGrow: 0 },
  catRow: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: 'center' },
  catChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  catChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  catChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  catChipTextActive: { color: colors.white },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.md, paddingBottom: 96 },

  // Featured hero
  featured: {
    height: 210,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    ...shadows.md,
  },
  featuredCover: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  featuredOverlay: { flex: 1, justifyContent: 'flex-end', padding: spacing.md },
  featuredKicker: {
    ...typography.caption, color: colors.accent, fontWeight: '800',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4,
  },
  featuredTitle: { fontSize: 24, fontWeight: '800', color: colors.white, lineHeight: 28 },
  featuredMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  featuredAuthor: { ...typography.caption, color: 'rgba(255,255,255,0.9)', fontWeight: '600' },
  featuredDot: { color: 'rgba(255,255,255,0.6)' },

  // List card
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cover: { width: 92, height: 124, backgroundColor: colors.surface },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, padding: spacing.md, justifyContent: 'center' },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  catBadge: {
    ...typography.caption, color: colors.accent, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10.5,
  },
  draftBadge: {
    color: colors.warning, fontWeight: '800', fontSize: 9.5, letterSpacing: 0.5,
    borderWidth: 1, borderColor: colors.warning, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1,
  },
  cardTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: 3, lineHeight: 22 },
  cardSummary: { ...typography.caption, color: colors.textSecondary, lineHeight: 17, marginBottom: spacing.sm },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardMetaText: { ...typography.caption, color: colors.textMuted },
  metaDot: { color: colors.textMuted },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  writeNow: {
    marginTop: spacing.sm, backgroundColor: colors.primary,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  writeNowText: { ...typography.label, color: colors.white, fontWeight: '600' },

  fab: {
    position: 'absolute', bottom: spacing.lg, right: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
    borderRadius: radius.full, ...shadows.lg,
  },
  fabText: { ...typography.button, color: colors.white },
});

export default Articles;
