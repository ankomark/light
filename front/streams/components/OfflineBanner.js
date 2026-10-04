/**
 * A slim strip that says the phone is offline (or a load failed) while the
 * screen keeps showing what it had — never a popup over content that is
 * still perfectly readable. Retry when there is something to retry.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useI18n } from '../context/I18nContext';

const OfflineBanner = ({ kind = 'offline', onRetry, style, testID = 'offline-banner' }) => {
  const { t } = useI18n();
  const offline = kind === 'offline';
  return (
    <View style={[styles.bar, style]} accessibilityLiveRegion="polite" testID={testID}>
      <MaterialIcons name={offline ? 'cloud-off' : 'error-outline'} size={16} color="#FFD99A" />
      <Text style={styles.text} numberOfLines={2}>
        {offline ? t('net.offlineSaved') : t('net.loadFailed')}
      </Text>
      {!!onRetry && (
        <TouchableOpacity onPress={onRetry} hitSlop={10} accessibilityRole="button" testID={`${testID}-retry`}>
          <Text style={styles.retry}>{t('common.retry')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12,
    marginHorizontal: 12, marginVertical: 6, borderRadius: 12,
    backgroundColor: 'rgba(10,22,40,0.92)', borderWidth: 1, borderColor: 'rgba(255,196,107,0.35)',
  },
  text: { flex: 1, color: '#FFFFFF', fontSize: 13, lineHeight: 18 },
  retry: { color: '#FFC46B', fontSize: 13, fontWeight: '700' },
});

export default OfflineBanner;
