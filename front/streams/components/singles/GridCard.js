// A profile in a grid: the portrait, the name and age, where, what they're
// here for, the verified tick and whether they're around. Two to a row on a
// phone, one at a large text size (InfoKit's rule, applied here too).
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { GOLD, FACE, Portrait, MAX_WIDTH } from './SinglesKit';
import { INTENT_ICON } from './ProfileCard';

export const useGridWidth = () => {
  const { width, fontScale } = useWindowDimensions();
  const column = Math.min(width, MAX_WIDTH) - 32;
  return (column - 10) / 2 / Math.max(1, fontScale) >= 135 ? '48.5%' : '100%';
};

export default function GridCard({ card, width, testID }) {
  const { t } = useI18n();
  const navigation = useNavigation();
  return (
    <TouchableOpacity style={[styles.card, { width }]} activeOpacity={0.85} testID={testID}
      onPress={() => navigation.navigate('SinglesView', { id: card.id, card })} accessibilityRole="button"
      accessibilityLabel={`${card.first_name}${card.age != null ? `, ${card.age}` : ''}`}>
      <View>
        <Portrait uri={card.photo} size={160} radius={14} style={styles.photo} />
        {card.online && <View style={styles.online} />}
      </View>
      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={1}>
          {card.first_name}{card.age != null ? <Text style={styles.age}>, {card.age}</Text> : null}
        </Text>
        {card.badges?.photo && <MaterialCommunityIcons name="check-decagram" size={16} color={GOLD.gold} />}
      </View>
      {!!(card.town || card.country) && <Text style={styles.place} numberOfLines={1}>{card.town || card.country}</Text>}
      {!!card.looking_for && (
        <View style={styles.intent}>
          <MaterialCommunityIcons name={INTENT_ICON[card.looking_for] || 'heart-outline'} size={14} color={GOLD.gold} />
          <Text style={styles.intentText} numberOfLines={1}>{t(`singles.lookingShort.${card.looking_for}`)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: GOLD.card, borderRadius: 18, borderWidth: 1, borderColor: GOLD.border, padding: 8, gap: 4 },
  photo: { width: '100%', height: 170 },
  online: {
    position: 'absolute', right: 8, top: 8, width: 12, height: 12, borderRadius: 6, backgroundColor: '#5FD39A',
    borderWidth: 2, borderColor: GOLD.card,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4, marginTop: 4 },
  name: { flexShrink: 1, color: GOLD.text, fontFamily: FACE.title, fontSize: 22 },
  age: { color: GOLD.gold, fontFamily: FACE.title, fontSize: 19 },
  place: { color: GOLD.muted, fontSize: 12.5, fontFamily: FACE.body, paddingHorizontal: 4 },
  intent: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4, paddingBottom: 4 },
  intentText: { flexShrink: 1, color: GOLD.sub, fontSize: 12, fontFamily: FACE.semi },
});
