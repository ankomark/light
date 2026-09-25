// One listing in the Services directory, compact: cover and logo, name and
// tick, what and where, open now or not, a "from" price, and a quick call or
// WhatsApp. A tap opens the service's page (everything else is there). The
// "…" holds Edit / Delete for its owner and Report for everyone else.
import React, { memo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CATEGORY_ICON, serviceLabel, priceHint, openState, openLabel,
} from '../../services/servicesCatalog';
import { notify } from '../../utils/adminConfirm';
import { StarRow } from '../BookReviews';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

export const OpenChip = ({ hours, t, style }) => {
  const st = openState(hours);
  const label = openLabel(st, t);
  if (!label) return null;
  const open = st.state === 'open';
  return (
    <View style={[styles.open, style]} testID="service-open-state">
      <View style={[styles.dot, { backgroundColor: open ? colors.success : colors.error }]} />
      <Text style={[styles.openText, { color: open ? colors.success : colors.textSecondary }]} numberOfLines={1}>{label}</Text>
    </View>
  );
};

const ServiceCard = memo(({ item, t, onOpen, onEdit, onDelete, onReport, style }) => {
  const [menu, setMenu] = useState(false);
  const call = (url) => Linking.openURL(url).catch(() => notify(t('common.error'), t('dir.openLinkFailed')));
  const price = priceHint(item);
  const cat = item.category || 'media';
  const tags = item.service_types || [];

  return (
    <Pressable style={({ pressed }) => [styles.card, style, pressed && styles.pressed]} onPress={() => onOpen?.(item)}
      accessibilityRole="button" accessibilityLabel={item.name} testID={`service-${item.id}`}>
      <View style={styles.banner}>
        {item.cover_image ? (
          <Image source={{ uri: item.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150}
            recyclingKey={`c${item.id}`} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.coverFallback]}>
            <MaterialIcons name={CATEGORY_ICON[cat] || 'storefront'} size={34} color={colors.textMuted} />
          </View>
        )}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.4)']} style={styles.bannerScrim} pointerEvents="none" />
        <View style={styles.categoryPill}>
          <MaterialIcons name={CATEGORY_ICON[cat] || 'storefront'} size={12} color={colors.white} />
          <Text style={styles.categoryPillText}>{t(`services.cat.${cat}`)}</Text>
        </View>
        {(item.is_owner && (onEdit || onDelete)) || onReport ? (
          <View style={styles.menu}>
            {menu ? (
              <>
                {item.is_owner ? (
                  <>
                    <TouchableOpacity style={styles.menuBtn} onPress={() => { setMenu(false); onEdit(item); }} hitSlop={6}
                      accessibilityLabel={t('common.edit')} testID={`service-edit-${item.id}`}>
                      <MaterialIcons name="edit" size={18} color={colors.white} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.menuBtn} onPress={() => { setMenu(false); onDelete(item); }} hitSlop={6}
                      accessibilityLabel={t('common.delete')} testID={`service-delete-${item.id}`}>
                      <MaterialIcons name="delete-outline" size={19} color={colors.white} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity style={styles.menuBtn} onPress={() => { setMenu(false); onReport(item); }} hitSlop={6}
                    accessibilityLabel={t('common.report')} testID={`service-report-${item.id}`}>
                    <Ionicons name="flag-outline" size={17} color={colors.white} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.menuBtn} onPress={() => setMenu(false)} hitSlop={6} accessibilityLabel={t('common.close')}>
                  <MaterialIcons name="close" size={18} color={colors.white} />
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.menuBtn} onPress={() => setMenu(true)} hitSlop={6}
                accessibilityLabel={t('common.more')} testID={`service-more-${item.id}`}>
                <MaterialIcons name="more-horiz" size={20} color={colors.white} />
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.head}>
        <Image source={item.logo ? { uri: item.logo } : DEFAULT_AVATAR} placeholder={DEFAULT_AVATAR} style={styles.avatar}
          contentFit="cover" recyclingKey={`l${item.id}`} />
        <View style={styles.headInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            {item.is_verified ? <MaterialIcons name="verified" size={16} color={colors.primary} /> : null}
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={13} color={colors.textMuted} />
            <Text style={styles.meta} numberOfLines={1}>{item.location}</Text>
          </View>
        </View>
      </View>

      {item.description ? <Text style={styles.description} numberOfLines={2}>{item.description}</Text> : null}

      {tags.length ? (
        <View style={styles.tags}>
          {tags.slice(0, 3).map((k) => (
            <View key={k} style={styles.tag}><Text style={styles.tagText} numberOfLines={1}>{serviceLabel(k, t)}</Text></View>
          ))}
          {tags.length > 3 ? <Text style={styles.moreTags}>{`+${tags.length - 3}`}</Text> : null}
        </View>
      ) : null}

      <View style={styles.foot}>
        <View style={styles.footInfo}>
          {item.rating_count ? (
            <View style={styles.stars} testID={`service-stars-${item.id}`}>
              <StarRow value={item.rating_avg} size={11} />
              <Text style={styles.starsText}>{`${item.rating_avg} (${item.rating_count})`}</Text>
            </View>
          ) : null}
          <OpenChip hours={item.opening_hours} t={t} />
          {price ? <Text style={styles.price} numberOfLines={1}>{t('services.from', { price })}</Text> : null}
        </View>
        {item.contact_phone ? (
          <TouchableOpacity style={styles.quick} onPress={() => call(`tel:${item.contact_phone}`)} hitSlop={4}
            accessibilityLabel={t('studios.call')} testID={`service-call-${item.id}`}>
            <Ionicons name="call" size={17} color={colors.white} />
          </TouchableOpacity>
        ) : null}
        {item.whatsapp_number ? (
          <TouchableOpacity style={[styles.quick, styles.whatsapp]} hitSlop={4} accessibilityLabel={t('studios.whatsapp')}
            onPress={() => call(`https://wa.me/${item.whatsapp_number.replace(/[^\d]/g, '')}`)} testID={`service-whatsapp-${item.id}`}>
            <Ionicons name="logo-whatsapp" size={18} color={colors.white} />
          </TouchableOpacity>
        ) : null}
      </View>
    </Pressable>
  );
});

/** Placeholder cards while the first page loads. */
export const ServiceCardSkeleton = ({ style }) => (
  <View style={[styles.card, style]}>
    <View style={[styles.banner, styles.skel]} />
    <View style={styles.head}>
      <View style={[styles.avatar, styles.skel]} />
      <View style={styles.headInfo}>
        <View style={[styles.skelLine, { width: '60%' }]} />
        <View style={[styles.skelLine, { width: '35%' }]} />
      </View>
    </View>
    <View style={[styles.skelLine, { width: '85%', marginHorizontal: spacing.md, marginTop: spacing.md }]} />
    <View style={[styles.skelLine, { width: '50%', marginHorizontal: spacing.md, marginBottom: spacing.md }]} />
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.md,
  },
  pressed: { opacity: 0.92 },
  banner: { height: 118, backgroundColor: colors.surface },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  bannerScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 56 },
  categoryPill: {
    position: 'absolute', top: spacing.sm, left: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3,
  },
  categoryPillText: { ...typography.caption, color: colors.white, fontWeight: '700', fontSize: 11 },
  menu: { position: 'absolute', top: spacing.sm, right: spacing.sm, flexDirection: 'row', gap: spacing.xs },
  menuBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, marginTop: -22 },
  avatar: { width: 54, height: 54, borderRadius: radius.md, borderWidth: 3, borderColor: colors.card, backgroundColor: colors.surface },
  headInfo: { flex: 1, marginLeft: spacing.sm, paddingTop: 22, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...typography.h3, color: colors.textPrimary, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  meta: { ...typography.caption, color: colors.textMuted, flex: 1 },
  description: { ...typography.body, color: colors.textSecondary, paddingHorizontal: spacing.md, marginTop: spacing.sm, lineHeight: 20 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.md, marginTop: spacing.sm, alignItems: 'center' },
  tag: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3, maxWidth: '45%' },
  tagText: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
  moreTags: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  foot: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  footInfo: { flex: 1, gap: 2 },
  open: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  starsText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  openText: { ...typography.caption, fontWeight: '700', flexShrink: 1 },
  price: { ...typography.label, color: colors.primary, fontWeight: '800' },
  quick: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  whatsapp: { backgroundColor: '#25D366' },
  skel: { backgroundColor: colors.surface },
  skelLine: { height: 10, borderRadius: 5, backgroundColor: colors.surface, marginTop: 8 },
});

export default ServiceCard;
