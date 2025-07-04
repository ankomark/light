import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchOrders } from '../../services/api';

const OrderHistory = () => {
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
      setOrders(ordersData);
    } catch (error) {
      console.error('Error loading orders:', error);
      Alert.alert('Error', 'Failed to load order history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const formatDate = (dateString) => {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
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
          <Text style={styles.emptyText}>No orders yet</Text>
          <TouchableOpacity 
            style={styles.shopButton}
            onPress={() => navigation.navigate('ProductList')}
          >
            <Text style={styles.shopButtonText}>Browse Products</Text>
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
                <Text style={styles.orderDate}>{formatDate(item.ordered_at)}</Text>
              </View>
              
              <View style={styles.orderStatusContainer}>
                <View style={[
                  styles.statusBadge,
                  { backgroundColor: getStatusColor(item.status) }
                ]}>
                  <Text style={styles.statusText}>{item.status}</Text>
                </View>
                <Text style={styles.orderTotal}>${item.total_amount.toFixed(2)}</Text>
              </View>

              <View style={styles.orderItemsPreview}>
                {item.items.slice(0, 2).map((orderItem, index) => (
                  <Text key={index} style={styles.orderItemText} numberOfLines={1}>
                    {orderItem.quantity}x {orderItem.product.title}
                  </Text>
                ))}
                {item.items.length > 2 && (
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
    backgroundColor: '#fff',
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
    color: '#888',
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