import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HYMNALS, HYMNAL_ORDER } from '../utils/hymnals';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const HymnList = ({ navigation }) => {
  const [lang, setLang] = useState('en');
  const [searchQuery, setSearchQuery] = useState('');

  const hymnal = HYMNALS[lang];
  const hymns = hymnal.data.hymns;

  const filteredHymns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return hymns;
    return hymns.filter((h) => {
      if (String(h.number).includes(q)) return true;
      if (h.title && h.title.toLowerCase().includes(q)) return true;
      if (h.refrain && h.refrain.toLowerCase().includes(q)) return true;
      return h.verses?.some((v) => v.toLowerCase().includes(q));
    });
  }, [hymns, searchQuery]);

  const openHymn = useCallback((hymn) => {
    Keyboard.dismiss();
    navigation.navigate('HymnDetail', { hymn, hymnalName: hymnal.name, lang });
  }, [navigation, hymnal.name, lang]);

  const renderHymnItem = useCallback(({ item }) => {
    const preview = (item.refrain || item.verses?.[0] || '').split('\n')[0];
    const numberMatch = searchQuery && String(item.number).includes(searchQuery.trim());
    return (
      <TouchableOpacity style={styles.hymnItem} onPress={() => openHymn(item)} activeOpacity={0.8}>
        <View style={[styles.numberBadge, numberMatch && styles.numberBadgeMatch]}>
          <Text style={styles.numberText}>{item.number}</Text>
        </View>
        <View style={styles.hymnContent}>
          <Text style={styles.hymnTitle} numberOfLines={1}>{item.title}</Text>
          {preview ? (
            <Text style={styles.hymnPreview} numberOfLines={1}>{preview}</Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    );
  }, [openHymn, searchQuery]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="musical-notes" size={20} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Hymnal</Text>
          <Text style={styles.headerSubtitle}>{hymnal.name} · {hymns.length} hymns</Text>
        </View>
      </View>

      {/* Language switcher — segmented control */}
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

      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.placeholder} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by number, title, or lyrics…"
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

      {searchQuery ? (
        <Text style={styles.resultsText}>
          {filteredHymns.length} {filteredHymns.length === 1 ? 'result' : 'results'}
        </Text>
      ) : null}

      <FlatList
        data={filteredHymns}
        keyExtractor={(item) => `${lang}_${item.number}`}
        renderItem={renderHymnItem}
        contentContainerStyle={styles.listContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={15}
        windowSize={10}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="musical-notes-outline" size={44} color={colors.textMuted} />
            <Text style={styles.emptyText}>No hymns found</Text>
            <Text style={styles.emptySub}>Try a different number or word</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
  },
  headerText: { flex: 1 },
  headerTitle: { ...typography.h2, color: colors.textPrimary },
  headerSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },

  langRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
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
    backgroundColor: colors.card,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    height: 46,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  resultsText: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },

  listContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  hymnItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  numberBadge: {
    minWidth: 40, height: 40, borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
    paddingHorizontal: 6,
  },
  numberBadgeMatch: { backgroundColor: colors.primary },
  numberText: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  hymnContent: { flex: 1, marginRight: spacing.sm },
  hymnTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '600' },
  hymnPreview: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.xs,
  },
  emptyText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  emptySub: { ...typography.caption, color: colors.textMuted },
});

export default HymnList;
