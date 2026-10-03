// The whole grid: For You (explained), New, Nearby, Online, with filters
// for those who'd rather search than be suggested to.
import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { browseSingles } from '../../services/api';
import { GOLD, SinglesScreen, Chip, Body } from '../../components/singles/SinglesKit';
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
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);

  const load = useCallback(async (m, f, p = 1) => {
    try {
      const res = await browseSingles(m, p, f);
      setRows((cur) => (p === 1 ? res.results : [...(cur || []), ...res.results.filter((r) => !(cur || []).some((c) => c.id === r.id))]));
      setMore(res.more);
      setPage(p);
    } catch { setRows((cur) => cur || []); }
  }, []);
  useEffect(() => { setRows(null); load(mode, filters, 1); }, [load, mode, filters]);

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
      {rows === null ? <ActivityIndicator color={GOLD.gold} style={{ marginTop: 40 }} /> : (
        <FlatList data={rows} keyExtractor={(c) => String(c.id)} numColumns={width === '100%' ? 1 : 2}
          key={width} columnWrapperStyle={width === '100%' ? undefined : styles.row}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <GridCard card={item} width={width} testID={`singles-browse-${item.id}`} />}
          onEndReached={() => more && load(mode, filters, page + 1)} onEndReachedThreshold={0.5}
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
});
