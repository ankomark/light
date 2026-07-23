import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchWishlist, removeFromWishlist } from '../../services/api';
import { useAuth } from '../../context/useAuth';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', KES: 'Ksh', NGN: '₦' };

const formatPrice = (price, currency = 'USD') => {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  return `${symbol}${(parseFloat(price) || 0).toFixed(2)}`;
};

const Wishlist = () => {
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadWishlist = useCallback(async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    try {
      const data = await fetchWishlist();
      setProducts(data?.products || []);
    } catch (error) {
      console.error('Error loading wishlist:', error);
      Alert.alert('Error', 'Failed to load your wishlist');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUser]);

  // Re-read on focus: the heart can be toggled over on the product screen.
  useFocusEffect(
    useCallback(() => {
      loadWishlist();
    }, [loadWishlist])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadWishlist();
  };

  const handleRemove = async (productId) => {
    const previous = products;
    setProducts((prev) => prev.filter((p) => p.id !== productId));  // optimistic
    try {
      await removeFromWishlist(productId);
    } catch (error) {
      console.error('Error removing from wishlist:', error);
      setProducts(previous);  // revert
      Alert.alert('Error', 'Could not remove that item. Please try again.');
    }
  };

  if (!currentUser) {
    return (
      <View style={styles.centered}>
        <Icon name="heart-o" size={50} color="#888" />
        <Text style={styles.emptyText}>Please login to use your wishlist</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.primaryButtonText}>Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#FFC46B" />
      </View>
    );
  }

  if (products.length === 0) {
    return (
      <View style={styles.centered}>
        <Icon name="heart-o" size={50} color="#888" />
        <Text style={styles.emptyText}>Your wishlist is empty</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('ProductList')}>
          <Text style={styles.primaryButtonText}>Browse Products</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={products}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#1D478B" />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('ProductDetail', { slug: item.slug })}
            activeOpacity={0.85}
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
                {item.title || 'Untitled Product'}
              </Text>
              <Text style={styles.price}>{formatPrice(item.price, item.currency)}</Text>
              <Text style={[styles.stock, item.quantity <= 0 && styles.outOfStock]}>
                {item.quantity > 0 ? `${item.quantity} in stock` : 'Out of stock'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => handleRemove(item.id)}
              hitSlop={8}
            >
              <Icon name="heart" size={20} color="#FF6347" />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
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
