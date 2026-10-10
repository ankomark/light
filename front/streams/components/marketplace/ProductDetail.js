// One product. Opens at once on what the list already had (the `preview`
// passed with the tap, or the copy kept from last time) and fills in behind
// it. Add to cart and the wishlist heart answer at once (utils/cartStore.js);
// Buy now makes an order of just this, skipping the cart.
//
// The photos swipe (with the thumbnails to jump); below, more like it from
// the same category (or the same seller), which also swipe sideways.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  Linking,
  } from 'react-native';
import KeyboardLift from '../tickets/KeyboardLift';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import {
  fetchProductById,
  fetchProductReviews,
  addProductReview,
  buyNow,
  fetchOrders,
  fetchProducts,
} from '../../services/api';
import { useAuth } from '../../context/useAuth';
import ReportModal from '../ReportModal';
import { useI18n } from '../../context/I18nContext';
import { peekCache, writeCache } from '../../utils/screenCache';
import {
  useMarket, useMarketUser, addProductToCart, toggleWish, isWished, rememberViewed,
  refreshWishlist,
} from '../../utils/cartStore';
import { formatPrice, hasPaymentInfo, marketError, findJustPlacedOrder } from '../../utils/market';
import useMarketToast from './MarketToast';
import CartButton from './CartButton';
import ShareCardSheet from '../ShareCardSheet';
import ProductShareCard from './ProductShareCard';
import { EmojiTextInput } from '../EmojiKeyboard';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');

const normalize = (p) => (p ? {
  ...p,
  images: p.images || [],
  quantity: Number.isFinite(Number(p.quantity)) ? Number(p.quantity) : 0,
  price: typeof p.price === 'number' ? p.price : parseFloat(p.price) || 0,
} : null);

const listOf = (data) => (Array.isArray(data) ? data : (data?.results || []));
const CONDITIONS = ['NEW', 'USED', 'REFURBISHED'];

/** More like this: the same category, else the same seller; never itself. */
const MoreLikeThis = ({ product, onOpen, t }) => {
  const [items, setItems] = useState([]);
  const category = typeof product.category === 'string' ? product.category : product.category?.name;
  const sellerId = product.seller?.id;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pick = async (params) => listOf(await fetchProducts(1, { page_size: 11, ...params }))
          .filter((p) => p.id !== product.id);
        let found = category ? await pick({ category }) : [];
        if (!found.length && sellerId) found = await pick({ seller: sellerId });
        if (!cancelled) setItems(found.slice(0, 10));
      } catch {
        // Only an extra: the product stands without it.
      }
    })();
    return () => { cancelled = true; };
  }, [product.id, category, sellerId]);
  if (!items.length) return null;
  return (
    <View style={styles.moreSection} testID="more-like-this">
      <Text style={styles.sectionTitle}>{t('market.product.moreLikeThis')}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => String(item.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.moreList}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.moreCard} onPress={() => onOpen(item)} testID={`more-${item.id}`}
                            accessibilityRole="button"
                            accessibilityLabel={`${item.title}, ${formatPrice(item.price, item.currency)}`}>
            <Image source={item.images?.[0]?.image_url ? { uri: item.images[0].image_url } : PLACEHOLDER_IMAGE}
                   placeholder={PLACEHOLDER_IMAGE} contentFit="cover" transition={120}
                   recyclingKey={String(item.id)} style={styles.moreImage} />
            <Text style={styles.moreTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.morePrice}>{formatPrice(item.price, item.currency)}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

// The same screen can be handed another product (a notification, a link, or
// navigate() to the screen already open): it starts afresh for it, rather
// than showing the last one's photo, quantity, reviews and half-typed review.
const ProductDetail = () => {
  const slug = useRoute().params?.slug;
  return <ProductPage key={slug || ''} />;
};

