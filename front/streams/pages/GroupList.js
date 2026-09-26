import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  useWindowDimensions,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/useAuth';
import {
  fetchGroups, fetchGroupsByUrl,
  fetchCommunities, fetchCommunitiesByUrl, fetchCommunityCategories,
  deleteGroup, joinGroupByCode,
} from '../services/api';
import GroupItem from './GroupItem';
import { useFocusEffect } from '@react-navigation/native';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { peekCache, readCache, writeCache } from '../utils/screenCache';
import { groupListKey } from '../utils/groupChat';
import { confirmAction, notify } from '../utils/adminConfirm';
import { subscribeDM } from '../services/dmSocket';
import { useI18n } from '../context/I18nContext';

const TAB_KEYS = [
  { key: 'public', icon: 'earth' },
  { key: 'private', icon: 'lock-closed' },
  { key: 'mine', icon: 'people' },
];

/**
 * Lists groups or communities — the same screen for both, since they run on one
 * engine. `mode` decides which: 'community' adds the category browse and the
 * per-category directory filters; 'group' is the plain list it has always been.
 */
// Which list is on screen — the cache keeps one per view (a search isn't kept).
const viewOf = (tab, category, filters) => {
  const f = Object.entries(filters || {}).filter(([, v]) => v && String(v).trim()).sort();
  return `${tab}:${category}${f.length ? `:${JSON.stringify(f)}` : ''}`;
};

