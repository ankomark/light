import React, { useState, useEffect } from 'react';
import { useI18n } from '../../context/I18nContext';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchOrders } from '../../services/api';

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', KES: 'Ksh', NGN: '₦' };

// total_amount/price arrive as strings (DRF serializes DecimalField that way),
// so parse before formatting — never call .toFixed() on the raw value.
const formatPrice = (price, currency = 'USD') => {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  return `${symbol}${(parseFloat(price) || 0).toFixed(2)}`;
};

const OrderHistory = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const route = useRoute();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    if (route.params?.success) {
      Alert.alert(
        'Order Successful', 
        `Your order #${route.params.orderId} has been placed successfully!`,
        [{ text: 'OK', onPress: () => loadOrders() }]
      );
    }
  }, [route.params]);

  const loadOrders = async () => {
    try {
      setRefreshing(true);
      const ordersData = await fetchOrders();
      // Orders list is unpaginated today; tolerate a paginated envelope too.
      setOrders(Array.isArray(ordersData) ? ordersData : (ordersData?.results || []));
    } catch (error) {
      console.error('Error loading orders:', error);
      Alert.alert(t('common.error'), t('market.orders.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString(undefined, options);
  };

  const getStatusColor = (status) => {
    switch ((status || '').toLowerCase()) {
      case 'delivered':
        return '#2E8B57';
      case 'shipped':
        return '#1D478B';
      case 'processing':
        return '#FFA500';
      case 'cancelled':
        return '#FF6347';
      default:
        return '#888';
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1D478B" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {orders.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="box-open" size={50} color="#888" />
          <Text style={styles.emptyText}>{t('market.orders.empty')}</Text>
          <TouchableOpacity 
            style={styles.shopButton}
            onPress={() => navigation.navigate('ProductList')}
          >
            <Text style={styles.shopButtonText}>{t('market.browseProducts')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity 
              style={styles.orderCard}
              onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
            >
              <View style={styles.orderHeader}>
                <Text style={styles.orderId}>Order #{item.id}</Text>
                <Text style={styles.orderDate}>{formatDate(item.created_at)}</Text>
              </View>

              <View style={styles.orderStatusContainer}>
                <View style={[
                  styles.statusBadge,
                  { backgroundColor: getStatusColor(item.status) }
                ]}>
                  <Text style={styles.statusText}>{item.status}</Text>
                </View>
                <Text style={styles.orderTotal}>
                  {formatPrice(item.total_amount, item.items?.[0]?.product?.currency)}
                </Text>
              </View>

              <View style={styles.orderItemsPreview}>
                {(item.items || []).slice(0, 2).map((orderItem, index) => (
                  <Text key={index} style={styles.orderItemText} numberOfLines={1}>
                    {orderItem.quantity}x {orderItem.product?.title || t('market.unavailableProduct')}
                  </Text>
                ))}
                {(item.items?.length || 0) > 2 && (
                  <Text style={styles.moreItemsText}>
                    +{item.items.length - 2} more items
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.orderList}
          refreshing={refreshing}
          onRefresh={loadOrders}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  orderList: {
    padding: 16,
  },
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  orderId: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  orderDate: {
    fontSize: 14,
    color: '#888',
  },
  orderStatusContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  orderTotal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1D478B',
  },
  orderItemsPreview: {
    borderTopWidth: 1,
    borderColor: '#eee',
    paddingTop: 12,
  },
  orderItemText: {
    fontSize: 14,
    color: '#555',
    marginBottom: 4,
  },
  moreItemsText: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
  },
});

export default OrderHistory;