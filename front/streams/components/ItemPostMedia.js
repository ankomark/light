// A product for sale or a listed service, posted to the feed when it went up
// (songs/feed_cards.py): drawn as the thing itself — its picture, what it is,
// the price or the place — with a button into the shop / the listing. Tap
// opens it; double-tap likes, like any post.
import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import ResilientImage from './ResilientImage';

const DOUBLE_TAP_MS = 280;

export const formatPrice = (price, currency) => {
  const n = Number(price);
  if (!Number.isFinite(n)) return '';
  const amount = n.toLocaleString(undefined, { maximumFractionDigits: n % 1 ? 2 : 0 });
  return currency ? `${currency} ${amount}` : amount;
};

const ItemPostMedia = ({ item, width, onDoubleTapLike, onOpen }) => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const isProduct = item.content_type === 'product';
  const thing = (isProduct ? item.product : item.service) || {};
  const picture = isProduct ? thing.image : (thing.cover || thing.logo);
  const tap = useRef({ at: 0, timer: null });
  useEffect(() => () => clearTimeout(tap.current.timer), []);

  const open = useCallback(() => {
    onOpen?.();
    if (isProduct) {
      if (thing.slug) {
        navigation.navigate('ProductDetail', {
          slug: thing.slug,
          preview: { slug: thing.slug, title: thing.title, price: thing.price, currency: thing.currency },
        });
      }
    } else if (thing.id) {
      navigation.navigate('ServiceDetail', { id: thing.id });
    }
  }, [navigation, isProduct, thing.slug, thing.id, thing.title, thing.price, thing.currency, onOpen]);

  const onPress = () => {
    const s = tap.current;
    const now = Date.now();
    if (now - s.at < DOUBLE_TAP_MS) {
      clearTimeout(s.timer);
      s.at = 0;
      onDoubleTapLike?.(item);
      return;
    }
    s.at = now;
    s.timer = setTimeout(open, DOUBLE_TAP_MS);
  };

  const title = isProduct ? thing.title : thing.name;
  const detail = isProduct ? formatPrice(thing.price, thing.currency) : (thing.rate || thing.location || '');
  const where = isProduct ? thing.location : (thing.rate ? thing.location : '');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      testID={`${item.content_type}-post-${item.id}`} style={[styles.card, { width }]}>
      <View style={[styles.picture, { height: Math.round(width * 0.9) }]}>
        {picture ? (
          <ResilientImage uri={picture} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.fallback]}>
            <Ionicons name={isProduct ? 'pricetag-outline' : 'briefcase-outline'} size={44} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.badge}>
          <Ionicons name={isProduct ? 'pricetag' : 'briefcase'} size={12} color={colors.white} />
          <Text style={styles.badgeText}>{isProduct ? t('itemPost.newProduct') : t('itemPost.newService')}</Text>
        </View>
      </View>

      <View style={styles.info}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {!isProduct && thing.is_verified ? <Ionicons name="checkmark-circle" size={16} color={colors.primary} /> : null}
        </View>
        {detail ? <Text style={isProduct ? styles.price : styles.detail} numberOfLines={1}>{detail}</Text> : null}
        {where ? (
          <View style={styles.whereRow}>
            <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.65)" />
            <Text style={styles.where} numberOfLines={1}>{where}</Text>
          </View>
        ) : null}
        {thing.description ? <Text style={styles.description} numberOfLines={2}>{thing.description}</Text> : null}
        <View style={styles.cta}>
          <Ionicons name={isProduct ? 'bag-handle-outline' : 'open-outline'} size={15} color={colors.white} />
          <Text style={styles.ctaText}>{isProduct ? t('itemPost.viewProduct') : t('itemPost.viewService')}</Text>
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: { overflow: 'hidden', backgroundColor: '#0A1628' },
  picture: { width: '100%', backgroundColor: colors.surface },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: spacing.sm, left: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full, backgroundColor: 'rgba(6,14,28,0.78)',
  },
  badgeText: { ...typography.caption, color: colors.white, fontWeight: '800' },
  info: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...typography.h3, color: colors.white, flexShrink: 1 },
  price: { fontSize: 18, fontWeight: '900', color: colors.accent },
  detail: { ...typography.label, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  whereRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  where: { ...typography.caption, color: 'rgba(255,255,255,0.65)', flexShrink: 1 },
  description: { ...typography.body, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.md,
    paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.primary,
  },
  ctaText: { ...typography.label, color: colors.white, fontWeight: '800' },
});

export default ItemPostMedia;