const GroupList = ({ navigation, route, mode = 'group' }) => {
  const isCommunity = mode === 'community';
  const { t } = useI18n();
  const { currentUser } = useAuth();
  // Paint the last list seen for this view at once (memory, then disk), then
  // refresh it in place — faded while it does — instead of a spinner.
  const firstKey = groupListKey(currentUser?.id, mode, viewOf('public', route?.params?.category || 'all', {}));
  const [groups, setGroups] = useState(() => peekCache(firstKey)?.results ?? []);
  const [loading, setLoading] = useState(() => !peekCache(firstKey));
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);
  const [activeTab, setActiveTab] = useState('public');
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  // Category browse. Replaces the separate Churches/Choirs directory screens:
  // the kinds come from the API, so a category someone invented today shows up
  // here without a release.
  const [categories, setCategories] = useState([]);
  // A deep link may open the list pre-filtered to one category.
  const [activeCategory, setActiveCategory] = useState(route?.params?.category || 'all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Values for the active category's filterable fields (conference, genre, ...).
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isCommunity) return;
      try {
        const res = await fetchCommunityCategories();
        if (!alive) return;
        setCategories(Array.isArray(res) ? res : (res?.results || []));
      } catch (e) {
        console.log('[community] categories failed to load', e?.message);
      }
    })();
    return () => { alive = false; };
  }, [isCommunity]);

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.slug === activeCategory) || null,
    [categories, activeCategory],
  );
  // Only fields the category marks filterable become browse controls.
  const filterFields = useMemo(
    () => (selectedCategory?.field_schema || []).filter((f) => f.filterable),
    [selectedCategory],
  );

  // Switching category retires the previous category's filters.
  // (Same object when there's nothing to clear — a fresh {} would make the
  // list load a second time on open.)
  useEffect(() => {
    setFilters((f) => (Object.keys(f).length ? {} : f));
    setShowFilters(false);
  }, [activeCategory]);

  // Communities and groups are different features, so they get different
  // copy — "No public groups" on the community screen would just be wrong.
  const ns = isCommunity ? 'community.list' : 'group.list';
  // Two of this screen's strings live under the create namespace.
  const nsCreate = isCommunity ? 'community.create' : 'group.create';

  // Three tabs share one bar, so each gets a third of the width. On a 320pt
  // screen that leaves ~73pt for a label after the icon — enough for "My
  // Groups", not for "My Communities", which wrapped and deformed the bar.
  const { width: screenWidth } = useWindowDimensions();
  const compactTabs = screenWidth < 380;

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((v) => v && String(v).trim()).length,
    [filters],
  );

  // The rail shows how much lives behind each kind — a count is the difference
  // between a row of labels and something worth scrolling.
  const railItems = useMemo(() => {
    const total = categories.reduce((n, c) => n + (c.community_count || 0), 0);
    return [
      { id: 'all', slug: 'all', name: t('community.allCategories'), icon: 'apps', community_count: total },
      ...categories,
    ];
  }, [categories, t]);

  // This view's cache key (none while searching).
  const view = viewOf(activeTab, activeCategory, filters);
  const cacheKey = debouncedSearch ? null : groupListKey(currentUser?.id, mode, view);
  const viewRef = useRef(null);
  viewRef.current = `${view}|${debouncedSearch}`;
  const [failed, setFailed] = useState(false);

  // Another view: its cached list at once (or rows about to fill in).
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return undefined; }
    const hit = cacheKey ? peekCache(cacheKey) : null;
    setGroups(hit?.results ?? []);
    setNextUrl(hit?.next ?? null);
    setLoading(!hit);
    let cancelled = false;
    if (cacheKey && !hit) {
      readCache(cacheKey).then((disk) => {
        if (cancelled || !disk?.results?.length) return;
        setGroups((prev) => (prev.length ? prev : disk.results));
        setLoading(false);
      });
    }
    return () => { cancelled = true; };
  }, [cacheKey]);

  // Cold start: the disk copy of the first view, if the network hasn't answered.
  useEffect(() => {
    if (peekCache(firstKey)) return undefined;
    let cancelled = false;
    readCache(firstKey).then((disk) => {
      if (cancelled || !disk?.results?.length) return;
      setGroups((prev) => (prev.length ? prev : disk.results));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [firstKey]);

  // Page 1 of the current view. Both kinds scope their tabs on the server, so
  // each tab pages correctly (the old client-side split missed anything past
  // the first page). A late answer for a view they've left is dropped.
  const loadGroups = useCallback(async () => {
    const asked = viewRef.current;
    try {
      const data = isCommunity
        ? await fetchCommunities({ category: activeCategory, search: debouncedSearch, scope: activeTab, ...filters })
        : await fetchGroups({ scope: activeTab });
      if (viewRef.current !== asked) return data;
      const results = data?.results ?? (Array.isArray(data) ? data : []);
      setGroups(results);
      setNextUrl(data?.next ?? null);
      setFailed(false);
      if (cacheKey) writeCache(cacheKey, { results, next: data?.next ?? null });
      return data;
    } catch {
      // Whatever is on screen stays; an empty screen offers a retry.
      if (viewRef.current === asked) setFailed(true);
      return null;
    } finally {
      if (viewRef.current === asked) setLoading(false);
      setRefreshing(false);
    }
  }, [isCommunity, activeCategory, debouncedSearch, filters, activeTab, cacheKey]);

  // Infinite scroll: append the next page of groups, deduped by slug.
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextUrl) return;
    setLoadingMore(true);
    try {
      const res = isCommunity
        ? await fetchCommunitiesByUrl(nextUrl)
        : await fetchGroupsByUrl(nextUrl);
      setGroups((prev) => {
        const have = new Set(prev.map((g) => g.slug));
        return [...prev, ...(res?.results ?? []).filter((g) => !have.has(g.slug))];
      });
      setNextUrl(res?.next ?? null);
    } catch {
      // silent — pull-to-refresh recovers
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextUrl, isCommunity]);

  // On focus, and whenever the view changes (tab, category, search, filters):
  // one request — this used to fire twice on open for communities.
  const loadRef = useRef(loadGroups);
  loadRef.current = loadGroups;
  // While on screen: a slow poll (big communities aren't told live).
  useFocusEffect(useCallback(() => {
    loadRef.current();
    const id = setInterval(() => loadRef.current(), 60000);
    return () => clearInterval(id);
  }, []));

  // Live: a new message moves its group to the top with its badge (smaller
  // groups are told on the person's own socket); reading it clears the badge.
  useEffect(() => {
    let soon = null;
    const unsub = subscribeDM((e) => {
      if (e.type === 'group_read') {
        const now = new Date().toISOString();
        setGroups((prev) => prev.map((g) => (g.slug === e.group_slug
          ? { ...g, unread_count: 0, my_settings: g.my_settings ? { ...g.my_settings, last_read_at: now } : g.my_settings } : g)));
        return;
      }
      if (e.type !== 'group_message' || (e.kind && e.kind !== (isCommunity ? 'community' : 'group'))) return;
      const m = e.message || {};
      setGroups((prev) => {
        const row = prev.find((g) => g.slug === e.group_slug);
        if (!row) {                                  // not in this view's page: ask again
          clearTimeout(soon);
          soon = setTimeout(() => loadRef.current(), 500);
          return prev;
        }
        const mine = m.sender_id === currentUser?.id;
        const updated = {
          ...row,
          last_message: { ...m, sender_username: mine ? null : m.sender_username },
          unread_count: mine ? row.unread_count : (row.unread_count || 0) + 1,
        };
        return [updated, ...prev.filter((g) => g.slug !== e.group_slug)];
      });
    });
    return () => { unsub(); clearTimeout(soon); };
  }, [isCommunity, currentUser?.id]);
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    loadGroups();
  }, [loadGroups]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadGroups();
  }, [loadGroups]);

  // Web-safe: Alert's buttons never fire on web, so deleting did nothing there.
  const handleDeleteGroup = useCallback(async (group) => {
    const ok = await confirmAction({
      title: t(`${nsCreate}.deleteTitle`), message: t(`${ns}.deleteConfirm`, { name: group.name }),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    try {
      await deleteGroup(group.slug);
      setGroups((prev) => prev.filter((g) => g.slug !== group.slug));
    } catch (error) {
      notify(t('common.error'), error?.detail || error?.message || t(`${ns}.deleteFailed`));
    }
  }, [t, ns, nsCreate]);

  const handleEditGroup = useCallback((group) => {
    navigation.navigate('CreateGroup', {
      group,
      mode,
      onSubmit: (updatedGroup) => {
        setGroups(prev => prev.map(g =>
          g.slug === updatedGroup.slug ? updatedGroup : g
        ));
      },
    });
  }, [navigation, mode]);

  const handleJoinByCode = useCallback(async () => {
    const code = joinCode.trim();
    if (!code) return;
    setJoining(true);
    try {
      const group = await joinGroupByCode(code);
      setJoinOpen(false);
      setJoinCode('');
      loadGroups();
      navigation.navigate('GroupDetail', { groupSlug: group.slug, group });
    } catch (e) {
      notify(t(`${ns}.joinFailedTitle`), e?.response?.data?.error || t(`${ns}.inviteInvalid`));
    } finally {
      setJoining(false);
    }
  }, [joinCode, loadGroups, navigation, t, ns]);

  // Split the visible groups into the three tabs. Private groups only ever reach
  // the client when the user is already a member (server-enforced), so the
  // Private tab naturally shows just the private groups they belong to.
  // Both kinds are scoped by the server now, so the page is the answer.
  const filtered = groups;

  // Pass the group along so its chat opens at once, without a refetch.
  const openGroup = useCallback((item) => {
    navigation.navigate('GroupDetail', { groupSlug: item.slug, group: item });
  }, [navigation]);

  const renderGroupItem = useCallback(({ item }) => (
    <GroupItem
      group={item}
      onPress={openGroup}
      onDelete={handleDeleteGroup}
      onEdit={handleEditGroup}
      isCreator={currentUser?.id === item.creator?.id}
    />
  ), [currentUser?.id, handleDeleteGroup, handleEditGroup, openGroup]);

  const emptyCopy = isCommunity && (activeCategory !== 'all' || debouncedSearch)
    ? { title: t('community.list.noneInCategory'), sub: t('community.list.noneInCategorySub') }
    : {
      public: { title: t(`${ns}.noPublic`), sub: t(`${ns}.noPublicSub`) },
      private: {
        title: t(`${ns}.noPrivate`),
        sub: t(`${ns}.privateNote`),
      },
      mine: { title: t(`${ns}.notInAny`), sub: t(`${ns}.notInAnySub`) },
      archived: { title: t('group.list.noArchived'), sub: t('group.list.noArchivedSub') },
    }[activeTab];

  const renderEmptyComponent = useCallback(() => (loading ? (
    <View style={styles.emptyContainer}><ActivityIndicator size="large" color="#F4A261" /></View>
  ) : failed ? (
    <View style={styles.emptyContainer}>
      <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
      <Text style={styles.emptyText}>{t(`${ns}.loadFailed`)}</Text>
      <TouchableOpacity onPress={() => { setLoading(true); loadGroups(); }} style={styles.retryBtn} testID="groups-retry">
        <Text style={styles.retryText}>{t('common.retry')}</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <View style={styles.emptyContainer}>
      <Ionicons name="people-circle-outline" size={56} color={colors.textMuted} />
      <Text style={styles.emptyText}>{emptyCopy.title}</Text>
      <Text style={styles.emptySubtext}>{emptyCopy.sub}</Text>
    </View>
  )), [emptyCopy, loading, failed, t, ns, loadGroups]);

  // The tabs, search and categories stay on screen while a view loads — only
  // the list waits (a spinner in its place, or the old rows, faded).

  return (
    <View style={styles.root}>
      <View style={styles.container}>
        {/* Tabs */}
        <View style={styles.tabBar}>
          {TAB_KEYS.map((tab) => {
            const active = activeTab === tab.key || (tab.key === 'mine' && activeTab === 'archived');
            const label = compactTabs && tab.key === 'mine'
              ? t(`${ns}.tabMineShort`)
              : t(`${ns}.tab${tab.key.charAt(0).toUpperCase()}${tab.key.slice(1)}`);
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.85}
              >
                <Ionicons name={tab.icon} size={15} color={active ? '#0A1628' : colors.textSecondary} />
                <Text
                  style={[styles.tabText, active && styles.tabTextActive]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Search + category browse — the old Churches/Choirs directory. */}
        {isCommunity && (
        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={t('community.browseSearch')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          {filterFields.length > 0 && (
            <TouchableOpacity
              onPress={() => setShowFilters((v) => !v)}
              hitSlop={10}
              style={styles.filterToggle}
            >
              <Ionicons
                name="options-outline"
                size={18}
                color={activeFilterCount ? colors.accent : colors.textMuted}
              />
              {activeFilterCount > 0 && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>
        )}

        {isCommunity && (
        <View style={styles.railWrap}>
          <FlatList
            horizontal
            data={railItems}
            keyExtractor={(item) => String(item.slug)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRow}
            renderItem={({ item }) => {
              const active = activeCategory === item.slug;
              const count = item.community_count;
              return (
                <TouchableOpacity
                  style={[styles.categoryChip, active && styles.categoryChipActive]}
                  onPress={() => setActiveCategory(item.slug)}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={item.icon || 'people'}
                    size={18}
                    color={active ? '#0A1628' : colors.accent}
                  />
                  <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                    {item.name}
                  </Text>
                  {count > 0 && (
                    <Text style={[styles.categoryCount, active && styles.categoryCountActive]}>
                      {count}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
        )}

        {isCommunity && showFilters && filterFields.length > 0 && (
          <View style={styles.filterPanel}>
            {filterFields.map((field) => (
              <View style={styles.filterField} key={field.key}>
                <Text style={styles.filterLabel}>{field.label}</Text>
                <TextInput
                  style={styles.filterInput}
                  value={filters[field.key] || ''}
                  onChangeText={(v) => setFilters((prev) => ({ ...prev, [field.key]: v }))}
                  placeholder={field.label}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="words"
                />
              </View>
            ))}
            {activeFilterCount > 0 && (
              <TouchableOpacity onPress={() => setFilters({})} style={styles.clearFilters}>
                <Text style={styles.clearFiltersText}>{t('community.clearFilters')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Mine: the ones tucked away are a tap off. */}
        {activeTab === 'mine' || activeTab === 'archived' ? (
          <TouchableOpacity style={styles.archivedLink} testID="archived-toggle"
            onPress={() => setActiveTab(activeTab === 'archived' ? 'mine' : 'archived')}>
            <Ionicons name={activeTab === 'archived' ? 'arrow-back' : 'archive-outline'} size={15} color={colors.accent} />
            <Text style={styles.archivedLinkText}>{activeTab === 'archived' ? t('group.list.backToMine') : t('group.list.archived')}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Actions */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => navigation.navigate('CreateGroup', { mode })}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={18} color="#0A1628" />
            <Text style={styles.createButtonText}>{t(`${ns}.new`)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.codeButton} onPress={() => setJoinOpen(true)} activeOpacity={0.85}>
            <Ionicons name="link" size={18} color={colors.accent} />
            <Text style={styles.codeButtonText}>{t(`${ns}.joinWithCode`)}</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.slug}
          renderItem={renderGroupItem}
          ListEmptyComponent={renderEmptyComponent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={['#4F46E5']}
              tintColor="#fff"
            />
          }
          style={loading && filtered.length > 0 && !refreshing ? styles.fading : null}
          contentContainerStyle={filtered.length === 0 && styles.listContent}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={11}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore
              ? <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: spacing.md }} />
              : null
          }
        />
      </View>

      {/* Join with invite code */}
      <Modal visible={joinOpen} transparent animationType="fade" onRequestClose={() => setJoinOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setJoinOpen(false)}>
          <Pressable style={styles.modalCard}>
            <View style={styles.modalIcon}><Ionicons name="link" size={26} color={colors.accent} /></View>
            <Text style={styles.modalTitle}>{t(`${ns}.joinWithInvite`)}</Text>
            <Text style={styles.modalText}>{t(`${ns}.invitePrompt`)}</Text>
            <TextInput
              style={styles.codeInput}
              placeholder={t(`${ns}.invitePlaceholder`)}
              placeholderTextColor={colors.placeholder}
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancelBtn]} onPress={() => setJoinOpen(false)} activeOpacity={0.85}>
                <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalJoinBtn, !joinCode.trim() && styles.disabledButton]} onPress={handleJoinByCode} disabled={!joinCode.trim() || joining} activeOpacity={0.85}>
                {joining ? <ActivityIndicator color="#0A1628" size="small" /> : <Text style={styles.modalJoinText}>{t('common.join')}</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  archivedLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginHorizontal: spacing.md, marginBottom: spacing.xs, paddingVertical: 4 },
  archivedLinkText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  root: { flex: 1, backgroundColor: 'transparent' },
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: 'transparent' },
  fading: { opacity: 0.6 },
  retryBtn: { marginTop: spacing.sm, backgroundColor: colors.accent, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: '#0A1628', fontWeight: '800' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(13,35,64,0.7)',
    borderRadius: radius.full,
    padding: 4,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: spacing.sm, borderRadius: radius.full,
  },
  tabActive: { backgroundColor: colors.accent, ...shadows.sm },
  // Shrinks and ellipsizes rather than pushing the row apart, whatever the
  // device's font-scale accessibility setting is.
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', flexShrink: 1 },
  tabTextActive: { color: '#0A1628' },

  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  createButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.accent, paddingVertical: spacing.sm + 4, borderRadius: radius.md, ...shadows.sm,
  },
  createButtonText: { color: '#0A1628', fontWeight: '800', fontSize: 14 },
  codeButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4, borderRadius: radius.md,
    backgroundColor: 'rgba(16,46,80,0.7)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.4)',
  },
  codeButtonText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  disabledButton: { opacity: 0.6 },

  // Search, the rail and the tab bar share one pill vocabulary: same fill,
  // same hairline, same full radius, 44px tall so every target is thumb-sized.
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2,
    marginHorizontal: spacing.md, marginTop: spacing.xs,
    height: 44, paddingHorizontal: spacing.md - 2,
    backgroundColor: 'rgba(13,35,64,0.7)', borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 },
  filterToggle: { paddingLeft: spacing.xs },
  filterBadge: {
    position: 'absolute', top: -4, right: -6, minWidth: 14, height: 14,
    borderRadius: 7, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  filterBadgeText: { fontSize: 9, fontWeight: '800', color: '#0A1628' },
  railWrap: { position: 'relative' },
  categoryRow: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    height: 44, paddingHorizontal: spacing.md - 2, borderRadius: radius.full,
    backgroundColor: 'rgba(13,35,64,0.7)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
  },
  categoryChipActive: { backgroundColor: colors.accent, borderColor: colors.accent, ...shadows.sm },
  categoryChipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '700' },
  categoryChipTextActive: { color: '#0A1628', fontWeight: '800' },
  categoryCount: { fontSize: 11, fontWeight: '800', color: colors.textMuted },
  categoryCountActive: { color: 'rgba(10,22,40,0.6)' },
  filterPanel: {
    marginHorizontal: spacing.md, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md - 2, paddingVertical: spacing.sm + 2,
    backgroundColor: 'rgba(13,35,64,0.7)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    gap: spacing.sm,
  },
  filterField: { gap: 4 },
  filterLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  filterInput: {
    fontSize: 14, color: colors.textPrimary, height: 34,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 0,
  },
  clearFilters: { alignSelf: 'flex-end', paddingTop: spacing.xs },
  clearFiltersText: { ...typography.caption, color: colors.accent, fontWeight: '800' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 90, gap: spacing.xs },
  emptyText: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm },
  emptySubtext: { fontSize: 13.5, color: colors.textSecondary, textAlign: 'center' },
  listContent: { flexGrow: 1 },

  // Join-with-code modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: {
    width: '100%', maxWidth: 360, backgroundColor: 'rgba(16,46,80,0.98)', borderRadius: radius.xl,
    padding: spacing.lg, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.35)', ...shadows.lg,
  },
  modalIcon: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(244,162,97,0.14)', borderWidth: 1, borderColor: 'rgba(244,162,97,0.5)', marginBottom: spacing.md,
  },
  modalTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '800', textAlign: 'center' },
  modalText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  codeInput: {
    alignSelf: 'stretch', marginTop: spacing.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, color: colors.textPrimary,
    backgroundColor: 'rgba(13,35,64,0.85)', fontSize: 15,
  },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' },
  modalBtn: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.lg, alignItems: 'center' },
  modalCancelBtn: { backgroundColor: 'rgba(18,30,46,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  modalCancelText: { ...typography.button, color: colors.textSecondary, fontWeight: '700' },
  modalJoinBtn: { backgroundColor: colors.accent },
  modalJoinText: { ...typography.button, color: '#0A1628', fontWeight: '800' },
});

export default React.memo(GroupList);
