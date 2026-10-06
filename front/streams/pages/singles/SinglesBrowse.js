// The whole grid: For You (explained), New, Nearby, Online, with filters
// for those who'd rather search than be suggested to.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { browseSingles } from '../../services/api';
import { GOLD, SinglesScreen, Chip, Body, GoldButton } from '../../components/singles/SinglesKit';
import { useAuth } from '../../context/useAuth';
import { peekCache, readCache, userKey, writeCache } from '../../utils/screenCache';
import GridCard, { useGridWidth } from '../../components/singles/GridCard';
import { FiltersSheet } from './SinglesHome';

const MODES = ['foryou', 'new', 'nearby', 'online'];

export default function SinglesBrowse() {
  const { t } = useI18n();
  const { params = {} } = useRoute();
  const width = useGridWidth();
  const [mode, setMode] = useState(params.mode || 'foryou');
  const [filters, setFilters] = useState({});
  const [open, setOpen] = useState(false);
  const { currentUser } = useAuth();
  // Each tab's first page is kept (unfiltered): it opens at once next time,
  // and offline still shows the last copy.
  const keyFor = (m, f) => (currentUser?.id && !Object.keys(f).length
    ? userKey(currentUser.id, `singles:browse:${m}`) : null);
  const [rows, setRows] = useState(() => {
    const k = keyFor(params.mode || 'foryou', {});
    return k ? peekCache(k)?.results ?? null : null;
  });
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  // Only the newest request may answer: a slow reply for the tab just left
  // used to land on the tab just picked.
  const ticket = useRef(0);
  const loadingMore = useRef(false);

  const load = useCallback(async (m, f, p = 1) => {
    const mine = ++ticket.current;
    const key = p === 1 ? keyFor(m, f) : null;
    if (key && peekCache(key) == null) {
      const kept = await readCache(key);
      if (mine !== ticket.current) return;
      if (kept?.results) setRows((cur) => cur ?? kept.results);
    }
    setFailed(false);
    try {
      const res = await browseSingles(m, p, f);
      if (mine !== ticket.current) return;
      setRows((cur) => (p === 1 ? res.results : [...(cur || []), ...res.results.filter((r) => !(cur || []).some((c) => c.id === r.id))]));
      setMore(res.more);
      setPage(p);
      if (key) writeCache(key, { results: res.results });
    } catch {
      if (mine !== ticket.current) return;
      // Not "nobody here": that was untrue offline. Whatever is shown stays.
      setFailed(true);
      setRows((cur) => cur ?? null);
    }
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = keyFor(mode, filters);
    setRows(k ? peekCache(k)?.results ?? null : null);
    load(mode, filters, 1);
  }, [load, mode, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMore = async () => {
    if (!more || loadingMore.current) return;
    loadingMore.current = true;
    try { await load(mode, filters, page + 1); } finally { loadingMore.current = false; }
  };

  return (
    <SinglesScreen title={t('singles.browse.title')} scroll={false} testID="singles-browse"
      right={(
        <TouchableOpacity onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={t('singles.filters.title')}
          hitSlop={10} testID="singles-browse-filters">
          <Ionicons name="options-outline" size={22} color={GOLD.text} />
        </TouchableOpacity>
      )}>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modes}>
          {MODES.map((m) => <Chip key={m} text={t(`singles.mode.${m}`)} on={mode === m} onPress={() => setMode(m)} />)}
        </ScrollView>
      </View>
      {rows === null && failed ? (
        <View style={styles.failed} testID="singles-browse-failed">
          <Body style={{ textAlign: 'center' }}>{t('singles.loadFailed')}</Body>
          <GoldButton label={t('common.retry')} icon="refresh" kind="outline" onPress={() => load(mode, filters, 1)} />
        </View>
      ) : rows === null ? <ActivityIndicator color={GOLD.gold} style={{ marginTop: 40 }} /> : (
        <FlatList data={rows} keyExtractor={(c) => String(c.id)} numColumns={width === '100%' ? 1 : 2}
          key={width} columnWrapperStyle={width === '100%' ? undefined : styles.row}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <GridCard card={item} width={width} testID={`singles-browse-${item.id}`} />}
          onEndReached={loadMore} onEndReachedThreshold={0.5}
          ListEmptyComponent={<Body style={{ textAlign: 'center', marginTop: 30 }}>{t(`singles.mode.${mode}Empty`)}</Body>} />
      )}
      <FiltersSheet visible={open} value={filters} onClose={() => setOpen(false)}
        onApply={(f) => { setFilters(f); setOpen(false); }} />
    </SinglesScreen>
  );
}

const styles = StyleSheet.create({
  modes: { gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  row: { justifyContent: 'space-between' },
  failed: { marginTop: 40, gap: 14, alignItems: 'center', paddingHorizontal: 24 },
});
