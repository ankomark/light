// A seller's shop front: who they are, a tick when staff have verified them,
// how long they have sold here, how many sales and how their things are rated,
// and what they have on offer. Shareable (streams://shop/<username>), and a
// seller can be reported from here.
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Share,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/FontAwesome';
import { useNavigation, useRoute } from '@react-navigation/native';
import { fetchShop, fetchProducts } from '../../services/api';
import { useI18n } from '../../context/I18nContext';
import { useAuth } from '../../context/useAuth';
import useCachedData from '../../utils/useCachedData';
import useGridColumns from '../../utils/useGridColumns';
import { formatPrice } from '../../utils/market';
import ReportModal from '../ReportModal';

const PLACEHOLDER_IMAGE = require('../../assets/default-image.png');

export const shopLink = (username) => `streams://shop/${encodeURIComponent(username || '')}`;

const loadShop = async (username) => {
  const shop = await fetchShop(username);
  const products = await fetchProducts(1, { seller: shop.seller.id, page_size: 40 });
  return { shop, products: products?.results || [] };
};

export default function SellerShop() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { username } = useRoute().params ?? {};
  const { currentUser } = useAuth();
  const [reporting, setReporting] = useState(false);
  const { cols, tileSize } = useGridColumns({ target: 170, min: 2, max: 5, horizontalPadding: 24, gap: 10 });
  const { data, failed, reload } = useCachedData(username ? `market:shop:${username}` : null, () => loadShop(username));
  const shop = data?.shop;
  const mine = currentUser?.username && currentUser.username === username;

  const share = () => {
    Share.share({ message: t('market.shop.shareMessage', { name: username, link: shopLink(username) }) })
      .catch(() => {});
  };

  if (!shop) {
    return (
      <View style={styles.centered}>
        {failed ? (
          <TouchableOpacity onPress={reload}>
            <Text style={styles.muted}>{t('market.shop.loadFailed')}</Text>
          </TouchableOpacity>
        ) : <ActivityIndicator color="#FFC46B" size="large" />}
      </View>
    );
  }

  const since = shop.selling_since ? new Date(shop.selling_since) : null;
  const header = (
    <View style={styles.header} testID="shop-header">
      <View style={styles.headRow}>
        <Image
          source={shop.seller?.profile_picture ? { uri: shop.seller.profile_picture } : PLACEHOLDER_IMAGE}
          placeholder={PLACEHOLDER_IMAGE}
          style={styles.avatar}
          contentFit="cover"
        />
        <View style={styles.headText}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{shop.seller?.username}</Text>
            {shop.is_verified && (
              <View style={styles.verified} testID="shop-verified">
                <Icon name="check-circle" size={14} color="#2E8B57" />
                <Text style={styles.verifiedText}>{t('market.shop.verified')}</Text>
              </View>
            )}
          </View>
          {!!shop.location && <Text style={styles.muted}>{shop.location}</Text>}
          {!!since && !isNaN(since.getTime()) && (
            <Text style={styles.muted}>
              {t('market.shop.since', { date: since.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) })}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{shop.products_on_offer}</Text>
          <Text style={styles.statLabel}>{t('market.shop.onOffer')}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{shop.sales}</Text>
          <Text style={styles.statLabel}>{t('market.shop.sales')}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{shop.rating != null ? `★ ${shop.rating}` : '—'}</Text>
          <Text style={styles.statLabel}>{t('market.shop.reviews', { n: shop.review_count })}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.action} onPress={share} testID="shop-share">
          <Icon name="share-alt" size={14} color="#1D478B" />
          <Text style={styles.actionText}>{t('market.shop.share')}</Text>
        </TouchableOpacity>
        {!mine && (
          <TouchableOpacity style={styles.action} onPress={() => setReporting(true)} testID="shop-report">
            <Icon name="flag-o" size={14} color="#B00020" />
            <Text style={[styles.actionText, { color: '#B00020' }]}>{t('market.shop.report')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={data.products}
        key={`shop-${cols}`}
        numColumns={cols}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={header}
        columnWrapperStyle={cols > 1 ? styles.columns : undefined}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>{t('market.shop.nothing')}</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, { width: tileSize }]}
            onPress={() => navigation.navigate('ProductDetail', { slug: item.slug, preview: item })}
            testID={`shop-product-${item.id}`}
          >
            <Image
              source={item.images?.[0]?.image_url ? { uri: item.images[0].image_url } : PLACEHOLDER_IMAGE}
              placeholder={PLACEHOLDER_IMAGE}
              style={[styles.cardImage, { height: tileSize }]}
              contentFit="cover"
            />
            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.cardPrice}>{formatPrice(item.price, item.currency)}</Text>
          </TouchableOpacity>
        )}
      />
      {!!shop.seller?.id && (
        <ReportModal visible={reporting} onClose={() => setReporting(false)} contentType="user" objectId={shop.seller.id} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12 },
  header: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#eee' },
  headText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 20, fontWeight: '700', color: '#1D478B', flexShrink: 1 },
  verified: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: 'rgba(46,139,87,0.12)',
  },
  verifiedText: { color: '#2E8B57', fontSize: 11, fontWeight: '700' },
  muted: { color: '#777', fontSize: 13, marginTop: 2 },
  stats: { flexDirection: 'row', marginTop: 14, borderTopWidth: 1, borderColor: '#eee', paddingTop: 12 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#333' },
  statLabel: { fontSize: 12, color: '#777', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 12, justifyContent: 'center' },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 16, borderWidth: 1, borderColor: '#dde3ee',
  },
  actionText: { color: '#1D478B', fontSize: 13, fontWeight: '600' },
  columns: { gap: 10 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 8, marginBottom: 10 },
  cardImage: { width: '100%', borderRadius: 8, marginBottom: 6 },
  cardTitle: { fontSize: 13, color: '#333', fontWeight: '500' },
  cardPrice: { fontSize: 14, color: '#1D478B', fontWeight: '700', marginTop: 2 },
  empty: { textAlign: 'center', color: '#cdd9e5', marginTop: 24 },
});
