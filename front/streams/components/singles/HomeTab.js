// The hub's home: a greeting, today's suggestions, a few faces in the grid
// (For You, New, Nearby, Online), then what makes this a community rather
// than a list of faces — a question people are answering, the next meet-up,
// live rooms, couples' stories.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { fetchSinglesHub } from '../../services/api';
import { GOLD, FACE, Label, Card, Chip, Body, SkeletonList, FadeIn, Offline } from './SinglesKit';
import useSingles from './useSingles';
import GridCard, { useGridWidth } from './GridCard';

const MODES = ['foryou', 'new', 'nearby', 'online'];

export const greetingKey = (hour) => (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');

export default function HomeTab({ onTab }) {
  const { t } = useI18n();
  const navigation = useNavigation();
  const width = useGridWidth();
  const [mode, setMode] = useState('foryou');
  const [refreshing, setRefreshing] = useState(false);
  // Each mode keeps its own last copy, so switching back is instant too.
  const { data: hub, failed, reload } = useSingles(`hub:${mode}`, () => fetchSinglesHub(mode));

  if (!hub && failed) return <Offline onRetry={reload} />;
  if (!hub) return <SkeletonList rows={4} testID="singles-hub-loading" />;
  const pick = (m) => setMode(m);

  return (
    <ScrollView contentContainerStyle={styles.pad} showsVerticalScrollIndicator={false} testID="singles-hub"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={GOLD.gold}
        onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}>
      <Text style={styles.greet}>{t(`singles.hub.${greetingKey(new Date().getHours())}`, { name: hub.first_name })}</Text>
      <Text style={styles.lead}>{t('singles.hub.lead')}</Text>

      {hub.paused ? (
        <Card style={styles.today}><Body>{t('singles.discover.pausedBody')}</Body></Card>
      ) : (
        <TouchableOpacity style={styles.today} activeOpacity={0.9} onPress={() => onTab('discover')}
          accessibilityRole="button" testID="singles-hub-today">
          <MaterialCommunityIcons name="star-four-points-outline" size={24} color={GOLD.gold} />
          <Text style={styles.todayText}>{t('singles.hub.today', { n: hub.today })}</Text>
          <Text style={styles.todayLink}>{t('singles.hub.explore')}</Text>
        </TouchableOpacity>
      )}

      {(hub.likes > 0 || hub.matches > 0) && (
        <View style={styles.counts}>
          {hub.likes > 0 && <Chip icon="heart" text={t('singles.hub.likes', { n: hub.likes })} onPress={() => onTab('connections')} />}
          {hub.matches > 0 && <Chip icon="account-heart-outline" text={t('singles.hub.matches', { n: hub.matches })} onPress={() => onTab('connections')} />}
        </View>
      )}

      {!hub.paused && (
        <>
          <Label style={styles.section}>{t('singles.tab.discover')}</Label>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modes}>
            {MODES.map((m) => <Chip key={m} text={t(`singles.mode.${m}`)} on={mode === m} onPress={() => pick(m)} testID={`singles-mode-${m}`} />)}
          </ScrollView>
          {hub.preview.length ? (
            <FadeIn style={styles.grid} key={mode}>
              {hub.preview.map((c) => <GridCard key={c.id} card={c} width={width} testID={`singles-grid-${c.id}`} />)}
            </FadeIn>
          ) : <Body style={styles.empty}>{t(`singles.mode.${mode}Empty`)}</Body>}
          <TouchableOpacity style={styles.more} onPress={() => navigation.navigate('SinglesBrowse', { mode })}
            accessibilityRole="button" testID="singles-see-all">
            <Text style={styles.moreText}>{t('singles.hub.seeAll')}</Text>
            <Ionicons name="chevron-forward" size={16} color={GOLD.gold} />
          </TouchableOpacity>
        </>
      )}

      <Label style={styles.section}>{t('singles.community.title')}</Label>
      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('SinglesCommunity')} activeOpacity={0.9}
        accessibilityRole="button" testID="singles-hub-community">
        <MaterialCommunityIcons name="chat-question-outline" size={22} color={GOLD.gold} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={2}>{hub.topic ? hub.topic.body : t('singles.community.empty')}</Text>
          {!!hub.topic && <Text style={styles.cardSub}>{t('singles.community.replies', { n: hub.topic.reply_count })}</Text>}
        </View>
      </TouchableOpacity>

      <Label style={styles.section}>{t('singles.events.upcoming')}</Label>
      <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('SinglesEvents')} activeOpacity={0.9}
        accessibilityRole="button" testID="singles-hub-events">
        <MaterialCommunityIcons name="calendar-heart" size={22} color={GOLD.gold} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={2}>{hub.gathering ? hub.gathering.title : t('singles.events.none')}</Text>
          {!!hub.gathering && (
            <Text style={styles.cardSub}>
              {new Date(hub.gathering.starts_at).toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' })}
              {`  ·  ${t('singles.events.going', { n: hub.gathering.going })}`}
            </Text>
          )}
        </View>
      </TouchableOpacity>
      {hub.live_rooms > 0 && (
        <TouchableOpacity style={[styles.card, styles.live]} onPress={() => navigation.navigate('SinglesEvents', { tab: 'rooms' })}
          accessibilityRole="button" testID="singles-hub-live">
          <View style={styles.liveDot} />
          <Text style={[styles.cardTitle, { flex: 1 }]}>{t('singles.rooms.liveNow', { n: hub.live_rooms })}</Text>
          <Ionicons name="chevron-forward" size={16} color={GOLD.gold} />
        </TouchableOpacity>
      )}
      {hub.stories > 0 && (
        <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('SinglesStories')} activeOpacity={0.9}
          accessibilityRole="button">
          <MaterialCommunityIcons name="ring" size={22} color={GOLD.gold} />
          <Text style={[styles.cardTitle, { flex: 1 }]}>{t('singles.stories.teaser')}</Text>
          <Ionicons name="chevron-forward" size={16} color={GOLD.gold} />
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 32, gap: 10 },
  greet: { color: GOLD.text, fontFamily: FACE.title, fontSize: 32, lineHeight: 38 },
  lead: { color: GOLD.sub, fontSize: 15, fontFamily: FACE.body, marginBottom: 6 },
  today: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: 18,
    backgroundColor: GOLD.soft, borderWidth: 1, borderColor: 'rgba(255,196,107,0.35)', flexWrap: 'wrap',
  },
  todayText: { flex: 1, color: GOLD.text, fontSize: 16, fontFamily: FACE.bold, minWidth: 160 },
  todayLink: { color: GOLD.gold, fontSize: 14, fontFamily: FACE.heavy },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  section: { marginTop: 14 },
  modes: { gap: 8, paddingVertical: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  empty: { textAlign: 'center', paddingVertical: 12 },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 44 },
  moreText: { color: GOLD.gold, fontSize: 14, fontFamily: FACE.heavy },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18,
    backgroundColor: GOLD.card, borderWidth: 1, borderColor: GOLD.border, minHeight: 64,
  },
  cardTitle: { color: GOLD.text, fontSize: 15, fontFamily: FACE.bold, lineHeight: 21 },
  cardSub: { color: GOLD.muted, fontSize: 12.5, fontFamily: FACE.body, marginTop: 2 },
  live: { borderColor: 'rgba(242,139,130,0.5)' },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#F28B82' },
});
