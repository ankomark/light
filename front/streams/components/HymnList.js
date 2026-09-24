import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HYMNALS, HYMNAL_ORDER } from '../utils/hymnals';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useHymnFavorites, sortFavorites, FAVORITE_SORTS } from '../services/hymnFavorites';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';

// Each hymnal's hymns by number, for turning saved favourites back into hymns.
const BY_NUMBER = Object.fromEntries(HYMNAL_ORDER.map((code) => [
  code, new Map(HYMNALS[code].data.hymns.map((h) => [Number(h.number), h])),
]));

const matches = (h, q) => {
  if (String(h.number).includes(q)) return true;
  if (h.title && h.title.toLowerCase().includes(q)) return true;
  if (h.refrain && h.refrain.toLowerCase().includes(q)) return true;
  return h.verses?.some((v) => v.toLowerCase().includes(q));
};

const HymnList = ({ navigation }) => {
  const { t } = useI18n();
  const [lang, setLang] = useState('en');
  const [searchQuery, setSearchQuery] = useState('');
  // The Favourites view: the hymns the user saved, from every hymnal.
  const [showFavs, setShowFavs] = useState(false);
  const { favorites, isFavorite, toggle } = useHymnFavorites();
  // The Favourites order, remembered between visits.
  const { preferences, setPreference } = usePreferences();
  const favSort = FAVORITE_SORTS.includes(preferences[PREF_KEYS.hymnFavSort])
    ? preferences[PREF_KEYS.hymnFavSort] : 'recent';

  const hymnal = HYMNALS[lang];
  const hymns = hymnal.data.hymns;

  // Rows: { lang, hymn }. Favourites in the chosen order; any that no longer
  // exist in the bundled hymnal (a data update) are skipped.
  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = showFavs
      ? sortFavorites(
        favorites.map((f) => ({ lang: f.lang, at: f.at, hymn: BY_NUMBER[f.lang]?.get(f.number) })).filter((r) => r.hymn),
        favSort,
      )
      : hymns.map((hymn) => ({ lang, hymn }));
    return q ? list.filter((r) => matches(r.hymn, q)) : list;
  }, [showFavs, favorites, favSort, hymns, lang, searchQuery]);

  const openHymn = useCallback((row) => {
    Keyboard.dismiss();
    navigation.navigate('HymnDetail', { hymn: row.hymn, hymnalName: HYMNALS[row.lang].name, lang: row.lang });
  }, [navigation]);

  const renderHymnItem = useCallback(({ item: row }) => {
    const { hymn: item } = row;
    const preview = (item.refrain || item.verses?.[0] || '').split('\n')[0];
    const numberMatch = searchQuery && String(item.number).includes(searchQuery.trim());
    const fav = isFavorite(row.lang, item.number);
    return (
      <TouchableOpacity style={styles.hymnItem} onPress={() => openHymn(row)} activeOpacity={0.8}>
        <View style={[styles.numberBadge, numberMatch && styles.numberBadgeMatch]}>
          <Text style={styles.numberText}>{item.number}</Text>
        </View>
        <View style={styles.hymnContent}>
          <Text style={styles.hymnTitle} numberOfLines={1}>{item.title}</Text>
          {showFavs ? (
            <Text style={styles.bookTag} numberOfLines={1}>{HYMNALS[row.lang].name}</Text>
          ) : preview ? (
            <Text style={styles.hymnPreview} numberOfLines={1}>{preview}</Text>
          ) : null}
        </View>
        {showFavs ? (
          // In Favourites the heart takes it off the list.
          <TouchableOpacity
            onPress={() => toggle(row.lang, item.number)}
            hitSlop={10}
            style={styles.rowHeart}
            accessibilityRole="button"
            accessibilityLabel={t('hymns.removeFavorite')}
          >
            <Ionicons name="heart" size={20} color="#FF4D6D" />
          </TouchableOpacity>
        ) : (
          <>
            {fav ? <Ionicons name="heart" size={14} color="#FF4D6D" style={styles.favDot} /> : null}
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </>
        )}
      </TouchableOpacity>
    );
  }, [openHymn, searchQuery, showFavs, isFavorite, toggle, t]);

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="musical-notes" size={20} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{showFavs ? t('hymns.favorites') : t('hymns.title')}</Text>
          <Text style={styles.headerSubtitle}>
            {showFavs ? t('hymns.favCount', { n: favorites.length }) : `${hymnal.name} · ${hymns.length} hymns`}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.favBtn, showFavs && styles.favBtnOn]}
          onPress={() => { setShowFavs((v) => !v); setSearchQuery(''); Keyboard.dismiss(); }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ selected: showFavs }}
          accessibilityLabel={t('hymns.favorites')}
          testID="hymn-favorites-button"
        >
          <Ionicons name={showFavs ? 'heart' : 'heart-outline'} size={18} color={showFavs ? colors.white : '#FF4D6D'} />
          <Text style={[styles.favBtnText, showFavs && styles.favBtnTextOn]}>{favorites.length}</Text>
        </TouchableOpacity>
      </View>

      {/* Language switcher — segmented control (not in Favourites: it holds every hymnal) */}
      {!showFavs ? (
      <View style={styles.langRow}>
        {HYMNAL_ORDER.map((code) => {
          const active = code === lang;
          return (
            <TouchableOpacity
              key={code}
              style={[styles.langSeg, active && styles.langSegActive]}
              onPress={() => { setLang(code); Keyboard.dismiss(); }}
              activeOpacity={0.85}
            >
              <Text
                style={[styles.langSegText, active && styles.langSegTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {HYMNALS[code].label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      ) : null}

      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.placeholder} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('hymns.searchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => { setSearchQuery(''); Keyboard.dismiss(); }}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Favourites: how they're ordered. */}
      {showFavs && favorites.length > 1 ? (
        <View style={styles.sortRow} accessibilityRole="radiogroup" accessibilityLabel={t('hymns.sortBy')}>
          <Ionicons name="swap-vertical" size={16} color={colors.textSecondary} />
          {FAVORITE_SORTS.map((key) => {
            const on = key === favSort;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.sortChip, on && styles.sortChipOn]}
                onPress={() => setPreference(PREF_KEYS.hymnFavSort, key)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                testID={`hymn-sort-${key}`}
              >
                <Text style={[styles.sortChipText, on && styles.sortChipTextOn]}>{t(`hymns.sort.${key}`)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {searchQuery ? (
        <Text style={styles.resultsText}>
          {rows.length} {rows.length === 1 ? 'result' : 'results'}
        </Text>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(row) => `${row.lang}_${row.hymn.number}`}
        renderItem={renderHymnItem}
        contentContainerStyle={styles.listContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={15}
        windowSize={10}
        ListEmptyComponent={
          showFavs && !searchQuery ? (
            <View style={styles.empty}>
              <Ionicons name="heart-outline" size={44} color="#FF4D6D" />
              <Text style={styles.emptyText}>{t('hymns.noFavorites')}</Text>
              <Text style={[styles.emptySub, styles.emptyCentered]}>{t('hymns.noFavoritesSub')}</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="musical-notes-outline" size={44} color={colors.textMuted} />
              <Text style={styles.emptyText}>{t('hymns.none')}</Text>
              <Text style={styles.emptySub}>{t('hymns.tryDifferent')}</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: 'transparent' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: 'rgba(16,28,46,0.8)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
  },
  headerText: { flex: 1 },
  headerTitle: {
    ...typography.h2, color: colors.textPrimary,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  headerSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  favBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 38,
    paddingHorizontal: 12, borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.8)',
    borderWidth: 1, borderColor: 'rgba(255,77,109,0.55)',
  },
  favBtnOn: { backgroundColor: '#FF4D6D', borderColor: '#FF4D6D' },
  favBtnText: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  favBtnTextOn: { color: colors.white },

  langRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(16,28,46,0.8)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.full,
    padding: 4,
    gap: 4,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  langSeg: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langSegActive: {
    backgroundColor: colors.primary,
    ...shadows.sm,
  },
  langSegText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  langSegTextActive: { color: colors.white },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(13,35,64,0.78)',
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    height: 46,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  resultsText: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },

  listContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  hymnItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  numberBadge: {
    minWidth: 40, height: 40, borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,162,97,0.35)',
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
    paddingHorizontal: 6,
  },
  numberBadgeMatch: { backgroundColor: colors.primary },
  numberText: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  hymnContent: { flex: 1, marginRight: spacing.sm },
  hymnTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '600' },
  hymnPreview: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  sortRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs,
    marginHorizontal: spacing.md, marginTop: spacing.sm,
  },
  sortChip: {
    paddingHorizontal: 12, minHeight: 32, justifyContent: 'center', borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.8)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  sortChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  sortChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  sortChipTextOn: { color: colors.white },
  bookTag: { ...typography.caption, color: colors.accent, fontWeight: '700', marginTop: 2 },
  rowHeart: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  favDot: { marginRight: 6 },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.xs,
  },
  emptyText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  emptySub: { ...typography.caption, color: colors.textMuted },
  emptyCentered: { textAlign: 'center', paddingHorizontal: spacing.xl },
});

export default HymnList;
