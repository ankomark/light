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

const SellerDashboard = () => {
  const navigation = useNavigation();
  const { currentUser, isAuthenticated, isLoading: authLoading } = useAuth();
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('products');

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
              // Refresh products after deletion
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
    return orders.reduce((total, order) => {
      return total + (order.total_amount || 0);
    }, 0);
  };

  const getOrderStatusCount = (status) => {
    return orders.filter(order => 
      order.status && order.status.toLowerCase() === status.toLowerCase()
    ).length;
  };

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
          <Text style={styles.statValue}>${calculateEarnings().toFixed(2)}</Text>
          <Text style={styles.statLabel}>Earnings</Text>
        </View>
      </View>

      {orders.length > 0 && (
        <View style={styles.statusContainer}>
          <View style={styles.statusCard}>
            <Text style={styles.statusValue}>{getOrderStatusCount('processing')}</Text>
            <Text style={styles.statusLabel}>Processing</Text>
          </View>
          <View style={styles.statusCard}>
            <Text style={styles.statusValue}>{getOrderStatusCount('shipped')}</Text>
            <Text style={styles.statusLabel}>Shipped</Text>
          </View>
          <View style={styles.statusCard}>
            <Text style={styles.statusValue}>{getOrderStatusCount('delivered')}</Text>
            <Text style={styles.statusLabel}>Delivered</Text>
          </View>
        </View>
      )}

      <View style={styles.tabsContainer}>
        <TouchableOpacity 
          style={[
            styles.tabButton,
            activeTab === 'products' && styles.activeTab
          ]}
          onPress={() => setActiveTab('products')}
        >
          <Text style={[
            styles.tabText,
            activeTab === 'products' && styles.activeTabText
          ]}>
            My Products
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[
            styles.tabButton,
            activeTab === 'orders' && styles.activeTab
          ]}
          onPress={() => setActiveTab('orders')}
        >
          <Text style={[
            styles.tabText,
            activeTab === 'orders' && styles.activeTabText
          ]}>
            My Orders
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Icon name={activeTab === 'products' ? "box-open" : "shopping-bag"} size={40} color="#888" />
      <Text style={styles.emptyText}>
        {activeTab === 'products' ? 'You have no products listed yet' : 'You have no orders yet'}
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
      onPress={() => {
        // Only allow editing if current user is the owner
        if (item.is_owner) {
          navigation.navigate('EditProduct', { slug: item.slug })
        }
      }}
    >
      <Image 
        source={{ uri: item.images?.[0]?.image_url || 'https://via.placeholder.com/120' }} 
        style={styles.productImage}
        resizeMode="cover"
      />
      <View style={styles.productInfo}>
        <Text style={styles.productTitle} numberOfLines={1}>{item.title || 'Untitled Product'}</Text>
        <Text style={styles.productPrice}>${(item.price ? Number(item.price) : 0).toFixed(2)}</Text>
        <Text style={[
          styles.productStock,
          item.quantity <= 0 && styles.outOfStock
        ]}>
          {item.quantity > 0 ? `${item.quantity} in stock` : 'Out of stock'}
        </Text>
      </View>
      
      {/* Only show actions for products owned by current user */}
      {item.is_owner && (
        <View style={styles.productActions}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => navigation.navigate('EditProduct', { slug: item.slug })}
          >
            <Icon name="edit" size={18} color="#1D478B" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => handleDeleteProduct(item.slug)}
          >
            <Icon name="trash" size={18} color="#FF6347" />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderOrderItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.orderCard}
      onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
    >
      <View style={styles.orderHeader}>
        <Text style={styles.orderId}>Order #{item.id}</Text>
        <Text style={[
          styles.orderStatus,
          { 
            color: item.status === 'delivered' ? '#2E8B57' : 
                  item.status === 'shipped' ? '#1D478B' : 
                  item.status === 'processing' ? '#FFA500' : '#888'
          }
        ]}>
          {item.status || 'Unknown'}
        </Text>
      </View>
      <Text style={styles.orderDate}>
        {item.ordered_at ? new Date(item.ordered_at).toLocaleDateString() : 'No date'}
      </Text>
      <Text style={styles.orderTotal}>
        Total: ${(item.total_amount || 0).toFixed(2)}
      </Text>
      <Text style={styles.orderItems}>
        {item.items?.length || 0} item{item.items?.length !== 1 ? 's' : ''}
      </Text>
    </TouchableOpacity>
  );

  if (authLoading || (isAuthenticated && loading)) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1D478B" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={styles.authContainer}>
        <Icon name="user-circle" size={50} color="#888" />
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
          <Icon name="plus" size={24} color="#fff" />
        </TouchableOpacity>
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
  authContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  authText: {
    fontSize: 18,
    color: '#555',
    marginVertical: 20,
    textAlign: 'center',
  },
  authButton: {
    backgroundColor: '#1D478B',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 8,
  },
  authButtonText: {
    color: '#fff',
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
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1D478B',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#888',
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statusCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statusValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  statusLabel: {
    fontSize: 12,
    color: '#888',
    textTransform: 'uppercase',
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#eee',
    marginHorizontal: 16,
  },
  tabButton: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderColor: '#1D478B',
  },
  tabText: {
    fontSize: 16,
    color: '#888',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#1D478B',
  },
  contentContainer: {
    flex: 1,
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
    color: '#888',
    marginTop: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  addButton: {
    backgroundColor: '#1D478B',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  productCard: {
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
  productInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  productTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
    color: '#333',
  },
  productPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1D478B',
    marginBottom: 4,
  },
  productStock: {
    fontSize: 14,
    color: '#2E8B57',
  },
  outOfStock: {
    color: '#FF6347',
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
  orderStatus: {
    fontSize: 14,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  orderDate: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  orderTotal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1D478B',
    marginBottom: 4,
  },
  orderItems: {
    fontSize: 14,
    color: '#555',
  },
  floatingButton: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1D478B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
});

export default SellerDashboard;