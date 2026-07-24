import React, { useState, useEffect } from 'react';
import { 
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Alert,
  Share,
  ActivityIndicator,
  Linking,
  TextInput
} from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import {
  fetchProductById,
  addToCart,
  addToWishlist,
  removeFromWishlist,
  fetchProductReviews,
  addProductReview,
} from '../../services/api';
import { useAuth } from '../../context/useAuth';
import ReportModal from '../ReportModal';
import { useI18n } from '../../context/I18nContext';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');

const ProductDetail = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { slug } = route.params;
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  const [wishlisted, setWishlisted] = useState(false);
  const [wishlistBusy, setWishlistBusy] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState('');
  const [postingReview, setPostingReview] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const { currentUser } = useAuth();
  const { t } = useI18n();

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
        // Server state, not a local guess — the heart must survive a reopen.
        setWishlisted(!!data.is_wishlisted);
      } catch (error) {
        console.error('Error loading product:', error);
        const message = error.message === 'Product not found' 
          ? t('market.product.noLongerAvailable')
          : t('market.product.loadFailed');
        Alert.alert(t('common.error'), message, [
          { text: 'Go Back', onPress: () => navigation.goBack() }
        ]);
      } finally {
        setLoading(false);
      }
    };
    loadProduct();
  }, [slug, navigation, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchProductReviews(slug);
        if (cancelled) return;
        setReviews(Array.isArray(data) ? data : (data?.results || []));
      } catch (error) {
        // Non-fatal: the product itself still renders without its reviews.
        console.error('Error loading reviews:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const handleAddToCart = async () => {
    if (!currentUser) {
      Alert.alert(t('market.loginRequired'), t('market.product.loginToCart'), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => navigation.navigate('Login') }
      ]);
      return;
    }

    try {
      await addToCart(product.id, quantity);
      Alert.alert(t('market.success'), t('market.product.addedToCart'));
    } catch (error) {
      console.error('Error adding to cart:', error);
      Alert.alert(t('common.error'), error.message || t('market.product.addToCartFailed'));
    }
  };

  const handleToggleWishlist = async () => {
    if (!currentUser) {
      Alert.alert(t('market.loginRequired'), t('market.product.loginToWishlist'), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => navigation.navigate('Login') }
      ]);
      return;
    }
    const next = !wishlisted;
    try {
      setWishlistBusy(true);
      setWishlisted(next);  // optimistic
      if (next) {
        await addToWishlist(product.id);
      } else {
        await removeFromWishlist(product.id);
      }
    } catch (error) {
      console.error('Error updating wishlist:', error);
      setWishlisted(!next);  // revert
      Alert.alert(t('common.error'), error.message || t('market.product.wishlistFailed'));
    } finally {
      setWishlistBusy(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!currentUser) {
      Alert.alert(t('market.loginRequired'), t('market.product.loginToReview'), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => navigation.navigate('Login') }
      ]);
      return;
    }
    if (!myRating) {
      Alert.alert(t('market.product.ratingRequiredTitle'), t('market.product.ratingRequiredBody'));
      return;
    }
    try {
      setPostingReview(true);
      await addProductReview(slug, myRating, myComment.trim());
      // Re-read both: the review list and the product's rating aggregate.
      const [freshReviews, freshProduct] = await Promise.all([
        fetchProductReviews(slug),
        fetchProductById(slug),
      ]);
      setReviews(Array.isArray(freshReviews) ? freshReviews : (freshReviews?.results || []));
      setProduct((prev) => ({ ...prev, ...freshProduct }));
      setMyComment('');
      Alert.alert(t('market.product.reviewThanks'), t('market.product.reviewSaved'));
    } catch (error) {
      console.error('Error posting review:', error);
      Alert.alert(t('common.error'), error.response?.data?.detail || t('market.product.reviewFailed'));
    } finally {
      setPostingReview(false);
    }
  };

  const hasPaymentInfo = (p) =>
    !!(p?.mpesa_number || p?.till_number || p?.bank_details || p?.payment_instructions);

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out this product: ${product.title} - ${formatPrice(product.price, product.currency)}`,
        url: product.images[0]?.image_url || 'https://via.placeholder.com/120',
        title: product.title || 'Product'
      });
    } catch (error) {
      console.error('Error sharing:', error);
      Alert.alert(t('common.error'), t('market.product.shareFailed'));
    }
  };

  const handleWhatsAppPress = () => {
    if (!product.whatsapp_number) {
      Alert.alert(t('common.error'), t('market.product.noWhatsapp'));
      return;
    }
    const url = `https://wa.me/${product.whatsapp_number}`;
    Linking.openURL(url).catch(() => {
      Alert.alert(t('common.error'), t('market.product.whatsappFailed'));
    });
  };

  const handleCallPress = () => {
    if (!product.contact_number) {
      Alert.alert(t('common.error'), t('market.product.noPhone'));
      return;
    }
    const url = `tel:${product.contact_number}`;
    Linking.openURL(url).catch(() => {
      Alert.alert(t('common.error'), t('market.product.callFailed'));
    });
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
        <ActivityIndicator size="large" color="#FFC46B" />
        <Text style={styles.loadingText}>{t('market.product.loading')}</Text>
      </View>
    );
  }

  if (!product) {
    return (
      <View style={styles.errorContainer}>
        <Icon name="exclamation-circle" size={50} color="#888" />
        <Text style={styles.errorText}>{t('market.product.notFound')}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.retryText}>{t('market.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
     <View style={styles.sheet}>
      <View style={styles.mainImageContainer}>
        <Image
          source={product.images?.[selectedImage]?.image_url ? { uri: product.images[selectedImage].image_url } : PLACEHOLDER_IMAGE}
          placeholder={PLACEHOLDER_IMAGE}
          contentFit="contain"
          transition={150}
          style={styles.mainImage}
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
                source={item.image_url ? { uri: item.image_url } : PLACEHOLDER_IMAGE}
                placeholder={PLACEHOLDER_IMAGE}
                contentFit="cover"
                transition={120}
                style={[
                  styles.thumbnailImage,
                  index === selectedImage && styles.selectedThumbnail
                ]}
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
            <Text style={styles.outOfStock}>{t('market.product.outOfStock')}</Text>
          )}
        </View>

        <View style={styles.sellerContainer}>
          <Text style={styles.sellerText}>Sold by: {product.seller?.username || 'Unknown Seller'}</Text>
          {product.condition ? (
            <View style={styles.conditionBadge}>
              <Text style={styles.conditionText}>{product.condition}</Text>
            </View>
          ) : null}
        </View>

        {/* Contact Information Section */}
        <View style={styles.contactInfoContainer}>
          <Text style={styles.sectionTitle}>{t('market.product.contactInfo')}</Text>
          
          {product.whatsapp_number && (
            <TouchableOpacity style={styles.contactButton} onPress={handleWhatsAppPress}>
              <Icon name="whatsapp" size={20} color="#25D366" />
              <Text style={styles.contactButtonText}>{t('market.product.whatsapp')}</Text>
            </TouchableOpacity>
          )}
          
          {product.contact_number && (
            <TouchableOpacity style={styles.contactButton} onPress={handleCallPress}>
              <Icon name="phone" size={20} color="#1D478B" />
              <Text style={styles.contactButtonText}>{t('market.product.call')}</Text>
            </TouchableOpacity>
          )}
          
          {product.location && (
            <View style={styles.locationContainer}>
              <Icon name="map-marker" size={20} color="#FF6347" />
              <Text style={styles.locationText}>{product.location}</Text>
            </View>
          )}
        </View>

        {/* Payment Details — buyer pays the seller directly */}
        {hasPaymentInfo(product) && (
          <View style={styles.paymentContainer}>
            <Text style={styles.sectionTitle}>{t('market.product.paymentDetails')}</Text>
            <Text style={styles.paymentNote}>
              Pay the seller directly using the details below, then arrange delivery with them.
              Long-press a value to copy it.
            </Text>

            {product.mpesa_number ? (
              <View style={styles.paymentRow}>
                <Icon name="mobile" size={20} color="#2E8B57" style={styles.paymentIcon} />
                <View style={styles.paymentTextWrap}>
                  <Text style={styles.paymentLabel}>M-Pesa</Text>
                  <Text style={styles.paymentValue} selectable>{product.mpesa_number}</Text>
                </View>
              </View>
            ) : null}

            {product.till_number ? (
              <View style={styles.paymentRow}>
                <Icon name="credit-card" size={18} color="#2E8B57" style={styles.paymentIcon} />
                <View style={styles.paymentTextWrap}>
                  <Text style={styles.paymentLabel}>{t('market.product.till')}</Text>
                  <Text style={styles.paymentValue} selectable>{product.till_number}</Text>
                </View>
              </View>
            ) : null}

            {product.bank_details ? (
              <View style={styles.paymentRow}>
                <Icon name="bank" size={18} color="#2E8B57" style={styles.paymentIcon} />
                <View style={styles.paymentTextWrap}>
                  <Text style={styles.paymentLabel}>{t('market.product.bank')}</Text>
                  <Text style={styles.paymentValue} selectable>{product.bank_details}</Text>
                </View>
              </View>
            ) : null}

            {product.payment_instructions ? (
              <View style={styles.paymentRow}>
                <Icon name="info-circle" size={18} color="#2E8B57" style={styles.paymentIcon} />
                <View style={styles.paymentTextWrap}>
                  <Text style={styles.paymentLabel}>{t('market.product.instructions')}</Text>
                  <Text style={styles.paymentValue} selectable>{product.payment_instructions}</Text>
                </View>
              </View>
            ) : null}
          </View>
        )}

        <Text style={styles.description}>{product.description || t('market.product.noDescription')}</Text>

        {product.track && (
          <View style={styles.trackInfo}>
            <Text style={styles.sectionTitle}>{t('market.product.relatedTrack')}</Text>
            <Text style={styles.trackTitle}>{product.track.title || 'Untitled Track'}</Text>
            <Text style={styles.trackArtist}>by {product.track.artist?.username || 'Unknown Artist'}</Text>
          </View>
        )}
      </View>

      <View style={styles.quantityContainer}>
        <Text style={styles.quantityLabel}>{t('market.product.quantity')}</Text>
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
          <Text style={styles.cartButtonText}>{t('market.product.addToCart')}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.wishlistButton}
          onPress={handleToggleWishlist}
          disabled={wishlistBusy}
        >
          <Icon name={wishlisted ? 'heart' : 'heart-o'} size={20} color="#1D478B" />
          <Text style={styles.wishlistButtonText}>{wishlisted ? t('market.product.wishlisted') : t('market.wishlist.title')}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.shareButton}
        onPress={handleShare}
      >
        <Icon name="share-alt" size={20} color="#1D478B" />
        <Text style={styles.shareButtonText}>{t('market.product.share')}</Text>
      </TouchableOpacity>

      {!product.is_owner && (
        <TouchableOpacity
          style={styles.shareButton}
          onPress={() => setReportVisible(true)}
        >
          <Icon name="flag-o" size={18} color="#B00020" />
          <Text style={[styles.shareButtonText, { color: '#B00020' }]}>{t('market.product.report')}</Text>
        </TouchableOpacity>
      )}

      <ReportModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        contentType="product"
        objectId={product.id}
      />

      {/* Reviews */}
      <View style={styles.reviewsContainer}>
        <View style={styles.reviewsHeader}>
          <Text style={styles.sectionTitle}>{t('market.product.reviews')}</Text>
          {product.average_rating != null && (
            <View style={styles.aggregateRow}>
              <Icon name="star" size={15} color="#FFC107" />
              <Text style={styles.aggregateText}>
                {product.average_rating} · {product.review_count} review
                {product.review_count === 1 ? '' : 's'}
              </Text>
            </View>
          )}
        </View>

        {reviews.length === 0 ? (
          <Text style={styles.noReviewsText}>{t('market.product.noReviews')}</Text>
        ) : (
          reviews.map((review) => (
            <View key={review.id} style={styles.reviewRow}>
              <View style={styles.reviewHeader}>
                <Text style={styles.reviewAuthor}>
                  {review.reviewer?.username || 'Someone'}
                </Text>
                <View style={styles.reviewStars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Icon
                      key={n}
                      name={n <= review.rating ? 'star' : 'star-o'}
                      size={12}
                      color="#FFC107"
                    />
                  ))}
                </View>
              </View>
              {review.comment ? (
                <Text style={styles.reviewComment}>{review.comment}</Text>
              ) : null}
            </View>
          ))
        )}

        {/* Own review. Posting again updates it — one review per person. */}
        {!product.is_owner && (
          <View style={styles.reviewForm}>
            <Text style={styles.reviewFormLabel}>{t('market.product.rateThis')}</Text>
            <View style={styles.starPicker}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => setMyRating(n)} hitSlop={6}>
                  <Icon
                    name={n <= myRating ? 'star' : 'star-o'}
                    size={26}
                    color="#FFC107"
                    style={styles.starPickerIcon}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.reviewInput}
              placeholder={t('market.product.commentPlaceholder')}
              placeholderTextColor="#888"
              value={myComment}
              onChangeText={setMyComment}
              multiline
            />
            <TouchableOpacity
              style={[styles.reviewSubmit, postingReview && styles.reviewSubmitDisabled]}
              onPress={handleSubmitReview}
              disabled={postingReview}
            >
              {postingReview
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.reviewSubmitText}>{t('market.product.submitReview')}</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>
     </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    padding: 12,
  },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    paddingBottom: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#cdd9e5',
    fontSize: 15,
    marginTop: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorText: {
    fontSize: 18,
    color: '#cdd9e5',
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
  conditionBadge: {
    backgroundColor: '#e7f3ff',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  conditionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D478B',
    letterSpacing: 0.5,
  },
  paymentContainer: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderColor: '#eee',
    paddingBottom: 12,
  },
  paymentNote: {
    fontSize: 13,
    color: '#777',
    marginBottom: 12,
    lineHeight: 18,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f5fbf7',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  paymentIcon: {
    marginRight: 12,
    marginTop: 2,
    width: 22,
    textAlign: 'center',
  },
  paymentTextWrap: {
    flex: 1,
  },
  paymentLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 2,
  },
  paymentValue: {
    fontSize: 16,
    color: '#222',
    fontWeight: '600',
  },
  // New styles for contact information
  contactInfoContainer: {
    marginBottom: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
    paddingVertical: 12,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginTop: 8,
  },
  contactButtonText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#333',
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  locationText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#555',
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
  reviewsContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderColor: '#eee',
  },
  reviewsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aggregateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  aggregateText: {
    fontSize: 14,
    color: '#555',
    marginLeft: 6,
  },
  noReviewsText: {
    fontSize: 14,
    color: '#888',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  reviewRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0',
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewAuthor: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  reviewStars: {
    flexDirection: 'row',
    gap: 2,
  },
  reviewComment: {
    fontSize: 14,
    color: '#555',
    marginTop: 4,
    lineHeight: 20,
  },
  reviewForm: {
    marginTop: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
  },
  reviewFormLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  starPicker: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  starPickerIcon: {
    marginRight: 8,
  },
  reviewInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    padding: 12,
    fontSize: 15,
    color: '#111', // explicit dark text so it's never white-on-light in dark mode
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  reviewSubmit: {
    backgroundColor: '#1D478B',
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewSubmitDisabled: {
    backgroundColor: '#a0c4ff',
  },
  reviewSubmitText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
});

export default ProductDetail;