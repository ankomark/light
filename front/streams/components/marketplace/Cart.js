// The cart: what is in it opens at once from the phone, every change shows at
// once, and the server's answer follows (utils/cartStore.js). Offline, the
// cart is still the cart — it says it is offline, and checkout waits.
import React, { useEffect, useState } from 'react';
import { useI18n } from '../../context/I18nContext';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { checkoutCart } from '../../services/api';
import { useAuth } from '../../context/useAuth';
import {
  useMarket, useMarketUser, refreshCart, setCartQuantity, removeCartLine, emptyCart,
} from '../../utils/cartStore';
import { formatPrice, formatTotals, cartTotals, marketError } from '../../utils/market';
import useMarketToast from './MarketToast';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');

const Cart = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  useMarketUser(currentUser?.id);
  const { cart, cartOffline } = useMarket();
  const [refreshing, setRefreshing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [toast, showToast] = useMarketToast();
  const cartItems = cart?.items || [];

  // By id: a new user object for the same person must not re-read the cart
  // (each read re-renders, which would read it again).
  const userId = currentUser?.id;
  useEffect(() => {
    if (userId) refreshCart().catch(() => {});
  }, [userId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshCart();
    } catch {
      showToast(t('market.cart.offline'), { error: true });
    } finally {
      setRefreshing(false);
    }
  };

  const handleRemoveItem = async (item) => {
    try {
      await removeCartLine(item);
    } catch (e) {
      showToast(marketError(e, t('market.cart.removeFailed')), { error: true });
    }
  };

  // The +/- steppers: capped at stock here, and by the server behind it.
  const handleSetQuantity = async (item, nextQty) => {
    const stock = item.product?.quantity ?? 0;
    if (nextQty < 1) return;                 // to remove, use the trash button
    if (nextQty > stock) {
      showToast(t('market.cart.onlyInStock', { n: stock }), { error: true });
      return;
    }
    try {
      await setCartQuantity(item, nextQty);
    } catch (e) {
      showToast(marketError(e, t('market.cart.updateFailed')), { error: true });
    }
  };

  const handleCheckout = async () => {
    if (!currentUser) {
      Alert.alert(t('market.loginRequired'), t('market.cart.loginToCheckout'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('market.login'), onPress: () => navigation.navigate('Login') },
      ]);
      return;
    }
    try {
      setCheckingOut(true);
      const order = await checkoutCart();
      emptyCart();
      // The order comes with the answer: the next screen shows it at once.
      navigation.navigate('Checkout', { orderId: order.id, order });
    } catch (error) {
      showToast(marketError(error, t('market.cart.checkoutFailed')), { error: true });
      refreshCart().catch(() => {});
    } finally {
      setCheckingOut(false);
    }
  };

  if (!cart && currentUser && !cartOffline) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FFC46B" />
        <Text style={styles.loadingText}>{t('market.cart.loading')}</Text>
      </View>
    );
  }

  if (cartItems.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Icon name={cartOffline && !cart ? 'wifi' : 'shopping-cart'} size={50} color="#888" />
        <Text style={styles.emptyText}>
          {cartOffline && !cart ? t('market.cart.offline') : t('market.cart.empty')}
        </Text>
        <TouchableOpacity
          style={styles.shopButton}
          onPress={() => (cartOffline && !cart ? handleRefresh() : navigation.navigate('ProductList'))}
        >
          <Text style={styles.shopButtonText}>
            {cartOffline && !cart ? t('common.retry') : t('market.browseProducts')}
          </Text>
        </TouchableOpacity>
        {toast}
      </View>
    );
  }

  const totals = cartTotals(cart);
  const hasStockProblem = cartItems.some((i) => i.quantity > (i.product?.quantity ?? 0));

  return (
    <View style={styles.container}>
      {cartOffline && (
        <View style={styles.offlineBanner} testID="cart-offline">
          <Icon name="wifi" size={14} color="#FFC46B" />
          <Text style={styles.offlineText}>{t('market.cart.offlineShowing')}</Text>
        </View>
      )}
      <FlatList
        data={cartItems}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => {
          const stock = item.product?.quantity ?? 0;
          // A line still on its way to the server has no id to change yet.
          const settled = !item.pending;
          return (
            <View style={styles.cartItem} testID={`cart-line-${item.product?.id}`}>
              <Image
                source={item.product?.images?.[0]?.image_url ? { uri: item.product.images[0].image_url } : PLACEHOLDER_IMAGE}
                placeholder={PLACEHOLDER_IMAGE}
                contentFit="cover"
                transition={150}
                style={styles.productImage}
              />
              <View style={styles.itemDetails}>
                <Text style={styles.productTitle} numberOfLines={1}>{item.product?.title || t('market.unavailableProduct')}</Text>

                <View style={styles.priceContainer}>
                  <Text style={styles.price}>
                    {formatPrice(item.product?.price, item.product?.currency)}
                  </Text>
                  <View style={styles.qtyStepper}>
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => handleSetQuantity(item, item.quantity - 1)}
                      disabled={!settled || item.quantity <= 1}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={t('market.cart.less')}
                      testID={`cart-less-${item.product?.id}`}
                    >
                      <Icon name="minus" size={12} color={!settled || item.quantity <= 1 ? '#ccc' : '#1D478B'} />
                    </TouchableOpacity>
                    <Text style={styles.qtyValue}>{item.quantity}</Text>
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => handleSetQuantity(item, item.quantity + 1)}
                      disabled={!settled || item.quantity >= stock}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={t('market.cart.more')}
                      testID={`cart-more-${item.product?.id}`}
                    >
                      <Icon name="plus" size={12} color={!settled || item.quantity >= stock ? '#ccc' : '#1D478B'} />
                    </TouchableOpacity>
                  </View>
                </View>

                {item.quantity > stock && (
                  <Text style={styles.stockWarn}>
                    {t('market.cart.exceedsStock', { n: stock })}
                  </Text>
                )}

                <Text style={styles.itemTotal}>
                  {t('market.cart.lineTotal', {
                    amount: formatPrice((parseFloat(item.product?.price) || 0) * item.quantity, item.product?.currency),
                  })}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => handleRemoveItem(item)}
                disabled={!settled}
                accessibilityRole="button"
                accessibilityLabel={t('market.cart.remove')}
                testID={`cart-remove-${item.product?.id}`}
              >
                <Icon name="trash" size={20} color={settled ? '#FF6347' : '#ccc'} />
              </TouchableOpacity>
            </View>
          );
        }}
        contentContainerStyle={styles.cartList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#1D478B']}
            tintColor="#1D478B"
          />
        }
      />

      <View style={styles.summaryContainer}>
        <View style={[styles.summaryRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>{t('market.cart.total')}</Text>
          {/* One figure per currency: shillings and dollars are never added. */}
          <Text style={styles.totalPrice} testID="cart-total">{formatTotals(totals)}</Text>
        </View>
        <Text style={styles.shippingNote}>{t('market.cart.payDirectNote')}</Text>
      </View>

      <TouchableOpacity
        style={[styles.checkoutButton, (cartOffline || checkingOut || hasStockProblem) && styles.checkoutButtonDisabled]}
        onPress={handleCheckout}
        disabled={cartOffline || checkingOut || hasStockProblem}
        testID="cart-checkout"
      >
        <Text style={styles.checkoutButtonText}>
          {cartOffline ? t('market.cart.offlineButton')
            : hasStockProblem ? t('market.cart.fixStock')
              : t('market.cart.continueToSellers')}
        </Text>
      </TouchableOpacity>

      {checkingOut && (
        <View style={styles.checkoutOverlay}>
          <View style={styles.checkoutOverlayCard}>
            <ActivityIndicator size="large" color="#1D478B" />
            <Text style={styles.checkoutOverlayText}>{t('market.cart.connecting')}</Text>
          </View>
        </View>
      )}
      {toast}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, backgroundColor: 'rgba(255,196,107,0.14)',
  },
  offlineText: { color: '#FFC46B', fontSize: 13, flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#cdd9e5',
    fontSize: 15,
    marginTop: 12,
  },
  emptyContainer: {
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
  },
  shopButton: {
    backgroundColor: '#1D478B',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  shopButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  cartList: {
    padding: 16,
  },
  cartItem: {
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
  productImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  itemDetails: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'space-between',
  },
  productTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
    color: '#333',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    justifyContent: 'space-between',
  },
  price: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1D478B',
  },
  quantityText: {
    fontSize: 14,
    color: '#555',
  },
  qtyStepper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginHorizontal: 12,
    minWidth: 18,
    textAlign: 'center',
  },
  stockWarn: {
    fontSize: 12,
    color: '#FF6347',
    marginBottom: 4,
  },
  itemTotal: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  removeButton: {
    justifyContent: 'center',
    paddingLeft: 8,
  },
  summaryContainer: {
    borderTopWidth: 1,
    borderColor: '#eee',
    padding: 16,
    backgroundColor: '#f9f9f9',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 16,
    color: '#555',
  },
  summaryPrice: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  totalRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: '#ddd',
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  totalPrice: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1D478B',
  },
  shippingNote: {
    fontSize: 12,
    color: '#777',
    marginTop: 8,
    lineHeight: 17,
  },
  checkoutButton: {
    backgroundColor: '#1D478B',
    padding: 16,
    margin: 16,
    borderRadius: 8,
    alignItems: 'center',
    opacity: 1,
  },
  checkoutButtonDisabled: {
    backgroundColor: '#cccccc',
  },
  checkoutButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  checkoutOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkoutOverlayCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: 'center',
    maxWidth: '80%',
  },
  checkoutOverlayText: {
    marginTop: 16,
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default Cart;