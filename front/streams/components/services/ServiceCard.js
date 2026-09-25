// One listing in the Services directory: cover and logo, name and place,
// what they offer, a price, and ways to reach them (call, WhatsApp, email,
// their links). The "…" holds Edit / Delete for its owner and Report for
// everyone else.
import React, { memo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CATEGORY_ICON, SOCIAL_LINKS, serviceLabel, withScheme, rateText } from '../../services/servicesCatalog';
import { notify } from '../../utils/adminConfirm';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

const ServiceCard = memo(({ item, t, onEdit, onDelete, onReport, style }) => {
  const [menu, setMenu] = useState(false);
  const open = (url) => Linking.openURL(url).catch(() => notify(t('common.error'), t('dir.openLinkFailed')));
  const price = rateText(item);
  const links = SOCIAL_LINKS.filter((s) => item[s.key]);
  const cat = item.category || 'media';

  return (
    <View style={[styles.card, style]} testID={`service-${item.id}`}>
      <View style={styles.banner}>
        {item.cover_image ? (
          <Image source={{ uri: item.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150}
            recyclingKey={`c${item.id}`} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.coverFallback]}>
            <MaterialIcons name={CATEGORY_ICON[cat] || 'storefront'} size={36} color={colors.textMuted} />
          </View>
        )}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.35)']} style={styles.bannerScrim} pointerEvents="none" />
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

      {item.description ? <Text style={styles.description} numberOfLines={3}>{item.description}</Text> : null}

      {item.service_types?.length ? (
        <View style={styles.tags}>
          {item.service_types.slice(0, 6).map((k) => (
            <View key={k} style={styles.tag}><Text style={styles.tagText}>{serviceLabel(k, t)}</Text></View>
          ))}
          {item.service_types.length > 6 ? <Text style={styles.moreTags}>{`+${item.service_types.length - 6}`}</Text> : null}
        </View>
      ) : null}

      {price ? (
        <View style={styles.price}>
          <MaterialIcons name="payments" size={15} color={colors.primary} />
          <Text style={styles.priceText} numberOfLines={1}>{price}</Text>
        </View>
      ) : null}

      {item.contact_phone || item.whatsapp_number || item.contact_email ? (
        <View style={styles.contacts}>
          {item.contact_phone ? (
            <TouchableOpacity style={styles.contactBtn} onPress={() => open(`tel:${item.contact_phone}`)} testID={`service-call-${item.id}`}>
              <Ionicons name="call" size={15} color={colors.white} />
              <Text style={styles.contactText}>{t('studios.call')}</Text>
            </TouchableOpacity>
          ) : null}
          {item.whatsapp_number ? (
            <TouchableOpacity style={[styles.contactBtn, styles.whatsapp]} testID={`service-whatsapp-${item.id}`}
              onPress={() => open(`https://wa.me/${item.whatsapp_number.replace(/[^\d]/g, '')}`)}>
              <Ionicons name="logo-whatsapp" size={15} color={colors.white} />
              <Text style={styles.contactText}>{t('studios.whatsapp')}</Text>
            </TouchableOpacity>
          ) : null}
          {item.contact_email ? (
            <TouchableOpacity style={[styles.contactBtn, styles.email]} onPress={() => open(`mailto:${item.contact_email}`)}>
              <Ionicons name="mail" size={15} color={colors.textPrimary} />
              <Text style={[styles.contactText, styles.emailText]}>{t('services.link.email')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {links.length ? (
        <View style={styles.socials}>
          {links.map((s) => (
            <TouchableOpacity key={s.key} style={styles.socialBtn} onPress={() => open(withScheme(item[s.key]))}
              accessibilityLabel={t(s.labelKey)}>
              <Ionicons name={s.icon} size={18} color={s.color} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <View style={{ height: spacing.md }} />
    </View>
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
    <View style={[styles.skelLine, { width: '70%', marginHorizontal: spacing.md, marginBottom: spacing.md }]} />
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.md,
  },
  banner: { height: 130, backgroundColor: colors.surface },
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
  avatar: { width: 56, height: 56, borderRadius: radius.md, borderWidth: 3, borderColor: colors.card, backgroundColor: colors.surface },
  headInfo: { flex: 1, marginLeft: spacing.sm, paddingTop: 22, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...typography.h3, color: colors.textPrimary, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  meta: { ...typography.caption, color: colors.textMuted, flex: 1 },
  description: { ...typography.body, color: colors.textSecondary, paddingHorizontal: spacing.md, marginTop: spacing.sm, lineHeight: 20 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.md, marginTop: spacing.sm, alignItems: 'center' },
  tag: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  tagText: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
  moreTags: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  price: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', maxWidth: '92%',
    marginHorizontal: spacing.md, marginTop: spacing.sm, backgroundColor: `${colors.primary}14`,
    borderRadius: radius.full, paddingHorizontal: spacing.sm + 2, paddingVertical: 5,
  },
  priceText: { ...typography.label, color: colors.primary, fontWeight: '800', fontSize: 13, flexShrink: 1 },
  contacts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primary, borderRadius: radius.full,
    paddingVertical: spacing.xs + 3, paddingHorizontal: spacing.md,
  },
  whatsapp: { backgroundColor: '#25D366' },
  email: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  contactText: { ...typography.caption, color: colors.white, fontWeight: '700' },
  emailText: { color: colors.textPrimary },
  socials: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  socialBtn: {
    width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  skel: { backgroundColor: colors.surface },
  skelLine: { height: 10, borderRadius: 5, backgroundColor: colors.surface, marginTop: 8 },
});

export default ServiceCard;
