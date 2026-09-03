import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  ScrollView, TextInput, Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchAdminContent, fetchAdminByUrl, removeContent, restoreContent, bulkContent } from '../../services/api';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';
import { useI18n } from '../../context/I18nContext';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

const TYPES = [
  { key: 'post', label: 'Posts' },
  { key: 'track', label: 'Tracks' },
  { key: 'comment', label: 'Post comments' },
  { key: 'trackcomment', label: 'Track comments' },
  { key: 'group', label: 'Groups' },
  { key: 'story', label: 'Stories' },
  { key: 'publication', label: 'Publications' },
  { key: 'product', label: 'Products' },
  { key: 'productreview', label: 'Product reviews' },
  { key: 'grouppost', label: 'Group messages' },
  { key: 'videostudio', label: 'Studios' },
  { key: 'mediastation', label: 'Media stations' },
];

const AdminContent = () => {
  const { t } = useI18n();
  const [type, setType] = useState('post');
  const [query, setQuery] = useState('');
  const [removedOnly, setRemovedOnly] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);
  const debounceRef = useRef(null);

  const load = useCallback(async (t, q, removed) => {
    setLoading(true);
    try {
      const res = await fetchAdminContent(t, q, removed ? 'true' : '');
      setItems(res?.results || (Array.isArray(res) ? res : []));
      setNextUrl(res?.next || null);
    } catch {
      setItems([]);
      setNextUrl(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // nextUrl already encodes the active type/query/removed filters, so loadMore
  // just follows it — no need to thread the current filters through here.
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextUrl) return;
    setLoadingMore(true);
    try {
      const res = await fetchAdminByUrl(nextUrl);
      setItems((prev) => {
        const have = new Set(prev.map((it) => it.id));
        return [...prev, ...(res?.results || []).filter((it) => !have.has(it.id))];
      });
      setNextUrl(res?.next || null);
    } catch {
      // silent — pull-to-refresh recovers
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextUrl]);

  useFocusEffect(useCallback(() => { load(type, query.trim(), removedOnly); }, [load, type, removedOnly]));  // eslint-disable-line react-hooks/exhaustive-deps

  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };

  const onChangeQuery = (text) => {
    setQuery(text);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(type, text.trim(), removedOnly), 400);
  };

  const switchType = (t) => { setType(t); setQuery(''); exitSelect(); load(t, '', removedOnly); };
  const toggleRemoved = () => { const v = !removedOnly; setRemovedOnly(v); exitSelect(); load(type, query.trim(), v); };

  const toggleSelect = (id) => setSelected((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const runBulk = async (action) => {
    if (selected.size === 0) return;
    const ids = [...selected];
    setBulkBusy(true);
    try {
      await bulkContent(type, ids, action);
      setItems((prev) => prev.map((it) => (ids.includes(it.id) ? { ...it, is_removed: action === 'remove' } : it)));
      exitSelect();
    } catch {
      notify(t('common.error'), t('admin.bulkFailed'));
    } finally {
      setBulkBusy(false);
    }
  };

  const confirmBulkRemove = async () => {
    if (await confirmAction({
      title: t('admin.removeContentTitle'),
      message: t('admin.removeBulkConfirm', { count: selected.size, type }),
      confirmLabel: 'Remove',
      destructive: true,
    })) runBulk('remove');
  };

  const toggle = async (item) => {
    const willRemove = !item.is_removed;
    const doIt = async () => {
      setBusyId(item.id);
      try {
        await (willRemove ? removeContent(type, item.id) : restoreContent(type, item.id));
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, is_removed: willRemove } : it)));
      } catch {
        notify(t('common.error'), t('admin.actionFailedShort'));
      } finally {
        setBusyId(null);
      }
    };
    if (willRemove) {
      if (await confirmAction({
        title: t('admin.removeContentTitle'),
        message: t('admin.removeOneConfirm', { type }),
        confirmLabel: 'Remove',
        destructive: true,
      })) doIt();
    } else {
      doIt();
    }
  };

  const renderItem = ({ item }) => {
    const author = item.author;
    const text = item.caption || item.content || item.title || item.name || `#${item.id}`;
    const checked = selected.has(item.id);
    return (
      <Pressable
        onPress={() => selectMode && toggleSelect(item.id)}
        style={[styles.card, item.is_removed && styles.cardRemoved, checked && styles.cardSelected]}
      >
        <View style={styles.head}>
          {selectMode && (
            <View style={[styles.checkbox, checked && styles.checkboxOn]}>
              {checked && <Ionicons name="checkmark" size={13} color="#0A1628" />}
            </View>
          )}
          <Image
            source={author?.profile_picture ? { uri: author.profile_picture } : DEFAULT_AVATAR}
            placeholder={DEFAULT_AVATAR}
            contentFit="cover"
            transition={120}
            style={styles.avatar}
          />
          <Text style={styles.author} numberOfLines={1}>@{author?.username || 'unknown'}</Text>
          {item.is_removed && <Text style={styles.removedPill}>removed</Text>}
        </View>
        <Text style={styles.body} numberOfLines={3}>{text || '(no text)'}</Text>

        {!selectMode && (busyId === item.id ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
        ) : (
          <TouchableOpacity
            style={[styles.btn, item.is_removed ? styles.btnRestore : styles.btnRemove]}
            onPress={() => toggle(item)}
            activeOpacity={0.85}
          >
            <Ionicons name={item.is_removed ? 'refresh-outline' : 'trash-outline'} size={16}
              color={item.is_removed ? '#0A1628' : colors.white} />
            <Text style={item.is_removed ? styles.btnTextDark : styles.btnTextLight}>
              {item.is_removed ? 'Restore' : 'Remove'}
            </Text>
          </TouchableOpacity>
        ))}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t('admin.content')}</Text>
        <TouchableOpacity onPress={() => (selectMode ? exitSelect() : setSelectMode(true))}>
          <Text style={styles.selectToggle}>{selectMode ? 'Cancel' : 'Select'}</Text>
        </TouchableOpacity>
      </View>

      {/* Type pills — horizontally scrollable (6 types). flexGrow/Shrink 0 keeps
          the row at its content height so the pills aren't vertically clipped. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pillsScroll}
        contentContainerStyle={styles.filterRow}
      >
        {TYPES.map((tp) => {
          const active = type === tp.key;
          return (
            <TouchableOpacity key={tp.key} style={[styles.pill, active && styles.pillActive]}
              onPress={() => switchType(tp.key)} activeOpacity={0.85}>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{tp.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Search + removed-only toggle */}
      <View style={styles.toolRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.placeholder} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('admin.searchPlaceholder')}
            placeholderTextColor={colors.placeholder}
            value={query}
            onChangeText={onChangeQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <TouchableOpacity style={[styles.toggle, removedOnly && styles.toggleActive]} onPress={toggleRemoved} activeOpacity={0.85}>
          <Ionicons name={removedOnly ? 'eye-off' : 'eye-off-outline'} size={15} color={removedOnly ? '#0A1628' : colors.textSecondary} />
          <Text style={[styles.toggleText, removedOnly && styles.toggleTextActive]}>{t('admin.removed')}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${type}_${item.id}`}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, selectMode && selected.size > 0 && { paddingBottom: 96 }]}
          showsVerticalScrollIndicator={false}
          onRefresh={() => load(type, query.trim(), removedOnly)}
          refreshing={loading}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} /> : null}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>{t('admin.nothingHere')}</Text></View>}
        />
      )}

      {/* Bulk action bar */}
      {selectMode && selected.size > 0 && (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkCount}>{selected.size} selected</Text>
          {bulkBusy ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <View style={styles.bulkBtns}>
              <TouchableOpacity style={[styles.bulkBtn, styles.btnRestore]} onPress={() => runBulk('restore')}>
                <Text style={styles.btnTextDark}>{t('admin.restore')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.bulkBtn, styles.btnRemove]} onPress={confirmBulkRemove}>
                <Text style={styles.btnTextLight}>{t('common.remove')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  titleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
  },
  title: {
    ...typography.h1, color: colors.textPrimary,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  selectToggle: { ...typography.label, color: colors.accent, fontWeight: '700' },
  pillsScroll: { flexGrow: 0, flexShrink: 0 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pill: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', lineHeight: 16 },
  pillTextActive: { color: '#0A1628' },
  toolRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, alignItems: 'center' },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: 'rgba(13,35,64,0.78)', borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: spacing.md, height: 40,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, height: 40, borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  toggleActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toggleText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  toggleTextActive: { color: '#0A1628' },
  list: { padding: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.md, marginBottom: spacing.sm, ...shadows.sm,
  },
  cardRemoved: { opacity: 0.7, borderColor: 'rgba(229,57,53,0.4)' },
  cardSelected: { borderColor: colors.accent, borderWidth: 1.5 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, marginRight: spacing.xs,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface },
  author: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  removedPill: {
    ...typography.caption, color: colors.error, fontWeight: '800', fontSize: 10,
    marginLeft: 'auto', textTransform: 'uppercase',
  },
  body: { ...typography.body, color: colors.textSecondary },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, marginTop: spacing.sm,
  },
  btnRemove: { backgroundColor: colors.error },
  btnRestore: { backgroundColor: colors.accent },
  btnTextLight: { ...typography.caption, color: colors.white, fontWeight: '700' },
  btnTextDark: { ...typography.caption, color: '#0A1628', fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary },
  bulkBar: {
    position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(14,32,56,0.97)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...shadows.md,
  },
  bulkCount: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  bulkBtns: { flexDirection: 'row', gap: spacing.sm },
  bulkBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
});

export default AdminContent;
