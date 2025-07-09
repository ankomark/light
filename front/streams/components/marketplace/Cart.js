import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity, 
  Image,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchCart, removeFromCart, checkoutCart } from '../../services/api';
import { useAuth } from '../../context/useAuth';
import NetInfo from '@react-native-community/netinfo';

// Price formatting helper
const formatPrice = (price, currency) => {
  const symbols = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    KES: 'Ksh',
    NGN: '₦',
  };
  
  const currencyCode = currency || 'USD';
  const symbol = symbols[currencyCode] || currencyCode;
  const numericPrice = typeof price === 'number' ? price : parseFloat(price) || 0;
  
  return `${symbol}${numericPrice.toFixed(2)}`;
};

const Cart = () => {
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  const [cartItems, setCartItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subtotal, setSubtotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // Load cart data
  const loadCartData = async () => {
    try {
      const cartData = await fetchCart();
      const items = cartData?.items || [];
      setCartItems(items);
      
      // Calculate subtotal
      const total = items.reduce((sum, item) => {
        const price = item.product?.price || 0;
        return sum + (price * item.quantity);
      }, 0);
      
      setSubtotal(total);
      return true;
    } catch (error) {
      console.error('Error loading cart:', error);
      if (error.response?.status !== 401) { // Don't show alert for unauthorized
        Alert.alert(
          'Error', 
          isOnline ? 'Failed to load cart data' : 'You are offline. Connect to load your cart.'
        );
      }
      return false;
    }
  };

  // Initial load and network status listener
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected);
      if (state.isConnected && currentUser) {
        loadCartData();
      }
    });

    const loadInitialData = async () => {
      setLoading(true);
      await loadCartData();
      setLoading(false);
    };

    loadInitialData();
    return () => unsubscribe();
  }, [currentUser]);

  // Handle refresh
  const handleRefresh = async () => {
    setRefreshing(true);
    await loadCartData();
    setRefreshing(false);
  };

  // Remove item from cart
  const handleRemoveItem = async (itemId) => {
    try {
      // Optimistic update
      const updatedItems = cartItems.filter(item => item.id !== itemId);
      setCartItems(updatedItems);
      
      // Update subtotal
      const newTotal = updatedItems.reduce((sum, item) => {
        const price = item.product?.price || 0;
        return sum + (price * item.quantity);
      }, 0);
      setSubtotal(newTotal);

      // API call
      await removeFromCart(itemId);
    } catch (error) {
      console.error('Error removing item:', error);
      // Revert on error
      const success = await loadCartData();
      if (!success) {
        Alert.alert('Error', 'Failed to remove item. Please try again.');
      }
    }
  };

  // Handle checkout
  const handleCheckout = async () => {
    if (!currentUser) {
      Alert.alert('Login Required', 'Please login to proceed to checkout', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => navigation.navigate('Login') }
      ]);
      return;
    }

    try {
      const order = await checkoutCart();
      navigation.navigate('Checkout', { orderId: order.id });
    } catch (error) {
      console.error('Error during checkout:', error);
      Alert.alert('Error', 'Failed to process checkout');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1D478B" />
        <Text>Loading your cart...</Text>
      </View>
    );
  }

  if (cartItems.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Icon name="shopping-cart" size={50} color="#888" />
        <Text style={styles.emptyText}>Your cart is empty</Text>
        <TouchableOpacity 
          style={styles.shopButton}
          onPress={() => navigation.navigate('ProductList')}
        >
          <Text style={styles.shopButtonText}>Browse Products</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Get currency from first item (assume all items same currency)
  const currency = cartItems[0]?.product?.currency || 'USD';

  return (
    <View style={styles.container}>
      <FlatList
        data={cartItems}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.cartItem}>
            <Image 
              source={{ uri: item.product.images[0]?.image_url }} 
              style={styles.productImage}
              resizeMode="cover"
            />
            <View style={styles.itemDetails}>
              <Text style={styles.productTitle} numberOfLines={1}>{item.product.title}</Text>
              
              <View style={styles.priceContainer}>
                <Text style={styles.price}>
                  {formatPrice(item.product.price, item.product.currency)}
                </Text>
                <Text style={styles.quantityText}>Qty: {item.quantity}</Text>
              </View>
              
              <Text style={styles.itemTotal}>
                Total: {formatPrice(item.product.price * item.quantity, item.product.currency)}
              </Text>
            </View>
            
            <TouchableOpacity 
              style={styles.removeButton}
              onPress={() => handleRemoveItem(item.id)}
            >
              <Icon name="trash" size={20} color="#FF6347" />
            </TouchableOpacity>
          </View>
        )}
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
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal:</Text>
          <Text style={styles.summaryPrice}>{formatPrice(subtotal, currency)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Shipping:</Text>
          <Text style={styles.summaryPrice}>{formatPrice(200, currency)}</Text>
        </View>
        <View style={[styles.summaryRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>Total:</Text>
          <Text style={styles.totalPrice}>{formatPrice(subtotal + 200, currency)}</Text>
        </View>
      </View>

      <TouchableOpacity 
        style={styles.checkoutButton}
        onPress={handleCheckout}
        disabled={!isOnline}
      >
        <Text style={styles.checkoutButtonText}>
          {isOnline ? 'Proceed to Checkout' : 'Offline - Checkout Unavailable'}
        </Text>
      </TouchableOpacity>
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
});

export default Cart;