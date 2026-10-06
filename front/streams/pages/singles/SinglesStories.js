// Couples who met here and chose, both of them, to say so.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useI18n } from '../../context/I18nContext';
import { fetchSinglesStories } from '../../services/api';
import { GOLD, FACE, SinglesScreen, Body, Card, Rule, Portrait, Ring, Centered, Title, SkeletonList, Offline } from '../../components/singles/SinglesKit';
import useSingles from '../../components/singles/useSingles';

export default function SinglesStories() {
  const { t } = useI18n();
  const { data, failed, reload } = useSingles('stories', async () => (await fetchSinglesStories()).results || []);
  const rows = data ?? null;
  return (
    <SinglesScreen title={t('singles.stories.title')} testID="singles-stories">
      <Body style={{ textAlign: 'center', marginBottom: 8 }}>{t('singles.stories.lead')}</Body>
      {rows === null && failed ? <Offline onRetry={reload} /> : rows === null ? <SkeletonList rows={2} /> : rows.length ? rows.map((s) => (
        <Card key={s.id} style={{ marginTop: 14, alignItems: 'center' }} testID={`singles-story-${s.id}`}>
          {!!s.photo && <Ring><Portrait uri={s.photo} size={120} /></Ring>}
          <Text style={styles.names}>{s.names.join(' & ')}</Text>
          <Rule />
          <Text style={styles.title}>{s.title}</Text>
          <Body>{s.body}</Body>
        </Card>
      )) : (
        <Centered>
          <Title size={28}>{t('singles.stories.emptyTitle')}</Title>
          <Body style={{ textAlign: 'center' }}>{t('singles.stories.emptyBody')}</Body>
        </Centered>
      )}
      <View style={{ height: 20 }} />
    </SinglesScreen>
  );
}

const styles = StyleSheet.create({
  names: { color: GOLD.text, fontFamily: FACE.title, fontSize: 28, textAlign: 'center' },
  title: { color: GOLD.gold, fontFamily: FACE.bold, fontSize: 16, textAlign: 'center' },
});
