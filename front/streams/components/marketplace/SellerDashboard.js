// The seller's dashboard: what sold this week (per currency, confirmed
// payments only), orders waiting for me to confirm payment or to send, what
// is running low, and my products with a quick edit (price, stock, on sale)
// that does not need the full form. Opens at once on the last copy.
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Switch,
  ScrollView,
  } from 'react-native';
import KeyboardSheetPad from '../KeyboardSheetPad';
import { Image } from 'expo-image';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import {
  fetchProducts, fetchOrders, deleteProduct, fetchSellerStats, quickUpdateProduct,
  fetchSellerProfile, saveSellerProfile,
} from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { useI18n } from '../../context/I18nContext';
import useCachedData from '../../utils/useCachedData';
import { userKey } from '../../utils/screenCache';
import { formatPrice, formatTotals, orderTotals, marketError } from '../../utils/market';
import { STATUS_COLORS, formatDate } from './OrderHistory';
import useMarketToast from './MarketToast';

// Constants
const COLORS = {
  primary: '#1D478B',
  secondary: '#2E8B57',
  error: '#FF6347',
  warning: '#FFA500',
  gray: '#888',
  lightGray: '#f5f5f5',
  white: '#fff',
  black: '#333'
};

const SHADOW = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  }
};

const DEFAULT_IMAGE = require('../../assets/default-image.png');
const SELLER_FIELDS = [
  'whatsapp_number', 'contact_number', 'location', 'mpesa_number', 'till_number',
  'bank_details', 'payment_instructions',
];
const listOf = (data) => (Array.isArray(data) ? data : (data?.results || []));

