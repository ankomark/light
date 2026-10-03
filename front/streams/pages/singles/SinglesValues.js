// Values questions: family worship, moving for marriage, children, money,
// conflict, career, health, serving together. Optional, answered over time,
// and each one shown on your profile only if you choose.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { saveSinglesAnswers } from '../../services/api';
import { notify } from '../../utils/adminConfirm';
import { GOLD, FACE, SinglesScreen, GoldButton, Chip, Body, Card } from '../../components/singles/SinglesKit';
import { VALUES } from '../../components/singles/ProfileCard';

export default function SinglesValues() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { params = {} } = useRoute();
  const [answers, setAnswers] = useState(() => Object.fromEntries(
    (params.profile?.answers || []).map((a) => [a.key, { answer: a.answer, visible: a.visible }])));
  const [busy, setBusy] = useState(false);

  const set = (key, patch) => setAnswers((cur) => ({ ...cur, [key]: { visible: true, ...cur[key], ...patch } }));
  const save = async () => {
    setBusy(true);
    try {
      await saveSinglesAnswers(Object.keys(VALUES).map((key) => ({
        key, answer: answers[key]?.answer || '', visible: answers[key]?.visible !== false })));
      navigation.goBack();
    } catch {
      notify(t('common.error'), t('singles.mine.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SinglesScreen title={t('singles.values.title')} testID="singles-values"
      footer={<GoldButton label={t('singles.edit.save')} onPress={save} busy={busy} testID="singles-values-save" />}>
      <Body>{t('singles.values.lead')}</Body>
      {Object.entries(VALUES).map(([key, options]) => (
        <Card key={key} style={{ marginTop: 14 }}>
          <Text style={styles.q}>{t(`singles.valueQ.${key}`)}</Text>
          <View style={styles.chips}>
            {options.map((o) => (
              <Chip key={o} text={t(`singles.valueA.${key}.${o}`)} on={answers[key]?.answer === o}
                onPress={() => set(key, { answer: answers[key]?.answer === o ? '' : o })} testID={`singles-value-${key}-${o}`} />
            ))}
          </View>
          {!!answers[key]?.answer && (
            <View style={styles.showRow}>
              <Text style={styles.show}>{t('singles.values.show')}</Text>
              <Switch value={answers[key]?.visible !== false} onValueChange={(v) => set(key, { visible: v })}
                trackColor={{ true: GOLD.gold, false: GOLD.border }} thumbColor="#FFFFFF"
                accessibilityLabel={t('singles.values.show')} />
            </View>
          )}
        </Card>
      ))}
    </SinglesScreen>
  );
}

const styles = StyleSheet.create({
  q: { color: GOLD.text, fontSize: 16, lineHeight: 22, fontFamily: FACE.bold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  showRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  show: { color: GOLD.sub, fontSize: 13.5, fontFamily: FACE.semi },
});