const ProductPage = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { slug, preview } = route.params ?? {};
  const key = `market:product:${slug}`;
  const [product, setProduct] = useState(() => normalize(peekCache(key) || preview));
  // A preview (from a list) lacks the description and the seller's details.
  const [full, setFull] = useState(() => !!peekCache(key));
  const [failed, setFailed] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  const [reviews, setReviews] = useState([]);
  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState('');
  const [postingReview, setPostingReview] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportingReview, setReportingReview] = useState(null);   // a buyer's review being reported
  const [buying, setBuying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [galleryW, setGalleryW] = useState(0);
  const gallery = useRef(null);
  // The field being typed in stays above the keyboard (KeyboardLift).
  const kbScroll = useRef(null);
  const { currentUser } = useAuth();
  useMarketUser(currentUser?.id);
  const market = useMarket();
  const { t } = useI18n();
  const [toast, showToast] = useMarketToast();

  const loadProduct = useCallback(async () => {
    setFailed(false);
    try {
      const data = normalize(await fetchProductById(slug));
      setProduct(data);
      setFull(true);
      writeCache(key, data, { persist: false });
      rememberViewed(data);
    } catch (error) {
      setFailed(error.message === 'Product not found' ? 'gone' : 'error');
    }
  }, [slug, key]);

  useEffect(() => { loadProduct(); }, [loadProduct]);

  // The hearts everywhere read one wishlist: read it once if not yet here.
  // By id, not the user object: each read re-renders, and a new object for
  // the same person would read it again, and again.
  const userId = currentUser?.id;
  useEffect(() => {
    if (userId && !market.wishlist) refreshWishlist().catch(() => {});
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchProductReviews(slug);
        if (cancelled) return;
        const list = listOf(data);
        setReviews(list);
        const mine = list.find((r) => r.reviewer?.id != null && r.reviewer.id === currentUser?.id);
        if (mine) {
          setMyRating((r) => r || mine.rating || 0);
          setMyComment((c) => c || mine.comment || '');
        }
      } catch {
        // Non-fatal: the product itself still renders without its reviews.
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const askToLogIn = (why) => {
    Alert.alert(t('market.loginRequired'), why, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('market.login'), onPress: () => navigation.navigate('Login') },
    ]);
  };

  // What was picked, never more than is left (the stock may have been
  // re-read since, lower).
  const stock = product?.quantity ?? 0;
  const qty = Math.max(1, Math.min(quantity, stock || 1));

  const handleAddToCart = async () => {
    if (!currentUser) { askToLogIn(t('market.product.loginToCart')); return; }
    try {
      showToast(t('market.product.addedToCart'));
      await addProductToCart(product, qty);
    } catch (error) {
      // The server's words (e.g. "Only 3 in stock…") over a generic one.
      showToast(marketError(error, t('market.product.addToCartFailed')), { error: true });
    }
  };

  // One tap, one order: a second tap before the first re-renders does nothing.
  const buyingRef = useRef(false);
  const handleBuyNow = async () => {
    if (!currentUser) { askToLogIn(t('market.product.loginToCart')); return; }
    if (buyingRef.current) return;
    buyingRef.current = true;
    try {
      setBuying(true);
      const order = await buyNow(product.id, qty);
      navigation.navigate('Checkout', { orderId: order.id, order });
    } catch (error) {
      // No answer (the connection dropped on the way back): if the order was
      // made, go to it - a retry would make a second one.
      const placed = !error?.response ? await findJustPlacedOrder(fetchOrders, { hasProduct: product.id }) : null;
      if (placed) navigation.navigate('Checkout', { orderId: placed.id, order: placed });
      else showToast(marketError(error, t('market.cart.checkoutFailed')), { error: true });
    } finally {
      buyingRef.current = false;
      setBuying(false);
    }
  };

  const wishlisted = market.wishlist ? isWished(market, product?.id) : !!product?.is_wishlisted;
  const handleToggleWishlist = async () => {
    if (!currentUser) { askToLogIn(t('market.product.loginToWishlist')); return; }
    try {
      await toggleWish(product, !wishlisted);
    } catch (error) {
      showToast(marketError(error, t('market.product.wishlistFailed')), { error: true });
    }
  };

  const handleSubmitReview = async () => {
    if (!currentUser) { askToLogIn(t('market.product.loginToReview')); return; }
    if (!myRating) {
      showToast(t('market.product.ratingRequiredBody'), { error: true });
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
      setReviews(listOf(freshReviews));
      setProduct((prev) => {
        const next = normalize({ ...prev, ...freshProduct });
        writeCache(key, next, { persist: false });
        return next;
      });
      setMyComment('');
      showToast(t('market.product.reviewSaved'));
    } catch (error) {
      showToast(marketError(error, t('market.product.reviewFailed')), { error: true });
    } finally {
      setPostingReview(false);
    }
  };

  // A picture of it (photo, price, seller) through the share sheet, with
  // the words and a link for anyone who cannot open the picture.
  const shareMessage = product ? `${t('market.product.shareMessage', {
    title: product.title, price: formatPrice(product.price, product.currency),
  })}
streams://product/${encodeURIComponent(product.slug || '')}` : '';
  const handleShare = () => setSharing(true);

  const handleWhatsAppPress = () => {
    const num = (product.whatsapp_number || '').replace(/[^\d]/g, '');
    if (!num) { showToast(t('market.product.noWhatsapp'), { error: true }); return; }
    const text = encodeURIComponent(t('market.product.askAbout', { title: product.title }));
    Linking.openURL(`https://wa.me/${num}?text=${text}`).catch(() => {
      showToast(t('market.product.whatsappFailed'), { error: true });
    });
  };

  const handleCallPress = () => {
    if (!product.contact_number) { showToast(t('market.product.noPhone'), { error: true }); return; }
    Linking.openURL(`tel:${product.contact_number}`).catch(() => {
      showToast(t('market.product.callFailed'), { error: true });
    });
  };

  if (!product) {
    return (
      <View style={failed ? styles.errorContainer : styles.loadingContainer}>
        {failed ? (
          <>
            <Icon name="exclamation-circle" size={50} color="#888" />
            <Text style={styles.errorText}>
              {failed === 'gone' ? t('market.product.noLongerAvailable') : t('market.product.loadFailed')}
            </Text>
            {failed !== 'gone' && (
              <TouchableOpacity onPress={loadProduct}>
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.retryText}>{t('market.goBack')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color="#FFC46B" />
            <Text style={styles.loadingText}>{t('market.product.loading')}</Text>
          </>
        )}
      </View>
    );
  }

  const gone = failed === 'gone';
  const canBuy = !gone && product.quantity > 0 && product.is_available !== false;
  const images = product.images.length ? product.images : [{ id: 'none', image_url: null }];
  const photo = Math.min(selectedImage, images.length - 1);
  const showPhoto = (i) => {
    setSelectedImage(i);
    if (galleryW) gallery.current?.scrollToOffset?.({ offset: i * galleryW, animated: true });
  };
  // Pushed, so Back comes back here (navigate would swap this page out).
  const openOther = (p) => {
    const params = { slug: p.slug, preview: p };
    if (navigation.push) navigation.push('ProductDetail', params);
    else navigation.navigate('ProductDetail', params);
  };
  const hasContact = !!(product.whatsapp_number || product.contact_number || product.location);

  return (
    <View style={styles.flex}>
<KeyboardLift scrollRef={kbScroll}>
    <ScrollView ref={kbScroll} style={styles.container} contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
     <View style={styles.cartCorner}><CartButton /></View>
     <View style={styles.sheet}>
      <View style={styles.mainImageContainer} onLayout={(e) => setGalleryW(e.nativeEvent.layout.width)}
            testID="product-gallery">
        {galleryW > 0 && (
          <FlatList
            ref={gallery}
            horizontal
            pagingEnabled
            data={images}
            keyExtractor={(item, i) => String(item.id ?? i)}
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: galleryW, offset: galleryW * i, index: i })}
            onScroll={(e) => {
              const i = Math.round(e.nativeEvent.contentOffset.x / galleryW);
              if (i !== photo && i >= 0 && i < images.length) setSelectedImage(i);
            }}
            scrollEventThrottle={32}
            renderItem={({ item }) => (
              <Image
                source={item.image_url ? { uri: item.image_url } : PLACEHOLDER_IMAGE}
                placeholder={PLACEHOLDER_IMAGE}
                contentFit="contain"
                transition={150}
                style={{ width: galleryW, height: '100%' }}
              />
            )}
          />
        )}
        {images.length > 1 && (
          <View style={styles.photoCount}>
            <Text style={styles.photoCountText}>{`${photo + 1}/${images.length}`}</Text>
          </View>
        )}
      </View>

      {product.images.length > 1 && (
        <FlatList
          horizontal
          data={product.images}
          keyExtractor={(item, index) => String(item.id ?? index)}
          renderItem={({ item, index }) => (
            <TouchableOpacity onPress={() => showPhoto(index)} testID={`thumb-${index}`}>
              <Image
                source={item.image_url ? { uri: item.image_url } : PLACEHOLDER_IMAGE}
                placeholder={PLACEHOLDER_IMAGE}
                contentFit="cover"
                transition={120}
                style={[
                  styles.thumbnailImage,
                  index === photo && styles.selectedThumbnail
                ]}
              />
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.thumbnailList}
          showsHorizontalScrollIndicator={false}
        />
      )}

      <View style={styles.infoContainer}>
        {gone && (
          <View style={styles.goneBanner} testID="product-gone">
            <Icon name="exclamation-circle" size={14} color="#B00020" />
            <Text style={styles.goneText}>{t('market.product.noLongerAvailable')}</Text>
          </View>
        )}
        <Text style={styles.title}>{product.title || t('market.untitled')}</Text>

        <View style={styles.priceContainer}>
          <Text style={styles.price}>
            {formatPrice(product.price, product.currency)}
          </Text>
          {product.quantity > 0 ? (
            <Text style={styles.inStock}>{t('market.inStock', { n: product.quantity })}</Text>
          ) : (
            <Text style={styles.outOfStock}>{t('market.product.outOfStock')}</Text>
          )}
        </View>

        <View style={styles.sellerContainer}>
          <TouchableOpacity
            onPress={() => product.seller?.username && navigation.navigate('SellerShop', { username: product.seller.username })}
            style={styles.sellerLink}
            accessibilityRole="link"
            testID="product-seller"
          >
            <Text style={styles.sellerText}>
              {t('market.product.soldBy', { name: product.seller?.username || t('market.seller.label') })}
            </Text>
            {product.seller_verified && (
              <Icon name="check-circle" size={14} color="#2E8B57" accessibilityLabel={t('market.shop.verified')} />
            )}
            <Icon name="angle-right" size={14} color="#888" />
          </TouchableOpacity>
          {product.condition ? (
            <View style={styles.conditionBadge}>
              <Text style={styles.conditionText}>
                {CONDITIONS.includes(product.condition) ? t(`market.condition.${product.condition}`) : product.condition}
              </Text>
            </View>
          ) : null}
        </View>

        {/* The seller's own: promote it to more buyers. */}
        {currentUser?.id != null && product.seller?.id === currentUser.id && product.is_available !== false ? (
          <TouchableOpacity style={styles.promoteBtn} testID="product-promote"
            onPress={() => navigation.navigate('Promote', { kind: 'product', targetId: product.id, title: product.title })}>
            <Icon name="bullhorn" size={14} color="#fff" />
            <Text style={styles.promoteText}>{t('promote.promoteProduct')}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Contact Information Section */}
        {hasContact && (
        <View style={styles.contactInfoContainer}>
          <Text style={styles.sectionTitle}>{t('market.product.contactInfo')}</Text>

          {!!product.whatsapp_number && (
            <TouchableOpacity style={styles.contactButton} onPress={handleWhatsAppPress}>
              <Icon name="whatsapp" size={20} color="#25D366" />
              <Text style={styles.contactButtonText}>{t('market.product.whatsapp')}</Text>
            </TouchableOpacity>
          )}

          {!!product.contact_number && (
            <TouchableOpacity style={styles.contactButton} onPress={handleCallPress}>
              <Icon name="phone" size={20} color="#1D478B" />
              <Text style={styles.contactButtonText}>{t('market.product.call')}</Text>
            </TouchableOpacity>
          )}

          {!!product.location && (
            <View style={styles.locationContainer}>
              <Icon name="map-marker" size={20} color="#FF6347" />
              <Text style={styles.locationText}>{product.location}</Text>
            </View>
          )}
        </View>
        )}

        {/* Payment Details — buyer pays the seller directly */}
        {hasPaymentInfo(product) && (
          <View style={styles.paymentContainer}>
            <Text style={styles.sectionTitle}>{t('market.product.paymentDetails')}</Text>
            <Text style={styles.paymentNote}>{t('market.product.payNote')}</Text>

            {product.mpesa_number ? (
              <View style={styles.paymentRow}>
                <Icon name="mobile" size={20} color="#2E8B57" style={styles.paymentIcon} />
                <View style={styles.paymentTextWrap}>
                  <Text style={styles.paymentLabel}>{t('market.pay.mpesa')}</Text>
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

        {full ? (
          <Text style={styles.description}>{product.description || t('market.product.noDescription')}</Text>
        ) : failed === 'error' ? (
          <TouchableOpacity onPress={loadProduct} style={styles.descLoading} testID="product-retry">
            <Text style={styles.descFailed}>{t('market.product.loadFailed')}</Text>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        ) : <ActivityIndicator color="#1D478B" style={styles.descLoading} />}

        {!!product.track && (
          <View style={styles.trackInfo}>
            <Text style={styles.sectionTitle}>{t('market.product.relatedTrack')}</Text>
            <Text style={styles.trackTitle}>{product.track.title || t('market.untitled')}</Text>
            {!!product.track.artist?.username && (
              <Text style={styles.trackArtist}>{t('market.product.byArtist', { name: product.track.artist.username })}</Text>
            )}
          </View>
        )}
      </View>

      {canBuy && !product.is_owner && (
      <View style={styles.quantityContainer}>
        <Text style={styles.quantityLabel}>{t('market.product.quantity')}</Text>
        <View style={styles.quantityControls}>
          <TouchableOpacity
            style={styles.quantityButton}
            onPress={() => setQuantity(Math.max(1, qty - 1))}
            disabled={qty <= 1}
            accessibilityLabel="-"
            testID="product-less"
          >
            <Icon name="minus" size={16} color={qty <= 1 ? '#bbb' : '#333'} />
          </TouchableOpacity>
          <Text style={styles.quantityValue} testID="product-qty">{qty}</Text>
          <TouchableOpacity
            style={styles.quantityButton}
            onPress={() => setQuantity(Math.min(stock, qty + 1))}
            disabled={qty >= stock}
            accessibilityLabel="+"
            testID="product-more"
          >
            <Icon name="plus" size={16} color={qty >= stock ? '#bbb' : '#333'} />
          </TouchableOpacity>
        </View>
      </View>
      )}

      {!product.is_owner && (
        <TouchableOpacity
          style={[styles.buyNowButton, (!canBuy || buying) && styles.disabledButton]}
          onPress={handleBuyNow}
          disabled={!canBuy || buying}
          testID="product-buy-now"
        >
          {buying ? <ActivityIndicator color="#fff" /> : (
            <>
              <Icon name="bolt" size={18} color="#fff" />
              <Text style={styles.cartButtonText}>{t('market.product.buyNow')}</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {product.is_owner ? (
        <TouchableOpacity
          style={[styles.cartButton, styles.editButton]}
          onPress={() => navigation.navigate('EditProduct', { slug: product.slug })}
          testID="product-edit"
        >
          <Icon name="pencil" size={18} color="#fff" />
          <Text style={styles.cartButtonText}>{t('common.edit')}</Text>
        </TouchableOpacity>
      ) : (
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.cartButton, !canBuy && styles.disabledButton]}
          onPress={handleAddToCart}
          disabled={!canBuy}
          testID="product-add-to-cart"
        >
          <Icon name="shopping-cart" size={20} color="#fff" />
          <Text style={styles.cartButtonText}>{t('market.product.addToCart')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.wishlistButton}
          onPress={handleToggleWishlist}
          testID="product-wish"
        >
          <Icon name={wishlisted ? 'heart' : 'heart-o'} size={20} color="#1D478B" />
          <Text style={styles.wishlistButtonText}>{wishlisted ? t('market.product.wishlisted') : t('market.wishlist.title')}</Text>
        </TouchableOpacity>
      </View>
      )}

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
      <ReportModal
        visible={!!reportingReview}
        onClose={() => setReportingReview(null)}
        contentType="productreview"
        objectId={reportingReview?.id}
      />

      {/* Reviews */}
      <View style={styles.reviewsContainer}>
        <View style={styles.reviewsHeader}>
          <Text style={styles.sectionTitle}>{t('market.product.reviews')}</Text>
          {product.average_rating != null && (
            <View style={styles.aggregateRow}>
              <Icon name="star" size={15} color="#FFC107" />
              <Text style={styles.aggregateText}>
                {t('market.product.ratingSummary', { rating: product.average_rating, n: product.review_count })}
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
                  {review.reviewer?.username || t('market.product.someone')}
                </Text>
                {review.verified && (
                  <View style={styles.verifiedPill}>
                    <Icon name="check" size={9} color="#2E8B57" />
                    <Text style={styles.verifiedText}>{t('market.product.verifiedBuyer')}</Text>
                  </View>
                )}
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
                {/* Someone else's review can be reported. */}
                {currentUser && review.reviewer?.id !== currentUser.id ? (
                  <TouchableOpacity onPress={() => setReportingReview(review)} hitSlop={10} style={{ marginLeft: 8 }}
                    accessibilityRole="button" accessibilityLabel={t('report.action')}
                    testID={`product-review-report-${review.id}`}>
                    <Icon name="flag-o" size={12} color="#8E99A8" />
                  </TouchableOpacity>
                ) : null}
              </View>
              {review.comment ? (
                <Text style={styles.reviewComment}>{review.comment}</Text>
              ) : null}
            </View>
          ))
        )}

        {/* Own review, for people who bought it. Posting again updates it —
            one review per person. */}
        {!product.is_owner && product.can_review === false && currentUser && (
          <Text style={styles.noReviewsText}>{t('market.product.reviewAfterBuying')}</Text>
        )}
        {full && !product.is_owner && product.can_review !== false && (
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
            <EmojiTextInput
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
      {full && <MoreLikeThis product={product} onOpen={openOther} t={t} />}
     </View>
    </ScrollView>
    </KeyboardLift>
    <ShareCardSheet
      visible={sharing}
      onClose={() => setSharing(false)}
      title={t('market.product.share')}
      message={shareMessage}
      onToast={showToast}
      renderCard={(ref, w) => <ProductShareCard ref={ref} width={w} product={product} />}
    />
    {toast}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sellerLink: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  cartCorner: { alignItems: 'flex-end', marginBottom: 6 },
  descLoading: { marginVertical: 16, alignItems: 'center' },
  descFailed: { color: '#666', fontSize: 14, textAlign: 'center' },
  photoCount: {
    position: 'absolute', right: 10, bottom: 10, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)',
  },
  photoCountText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  goneBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, marginBottom: 10,
    borderRadius: 8, backgroundColor: 'rgba(176,0,32,0.08)',
  },
  goneText: { color: '#B00020', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  editButton: { marginLeft: 16, marginRight: 16, marginTop: 12, flex: 0 },
  moreSection: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  moreList: { gap: 10, paddingRight: 16 },
  moreCard: { width: 120, borderRadius: 10, overflow: 'hidden', backgroundColor: '#f4f6f9' },
  moreImage: { width: 120, height: 110, backgroundColor: '#eef1f5' },
  moreTitle: { fontSize: 12.5, color: '#222', paddingHorizontal: 7, paddingTop: 5 },
  morePrice: { fontSize: 13, color: '#1D478B', fontWeight: '800', paddingHorizontal: 7, paddingBottom: 7 },
  buyNowButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FF6B00', marginHorizontal: 16, marginTop: 8, paddingVertical: 14, borderRadius: 8,
  },
  verifiedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 8,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(46,139,87,0.12)',
  },
  verifiedText: { fontSize: 10, color: '#2E8B57', fontWeight: '700' },
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
  promoteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12,
    paddingVertical: 12, borderRadius: 24, backgroundColor: '#1DA1F2',
  },
  promoteText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});

export default ProductDetail;