import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchPublications, fetchMyPublications, fetchPublicationsByUrl } from '../services/api';
import { publicationsChangedSince } from '../services/publicationStore';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { CATEGORIES, categoryLabel } from '../utils/publications';
import useGridColumns from '../utils/useGridColumns';
import { PublicationListSkeleton } from '../components/SkeletonLoader';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

const TABS = ['discover', 'saved', 'mine'];
const REFRESH_AFTER_MS = 60000;

// One cached list per view (a search isn't kept: it's typed, not returned to).
const listKey = (uid, tab, category) => userKey(uid, `pubs:${tab}${tab === 'discover' ? `:${category}` : ''}`);

const AuthorAvatar = ({ uri, size = 18 }) => (
  <Image
    source={uri ? { uri } : DEFAULT_AVATAR}
    placeholder={DEFAULT_AVATAR}
    contentFit="cover"
    transition={150}
    style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface }}
  />
);

const PublicationCard = memo(({ item, onOpen, t, style }) => {
  const isDraft = item.status === 'draft';
  return (
    <TouchableOpacity style={[styles.card, style]} activeOpacity={0.85} onPress={() => onOpen(item)}
      accessibilityRole="button" accessibilityLabel={item.title}>
      {item.cover ? (
        <Image source={{ uri: item.cover }} style={styles.cover} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.cover, styles.coverFallback]}>
          <MaterialIcons name="menu-book" size={28} color={colors.textMuted} />
        </View>
      )}
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.catBadge} numberOfLines={1}>{categoryLabel(item.category, t)}</Text>
          {isDraft && <Text style={styles.draftBadge}>{t('pubDetail.draft')}</Text>}
          {item.is_bookmarked && <Ionicons name="bookmark" size={13} color={colors.primary} />}
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        {item.summary ? (
          <Text style={styles.cardSummary} numberOfLines={2}>{item.summary}</Text>
        ) : null}
        <View style={styles.cardMeta}>
          <AuthorAvatar uri={item.author?.profile_picture} />
          <Text style={[styles.cardMetaText, styles.cardAuthor]} numberOfLines={1}>
            {item.author?.username || t('articles.unknownAuthor')}
          </Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.cardMetaText}>{t('articles.chapterShort', { n: item.chapter_count || 0 })}</Text>
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
});