/** Price, stock and on-sale, changed without the full form. */
const QuickEdit = ({ product, onClose, onSaved, t }) => {
  const [price, setPrice] = useState(String(product.price ?? ''));
  const [quantity, setQuantity] = useState(String(product.quantity ?? ''));
  const [available, setAvailable] = useState(product.is_available !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const p = parseFloat(price);
    const q = parseInt(quantity, 10);
    if (!Number.isFinite(p) || p < 0 || !Number.isFinite(q) || q < 0) {
      setError(t('market.seller.quickInvalid'));
      return;
    }
    try {
      setSaving(true);
      const fresh = await quickUpdateProduct(product.slug, { price: p.toFixed(2), quantity: q, is_available: available });
      onSaved(fresh);
    } catch (e) {
      setError(marketError(e, t('market.seller.quickFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardSheetPad style={quick.flex}>
      <TouchableOpacity style={quick.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={quick.card}>
          <Text style={quick.title} numberOfLines={1}>{product.title}</Text>
          <Text style={quick.label}>{t('market.seller.quickPrice', { currency: product.currency || '' })}</Text>
          <TextInput style={quick.input} value={price} onChangeText={setPrice} keyboardType="decimal-pad" testID="quick-price" />
          <Text style={quick.label}>{t('market.seller.quickStock')}</Text>
          <TextInput style={quick.input} value={quantity} onChangeText={setQuantity} keyboardType="number-pad" testID="quick-stock" />
          <View style={quick.row}>
            <Text style={quick.label}>{t('market.seller.quickOnSale')}</Text>
            <Switch value={available} onValueChange={setAvailable} testID="quick-available" />
          </View>
          {!!error && <Text style={quick.error}>{error}</Text>}
          <TouchableOpacity style={quick.save} onPress={save} disabled={saving} testID="quick-save">
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={quick.saveText}>{t('common.save')}</Text>}
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
      </KeyboardSheetPad>
    </Modal>
  );
};

/** The seller's contact and payment details, kept once for every product. */
const SellerDetails = ({ onClose, t, onSaved }) => {
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  React.useEffect(() => {
    fetchSellerProfile().then(setFields).catch(() => setFields({}));
  }, []);
  const save = async () => {
    try {
      setSaving(true);
      const out = {};
      SELLER_FIELDS.forEach((k) => { out[k] = (fields?.[k] || '').trim(); });
      setError(null);
      await saveSellerProfile(out);
      onSaved();
    } catch (e) {
      // Said: otherwise a seller leaves thinking buyers have their numbers.
      setError(marketError(e, t('market.seller.quickFailed')));
      setSaving(false);
    }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardSheetPad style={quick.flex}>
      <TouchableOpacity style={quick.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={quick.card}>
          <Text style={quick.title}>{t('market.seller.detailsTitle')}</Text>
          <Text style={quick.note}>{t('market.seller.detailsNote')}</Text>
          {!fields ? <ActivityIndicator color={COLORS.primary} /> : (
            <ScrollView style={{ maxHeight: 360 }}>
              {SELLER_FIELDS.map((k) => (
                <View key={k}>
                  <Text style={quick.label}>{t(`market.seller.field.${k}`)}</Text>
                  <TextInput
                    style={quick.input}
                    value={fields[k] || ''}
                    onChangeText={(v) => setFields((f) => ({ ...f, [k]: v }))}
                    testID={`details-${k}`}
                  />
                </View>
              ))}
            </ScrollView>
          )}
          {!!error && <Text style={quick.error} testID="details-error">{error}</Text>}
          <TouchableOpacity style={quick.save} onPress={save} disabled={!fields || saving} testID="details-save">
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={quick.saveText}>{t('common.save')}</Text>}
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
      </KeyboardSheetPad>
    </Modal>
  );
};

const SellerDashboard = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentUser, isAuthenticated, isLoading: authLoading } = useAuth();
  const uid = currentUser?.id;
  const [activeTab, setActiveTab] = useState('products');
  const [editing, setEditing] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [toast, showToast] = useMarketToast();

  const stats = useCachedData(uid ? userKey(uid, 'market:seller:stats') : null, fetchSellerStats);
  const productsData = useCachedData(uid ? userKey(uid, 'market:seller:products') : null,
    () => fetchProducts(1, { seller: uid, page_size: 50 }));
  const ordersData = useCachedData(uid ? userKey(uid, 'market:seller:orders') : null,
    () => fetchOrders({ role: 'seller' }));
  // Past the first fifty: further pages, fetched as the list is scrolled.
  const [more, setMore] = useState({ items: [], page: 1, next: undefined, loading: false });
  const products = [...(productsData.data?.results || []), ...more.items];
  const hasMore = more.next === undefined ? !!productsData.data?.next : !!more.next;
  const loadMoreProducts = async () => {
    if (!hasMore || more.loading || !uid) return;
    setMore((m) => ({ ...m, loading: true }));
    try {
      const data = await fetchProducts(more.page + 1, { seller: uid, page_size: 50 });
      setMore((m) => {
        const have = new Set([...(productsData.data?.results || []), ...m.items].map((p) => p.id));
        return {
          items: [...m.items, ...(data?.results || []).filter((p) => !have.has(p.id))],
          page: m.page + 1, next: data?.next || null, loading: false,
        };
      });
    } catch {
      setMore((m) => ({ ...m, loading: false }));
    }
  };
  const orders = listOf(ordersData.data);

  // Back from an order or a product: the numbers may have moved.
  const first = React.useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    stats.reload();
    productsData.reload();
    ordersData.reload();
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadAll = () => {
    setMore({ items: [], page: 1, next: undefined, loading: false });
    stats.reload(); productsData.reload(); ordersData.reload();
  };

  const handleDeleteProduct = (slug) => {
    Alert.alert(
      t('market.seller.deleteTitle'),
      t('market.seller.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProduct(slug);
              productsData.setData((d) => ({ ...(d || {}), results: (d?.results || []).filter((p) => p.slug !== slug) }));
              setMore((m) => ({ ...m, items: m.items.filter((p) => p.slug !== slug) }));
              showToast(t('market.seller.deleted'));
              stats.reload();
            } catch {
              showToast(t('market.seller.deleteFailed'), { error: true });
            }
          },
        },
      ],
    );
  };

  const onQuickSaved = (fresh) => {
    const swap = (p) => (p.slug === fresh.slug ? { ...p, ...fresh } : p);
    productsData.setData((d) => ({ ...(d || {}), results: (d?.results || []).map(swap) }));
    setMore((m) => ({ ...m, items: m.items.map(swap) }));
    setEditing(null);
    showToast(t('market.seller.quickSaved'));
    stats.reload();
  };

  // Lines this seller still needs to confirm payment for (nothing ships, and no
  // stock moves, until they do).
  const awaitingConfirmation = (order) =>
    (order?.items || []).some((item) => item.seller === uid && !item.payment_confirmed_at && !item.cancelled_at);

  const s = stats.data;

  const renderHeader = () => (
    <>
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statValue} numberOfLines={2} adjustsFontSizeToFit>
            {s ? formatTotals(s.week) : '—'}
          </Text>
          <Text style={styles.statLabel}>{t('market.seller.thisWeek')}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{s ? s.awaiting_payment : '—'}</Text>
          <Text style={styles.statLabel}>{t('market.seller.awaitingPayment')}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{s ? s.to_send : '—'}</Text>
          <Text style={styles.statLabel}>{t('market.seller.toSend')}</Text>
        </View>
      </View>

      {!!s?.low_stock?.length && (
        <View style={styles.lowStock} testID="low-stock">
          <Icon name="exclamation-triangle" size={14} color={COLORS.warning} />
          <Text style={styles.lowStockText}>
            {t('market.seller.lowStock', {
              items: s.low_stock.map((p) => `${p.title} (${p.quantity})`).join(', '),
            })}
          </Text>
        </View>
      )}

      <View style={styles.shopRow}>
        <TouchableOpacity style={styles.shopLink} onPress={() => navigation.navigate('SellerShop', { username: currentUser?.username })}
                          testID="my-shop">
          <Icon name="shopping-bag" size={14} color={COLORS.primary} />
          <Text style={styles.shopLinkText}>{t('market.seller.myShop')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.shopLink} onPress={() => setDetailsOpen(true)} testID="my-details">
          <Icon name="credit-card" size={14} color={COLORS.primary} />
          <Text style={styles.shopLinkText}>{t('market.seller.myDetails')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabsContainer}>
        {['products', 'orders'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabButton, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
            testID={`seller-tab-${tab}`}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {t(`market.seller.tab.${tab}`)}{tab === 'products' && s ? ` (${s.products})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      {(activeTab === 'products' ? productsData : ordersData).data == null ? (
        <ActivityIndicator color={COLORS.primary} />
      ) : (
        <>
          <Icon name={activeTab === 'products' ? 'tag' : 'shopping-bag'} size={40} color={COLORS.gray} />
          <Text style={styles.emptyText}>
            {activeTab === 'products' ? t('market.seller.noProducts') : t('market.seller.noOrders')}
          </Text>
          {activeTab === 'products' && (
            <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('AddProduct')}>
              <Text style={styles.addButtonText}>{t('market.seller.addFirst')}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );

  const renderProductItem = ({ item }) => {
    const soldOut = item.quantity <= 0 || item.is_available === false;
    return (
      <TouchableOpacity
        style={styles.productCard}
        onPress={() => navigation.navigate('ProductDetail', { slug: item.slug, preview: item })}
        testID={`seller-product-${item.id}`}
      >
        <Image
          source={item.images?.[0]?.image_url ? { uri: item.images[0].image_url } : DEFAULT_IMAGE}
          placeholder={DEFAULT_IMAGE}
          contentFit="cover"
          transition={150}
          style={styles.productImage}
        />
        <View style={styles.productInfo}>
          <Text style={styles.productTitle} numberOfLines={1}>{item.title || t('market.untitled')}</Text>
          <Text style={styles.productPrice}>{formatPrice(item.price, item.currency)}</Text>
          <Text style={[styles.productStock, soldOut && styles.outOfStock]}>
            {item.is_available === false ? t('market.seller.notOnSale')
              : item.quantity > 0 ? t('market.inStock', { n: item.quantity }) : t('market.outOfStock')}
            {item.views ? `  ·  ${t('market.seller.views', { n: item.views })}` : ''}
          </Text>
        </View>
        <View style={styles.productActions}>
          <TouchableOpacity style={styles.actionButton} onPress={() => setEditing(item)}
                            accessibilityLabel={t('market.seller.quickEdit')} testID={`quick-${item.id}`}>
            <Icon name="sliders" size={18} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('EditProduct', { slug: item.slug })}
                            accessibilityLabel={t('market.seller.edit')}>
            <Icon name="edit" size={18} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => handleDeleteProduct(item.slug)}
                            accessibilityLabel={t('common.delete')}>
            <Icon name="trash" size={18} color={COLORS.error} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderOrderItem = ({ item }) => {
    const status = (item.status || 'pending').toLowerCase();
    // Only my lines: an order can span several sellers.
    const mine = (item.items || []).filter((i) => i.seller === uid);
    return (
      <TouchableOpacity
        style={styles.orderCard}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.id, order: item })}
        testID={`seller-order-${item.id}`}
      >
        <View style={styles.orderHeader}>
          <Text style={styles.orderId}>{t('market.order.number', { id: item.id })}</Text>
          <Text style={[styles.orderStatus, { color: STATUS_COLORS[status] || COLORS.gray }]}>
            {t(`market.status.${status}`)}
          </Text>
        </View>
        <Text style={styles.orderDate}>
          {formatDate(item.created_at)}{item.buyer?.username ? `  ·  ${item.buyer.username}` : ''}
        </Text>
        <Text style={styles.orderTotal}>{formatTotals(orderTotals({ items: mine }))}</Text>
        <Text style={styles.orderItems}>{t('market.seller.lines', { n: mine.length })}</Text>
        {awaitingConfirmation(item) && (
          <View style={styles.confirmPrompt}>
            <Icon name="exclamation-circle" size={13} color="#FFA500" />
            <Text style={styles.confirmPromptText}>{t('market.seller.confirmPrompt')}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (authLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={styles.authContainer}>
        <Icon name="user-circle" size={50} color={COLORS.gray} />
        <Text style={styles.authText}>{t('market.seller.loginPrompt')}</Text>
        <TouchableOpacity style={styles.authButton} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.authButtonText}>{t('market.login')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={activeTab === 'products' ? products : orders}
        keyExtractor={(item) => String(item.id)}
        renderItem={activeTab === 'products' ? renderProductItem : renderOrderItem}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.contentContainer}
        refreshing={!!(stats.refreshing && stats.data)}
        onRefresh={reloadAll}
        onEndReached={activeTab === 'products' ? loadMoreProducts : undefined}
        onEndReachedThreshold={0.5}
        ListFooterComponent={activeTab === 'products' && more.loading
          ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 16 }} />
          : null}
      />

      {activeTab === 'products' && (
        <TouchableOpacity style={styles.floatingButton} onPress={() => navigation.navigate('AddProduct')}
                          accessibilityLabel={t('market.seller.addProduct')}>
          <Icon name="plus" size={24} color={COLORS.white} />
        </TouchableOpacity>
      )}
      {editing && <QuickEdit product={editing} t={t} onClose={() => setEditing(null)} onSaved={onQuickSaved} />}
      {detailsOpen && (
        <SellerDetails t={t} onClose={() => setDetailsOpen(false)}
                       onSaved={() => { setDetailsOpen(false); showToast(t('market.seller.detailsSaved')); }} />
      )}
      {toast}
    </View>
  );
};

const quick = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  title: { fontSize: 17, fontWeight: '700', color: '#333', marginBottom: 10 },
  note: { fontSize: 13, color: '#666', marginBottom: 10 },
  label: { fontSize: 13, color: '#555', marginTop: 8, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 15, color: '#333',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  error: { color: '#FF6347', fontSize: 13, marginTop: 8 },
  save: {
    marginTop: 16, backgroundColor: '#1D478B', borderRadius: 8, paddingVertical: 12, alignItems: 'center',
  },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

const styles = StyleSheet.create({
  lowStock: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 16, marginBottom: 12,
    padding: 10, borderRadius: 8, backgroundColor: 'rgba(255,165,0,0.14)',
  },
  lowStockText: { flex: 1, color: '#FFD28A', fontSize: 13 },
  shopRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 12 },
  shopLink: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 8, backgroundColor: '#fff',
  },
  shopLinkText: { color: '#1D478B', fontWeight: '600', fontSize: 13 },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  authContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  authText: {
    fontSize: 18,
    color: '#E0E1DD',
    marginVertical: 20,
    textAlign: 'center',
  },
  authButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 8,
  },
  authButtonText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: COLORS.gray,
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statusCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    ...SHADOW.sm,
  },
  statusValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.black,
    marginBottom: 4,
  },
  statusLabel: {
    fontSize: 12,
    color: COLORS.gray,
    textTransform: 'uppercase',
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: COLORS.lightGray,
    marginHorizontal: 16,
  },
  tabButton: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderColor: COLORS.primary,
  },
  tabText: {
    fontSize: 16,
    color: COLORS.gray,
    fontWeight: '500',
  },
  activeTabText: {
    color: COLORS.primary,
  },
  contentContainer: {
    flexGrow: 1,
    padding: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#cdd9e5',
    marginTop: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  addButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  addButtonText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 16,
  },
  productCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 8,
    marginBottom: 16,
    padding: 12,
    ...SHADOW.sm,
  },
  productImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  productTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
    color: COLORS.black,
  },
  productPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  productStock: {
    fontSize: 14,
    color: COLORS.secondary,
  },
  outOfStock: {
    color: COLORS.error,
  },
  productActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 8,
    marginLeft: 4,
  },
  orderCard: {
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    ...SHADOW.sm,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  orderId: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.black,
  },
  orderStatus: {
    fontSize: 14,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  orderDate: {
    fontSize: 14,
    color: COLORS.gray,
    marginBottom: 4,
  },
  orderTotal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  orderItems: {
    fontSize: 14,
    color: COLORS.black,
  },
  confirmPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderColor: '#eee',
  },
  confirmPromptText: {
    fontSize: 13,
    color: COLORS.warning,
    fontWeight: '600',
    marginLeft: 6,
  },
  floatingButton: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW.md,
  },
});

export default SellerDashboard;