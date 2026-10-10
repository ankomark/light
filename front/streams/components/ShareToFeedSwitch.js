// "Also share to my feed": shown when a book, product or service goes up for
// the first time. On by default — the server posts its card to the owner's
// feed (songs/feed_cards.py) unless this is switched off.
import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const ShareToFeedSwitch = ({ value, onValueChange, style, testID = 'share-to-feed' }) => {
  const { t } = useI18n();
  return (
    <View style={[styles.row, style]}>
      <Ionicons name="newspaper-outline" size={20} color={colors.primary} />
      <View style={styles.text}>
        <Text style={styles.label}>{t('shareToFeed.label')}</Text>
        <Text style={styles.hint}>{t('shareToFeed.hint')}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={t('shareToFeed.label')}
        testID={testID}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  text: { flex: 1 },
  label: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  hint: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
});

export default ShareToFeedSwitch;
