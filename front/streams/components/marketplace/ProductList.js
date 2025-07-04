import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchProducts } from '../../services/api';

// =====================
// Helper Functions
// =====================
const formatPrice = (price, currency) => {
  const symbols = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    KES: 'Ksh',
    NGN: '₦',
  };
  
  // Handle null/undefined currency
  const currencyCode = currency || 'USD';
  const symbol = symbols[currencyCode] || currencyCode;
  
  // Ensure price is a number and format to 2 decimal places
  const numericPrice = typeof price === 'number' ? price : parseFloat(price) || 0;
  return `${symbol}${numericPrice.toFixed(2)}`;
};

// =====================
// Style Constants
// =====================
const COLORS = {
  primary: '#1D478B',
  white: '#FFFFFF',
  background: '#F8F9FA',
  text: '#333333',
  gray: '#888888',
  lightGray: '#F5F5F5',
  error: '#DC3545',
  star: '#FFD700',
  shadow: '#000000',
};

const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
};

const SIZES = {
  small: 12,
  medium: 16,
  large: 20,
  xLarge: 24,
};

const SPACING = {
  tiny: 4,
  small: 8,
  medium: 16,
  large: 24,
  xLarge: 32,
};

// =====================
// Main Component
// =====================
const ProductList = () => {
  const navigation = useNavigation();
  const route = useRoute();

  const [products, setProducts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = route.params?.categoryId ? { category: route.params.categoryId } : {};
      const data = await fetchProducts(params);
      setProducts(data);
    } catch (err) {
      console.error('ProductList loading error:', err);
      setError(err.message || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [route.params?.categoryId]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return products;

    return products.filter((product) =>
      product.title?.toLowerCase().includes(query) ||
      product.description?.toLowerCase().includes(query)
    );
  }, [searchQuery, products]);

  const handleSearchChange = (text) => setSearchQuery(text);
  const handleProductPress = (product) => navigation.navigate('ProductDetail', { 
    slug: product.slug  // Pass slug instead of id
  });

  // =====================
  // Render Conditions
  // =====================
  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Icon name="exclamation-circle" size={50} color={COLORS.error} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={loadProducts}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={20} color={COLORS.gray} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search products..."
          placeholderTextColor={COLORS.gray}
          value={searchQuery}
          onChangeText={handleSearchChange}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Product List */}
      {filteredProducts.length > 0 ? (
        <FlatList
          data={filteredProducts}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <ProductCard product={item} onPress={() => handleProductPress(item)} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <EmptyState query={searchQuery} onClear={() => handleSearchChange('')} />
      )}
    </View>
  );
};

// =====================
// Product Card Component
// =====================
const ProductCard = ({ product, onPress }) => (
  <TouchableOpacity style={styles.card} onPress={onPress}>
    <Image
      source={{ uri: product.images?.[0]?.image_url || 'https://via.placeholder.com/120' }}
      style={styles.cardImage}
      resizeMode="cover"
    />
    <View style={styles.cardContent}>
      <Text style={styles.cardTitle} numberOfLines={2}>{product.title || 'Untitled Product'}</Text>
      <Text style={styles.cardPrice}>
        {formatPrice(product.price, product.currency)}
      </Text>
      <Text style={styles.cardSeller}>Sold by {product.seller?.username || 'Unknown'}</Text>
      <View style={styles.ratingContainer}>
        <Icon name="star" size={16} color={COLORS.star} />
        <Text style={styles.ratingText}>4.5 (24)</Text>
      </View>
    </View>
  </TouchableOpacity>
);

// =====================
// Empty State Component
// =====================
const EmptyState = ({ query, onClear }) => (
  <View style={styles.centerContainer}>
    <Icon name="exclamation-circle" size={50} color={COLORS.gray} />
    <Text style={styles.emptyText}>
      {query.trim() ? 'No matching products found' : 'No products available'}
    </Text>
    {query.trim() && (
      <TouchableOpacity onPress={onClear}>
        <Text style={styles.actionText}>Clear search</Text>
      </TouchableOpacity>
    )}
  </View>
);

// =====================
// Styles
// =====================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: SPACING.medium,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.large,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    paddingHorizontal: SPACING.small,
    marginBottom: SPACING.medium,
  },
  searchIcon: {
    marginRight: SPACING.small,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontFamily: FONTS.regular,
    fontSize: SIZES.medium,
    color: COLORS.text,
  },
  listContent: {
    paddingBottom: SPACING.medium,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 8,
    marginBottom: SPACING.medium,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardImage: {
    width: 120,
    height: 120,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  cardContent: {
    flex: 1,
    padding: SPACING.small,
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontFamily: FONTS.medium,
    fontSize: SIZES.medium,
    color: COLORS.text,
    marginBottom: SPACING.tiny,
  },
  cardPrice: {
    fontFamily: FONTS.bold,
    fontSize: SIZES.large,
    color: COLORS.primary,
    marginBottom: SPACING.tiny,
  },
  cardSeller: {
    fontFamily: FONTS.regular,
    fontSize: SIZES.small,
    color: COLORS.gray,
    marginBottom: SPACING.tiny,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontFamily: FONTS.regular,
    fontSize: SIZES.small,
    color: COLORS.gray,
    marginLeft: SPACING.tiny,
  },
  errorText: {
    fontFamily: FONTS.medium,
    fontSize: SIZES.large,
    color: COLORS.error,
    marginTop: SPACING.medium,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: FONTS.medium,
    fontSize: SIZES.large,
    color: COLORS.gray,
    marginTop: SPACING.medium,
    textAlign: 'center',
  },
  retryText: {
    fontFamily: FONTS.medium,
    color: COLORS.primary,
    marginTop: SPACING.small,
  },
  actionText: {
    fontFamily: FONTS.medium,
    color: COLORS.primary,
    marginTop: SPACING.small,
  },
});

export default ProductList;