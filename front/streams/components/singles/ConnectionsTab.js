// Connections: people who are interested in you (answer to match — a
// "not now" is never told), and your matches.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useI18n } from '../../context/I18nContext';
import { fetchSinglesLikes } from '../../services/api';
import { GOLD, FACE, Body, Centered, Title, SkeletonList, Offline } from './SinglesKit';
import useSingles from './useSingles';
import GridCard, { useGridWidth } from './GridCard';

export default function ConnectionsTab({ Matches }) {
  const { t } = useI18n();
  const [part, setPart] = useState('likes');
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.seg} accessibilityRole="tablist">
        {['likes', 'matches'].map((k) => (
          <TouchableOpacity key={k} onPress={() => setPart(k)} style={[styles.segBtn, part === k && styles.segOn]}
            accessibilityRole="tab" accessibilityState={{ selected: part === k }} testID={`singles-conn-${k}`}>
            <Text style={[styles.segText, part === k && styles.segTextOn]}>{t(`singles.conn.${k}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {part === 'likes' ? <Likes /> : <Matches />}
    </View>
  );
}

function Likes() {
  const { t } = useI18n();
  const width = useGridWidth();
  const { data, failed, reload: load } = useSingles('likes', async () => (await fetchSinglesLikes()).results || []);
  const rows = data ?? null;
  const [refreshing, setRefreshing] = useState(false);
  if (rows === null && failed) return <Offline onRetry={load} />;
  if (rows === null) return <SkeletonList rows={3} />;
  return (
    <ScrollView contentContainerStyle={styles.pad}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={GOLD.gold}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      {rows.length ? (
        <>
          <Body style={{ marginBottom: 6 }}>{t('singles.conn.likesLead')}</Body>
          <View style={styles.grid}>
            {rows.map((c) => <GridCard key={c.id} card={c} width={width} testID={`singles-like-${c.id}`} />)}
          </View>
        </>
      ) : (
        <Centered>
          <Title size={28}>{t('singles.conn.likesEmptyTitle')}</Title>
          <Body style={{ textAlign: 'center' }}>{t('singles.conn.likesEmptyBody')}</Body>
        </Centered>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  seg: {
    flexDirection: 'row', margin: 16, marginBottom: 4, borderRadius: 999, padding: 4,
    backgroundColor: GOLD.cardDeep, borderWidth: 1, borderColor: GOLD.border,
  },
  segBtn: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  segOn: { backgroundColor: GOLD.gold },
  segText: { color: GOLD.sub, fontSize: 14, fontFamily: FACE.bold },
  segTextOn: { color: GOLD.onGold },
  pad: { padding: 16, paddingBottom: 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
});
