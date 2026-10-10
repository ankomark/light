// A paid promotion placed among the feed's posts (songs/promotions.py serve),
// always marked "Sponsored". A promoted post is drawn as the post itself (the
// feed's own card, with its likes and comments); this draws the rest: a
// product, book or service as its card, and a profile with a Follow button.
// Opening it, or following from it, is told to the server as a tap.
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import ItemPostMedia from './ItemPostMedia';
import BookPostMedia from './BookPostMedia';
import { reportPromotionTap, followUser } from '../services/api';
import { useI18n } from '../context/I18nContext';
import { colors, spacing, radius } from '../constants/theme';

export const SponsoredLabel = ({ by, style }) => {
  const { t } = useI18n();
  return (
    <View style={[styles.label, style]} testID="sponsored-label">
      <Ionicons name="megaphone-outline" size={12} color={colors.textSecondary} />
      <Text style={styles.labelText}>{by ? `${t('sponsored.label')} · @${by}` : t('sponsored.label')}</Text>
    </View>
  );
};

const ProfilePromo = ({ promo, width }) => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const p = promo.profile || {};
  const [following, setFollowing] = useState(!!p.is_following);
  const open = () => {
    reportPromotionTap(promo.promotion_id, 'open').catch(() => {});
    navigation.navigate('UserProfile', { userId: p.id, username: p.username });
  };
  const follow = async () => {
    const next = !following;
    setFollowing(next);
    try {
      await followUser(p.id, next);
      if (next) reportPromotionTap(promo.promotion_id, 'follow').catch(() => {});
    } catch {
      setFollowing(!next);
    }
  };
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={open} style={[styles.profile, { width }]}
                      testID={`sponsored-profile-${promo.promotion_id}`}>
      {p.picture ? <Image source={{ uri: p.picture }} style={styles.avatar} contentFit="cover" />
        : <View style={[styles.avatar, styles.avatarEmpty]}><Ionicons name="person" size={36} color={colors.textMuted} /></View>}
      <Text style={styles.name} numberOfLines={1}>{p.display_name || `@${p.username}`}</Text>
      {p.display_name ? <Text style={styles.handle}>@{p.username}</Text> : null}
      {p.bio ? <Text style={styles.bio} numberOfLines={3}>{p.bio}</Text> : null}
      <Text style={styles.handle}>{t('sponsored.followers', { n: Number(p.followers || 0).toLocaleString() })}</Text>
      <TouchableOpacity style={[styles.follow, following && styles.following]} onPress={follow}
                        accessibilityRole="button" testID={`sponsored-follow-${promo.promotion_id}`}>
        <Text style={styles.followText}>{following ? t('sponsored.following') : t('sponsored.follow')}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const SponsoredCard = ({ promo, width }) => {
  const tapped = useCallback(() => reportPromotionTap(promo.promotion_id, 'open').catch(() => {}), [promo.promotion_id]);
  let body = null;
  if (promo.kind === 'profile') {
    body = <ProfilePromo promo={promo} width={width} />;
  } else if (promo.kind === 'book' && promo.book) {
    body = (
      <BookPostMedia item={{ id: `sp-${promo.promotion_id}`, content_type: 'book', book: promo.book }}
                     width={width} onOpen={tapped} />
    );
  } else if ((promo.kind === 'product' && promo.product) || (promo.kind === 'service' && promo.service)) {
    body = (
      <ItemPostMedia item={{ id: `sp-${promo.promotion_id}`, content_type: promo.kind,
        product: promo.product, service: promo.service }} width={width} onOpen={tapped} />
    );
  }
  if (!body) return null;
  return (
    <View style={[styles.wrap, { width }]} testID={`sponsored-${promo.promotion_id}`}>
      <SponsoredLabel by={promo.owner?.username} style={styles.labelPad} />
      {body}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md, backgroundColor: '#0A1628', overflow: 'hidden' },
  label: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  labelPad: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  labelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  profile: { alignItems: 'center', gap: 6, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surface },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.white, fontSize: 19, fontWeight: '800', marginTop: spacing.sm },
  handle: { color: colors.textSecondary, fontSize: 13 },
  bio: { color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  follow: { marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 10, borderRadius: radius.full, backgroundColor: colors.primary },
  following: { backgroundColor: 'rgba(255,255,255,0.14)' },
  followText: { color: colors.white, fontWeight: '800', fontSize: 15 },
});

export default SponsoredCard;
