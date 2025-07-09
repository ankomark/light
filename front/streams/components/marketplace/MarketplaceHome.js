import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { fetchProducts, fetchProductCategories } from '../../services/api';

// Price formatting helper function
const formatPrice = (price, currency) => {
  const symbols = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    KES: 'Ksh',
    NGN: '₦',
  };
  
  // Handle missing/undefined currency
  const currencyCode = currency || 'USD';
  const symbol = symbols[currencyCode] || currencyCode;
  
  // Ensure price is a number
  const numericPrice = typeof price === 'number' ? price : parseFloat(price) || 0;
  
  return `${symbol}${numericPrice.toFixed(2)}`;
};

const MarketplaceHome = () => {
  const navigation = useNavigation();
  const [categories, setCategories] = useState([]);
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [categoriesData, productsData] = await Promise.all([
          fetchProductCategories(),
          fetchProducts({ featured: true, limit: 8 })
        ]);
        setCategories(categoriesData);
        setFeaturedProducts(productsData);
      } catch (error) {
        console.error('Error loading marketplace data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading marketplace...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Hero Banner */}
      <View style={styles.heroContainer}>
        <Text style={styles.heroText}>Open Air Market</Text>
        <Text style={styles.heroSubtext}> Sell and Buy Products </Text>
      </View>

      {/* Categories */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Shop by Category</Text>
        <FlatList
          horizontal
          data={categories}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity 
              style={styles.categoryCard}
              onPress={() => navigation.navigate('ProductList', { categoryId: item.id })}
            >
              <View style={[styles.categoryIcon, { backgroundColor: '#f0f0f0' }]}>
                <Text style={styles.categoryEmoji}>🛍️</Text>
              </View>
              <Text style={styles.categoryName}>{item.name}</Text>
            </TouchableOpacity>
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryList}
        />
      </View>

      {/* Featured Products */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Featured Products</Text>
        <FlatList
          horizontal
          data={featuredProducts}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity 
              style={styles.productCard}
              onPress={() => navigation.navigate('ProductDetail', { slug: item.slug })}
            >
              <Image 
                source={{ uri: item.images[0]?.image_url }} 
                style={styles.productImage}
                resizeMode="cover"
              />
              <Text style={styles.productTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.productPrice}>
                {formatPrice(item.price, item.currency)}
              </Text>
            </TouchableOpacity>
          )}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.productList}
        />
      </View>

      {/* CTA Buttons */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={styles.primaryButton}
          onPress={() => navigation.navigate('ProductList')}
        >
          <Text style={styles.primaryButtonText}>Browse All Products</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('SellerDashboard')}
        >
          <Text style={styles.secondaryButtonText}>Sell Your Products</Text>
        </TouchableOpacity>
      </View>
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
  heroContainer: {
    backgroundColor: '#1D478B',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  heroText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  heroSubtext: {
    fontSize: 16,
    color: '#fff',
    opacity: 0.9,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  categoryList: {
    paddingRight: 16,
  },
  categoryCard: {
    width: 100,
    marginRight: 12,
    alignItems: 'center',
  },
  categoryIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryEmoji: {
    fontSize: 24,
  },
  categoryName: {
    fontSize: 14,
    textAlign: 'center',
    color: '#555',
  },
  productList: {
    paddingRight: 16,
  },
  productCard: {
    width: 150,
    marginRight: 12,
  },
  productImage: {
    width: 150,
    height: 150,
    borderRadius: 8,
    marginBottom: 8,
  },
  productTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
    color: '#333',
  },
  productPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1D478B',
  },
  buttonContainer: {
    marginTop: 16,
    marginBottom: 32,
  },
  primaryButton: {
    backgroundColor: '#1D478B',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#1D478B',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#1D478B',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default MarketplaceHome;