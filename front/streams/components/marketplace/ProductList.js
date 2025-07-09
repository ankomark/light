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
  Dimensions,
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
  
  const currencyCode = currency || 'USD';
  const symbol = symbols[currencyCode] || currencyCode;
  const numericPrice = typeof price === 'number' ? price : parseFloat(price) || 0;
  return `${symbol}${numericPrice.toFixed(2)}`;
};

// =====================
// Style Constants
// =====================
const COLORS = {
  primary: '#FF6B00', // Jumia orange
  white: '#FFFFFF',
  background: '#F5F5F5',
  text: '#333333',
  gray: '#888888',
  lightGray: '#E0E0E0',
  error: '#DC3545',
  star: '#FFD700',
  shadow: '#000000',
  discount: '#F44336',
  inStock: '#4CAF50',
  outOfStock: '#F44336',
};

const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
};

const SIZES = {
  small: 12,
  medium: 14,
  large: 16,
  xLarge: 18,
};

const SPACING = {
  tiny: 4,
  small: 8,
  medium: 12,
  large: 16,
  xLarge: 20,
};

// Calculate item width based on screen width
const { width } = Dimensions.get('window');
const ITEM_MARGIN = SPACING.small;
const ITEM_WIDTH = (width - (ITEM_MARGIN * 3)) / 2;

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
    slug: product.slug
  });

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
      {/* Search Bar */}
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

      {/* Product Grid */}
      {filteredProducts.length > 0 ? (
        <FlatList
          data={filteredProducts}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <ProductCard 
              product={item} 
              onPress={() => handleProductPress(item)}
              style={{ width: ITEM_WIDTH }}
            />
          )}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
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
const ProductCard = ({ product, onPress, style }) => {
  const hasDiscount = product.original_price && (product.original_price > product.price);
  const inStock = product.quantity > 0;
  
  return (
    <TouchableOpacity 
      style={[styles.card, style]} 
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Product Image */}
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: product.images?.[0]?.image_url || 'https://via.placeholder.com/150' }}
          style={styles.cardImage}
          resizeMode="contain"
        />
        {hasDiscount && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>
              {Math.round(((product.original_price - product.price) / product.original_price) * 100)}%
            </Text>
          </View>
        )}
      </View>

      {/* Product Details */}
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {product.title || 'Untitled Product'}
        </Text>
        
        {/* Price Section */}
        <View style={styles.priceContainer}>
          <Text style={styles.cardPrice}>
            {formatPrice(product.price, product.currency)}
          </Text>
          {hasDiscount && (
            <Text style={styles.originalPrice}>
              {formatPrice(product.original_price, product.currency)}
            </Text>
          )}
        </View>
        
        {/* Stock Status */}
        <View style={styles.stockContainer}>
          <Text style={[
            styles.stockText,
            inStock ? styles.inStockText : styles.outOfStockText
          ]}>
            {inStock ? `${product.quantity} in stock` : 'Out of stock'}
          </Text>
        </View>
        
        {/* Rating */}
        <View style={styles.ratingContainer}>
          <Icon name="star" size={14} color={COLORS.star} />
          <Text style={styles.ratingText}>4.5</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

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
    paddingHorizontal: ITEM_MARGIN,
    paddingTop: SPACING.small,
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
    backgroundColor: COLORS.white,
    borderRadius: 4,
    paddingHorizontal: SPACING.medium,
    marginBottom: SPACING.medium,
    height: 48,
    elevation: 2,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  searchIcon: {
    marginRight: SPACING.small,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontFamily: FONTS.regular,
    fontSize: SIZES.medium,
    color: COLORS.text,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: ITEM_MARGIN,
  },
  listContent: {
    paddingBottom: SPACING.large,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 6,
    marginBottom: ITEM_MARGIN,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  imageContainer: {
    width: '100%',
    height: ITEM_WIDTH, // Square image
    backgroundColor: COLORS.lightGray,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardImage: {
    width: '80%',
    height: '80%',
  },
  discountBadge: {
    position: 'absolute',
    top: SPACING.small,
    right: SPACING.small,
    backgroundColor: COLORS.discount,
    borderRadius: 10,
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.tiny,
  },
  discountText: {
    color: COLORS.white,
    fontSize: SIZES.small,
    fontFamily: FONTS.bold,
  },
  cardContent: {
    padding: SPACING.small,
  },
  cardTitle: {
    fontFamily: FONTS.regular,
    fontSize: SIZES.medium,
    color: COLORS.text,
    marginBottom: SPACING.tiny,
    height: 40, // Fixed height for consistent two-line display
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.tiny,
  },
  cardPrice: {
    fontFamily: FONTS.bold,
    fontSize: SIZES.large,
    color: COLORS.primary,
    marginRight: SPACING.small,
  },
  originalPrice: {
    fontFamily: FONTS.regular,
    fontSize: SIZES.small,
    color: COLORS.gray,
    textDecorationLine: 'line-through',
  },
  stockContainer: {
    marginBottom: SPACING.tiny,
  },
  stockText: {
    fontFamily: FONTS.regular,
    fontSize: SIZES.small,
  },
  inStockText: {
    color: COLORS.inStock,
  },
  outOfStockText: {
    color: COLORS.outOfStock,
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