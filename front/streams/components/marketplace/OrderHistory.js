// My Orders — what I bought. Opens at once from the phone's copy
// (useCachedData) and refreshes behind it; each order's total is shown per
// currency, never as one sum of shillings and dollars.
import React, { useCallback } from 'react';
import { useI18n } from '../../context/I18nContext';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchOrders } from '../../services/api';
import { useAuth } from '../../context/useAuth';
import useCachedData from '../../utils/useCachedData';
import { userKey } from '../../utils/screenCache';
import { formatTotals, orderTotals, lineTitle } from '../../utils/market';

export const STATUS_COLORS = {
  delivered: '#2E8B57',
  shipped: '#1D478B',
  processing: '#FFA500',
  cancelled: '#FF6347',
  refunded: '#FF6347',
  pending: '#888',
};

export const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const listOf = (data) => (Array.isArray(data) ? data : (data?.results || []));

// My Orders in three piles: still going, done, and called off.
const TABS = {
  active: ['pending', 'processing', 'shipped'],
  completed: ['delivered'],
  cancelled: ['cancelled', 'refunded'],
};
export const tabOf = (order) => {
  const status = (order?.status || 'pending').toLowerCase();
  return Object.keys(TABS).find((k) => TABS[k].includes(status)) || 'active';
};

const OrderHistory = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  // "My Orders" = things I bought. Sales live in the Seller Dashboard.
  const { data, failed, refreshing, reload } = useCachedData(
    currentUser ? userKey(currentUser.id, 'market:orders:buyer') : null,
    () => fetchOrders({ role: 'buyer' }),
  );
  const all = listOf(data);
  const [tab, setTab] = React.useState('active');
  const orders = all.filter((o) => tabOf(o) === tab);

  // Back from an order (cancelled, say): the list is read again.
  const first = React.useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    reload();
  }, [reload]));

  if (!data) {
    return (
      <View style={styles.loadingContainer}>
        {failed ? (
          <>
            <Icon name="wifi" size={44} color="#888" />
            <Text style={styles.emptyText}>{t('market.orders.loadFailed')}</Text>
            <TouchableOpacity style={styles.shopButton} onPress={reload}>
              <Text style={styles.shopButtonText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </>
        ) : <ActivityIndicator size="large" color="#1D478B" />}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {all.length > 0 && (
        <View style={styles.tabs} accessibilityRole="tablist">
          {Object.keys(TABS).map((k) => {
            const n = all.filter((o) => tabOf(o) === k).length;
            return (
              <TouchableOpacity
                key={k}
                style={[styles.tab, tab === k && styles.tabOn]}
                onPress={() => setTab(k)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === k }}
                testID={`orders-tab-${k}`}
              >
                <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>
                  {t(`market.orders.tab.${k}`)}{n ? ` (${n})` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {orders.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="archive" size={50} color="#888" />
          <Text style={styles.emptyText}>
            {all.length ? t(`market.orders.none.${tab}`) : t('market.orders.empty')}
          </Text>
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
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => {
            const status = (item.status || 'pending').toLowerCase();
            return (
              <TouchableOpacity
                style={styles.orderCard}
                onPress={() => navigation.navigate('OrderDetail', { orderId: item.id, order: item })}
                testID={`order-${item.id}`}
              >
                <View style={styles.orderHeader}>
                  <Text style={styles.orderId}>{t('market.order.number', { id: item.id })}</Text>
                  <Text style={styles.orderDate}>{formatDate(item.created_at)}</Text>
                </View>

                <View style={styles.orderStatusContainer}>
                  <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[status] || '#888' }]}>
                    <Text style={styles.statusText}>{t(`market.status.${status}`)}</Text>
                  </View>
                  <Text style={styles.orderTotal}>{formatTotals(orderTotals(item))}</Text>
                </View>

                <View style={styles.orderItemsPreview}>
                  {(item.items || []).slice(0, 2).map((orderItem) => (
                    <Text key={orderItem.id} style={styles.orderItemText} numberOfLines={1}>
                      {orderItem.quantity}× {lineTitle(orderItem) || t('market.unavailableProduct')}
                    </Text>
                  ))}
                  {(item.items?.length || 0) > 2 && (
                    <Text style={styles.moreItemsText}>
                      {t('market.orders.more', { n: item.items.length - 2 })}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.orderList}
          refreshing={refreshing && !!data}
          onRefresh={reload}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  tabOn: { backgroundColor: '#FFC46B' },
  tabText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: '#0A1628' },
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