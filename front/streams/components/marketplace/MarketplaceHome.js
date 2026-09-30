// The marketplace's front: search, the way to the cart, wishlist, orders and
// selling, the categories that have something in them, what is new, and what
// was looked at lately. Opens at once on the last copy (useCachedData).
import React, { useState } from 'react';
import { useI18n } from '../../context/I18nContext';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, TextInput, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useNavigation } from '@react-navigation/native';
import { fetchProducts, fetchProductCategories } from '../../services/api';
import useCachedData from '../../utils/useCachedData';
import { useAuth } from '../../context/useAuth';
import { useMarket, useMarketUser } from '../../utils/cartStore';
import { formatPrice } from '../../utils/market';
import CartButton from './CartButton';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');

const loadHome = async () => {
  const [categoriesData, productsData] = await Promise.all([
    fetchProductCategories(),
    // Featured strip shows 8 — fetch exactly 8 instead of the default 20.
    fetchProducts(1, { page_size: 8 }),
  ]);
  const categories = Array.isArray(categoriesData) ? categoriesData : (categoriesData?.results || []);
  return {
    // Only categories with something in them (older servers send no count).
    categories: categories.filter((c) => c.product_count == null || c.product_count > 0),
    featured: (productsData?.results || []).slice(0, 8),
  };
};

const ProductStrip = ({ products, onOpen }) => (
  <FlatList
    horizontal
    data={products}
    keyExtractor={(item) => String(item.id)}
    renderItem={({ item }) => (
      <TouchableOpacity style={styles.productCard} onPress={() => onOpen(item)} testID={`home-product-${item.id}`}>
        <Image
          source={item.images?.[0]?.image_url ? { uri: item.images[0].image_url } : PLACEHOLDER_IMAGE}
          placeholder={PLACEHOLDER_IMAGE}
          contentFit="cover"
          transition={150}
          style={styles.productImage}
        />
        <Text style={styles.productTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.productPrice}>{formatPrice(item.price, item.currency)}</Text>
      </TouchableOpacity>
    )}
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.productList}
  />
);

const MarketplaceHome = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  useMarketUser(currentUser?.id);
  const { recent } = useMarket();
  const [query, setQuery] = useState('');
  const { data, failed, reload } = useCachedData('market:home', loadHome);
  const categories = data?.categories || [];
  const featured = data?.featured || [];
  const open = (product) => navigation.navigate('ProductDetail', { slug: product.slug, preview: product });
  const search = () => {
    if (query.trim()) navigation.navigate('ProductList', { q: query.trim() });
  };

  const shortcuts = [
    { key: 'Wishlist', icon: 'heart-o', label: t('market.home.wishlist') },
    { key: 'OrderHistory', icon: 'archive', label: t('market.home.orders') },
    { key: 'SellerDashboard', icon: 'tag', label: t('market.home.sellShort') },
  ];

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.topRow}>
        <View style={styles.searchBox}>
          <Icon name="search" size={16} color="#888" />
          <TextInput
            style={styles.searchInput}
            placeholder={t('market.list.searchPlaceholder')}
            placeholderTextColor="#888"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={search}
            returnKeyType="search"
            testID="home-search"
          />
        </View>
        <CartButton />
      </View>

      <View style={styles.shortcuts}>
        {shortcuts.map((s) => (
          <TouchableOpacity key={s.key} style={styles.shortcut} onPress={() => navigation.navigate(s.key)}
                            accessibilityRole="button" testID={`home-${s.key}`}>
            <Icon name={s.icon} size={18} color="#FFC46B" />
            <Text style={styles.shortcutText}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!data && (
        <View style={styles.loadingContainer}>
          {failed ? (
            <TouchableOpacity onPress={reload}>
              <Text style={styles.loadingText}>{t('market.home.loadFailed')}</Text>
            </TouchableOpacity>
          ) : <ActivityIndicator color="#FFC46B" />}
        </View>
      )}

      {categories.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('market.home.shopByCategory')}</Text>
          <FlatList
            horizontal
            data={categories}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.categoryCard}
                onPress={() => navigation.navigate('ProductList', { categoryId: item.id, categoryName: item.name })}
                testID={`home-category-${item.id}`}
              >
                <View style={[styles.categoryIcon, { backgroundColor: '#f0f0f0' }]}>
                  <Text style={styles.categoryEmoji}>🛍️</Text>
                </View>
                <Text style={styles.categoryName} numberOfLines={2}>{item.name}</Text>
              </TouchableOpacity>
            )}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryList}
          />
        </View>
      )}

      {featured.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('market.home.featured')}</Text>
          <ProductStrip products={featured} onOpen={open} />
        </View>
      )}

      {recent.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('market.home.recent')}</Text>
          <ProductStrip products={recent} onOpen={open} />
        </View>
      )}

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('ProductList')}>
          <Text style={styles.primaryButtonText}>{t('market.home.browseAll')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    padding: 16,
  },
  loadingContainer: {
    paddingVertical: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 14, height: 44,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#333' },
  shortcuts: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  shortcut: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 12,
    backgroundColor: 'rgba(10,22,40,0.7)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,196,107,0.35)',
  },
  shortcutText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  loadingText: {
    color: '#cdd9e5',
    fontSize: 15,
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
    color: '#FFFFFF',
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
    color: 'rgba(255,255,255,0.85)',
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
    color: '#FFFFFF',
  },
  productPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFC46B',
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