const Articles = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser, isAuthenticated } = useAuth();
  const uid = currentUser?.id;
  const [tab, setTab] = useState('discover');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const searching = tab === 'discover' && !!query.trim();
  const needsAccount = !isAuthenticated && tab !== 'discover';
  const cacheKey = searching ? null : listKey(uid, tab, category);

  // Opened again: the last list, at once — then refreshed behind it.
  const [items, setItems] = useState(() => peekCache(cacheKey)?.items || []);
  const [loading, setLoading] = useState(() => !peekCache(cacheKey));
  const [busy, setBusy] = useState(false);            // a search on its way
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(() => peekCache(cacheKey)?.next ?? null);
  const [failed, setFailed] = useState(false);        // nothing to show, and it didn't load
  const [offline, setOffline] = useState(false);      // showing kept rows; the refresh failed

  const { cols } = useGridColumns({ target: 380, min: 1, max: 2, horizontalPadding: spacing.md * 2, gap: spacing.sm });

  const request = useRef(0);                          // only the latest load may land
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const lastLoadRef = useRef(0);

  const load = useCallback(async ({ refresh = false } = {}) => {
    const mine = ++request.current;
    setFailed(false);
    if (needsAccount) {
      setItems([]); setNextUrl(null); setLoading(false); setOffline(false);
      return;
    }
    let painted = false;
    if (!refresh && cacheKey) {
      const kept = peekCache(cacheKey) ?? await readCache(cacheKey);
      if (mine !== request.current) return;
      if (Array.isArray(kept?.items)) {
        setItems(kept.items);
        setNextUrl(kept.next ?? null);
        setLoading(false);
        painted = true;
      }
    }
    if (refresh) setRefreshing(true);
    else if (!painted) {
      if (searching && itemsRef.current.length) setBusy(true);   // keep the rows while it looks
      else { setItems([]); setLoading(true); }
    }
    try {
      let res;
      if (tab === 'mine') res = await fetchMyPublications();
      else if (tab === 'saved') res = await fetchPublications({ saved: 1 });
      else {
        const params = {};
        if (query.trim()) params.search = query.trim();
        if (category !== 'all') params.category = category;
        res = await fetchPublications(params);
      }
      if (mine !== request.current) return;
      const rows = Array.isArray(res) ? res : (res?.results ?? []);
      const next = Array.isArray(res) ? null : (res?.next ?? null);
      setItems(rows);
      setNextUrl(next);
      setOffline(false);
      if (cacheKey) writeCache(cacheKey, { items: rows, next });
    } catch {
      if (mine !== request.current) return;
      if (itemsRef.current.length) setOffline(true);            // keep what's on screen
      else setFailed(true);
    } finally {
      if (mine === request.current) {
        setLoading(false);
        setBusy(false);
        setRefreshing(false);
        lastLoadRef.current = Date.now();
      }
    }
  }, [tab, query, category, cacheKey, searching, needsAccount]);

  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  // One load per change: a tab, a category, the account — at once; typing a
  // search — once it pauses. (Tab and search used to both fire, fetching twice.)
  useEffect(() => {
    if (tab === 'discover' && query.trim()) {
      const h = setTimeout(() => loadRef.current(), 350);
      return () => clearTimeout(h);
    }
    loadRef.current();
    return undefined;
  }, [tab, category, query, uid, isAuthenticated]);

  // Back on the screen: refresh when something was published / edited /
  // deleted / liked / saved since, or the list is a minute old.
  const didMountRef = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    const since = lastLoadRef.current;
    if (publicationsChangedSince(since) || Date.now() - since > REFRESH_AFTER_MS) loadRef.current();
  }, []));

  // Infinite scroll: follow the server's `next` link (carries the filters).
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextUrl) return;
    const mine = request.current;
    setLoadingMore(true);
    try {
      const res = await fetchPublicationsByUrl(nextUrl);
      if (mine !== request.current) return;            // the view changed meanwhile
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...(res?.results ?? []).filter((p) => !seen.has(p.id))];
      });
      setNextUrl(res?.next ?? null);
    } catch {
      // silent — pull-to-refresh recovers
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextUrl]);

  // The row carries what the book page needs to draw its top at once.
  const open = useCallback((item) => navigation.navigate('PublicationDetail', { id: item.id, preview: item }), [navigation]);
  const write = () => (isAuthenticated ? navigation.navigate('PublicationEditor', {}) : navigation.navigate('Login'));

  // ── Featured hero (top story in Discover) ──
  const renderFeatured = (item) => (
    <TouchableOpacity style={styles.featured} activeOpacity={0.9} onPress={() => open(item)}
      accessibilityRole="button" accessibilityLabel={item.title}>
      {item.cover ? (
        <Image source={{ uri: item.cover }} style={styles.featuredCover} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.featuredCover, styles.coverFallback]}>
          <MaterialIcons name="auto-stories" size={48} color={colors.textMuted} />
        </View>
      )}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.featuredOverlay}>
        <Text style={styles.featuredKicker}>
          {categoryLabel(item.category, t)}{item.status === 'draft' ? `  ·  ${t('pubDetail.draft')}` : ''}
        </Text>
        <Text style={styles.featuredTitle} numberOfLines={2}>{item.title}</Text>
        <View style={styles.featuredMeta}>
          <AuthorAvatar uri={item.author?.profile_picture} size={20} />
          <Text style={[styles.featuredAuthor, styles.cardAuthor]} numberOfLines={1}>
            {item.author?.username || t('articles.unknownAuthor')}
          </Text>
          <Text style={styles.featuredDot}>·</Text>
          <Text style={styles.featuredAuthor}>{t('articles.chapterShort', { n: item.chapter_count || 0 })}</Text>
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

  const renderItem = useCallback(({ item }) => (
    <PublicationCard item={item} onOpen={open} t={t} style={cols > 1 ? styles.cardInGrid : null} />
  ), [open, t, cols]);

  const showFeatured = tab === 'discover' && category === 'all' && !searching && items.length > 0;
  const featured = showFeatured ? items[0] : null;
  const listData = showFeatured ? items.slice(1) : items;

  const renderEmpty = () => {
    if (featured) return null;
    if (needsAccount) {
      return (
        <View style={styles.empty}>
          <Ionicons name="person-circle-outline" size={46} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t(tab === 'saved' ? 'articles.signInSaved' : 'articles.signInMine')}</Text>
          <TouchableOpacity style={styles.writeNow} onPress={() => navigation.navigate('Login')}>
            <Text style={styles.writeNowText}>{t('auth.login')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (failed) {
      return (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={46} color={colors.textMuted} />
          <Text style={styles.emptyText}>{t('articles.loadFailed')}</Text>
          <TouchableOpacity style={styles.writeNow} onPress={() => load()} testID="articles-retry">
            <Text style={styles.writeNowText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.empty}>
        <MaterialIcons name="library-books" size={46} color={colors.textMuted} />
        <Text style={styles.emptyText}>
          {tab === 'mine' ? t('articles.noneMine') : tab === 'saved' ? t('articles.noSaved') : t('articles.none')}
        </Text>
        {tab === 'mine' && (
          <TouchableOpacity style={styles.writeNow} onPress={write}>
            <Text style={styles.writeNowText}>{t('articles.startWriting')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('articles.title')}</Text>
        <Text style={styles.headerSub}>{t('articles.subtitle')}</Text>
      </View>

      {/* Segmented tabs */}
      <View style={styles.segment} accessibilityRole="tablist">
        {TABS.map((key) => {
          const active = key === tab;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
              onPress={() => setTab(key)}
              activeOpacity={0.85}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              testID={`articles-tab-${key}`}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
                {t(`articles.tab.${key}`)}
              </Text>
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
              placeholder={t('articles.searchPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              autoCorrect={false}
            />
            {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catRow}>
            {[{ key: 'all' }, ...CATEGORIES].map((c) => {
              const active = c.key === category;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.catChip, active && styles.catChipActive]}
                  onPress={() => setCategory(c.key)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                    {c.key === 'all' ? t('articles.all') : categoryLabel(c.key, t)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      {offline ? (
        <View style={styles.offlineBar} testID="articles-offline">
          <Ionicons name="cloud-offline-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.offlineText}>{t('articles.offline')}</Text>
        </View>
      ) : null}

      {loading ? (
        // Nothing kept yet: cards about to fill in, not a spinner.
        <View style={styles.listContent}><PublicationListSkeleton count={5} /></View>
      ) : (
        <FlatList
          key={`cols-${cols}`}
          data={listData}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          numColumns={cols}
          columnWrapperStyle={cols > 1 ? styles.gridRow : undefined}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={needsAccount ? undefined : () => load({ refresh: true })}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          initialNumToRender={6}
          windowSize={7}
          ListFooterComponent={
            loadingMore
              ? <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 16 }} />
              : null
          }
          ListHeaderComponent={featured ? renderFeatured(featured) : null}
          ListEmptyComponent={renderEmpty()}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={write}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel={t('articles.write')}
        testID="articles-write"
      >
        <Ionicons name="create-outline" size={20} color={colors.white} />
        <Text style={styles.fabText}>{t('articles.write')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
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

  offlineBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: spacing.md, marginBottom: spacing.xs, paddingVertical: 6,
    borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.06)',
  },
  offlineText: { ...typography.caption, color: colors.textSecondary },

  listContent: { padding: spacing.md, paddingBottom: 96 },
  gridRow: { gap: spacing.sm },

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
  cardInGrid: { flex: 1 },
  cover: { width: 92, height: 124, backgroundColor: colors.surface },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, padding: spacing.md, justifyContent: 'center' },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  catBadge: {
    ...typography.caption, color: colors.accent, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10.5, flexShrink: 1,
  },
  draftBadge: {
    color: colors.warning, fontWeight: '800', fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase',
    borderWidth: 1, borderColor: colors.warning, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1,
  },
  cardTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: 3, lineHeight: 22 },
  cardSummary: { ...typography.caption, color: colors.textSecondary, lineHeight: 17, marginBottom: spacing.sm },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardMetaText: { ...typography.caption, color: colors.textMuted },
  // A long name gives way; the chapter count and likes stay readable.
  cardAuthor: { flexShrink: 1 },
  metaDot: { color: colors.textMuted },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, gap: spacing.sm },
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
