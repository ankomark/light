// Under your profile: the deeper parts — values questions, who you'd like
// to see and who can see you, the verified tick — and the community.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { GOLD, FACE, Label } from './SinglesKit';

export default function MoreLinks({ profile }) {
  const { t } = useI18n();
  const navigation = useNavigation();
  const rows = [
    ['scale-balance', 'values', () => navigation.navigate('SinglesValues', { profile })],
    ['tune-variant', 'settings', () => navigation.navigate('SinglesSettings', { profile })],
    ['check-decagram-outline', profile.photo_verified ? 'verified' : 'verify', () => navigation.navigate('SinglesVerify')],
    ['chat-question-outline', 'community', () => navigation.navigate('SinglesCommunity')],
    ['calendar-heart', 'events', () => navigation.navigate('SinglesEvents')],
    ['ring', 'stories', () => navigation.navigate('SinglesStories')],
  ];
  return (
    <View style={{ marginTop: 22, gap: 8 }}>
      <Label>{t('singles.more.title')}</Label>
      {rows.map(([icon, key, go]) => (
        <TouchableOpacity key={key} style={styles.row} onPress={go} accessibilityRole="button" testID={`singles-more-${key}`}>
          <View style={styles.icon}><MaterialCommunityIcons name={icon} size={20} color={GOLD.gold} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t(`singles.more.${key}`)}</Text>
            <Text style={styles.sub}>{t(`singles.more.${key}Sub`)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={GOLD.muted} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, minHeight: 60,
    backgroundColor: GOLD.card, borderWidth: 1, borderColor: GOLD.border,
  },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: GOLD.soft, alignItems: 'center', justifyContent: 'center' },
  title: { color: GOLD.text, fontSize: 15, fontFamily: FACE.bold },
  sub: { color: GOLD.muted, fontSize: 12.5, fontFamily: FACE.body, marginTop: 2 },
});
