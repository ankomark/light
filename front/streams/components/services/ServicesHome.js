// The top of Services when nothing is filtered: the categories as tiles
// (each with how many are listed), then rows of the featured, the verified
// and the newest. Drawn at once from the last copy, then refreshed.
import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { fetchServicesHome } from '../../services/api';
import { CATEGORIES, CATEGORY_ICON, CATEGORY_TINT } from '../../services/servicesCatalog';
import useCachedData from '../../utils/useCachedData';
import { userKey } from '../../utils/screenCache';
import { colors, typography, spacing, radius } from '../../constants/theme';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

export const ServiceTile = memo(({ item, onOpen, t }) => (
  <TouchableOpacity style={styles.tile} onPress={() => onOpen(item)} activeOpacity={0.85} testID={`service-tile-${item.id}`}>
    <View style={styles.tileCover}>
      {item.cover_image ? (
        <Image source={{ uri: item.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.tileFallback]}>
          <MaterialIcons name={CATEGORY_ICON[item.category] || 'storefront'} size={26} color={colors.textMuted} />
        </View>
      )}
      <Image source={item.logo ? { uri: item.logo } : DEFAULT_AVATAR} style={styles.tileLogo} contentFit="cover" />
    </View>
    <View style={styles.tileNameRow}>
      <Text style={styles.tileName} numberOfLines={1}>{item.name}</Text>
      {item.is_verified ? <MaterialIcons name="verified" size={13} color={colors.primary} /> : null}
    </View>
    <Text style={styles.tileMeta} numberOfLines={1}>{`${t(`services.cat.${item.category || 'media'}`)} · ${item.location}`}</Text>
  </TouchableOpacity>
));

const Row = ({ title, data, onOpen, t, testID }) => (data?.length ? (
  <View style={styles.row} testID={testID}>
    <Text style={styles.rowTitle}>{title}</Text>
    <FlatList horizontal data={data} keyExtractor={(s) => `${testID}_${s.id}`} showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail} renderItem={({ item }) => <ServiceTile item={item} onOpen={onOpen} t={t} />} />
  </View>
) : null);

const ServicesHome = ({ uid, t, onCategory, onOpen }) => {
  const { data } = useCachedData(userKey(uid, 'services:home'), fetchServicesHome);
  const { width } = useWindowDimensions();
  const perRow = width >= 900 ? 5 : width >= 600 ? 3 : 2;
  const counts = data?.counts || {};
  return (
    <View testID="services-home">
      <View style={styles.cats}>
        {CATEGORIES.map((c) => {
          const [from, to] = CATEGORY_TINT[c.key];
          return (
            <TouchableOpacity key={c.key} style={[styles.cat, { flexBasis: `${100 / perRow - 2}%` }]} activeOpacity={0.85}
              onPress={() => onCategory(c.key)} testID={`services-tile-${c.key}`} accessibilityRole="button">
              <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <MaterialIcons name={c.icon} size={30} color="rgba(255,255,255,0.92)" />
              <Text style={styles.catName} numberOfLines={2}>{t(c.labelKey)}</Text>
              {counts[c.key] != null ? <Text style={styles.catCount}>{t('services.countN', { n: counts[c.key] })}</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>
      <Row title={t('services.featured')} data={data?.featured} onOpen={onOpen} t={t} testID="services-featured" />
      <Row title={t('services.verified')} data={data?.verified} onOpen={onOpen} t={t} testID="services-verified" />
      <Row title={t('services.newest')} data={data?.new} onOpen={onOpen} t={t} testID="services-new" />
      <Text style={styles.allTitle}>{t('services.all')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md, justifyContent: 'space-between' },
  cat: {
    flexGrow: 1, minHeight: 92, borderRadius: radius.lg, overflow: 'hidden', padding: spacing.md,
    justifyContent: 'flex-end', gap: 2,
  },
  catName: { ...typography.label, color: colors.white, fontWeight: '800' },
  catCount: { ...typography.caption, color: 'rgba(255,255,255,0.8)', fontSize: 11 },
  row: { marginBottom: spacing.md },
  rowTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  rail: { gap: spacing.md, paddingRight: spacing.md },
  tile: { width: 168 },
  tileCover: { width: 168, height: 100, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  tileFallback: { alignItems: 'center', justifyContent: 'center' },
  tileLogo: {
    position: 'absolute', left: 8, bottom: 8, width: 34, height: 34, borderRadius: radius.sm,
    borderWidth: 2, borderColor: colors.card, backgroundColor: colors.surface,
  },
  tileNameRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
  tileName: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
  tileMeta: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  allTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm, marginTop: spacing.xs },
});

export default ServicesHome;
