import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchOrderById, processPayment } from '../../services/api';

// Price formatting helper
const formatPrice = (price, currency = 'USD') => {
  const numericPrice = typeof price === 'number' ? price : parseFloat(price) || 0;
  return numericPrice.toFixed(2);
};

const Checkout = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { orderId } = route.params;
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('mpesa');
  const [shippingAddress, setShippingAddress] = useState('');
  const [cardDetails, setCardDetails] = useState({
    number: '',
    expiry: '',
    cvv: ''
  });

  useEffect(() => {
    const loadOrder = async () => {
      try {
        const orderData = await fetchOrderById(orderId);
        setOrder(orderData);
      } catch (error) {
        console.error('Error loading order:', error);
        Alert.alert('Error', 'Failed to load order details');
      } finally {
        setLoading(false);
      }
    };
    loadOrder();
  }, [orderId]);

  const handlePayment = async () => {
    if (!shippingAddress.trim()) {
      Alert.alert('Error', 'Please enter your shipping address');
      return;
    }

    try {
      const paymentData = {
        order_id: orderId,
        payment_method: paymentMethod,
        shipping_address: shippingAddress,
        ...(paymentMethod === 'card' ? cardDetails : {})
      };

      const result = await processPayment(paymentData);
      navigation.navigate('OrderHistory', { 
        success: true,
        orderId: result.order.id 
      });
    } catch (error) {
      console.error('Payment error:', error);
      Alert.alert('Payment Failed', error.message || 'Failed to process payment');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1D478B" />
        <Text>Loading order details...</Text>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.errorContainer}>
        <Icon name="exclamation-circle" size={50} color="#888" />
        <Text style={styles.errorText}>Order not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>Order Summary</Text>
      
      <View style={styles.orderSummary}>
        {order.items.map((item, index) => {
          const itemPrice = item.price_at_purchase || item.product?.price || 0;
          return (
            <View key={index} style={styles.orderItem}>
              <Text style={styles.itemName}>{item.product?.title || 'Unknown Product'}</Text>
              <Text style={styles.itemPrice}>
                {item.quantity} x ${formatPrice(itemPrice)}
              </Text>
              <Text style={styles.itemTotal}>
                ${formatPrice(item.quantity * itemPrice)}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.totalContainer}>
        <Text style={styles.totalLabel}>Total:</Text>
        <Text style={styles.totalAmount}>${formatPrice(order.total_amount)}</Text>
      </View>

      <Text style={styles.sectionTitle}>Shipping Information</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter your shipping address"
        value={shippingAddress}
        onChangeText={setShippingAddress}
        multiline
      />

      <Text style={styles.sectionTitle}>Payment Method</Text>
      <View style={styles.paymentMethods}>
        <TouchableOpacity 
          style={[
            styles.paymentMethod, 
            paymentMethod === 'mpesa' && styles.selectedPayment
          ]}
          onPress={() => setPaymentMethod('mpesa')}
        >
          <Icon 
            name="mobile" 
            size={24} 
            color={paymentMethod === 'mpesa' ? '#1D478B' : '#888'} 
          />
          <Text style={[
            styles.paymentMethodText,
            paymentMethod === 'mpesa' && styles.selectedPaymentText
          ]}>
            M-Pesa
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[
            styles.paymentMethod, 
            paymentMethod === 'card' && styles.selectedPayment
          ]}
          onPress={() => setPaymentMethod('card')}
        >
          <Icon 
            name="credit-card" 
            size={24} 
            color={paymentMethod === 'card' ? '#1D478B' : '#888'} 
          />
          <Text style={[
            styles.paymentMethodText,
            paymentMethod === 'card' && styles.selectedPaymentText
          ]}>
            Credit Card
          </Text>
        </TouchableOpacity>
      </View>

      {paymentMethod === 'card' && (
        <View style={styles.cardDetails}>
          <TextInput
            style={styles.input}
            placeholder="Card Number"
            value={cardDetails.number}
            onChangeText={(text) => setCardDetails({...cardDetails, number: text})}
            keyboardType="numeric"
          />
          <View style={styles.cardRow}>
            <TextInput
              style={[styles.input, styles.cardInput]}
              placeholder="MM/YY"
              value={cardDetails.expiry}
              onChangeText={(text) => setCardDetails({...cardDetails, expiry: text})}
            />
            <TextInput
              style={[styles.input, styles.cardInput]}
              placeholder="CVV"
              value={cardDetails.cvv}
              onChangeText={(text) => setCardDetails({...cardDetails, cvv: text})}
              keyboardType="numeric"
              secureTextEntry
            />
          </View>
        </View>
      )}

      <TouchableOpacity 
        style={styles.payButton}
        onPress={handlePayment}
      >
        <Text style={styles.payButtonText}>
          {paymentMethod === 'mpesa' ? 'Pay with M-Pesa' : 'Pay with Card'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorText: {
    fontSize: 18,
    color: '#888',
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 12,
    color: '#333',
  },
  orderSummary: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
  },
  orderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  itemName: {
    flex: 2,
    fontSize: 14,
    color: '#555',
  },
  itemPrice: {
    flex: 1,
    fontSize: 14,
    color: '#888',
    textAlign: 'right',
  },
  itemTotal: {
    flex: 1,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1D478B',
    textAlign: 'right',
  },
  totalContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#eee',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1D478B',
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  paymentMethods: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  paymentMethod: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginHorizontal: 4,
  },
  selectedPayment: {
    borderColor: '#1D478B',
    backgroundColor: '#f0f7ff',
  },
  paymentMethodText: {
    marginTop: 8,
    fontSize: 14,
    color: '#888',
  },
  selectedPaymentText: {
    color: '#1D478B',
    fontWeight: 'bold',
  },
  cardDetails: {
    marginTop: 8,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardInput: {
    flex: 1,
    marginRight: 8,
  },
  payButton: {
    backgroundColor: '#1D478B',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 32,
  },
  payButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default Checkout;