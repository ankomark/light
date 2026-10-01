// The cart, one tap away from anywhere in the marketplace, with how many
// things are in it. The count is the phone's (utils/cartStore.js), so it moves
// the moment something is added, before the server has answered.
//
// Drawn with the marketplace's own coloured cart artwork (the menu's Cart row
// had it), in its own colours; `size` is the glyph size it stands in for.
import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { useAuth } from '../../context/useAuth';
import { useMarket, useMarketUser, refreshCart } from '../../utils/cartStore';
import { cartCount } from '../../utils/market';

const CART_ART = require('../../assets/cart-icon.png');

export default function CartButton({ size = 22, style }) {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  useMarketUser(currentUser?.id);
  const { cart } = useMarket();
  const count = cartCount(cart);

  // The first cart button to appear reads the cart, so the count is real.
  const userId = currentUser?.id;
  useEffect(() => {
    if (userId && !cart) refreshCart().catch(() => {});
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Cart')}
      style={[styles.button, style]}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={count ? t('market.cart.withCount', { n: count }) : t('market.cart.title')}
      testID="cart-button"
    >
      <Image source={CART_ART} style={{ width: size + 6, height: size + 6 }} contentFit="contain"
             testID="cart-art" />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText} testID="cart-count">{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { padding: 6 },
  badge: {
    position: 'absolute', top: -2, right: -4, minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 4, backgroundColor: '#FF6347', alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
