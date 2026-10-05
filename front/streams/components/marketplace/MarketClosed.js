// What every marketplace screen shows while an admin has the marketplace
// switched off (Admin → App control) — reached by a link, a notification or a
// screen left open. The server turns new orders and listings away meanwhile.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';

const MarketClosed = ({ navigation }) => {
  const { t } = useI18n();
  return (
    <View style={styles.wrap} testID="market-closed">
      <View style={styles.badge}>
        <MaterialCommunityIcons name="storefront-outline" size={34} color="#FFC46B" />
      </View>
      <Text style={styles.title}>{t('market.closed.title')}</Text>
      <Text style={styles.body}>{t('market.closed.body')}</Text>
      {navigation?.canGoBack?.() && (
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()} accessibilityRole="button">
          <Text style={styles.backText}>{t('market.goBack')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  badge: {
    width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,22,40,0.75)', borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,196,107,0.45)', marginBottom: 16,
  },
  title: { color: '#fff', fontSize: 19, fontWeight: '800', textAlign: 'center' },
  body: { color: '#cdd9e5', fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: 8, maxWidth: 360 },
  back: {
    marginTop: 20, paddingHorizontal: 22, height: 42, borderRadius: 21, justifyContent: 'center',
    backgroundColor: '#FFC46B',
  },
  backText: { color: '#0A1628', fontWeight: '800', fontSize: 14 },
});

export default MarketClosed;
