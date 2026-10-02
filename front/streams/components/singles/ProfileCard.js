// A singles profile as others see it, in the Covenant Gold portrait style:
// the photo in a gold ring (more photos below), the name and age in
// Cormorant, where and which church, a gold rule, then what they wrote —
// their own words first, the facts after.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useI18n } from '../../context/I18nContext';
import {
  GOLD, FACE, Portrait, Ring, Rule, Chip, Label, Body,
} from './SinglesKit';

export const PROMPTS = ['verse', 'sabbath', 'grateful', 'serve', 'laugh', 'home'];

export default function ProfileCard({ profile, testID }) {
  const { t } = useI18n();
  const photos = profile.photos || [];
  const [shown, setShown] = useState(0);
  const main = photos[shown] || photos[0];
  const place = [profile.town, profile.country].filter(Boolean).join(', ');
  return (
    <View style={styles.wrap} testID={testID}>
      <Ring><Portrait uri={main?.url} size={216} label={t('singles.photoOf', { name: profile.first_name })} /></Ring>
      {photos.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
          {photos.map((p, i) => (
            <TouchableOpacity key={p.id} onPress={() => setShown(i)} accessibilityRole="button"
              accessibilityLabel={t('singles.photoN', { n: i + 1 })} accessibilityState={{ selected: i === shown }}>
              <Portrait uri={p.url} size={52} style={i === shown ? styles.thumbOn : styles.thumb} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <Text style={styles.name} accessibilityRole="header">
        {profile.first_name}<Text style={styles.age}>, {profile.age}</Text>
      </Text>
      {!!(place || profile.church) && (
        <Text style={styles.place}>{[place, profile.church].filter(Boolean).join(' · ')}</Text>
      )}
      <Rule />
      {!!profile.about && <Body style={styles.about}>{profile.about}</Body>}
      <View style={styles.chips}>
        <Chip icon="ring" text={t(`singles.looking.${profile.looking_for}`)} />
        <Chip icon="water-outline" text={t(`singles.baptised.${profile.baptised}`)} />
        {(profile.languages || []).length > 0 && <Chip icon="translate" text={profile.languages.join(' · ')} />}
        {!!profile.occupation && <Chip icon="briefcase-outline" text={profile.occupation} />}
        {!!profile.education && <Chip icon="school-outline" text={profile.education} />}
      </View>
      {(profile.prompts || []).map((p) => (
        <View key={p.key} style={styles.prompt}>
          <Label style={styles.promptLabel}>{t(`singles.prompt.${p.key}`)}</Label>
          <Text style={styles.answer}>{p.answer}</Text>
        </View>
      ))}
      {(profile.interests || []).length > 0 && (
        <View style={styles.prompt}>
          <Label style={styles.promptLabel}>{t('singles.field.interests')}</Label>
          <View style={[styles.chips, { justifyContent: 'center' }]}>
            {profile.interests.map((x) => <Chip key={x} text={x} />)}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 12, paddingTop: 6 },
  thumbs: { gap: 10, paddingHorizontal: 4 },
  thumb: { opacity: 0.6 },
  thumbOn: { borderWidth: 2, borderColor: GOLD.gold },
  name: { color: GOLD.text, fontFamily: FACE.title, fontSize: 40, lineHeight: 46, textAlign: 'center', marginTop: 4 },
  age: { color: GOLD.gold, fontFamily: FACE.title, fontSize: 32 },
  place: { color: GOLD.sub, fontSize: 14, fontFamily: FACE.body, textAlign: 'center' },
  about: { textAlign: 'center', marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  prompt: { alignSelf: 'stretch', paddingTop: 16, borderTopWidth: 1, borderTopColor: GOLD.border, gap: 6, alignItems: 'center' },
  promptLabel: { textAlign: 'center' },
  answer: { color: GOLD.text, fontFamily: FACE.title, fontSize: 21, lineHeight: 28, textAlign: 'center' },
});

