// A product as a picture to share: its photo, what it is, what it costs, who
// sells it and where. Captured by the share sheet (ShareCardSheet), so the
// preview is exactly what is sent.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { formatPrice } from '../../utils/market';

const APP_NAME = 'Adventist Life';
const DESIGN_WIDTH = 360;

const ProductShareCard = React.forwardRef(({ width, product }, ref) => {
  const k = width / DESIGN_WIDTH;
  const photo = product?.images?.[0]?.image_url;
  return (
    <View ref={ref} collapsable={false} style={[styles.card, { width, borderRadius: 18 * k }]}>
      {photo ? (
        <Image source={{ uri: photo }} style={{ width, height: width }} contentFit="cover" />
      ) : <View style={{ width, height: width * 0.5, backgroundColor: '#dfe6f0' }} />}
      <View style={{ padding: 16 * k }}>
        <Text style={[styles.title, { fontSize: 18 * k }]} numberOfLines={2}>{product?.title}</Text>
        <Text style={[styles.price, { fontSize: 22 * k, marginTop: 6 * k }]}>
          {formatPrice(product?.price, product?.currency)}
        </Text>
        <Text style={[styles.meta, { fontSize: 12 * k, marginTop: 8 * k }]} numberOfLines={1}>
          {[product?.seller?.username, product?.location].filter(Boolean).join(' · ')}
        </Text>
        <Text style={[styles.brand, { fontSize: 10 * k, marginTop: 10 * k }]}>{APP_NAME} · Marketplace</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', overflow: 'hidden' },
  title: { color: '#1b1b1b', fontWeight: '700' },
  price: { color: '#1D478B', fontWeight: '800' },
  meta: { color: '#666' },
  brand: { color: '#9aa4b2', letterSpacing: 1, textTransform: 'uppercase' },
});

export default ProductShareCard;
