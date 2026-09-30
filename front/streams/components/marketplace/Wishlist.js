// The wishlist: kept on the phone and shared with every heart in the
// marketplace (utils/cartStore.js), so it opens at once and a heart taken off
// here is off everywhere. An item can go straight into the cart from here.
import React, { useCallback, useState } from 'react';
import { useI18n } from '../../context/I18nContext';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useAuth } from '../../context/useAuth';
import {
  useMarket, useMarketUser, refreshWishlist, toggleWish, addProductToCart,
} from '../../utils/cartStore';
import { formatPrice, marketError } from '../../utils/market';
import useMarketToast from './MarketToast';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');

const Wishlist = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  useMarketUser(currentUser?.id);
  const { wishlist } = useMarket();
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [toast, showToast] = useMarketToast();
  const products = wishlist?.products || [];

  // By id: a new user object for the same person must not read it again.
  const userId = currentUser?.id;
  const load = useCallback(async () => {
    if (!userId) return;
    setFailed(false);
    try {
      await refreshWishlist();
    } catch {
      setFailed(true);
    }
  }, [userId]);

  // Re-read on focus: a heart may have changed on a product screen meanwhile.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleRemove = async (product) => {
    try {
      await toggleWish(product, false);
    } catch (e) {
      showToast(marketError(e, t('market.wishlist.removeFailed')), { error: true });
    }
  };

  const handleAddToCart = async (product) => {
    try {
      await addProductToCart(product, 1);
      showToast(t('market.product.addedToCart'));
    } catch (e) {
      showToast(marketError(e, t('market.product.addToCartFailed')), { error: true });
    }
  };

  if (!currentUser) {
    return (
      <View style={styles.centered}>
        <Icon name="heart-o" size={50} color="#888" />
        <Text style={styles.emptyText}>{t('market.wishlist.loginPrompt')}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.primaryButtonText}>{t('market.login')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!wishlist) {
    return (
      <View style={styles.centered}>
        {failed ? (
          <>
            <Icon name="wifi" size={44} color="#888" />
            <Text style={styles.emptyText}>{t('market.wishlist.loadFailed')}</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={load}>
              <Text style={styles.primaryButtonText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </>
        ) : <ActivityIndicator size="large" color="#FFC46B" />}
      </View>
    );
  }

  if (products.length === 0) {
    return (
      <View style={styles.centered}>
        <Icon name="heart-o" size={50} color="#888" />
        <Text style={styles.emptyText}>{t('market.wishlist.empty')}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('ProductList')}>
          <Text style={styles.primaryButtonText}>{t('market.browseProducts')}</Text>
        </TouchableOpacity>
        {toast}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={products}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#1D478B" />
        }
        renderItem={({ item }) => {
          const canBuy = item.quantity > 0 && item.is_available !== false;
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('ProductDetail', { slug: item.slug, preview: item })}
              activeOpacity={0.85}
              testID={`wish-${item.id}`}
            >
              <Image
                source={item.images?.[0]?.image_url ? { uri: item.images[0].image_url } : PLACEHOLDER_IMAGE}
                placeholder={PLACEHOLDER_IMAGE}
                contentFit="cover"
                transition={150}
                style={styles.image}
              />
              <View style={styles.details}>
                <Text style={styles.title} numberOfLines={2}>
                  {item.title || t('market.untitled')}
                </Text>
                <Text style={styles.price}>{formatPrice(item.price, item.currency)}</Text>
                <Text style={[styles.stock, !canBuy && styles.outOfStock]}>
                  {canBuy ? t('market.inStock', { n: item.quantity }) : t('market.outOfStock')}
                </Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => handleRemove(item)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('market.wishlist.remove')}
                  testID={`wish-remove-${item.id}`}
                >
                  <Icon name="heart" size={20} color="#FF6347" />
                </TouchableOpacity>
                {canBuy && (
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => handleAddToCart(item)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('market.product.addToCart')}
                    testID={`wish-cart-${item.id}`}
                  >
                    <Icon name="cart-plus" size={20} color="#1D478B" />
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />
      {toast}
    </View>
  );
};

const styles = StyleSheet.create({
  actions: { justifyContent: 'space-between', alignItems: 'center', paddingLeft: 8 },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    color: '#cdd9e5',
    marginTop: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#1D478B',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  list: {
    padding: 16,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  image: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  details: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  price: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1D478B',
    marginBottom: 4,
  },
  stock: {
    fontSize: 14,
    color: '#2E8B57',
  },
  outOfStock: {
    color: '#FF6347',
  },
  removeButton: {
    justifyContent: 'center',
    paddingLeft: 8,
  },
});

export default Wishlist;
