// A singles profile as others see it, in the Covenant Gold portrait style:
// the photo in a gold ring (more photos below), the name and age in
// Cormorant with its badges, what they're here for, where and which church,
// a gold rule, then their own words, faith and life, values, and — when
// suggested — plainly why.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import {
  GOLD, FACE, Portrait, Ring, Rule, Chip, Label, Body,
} from './SinglesKit';

export const PROMPTS = ['verse', 'sabbath', 'working_toward', 'ministry_hope', 'three_happy', 'grateful', 'serve',
  'laugh', 'home'];
export const INTENTS = ['open', 'friendship', 'serious', 'marriage'];
export const INTENT_ICON = { open: 'sprout-outline', friendship: 'handshake-outline', serious: 'heart-outline', marriage: 'ring' };
export const MINISTRIES = ['youth', 'music', 'bible_study', 'health', 'community', 'children', 'media', 'prayer',
  'evangelism', 'hospitality'];
export const VALUES = {
  family_worship: ['very', 'somewhat', 'not_much'],
  relocate: ['yes', 'maybe', 'no'],
  children: ['want', 'open', 'not_for_me', 'have'],
  finances: ['plan_together', 'separate', 'not_sure'],
  conflict: ['talk_it_out', 'need_time', 'write_it'],
  career: ['career_first', 'balance', 'family_first'],
  health: ['very', 'some', 'little'],
  serve_together: ['yes', 'maybe', 'no'],
};

/** "Why you're seeing her": the shared things, in words. */
export function reasonText(t, r) {
  const list = (r.values || []).map((v) => (r.kind === 'ministries' ? t(`singles.ministry.${v}`)
    : r.kind === 'values' ? t(`singles.value.${v}`) : v)).join(', ');
  if (r.kind === 'intent') return t('singles.reasonText.intent', { value: t(`singles.looking.${r.value}`) });
  if (r.kind === 'church' || r.kind === 'town') return t(`singles.reasonText.${r.kind}`, { value: r.value });
  return t(`singles.reasonText.${r.kind}`, { value: list });
}

export default function ProfileCard({ profile, testID }) {
  const { t } = useI18n();
  const photos = profile.photos || [];
  const [shown, setShown] = useState(0);
  const main = photos[shown] || photos[0];
  const place = [profile.town, profile.country].filter(Boolean).join(', ');
  const reasons = profile.reasons || [];
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
      <View style={styles.nameRow}>
        <Text style={styles.name} accessibilityRole="header">
          {profile.first_name}{profile.age != null ? <Text style={styles.age}>, {profile.age}</Text> : null}
        </Text>
        {profile.badges?.photo && (
          <MaterialCommunityIcons name="check-decagram" size={22} color={GOLD.gold}
            accessibilityLabel={t('singles.badge.photo')} testID="singles-verified" />
        )}
      </View>
      {profile.online && (
        <View style={styles.online}><View style={styles.onlineDot} /><Text style={styles.onlineText}>{t('singles.online')}</Text></View>
      )}
      {!!(place || profile.church) && (
        <Text style={styles.place}>{[place, profile.church].filter(Boolean).join(' · ')}</Text>
      )}
      {!!profile.looking_for && (
        <Chip icon={INTENT_ICON[profile.looking_for] || 'heart-outline'} text={t(`singles.looking.${profile.looking_for}`)} on />
      )}
      <Rule />

      {reasons.length > 0 && (
        <View style={styles.why} testID="singles-why">
          <Label>{t('singles.why', { name: profile.first_name })}</Label>
          {reasons.slice(0, 3).map((r) => (
            <Text key={r.kind} style={styles.whyText}>{`•  ${reasonText(t, r)}`}</Text>
          ))}
        </View>
      )}

      {!!profile.about && <Body style={styles.about}>{profile.about}</Body>}
      <View style={styles.chips}>
        {/* A card painted from the grid has no details yet: none shown, not a raw key. */}
        {!!profile.baptised && <Chip icon="water-outline" text={t(`singles.baptised.${profile.baptised}`)} />}
        {(profile.languages || []).length > 0 && <Chip icon="translate" text={profile.languages.join(' · ')} />}
        {!!profile.occupation && <Chip icon="briefcase-outline" text={profile.occupation} />}
        {!!profile.education && <Chip icon="school-outline" text={profile.education} />}
        {!!profile.diet && <Chip icon="leaf" text={t(`singles.diet.${profile.diet}`)} />}
      </View>
      {(profile.prompts || []).map((p) => (
        <View key={p.key} style={styles.prompt}>
          <Label style={styles.center}>{t(`singles.prompt.${p.key}`)}</Label>
          <Text style={styles.answer}>{p.answer}</Text>
        </View>
      ))}
      {(profile.ministries || []).length > 0 && (
        <View style={styles.prompt}>
          <Label style={styles.center}>{t('singles.faithLife')}</Label>
          <View style={[styles.chips, { justifyContent: 'center' }]}>
            {profile.ministries.map((m) => <Chip key={m} icon="heart-outline" text={t(`singles.ministry.${m}`)} />)}
          </View>
        </View>
      )}
      {(profile.interests || []).length > 0 && (
        <View style={styles.prompt}>
          <Label style={styles.center}>{t('singles.field.interests')}</Label>
          <View style={[styles.chips, { justifyContent: 'center' }]}>
            {profile.interests.map((x) => <Chip key={x} text={x} />)}
          </View>
        </View>
      )}
      {(profile.answers || []).length > 0 && (
        <View style={styles.prompt}>
          <Label style={styles.center}>{t('singles.values.title')}</Label>
          {profile.answers.map((a) => (
            <View key={a.key} style={styles.value}>
              <Text style={styles.valueQ}>{t(`singles.valueQ.${a.key}`)}</Text>
              <Text style={styles.valueA}>{t(`singles.valueA.${a.key}.${a.answer}`)}</Text>
            </View>
          ))}
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
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4, maxWidth: '100%' },
  name: { flexShrink: 1, color: GOLD.text, fontFamily: FACE.title, fontSize: 40, lineHeight: 46, textAlign: 'center' },
  age: { color: GOLD.gold, fontFamily: FACE.title, fontSize: 32 },
  online: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#5FD39A' },
  onlineText: { color: GOLD.sub, fontSize: 12.5, fontFamily: FACE.semi },
  place: { color: GOLD.sub, fontSize: 14, fontFamily: FACE.body, textAlign: 'center' },
  why: { alignSelf: 'stretch', padding: 14, borderRadius: 14, backgroundColor: GOLD.soft, gap: 6 },
  whyText: { color: GOLD.text, fontSize: 14, lineHeight: 20, fontFamily: FACE.body },
  about: { textAlign: 'center', marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  prompt: { alignSelf: 'stretch', paddingTop: 16, borderTopWidth: 1, borderTopColor: GOLD.border, gap: 8, alignItems: 'center' },
  center: { textAlign: 'center' },
  answer: { color: GOLD.text, fontFamily: FACE.title, fontSize: 21, lineHeight: 28, textAlign: 'center' },
  value: { alignSelf: 'stretch', gap: 2, alignItems: 'center' },
  valueQ: { color: GOLD.muted, fontSize: 13, fontFamily: FACE.body, textAlign: 'center' },
  valueA: { color: GOLD.text, fontSize: 15, fontFamily: FACE.bold, textAlign: 'center' },
});
