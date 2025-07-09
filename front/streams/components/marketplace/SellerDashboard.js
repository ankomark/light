import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchProducts, fetchOrders, deleteProduct } from '../../services/api';
import { useAuth } from '../../context/useAuth';

// Constants
const COLORS = {
  primary: '#1D478B',
  secondary: '#2E8B57',
  error: '#FF6347',
  warning: '#FFA500',
  gray: '#888',
  lightGray: '#f5f5f5',
  white: '#fff',
  black: '#333'
};

const SHADOW = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  }
};

const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  KES: 'Ksh',
  NGN: '₦',
};

const STATUS_COLORS = {
  delivered: '#2E8B57',
  shipped: '#1D478B',
  processing: '#FFA500',
  default: '#888'
};

const DEFAULT_IMAGE = 'https://via.placeholder.com/120';

// Helper Functions
const formatPrice = (price, currency = 'USD') => {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const numericPrice = typeof price === 'number' ? price : parseFloat(price) || 0;
  return `${symbol}${numericPrice.toFixed(2)}`;
};

const SellerDashboard = () => {
  // Hooks and State
  const navigation = useNavigation();
  const { currentUser, isAuthenticated, isLoading: authLoading } = useAuth();
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('products');

  // Data Fetching
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        
        if (!isAuthenticated || !currentUser?.id) {
          setLoading(false);
          return;
        }

        const [productsData, ordersData] = await Promise.all([
          fetchProducts({ seller_id: currentUser.id }),
          fetchOrders({ seller_id: currentUser.id })
        ]);
        
        setProducts(productsData || []);
        setOrders(ordersData || []);
      } catch (error) {
        console.error('Error loading seller data:', error);
        Alert.alert('Error', 'Failed to load seller dashboard');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isAuthenticated, currentUser]);

  // Business Logic
  const handleDeleteProduct = async (slug) => {
    Alert.alert(
      'Delete Product',
      'Are you sure you want to delete this product?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              await deleteProduct(slug);
              const productsData = await fetchProducts({ seller_id: currentUser?.id });
              setProducts(productsData);
              Alert.alert('Success', 'Product deleted successfully');
            } catch (error) {
              console.error('Error deleting product:', error);
              Alert.alert('Error', 'Failed to delete product');
            }
          },
        },
      ],
      { cancelable: false }
    );
  };

  const calculateEarnings = () => {
    try {
      if (!Array.isArray(orders)) return 0;
      return orders.reduce((sum, order) => {
        const amount = Number(order?.total_amount);
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0);
    } catch (error) {
      console.error('Error calculating earnings:', error);
      return 0;
    }
  };

  const getOrderStatusCount = (status) => {
    return orders.filter(order => 
      order.status?.toLowerCase() === status.toLowerCase()
    ).length;
  };

  // Render Components
  const renderHeader = () => (
    <>
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{products.length}</Text>
          <Text style={styles.statLabel}>Products</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{orders.length}</Text>
          <Text style={styles.statLabel}>Orders</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {formatPrice(calculateEarnings(), 'USD')}
          </Text>
          <Text style={styles.statLabel}>Earnings</Text>
        </View>
      </View>

      {orders.length > 0 && (
        <View style={styles.statusContainer}>
          {['processing', 'shipped', 'delivered'].map((status) => (
            <View key={status} style={styles.statusCard}>
              <Text style={styles.statusValue}>{getOrderStatusCount(status)}</Text>
              <Text style={styles.statusLabel}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.tabsContainer}>
        {['products', 'orders'].map((tab) => (
          <TouchableOpacity 
            key={tab}
            style={[
              styles.tabButton,
              activeTab === tab && styles.activeTab
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[
              styles.tabText,
              activeTab === tab && styles.activeTabText
            ]}>
              My {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Icon 
        name={activeTab === 'products' ? "box-open" : "shopping-bag"} 
        size={40} 
        color={COLORS.gray} 
      />
      <Text style={styles.emptyText}>
        {activeTab === 'products' 
          ? 'You have no products listed yet' 
          : 'You have no orders yet'}
      </Text>
      {activeTab === 'products' && (
        <TouchableOpacity 
          style={styles.addButton}
          onPress={() => navigation.navigate('AddProduct')}
        >
          <Text style={styles.addButtonText}>Add Your First Product</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderProductItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.productCard}
      onPress={() => navigation.navigate(
        item.is_owner ? 'EditProduct' : 'ProductDetail', 
        { slug: item.slug }
      )}
    >
      <Image 
        source={{ uri: item.images?.[0]?.image_url || DEFAULT_IMAGE }} 
        style={styles.productImage}
        resizeMode="cover"
      />
      <View style={styles.productInfo}>
        <Text style={styles.productTitle} numberOfLines={1}>
          {item.title || 'Untitled Product'}
        </Text>
        <Text style={styles.productPrice}>
          {formatPrice(item.price, item.currency)}
        </Text>
        <Text style={[
          styles.productStock,
          item.quantity <= 0 && styles.outOfStock
        ]}>
          {item.quantity > 0 ? `${item.quantity} in stock` : 'Out of stock'}
        </Text>
      </View>
      
      {item.is_owner && (
        <View style={styles.productActions}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => navigation.navigate('EditProduct', { slug: item.slug })}
          >
            <Icon name="edit" size={18} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => handleDeleteProduct(item.slug)}
          >
            <Icon name="trash" size={18} color={COLORS.error} />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderOrderItem = ({ item }) => {
    const currency = item.items?.[0]?.product?.currency || 'USD';
    const statusColor = STATUS_COLORS[item.status?.toLowerCase()] || STATUS_COLORS.default;
    
    return (
      <TouchableOpacity 
        style={styles.orderCard}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
      >
        <View style={styles.orderHeader}>
          <Text style={styles.orderId}>Order #{item.id}</Text>
          <Text style={[styles.orderStatus, { color: statusColor }]}>
            {item.status || 'Unknown'}
          </Text>
        </View>
        <Text style={styles.orderDate}>
          {item.ordered_at ? new Date(item.ordered_at).toLocaleDateString() : 'No date'}
        </Text>
        <Text style={styles.orderTotal}>
          Total: {formatPrice(item.total_amount, currency)}
        </Text>
        <Text style={styles.orderItems}>
          {item.items?.length || 0} item{item.items?.length !== 1 ? 's' : ''}
        </Text>
      </TouchableOpacity>
    );
  };

  // Conditional Rendering
  if (authLoading || (isAuthenticated && loading)) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={styles.authContainer}>
        <Icon name="user-circle" size={50} color={COLORS.gray} />
        <Text style={styles.authText}>Please login to access seller dashboard</Text>
        <TouchableOpacity 
          style={styles.authButton}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={styles.authButtonText}>Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Main Render
  return (
    <View style={styles.container}>
      <FlatList
        data={activeTab === 'products' ? products : orders}
        keyExtractor={(item) => item.id.toString()}
        renderItem={activeTab === 'products' ? renderProductItem : renderOrderItem}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.contentContainer}
      />

      {activeTab === 'products' && (
        <TouchableOpacity 
          style={styles.floatingButton}
          onPress={() => navigation.navigate('AddProduct')}
        >
          <Icon name="plus" size={24} color={COLORS.white} />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  authContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  authText: {
    fontSize: 18,
    color: COLORS.black,
    marginVertical: 20,
    textAlign: 'center',
  },
  authButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 8,
  },
  authButtonText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: COLORS.gray,
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statusCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    ...SHADOW.sm,
  },
  statusValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.black,
    marginBottom: 4,
  },
  statusLabel: {
    fontSize: 12,
    color: COLORS.gray,
    textTransform: 'uppercase',
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: COLORS.lightGray,
    marginHorizontal: 16,
  },
  tabButton: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderColor: COLORS.primary,
  },
  tabText: {
    fontSize: 16,
    color: COLORS.gray,
    fontWeight: '500',
  },
  activeTabText: {
    color: COLORS.primary,
  },
  contentContainer: {
    flexGrow: 1,
    padding: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.gray,
    marginTop: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  addButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  addButtonText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 16,
  },
  productCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 8,
    marginBottom: 16,
    padding: 12,
    ...SHADOW.sm,
  },
  productImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  productTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
    color: COLORS.black,
  },
  productPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  productStock: {
    fontSize: 14,
    color: COLORS.secondary,
  },
  outOfStock: {
    color: COLORS.error,
  },
  productActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 8,
    marginLeft: 4,
  },
  orderCard: {
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    ...SHADOW.sm,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  orderId: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.black,
  },
  orderStatus: {
    fontSize: 14,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  orderDate: {
    fontSize: 14,
    color: COLORS.gray,
    marginBottom: 4,
  },
  orderTotal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  orderItems: {
    fontSize: 14,
    color: COLORS.black,
  },
  floatingButton: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW.md,
  },
});

export default SellerDashboard;