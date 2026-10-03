// Who you'd like to see (these shape For You and Discover) and who can see
// you: age, town, being online, and incognito — shown only to the people
// you are interested in.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Switch, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { updateSinglesProfile } from '../../services/api';
import { notify } from '../../utils/adminConfirm';
import { GOLD, FACE, SinglesScreen, GoldButton, Label, Chip, Body } from '../../components/singles/SinglesKit';
import { INTENTS } from '../../components/singles/ProfileCard';

export default function SinglesSettings() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const p = params.profile || {};
  const prefs = p.preferences || {};
  const [minAge, setMinAge] = useState(prefs.min_age ? String(prefs.min_age) : '');
  const [maxAge, setMaxAge] = useState(prefs.max_age ? String(prefs.max_age) : '');
  const [countries, setCountries] = useState((prefs.countries || []).join(', '));
  const [intents, setIntents] = useState(prefs.intents || []);
  const [show, setShow] = useState({ show_age: p.show_age !== false, show_town: p.show_town !== false, show_online: p.show_online !== false });
  const [discoverable, setDiscoverable] = useState(p.discoverable || 'everyone');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateSinglesProfile({
        ...show, discoverable,
        preferences: {
          min_age: minAge ? Number(minAge) : null, max_age: maxAge ? Number(maxAge) : null,
          countries: countries.split(',').map((c) => c.trim()).filter(Boolean), intents,
        },
      });
      navigation.goBack();
    } catch {
      notify(t('singles.edit.checkTitle'), t('singles.settings.ageBad'));
    } finally {
      setBusy(false);
    }
  };
  const num = (set) => (v) => set(v.replace(/[^0-9]/g, '').slice(0, 3));
  const toggleIntent = (i) => setIntents((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));

  return (
    <SinglesScreen title={t('singles.settings.title')} testID="singles-settings"
      footer={<GoldButton label={t('singles.edit.save')} onPress={save} busy={busy} testID="singles-settings-save" />}>
      <Label style={styles.section}>{t('singles.settings.seeTitle')}</Label>
      <Body style={styles.note}>{t('singles.settings.seeLead')}</Body>
      <Text style={styles.field}>{t('singles.filters.age')}</Text>
      <View style={styles.row}>
        <TextInput style={styles.input} value={minAge} onChangeText={num(setMinAge)} keyboardType="number-pad" placeholder="18"
          placeholderTextColor={GOLD.muted} accessibilityLabel={t('singles.filters.minAge')} testID="singles-pref-min" />
        <Text style={styles.to}>{t('singles.filters.to')}</Text>
        <TextInput style={styles.input} value={maxAge} onChangeText={num(setMaxAge)} keyboardType="number-pad" placeholder="60"
          placeholderTextColor={GOLD.muted} accessibilityLabel={t('singles.filters.maxAge')} testID="singles-pref-max" />
      </View>
      <Text style={styles.field}>{t('singles.settings.countries')}</Text>
      <TextInput style={styles.input} value={countries} onChangeText={setCountries} placeholder={t('singles.filters.anyCountry')}
        placeholderTextColor={GOLD.muted} accessibilityLabel={t('singles.settings.countries')} />
      <Text style={styles.field}>{t('singles.field.lookingFor')}</Text>
      <View style={styles.chips}>
        {INTENTS.map((i) => <Chip key={i} text={t(`singles.looking.${i}`)} on={intents.includes(i)} onPress={() => toggleIntent(i)} />)}
      </View>

      <Label style={styles.section}>{t('singles.settings.privacyTitle')}</Label>
      {['show_age', 'show_town', 'show_online'].map((k) => (
        <View key={k} style={styles.switchRow}>
          <Text style={styles.switchText}>{t(`singles.settings.${k}`)}</Text>
          <Switch value={show[k]} onValueChange={(v) => setShow((s) => ({ ...s, [k]: v }))}
            trackColor={{ true: GOLD.gold, false: GOLD.border }} thumbColor="#FFFFFF"
            accessibilityLabel={t(`singles.settings.${k}`)} testID={`singles-${k}`} />
        </View>
      ))}

      <Label style={styles.section}>{t('singles.settings.whoTitle')}</Label>
      {['everyone', 'liked'].map((d) => (
        <TouchableOpacity key={d} style={styles.option} onPress={() => setDiscoverable(d)} accessibilityRole="radio"
          accessibilityState={{ selected: discoverable === d }} testID={`singles-discoverable-${d}`}>
          <Ionicons name={discoverable === d ? 'radio-button-on' : 'radio-button-off'} size={22} color={GOLD.gold} />
          <View style={{ flex: 1 }}>
            <Text style={styles.switchText}>{t(`singles.settings.${d}`)}</Text>
            <Text style={styles.sub}>{t(`singles.settings.${d}Sub`)}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </SinglesScreen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 22 },
  note: { marginTop: 4, fontSize: 14 },
  field: { color: GOLD.sub, fontSize: 13, fontFamily: FACE.semi, marginTop: 14, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  to: { color: GOLD.sub, fontFamily: FACE.semi },
  input: {
    flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: GOLD.border, backgroundColor: GOLD.card,
    color: GOLD.text, paddingHorizontal: 12, fontSize: 15, fontFamily: FACE.body,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 52 },
  switchText: { flex: 1, color: GOLD.text, fontSize: 15, fontFamily: FACE.semi },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 56 },
  sub: { color: GOLD.muted, fontSize: 13, fontFamily: FACE.body, marginTop: 2 },
});
