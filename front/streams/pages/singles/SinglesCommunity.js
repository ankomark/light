// The singles community: questions worth talking about ("What qualities
// matter most in a life partner?"). Someone can become interesting because
// of what they say, not only their photo.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, RefreshControl, FlatList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { fetchSinglesTopics, askSinglesTopic, heartSinglesTopic } from '../../services/api';
import { notify } from '../../utils/adminConfirm';
import { GOLD, FACE, SinglesScreen, GoldButton, Portrait, Body, SkeletonList, Offline } from '../../components/singles/SinglesKit';
import useSingles from '../../components/singles/useSingles';
import { EmojiTextInput } from '../../components/EmojiKeyboard';

export function TopicRow({ topic, onPress, onHeart }) {
  const { t } = useI18n();
  return (
    <TouchableOpacity style={styles.topic} onPress={onPress} activeOpacity={0.88} disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined} testID={`singles-topic-${topic.id}`}>
      <View style={styles.by}>
        <Portrait uri={topic.author?.photo} size={30} />
        <Text style={styles.byName}>{topic.author?.first_name}</Text>
      </View>
      <Text style={styles.body}>{topic.body}</Text>
      <View style={styles.meta}>
        <TouchableOpacity onPress={onHeart} style={styles.metaBtn} accessibilityRole="button"
          accessibilityState={{ selected: topic.hearted }} accessibilityLabel={t('singles.community.heart')}
          testID={`singles-heart-${topic.id}`}>
          <Ionicons name={topic.hearted ? 'heart' : 'heart-outline'} size={18} color={GOLD.gold} />
          <Text style={styles.metaText}>{topic.heart_count}</Text>
        </TouchableOpacity>
        <View style={styles.metaBtn}>
          <Ionicons name="chatbubble-outline" size={17} color={GOLD.gold} />
          <Text style={styles.metaText}>{t('singles.community.replies', { n: topic.reply_count })}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function SinglesCommunity() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { data, setData: setRows, failed, reload: load } = useSingles('topics', async () => (await fetchSinglesTopics()).results || []);
  const rows = data ?? null;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const ask = async () => {
    setBusy(true);
    try {
      const topic = await askSinglesTopic(text.trim());
      setRows((r) => [topic, ...(r || []).filter((x) => x.id !== topic.id)]);
      setText('');
      load();          // the server's list has it too — a slow first load can't wipe it
    } catch (e) {
      notify(t('common.error'), e?.data?.code === 'slow_down' ? t('singles.community.slowDown') : t('singles.community.askBad'));
    } finally { setBusy(false); }
  };
  const heart = async (topic) => {
    try {
      const res = await heartSinglesTopic(topic.id);
      setRows((r) => r.map((x) => (x.id === topic.id ? { ...x, hearted: res.hearted, heart_count: res.heart_count } : x)));
    } catch { /* tap again */ }
  };

  return (
    <SinglesScreen title={t('singles.community.title')} scroll={false} testID="singles-community">
      <FlatList data={rows || []} keyExtractor={(x) => String(x.id)} contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={GOLD.gold}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListHeaderComponent={(
          <View style={styles.ask}>
            <Body>{t('singles.community.lead')}</Body>
            <EmojiTextInput style={styles.input} value={text} onChangeText={setText} multiline maxLength={300}
              placeholder={t('singles.community.placeholder')} placeholderTextColor={GOLD.muted}
              accessibilityLabel={t('singles.community.placeholder')} testID="singles-ask-input" />
            <GoldButton label={t('singles.community.ask')} onPress={ask} busy={busy} disabled={text.trim().length < 10}
              testID="singles-ask" />
          </View>
        )}
        ListEmptyComponent={rows === null && failed ? <Offline onRetry={load} />
          : rows === null ? <SkeletonList rows={3} /> : <Body style={{ textAlign: 'center' }}>{t('singles.community.empty')}</Body>}
        renderItem={({ item }) => (
          <TopicRow topic={item} onHeart={() => heart(item)} onPress={() => navigation.navigate('SinglesTopic', { id: item.id })} />
        )} />
    </SinglesScreen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  ask: { gap: 10, marginBottom: 6 },
  input: {
    minHeight: 70, borderRadius: 12, borderWidth: 1, borderColor: GOLD.border, backgroundColor: GOLD.card,
    color: GOLD.text, padding: 12, fontSize: 15, fontFamily: FACE.body, textAlignVertical: 'top',
  },
  topic: { padding: 16, borderRadius: 18, backgroundColor: GOLD.card, borderWidth: 1, borderColor: GOLD.border, gap: 10 },
  by: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  byName: { color: GOLD.sub, fontSize: 13, fontFamily: FACE.bold },
  body: { color: GOLD.text, fontFamily: FACE.title, fontSize: 22, lineHeight: 28 },
  meta: { flexDirection: 'row', gap: 18 },
  metaBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  metaText: { color: GOLD.sub, fontSize: 13, fontFamily: FACE.semi },
});
