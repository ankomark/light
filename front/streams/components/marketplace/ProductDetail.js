import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  Image, 
  TouchableOpacity, 
  FlatList,
  Alert,
  Share,
  ActivityIndicator
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchProductById, addToCart } from '../../services/api';
import { useAuth } from '../../context/useAuth';

const ProductDetail = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { slug } = route.params;
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  const { currentUser } = useAuth();

  useEffect(() => {
    const loadProduct = async () => {
      try {
        const data = await fetchProductById(slug);
        setProduct({
          ...data,
          // Ensure all numeric fields are properly formatted
          quantity: typeof data.quantity === 'number' ? data.quantity : 0,
          price: typeof data.price === 'number' ? data.price : parseFloat(data.price) || 0,
        });
      } catch (error) {
        console.error('Error loading product:', error);
        const message = error.message === 'Product not found' 
          ? 'This product is no longer available.'
          : 'Failed to load product details. Please try again.';
        Alert.alert('Error', message, [
          { text: 'Go Back', onPress: () => navigation.goBack() }
        ]);
      } finally {
        setLoading(false);
      }
    };
    loadProduct();
  }, [slug, navigation]);

  const handleAddToCart = async () => {
    if (!currentUser) {
      Alert.alert('Login Required', 'Please login to add items to your cart', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => navigation.navigate('Login') }
      ]);
      return;
    }

    try {
      await addToCart(product.id, quantity);
      Alert.alert('Success', 'Item added to your cart');
    } catch (error) {
      console.error('Error adding to cart:', error);
      Alert.alert('Error', error.message || 'Failed to add item to cart');
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out this product: ${product.title} - ${formatPrice(product.price, product.currency)}`,
        url: product.images[0]?.image_url || 'https://via.placeholder.com/120',
        title: product.title || 'Product'
      });
    } catch (error) {
      console.error('Error sharing:', error);
      Alert.alert('Error', 'Failed to share product');
    }
  };

  // Enhanced price formatting with fallbacks
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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1D478B" />
        <Text>Loading product details...</Text>
      </View>
    );
  }

  if (!product) {
    return (
      <View style={styles.errorContainer}>
        <Icon name="exclamation-circle" size={50} color="#888" />
        <Text style={styles.errorText}>Product not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.retryText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.mainImageContainer}>
        <Image 
          source={{ uri: product.images[selectedImage]?.image_url || 'https://via.placeholder.com/300' }} 
          style={styles.mainImage}
          resizeMode="contain"
        />
      </View>
      
      {product.images.length > 1 && (
        <FlatList
          horizontal
          data={product.images}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item, index }) => (
            <TouchableOpacity onPress={() => setSelectedImage(index)}>
              <Image 
                source={{ uri: item.image_url || 'https://via.placeholder.com/60' }} 
                style={[
                  styles.thumbnailImage,
                  index === selectedImage && styles.selectedThumbnail
                ]}
                resizeMode="cover"
              />
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.thumbnailList}
          showsHorizontalScrollIndicator={false}
        />
      )}

      <View style={styles.infoContainer}>
        <Text style={styles.title}>{product.title || 'Untitled Product'}</Text>
        
        <View style={styles.priceContainer}>
          <Text style={styles.price}>
            {formatPrice(product.price, product.currency)}
          </Text>
          {product.quantity > 0 ? (
            <Text style={styles.inStock}>In Stock ({product.quantity} available)</Text>
          ) : (
            <Text style={styles.outOfStock}>Out of Stock</Text>
          )}
        </View>

        <View style={styles.sellerContainer}>
          <Text style={styles.sellerText}>Sold by: {product.seller?.username || 'Unknown Seller'}</Text>
          <View style={styles.ratingContainer}>
            <Icon name="star" size={16} color="#FFD700" />
            <Text style={styles.ratingText}>4.5 (24 reviews)</Text>
          </View>
        </View>

        <Text style={styles.description}>{product.description || 'No description available'}</Text>

        {product.track && (
          <View style={styles.trackInfo}>
            <Text style={styles.sectionTitle}>Related Track</Text>
            <Text style={styles.trackTitle}>{product.track.title || 'Untitled Track'}</Text>
            <Text style={styles.trackArtist}>by {product.track.artist?.username || 'Unknown Artist'}</Text>
          </View>
        )}
      </View>

      <View style={styles.quantityContainer}>
        <Text style={styles.quantityLabel}>Quantity:</Text>
        <View style={styles.quantityControls}>
          <TouchableOpacity 
            style={styles.quantityButton}
            onPress={() => setQuantity(Math.max(1, quantity - 1))}
            disabled={quantity <= 1}
          >
            <Icon name="minus" size={16} color="#333" />
          </TouchableOpacity>
          <Text style={styles.quantityValue}>{quantity}</Text>
          <TouchableOpacity 
            style={styles.quantityButton}
            onPress={() => setQuantity(quantity + 1)}
            disabled={quantity >= product.quantity}
          >
            <Icon name="plus" size={16} color="#333" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.cartButton, product.quantity <= 0 && styles.disabledButton]}
          onPress={handleAddToCart}
          disabled={product.quantity <= 0}
        >
          <Icon name="shopping-cart" size={20} color="#fff" />
          <Text style={styles.cartButtonText}>Add to Cart</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.wishlistButton}
          onPress={() => Alert.alert('Success', 'Added to wishlist')}
        >
          <Icon name="heart" size={20} color="#1D478B" />
          <Text style={styles.wishlistButtonText}>Wishlist</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity 
        style={styles.shareButton}
        onPress={handleShare}
      >
        <Icon name="share-alt" size={20} color="#1D478B" />
        <Text style={styles.shareButtonText}>Share this product</Text>
      </TouchableOpacity>
    </ScrollView>
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
    textAlign: 'center',
  },
  retryText: {
    color: '#1D478B',
    marginTop: 8,
    fontWeight: '500',
  },
  mainImageContainer: {
    height: 300,
    backgroundColor: '#f9f9f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  thumbnailImage: {
    width: 60,
    height: 60,
    borderRadius: 4,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selectedThumbnail: {
    borderColor: '#1D478B',
  },
  infoContainer: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  price: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1D478B',
    marginRight: 16,
  },
  inStock: {
    fontSize: 16,
    color: '#2E8B57',
  },
  outOfStock: {
    fontSize: 16,
    color: '#FF6347',
  },
  sellerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sellerText: {
    fontSize: 16,
    color: '#555',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontSize: 14,
    color: '#888',
    marginLeft: 4,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: '#555',
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  trackInfo: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  trackTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  trackArtist: {
    fontSize: 14,
    color: '#888',
  },
  quantityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  quantityLabel: {
    fontSize: 16,
    color: '#555',
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quantityButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityValue: {
    fontSize: 18,
    fontWeight: 'bold',
    marginHorizontal: 16,
    color: '#333',
  },
  buttonContainer: {
    flexDirection: 'row',
    padding: 16,
  },
  cartButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#1D478B',
    borderRadius: 8,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  cartButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
  wishlistButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#1D478B',
    borderRadius: 8,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wishlistButtonText: {
    color: '#1D478B',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
  shareButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  shareButtonText: {
    color: '#1D478B',
    fontSize: 16,
    marginLeft: 8,
  },
});

export default ProductDetail;