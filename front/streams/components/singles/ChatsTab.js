// Chats: your Single & Searching conversations — the same chats as in
// Messages, gathered here, newest first.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { fetchConversations } from '../../services/api';
import { previewText } from '../../utils/dmView';
import { useAuth } from '../../context/useAuth';
import { GOLD, FACE, Body, Centered, Title } from './SinglesKit';

export default function ChatsTab() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetchConversations({});
      const list = Array.isArray(res) ? res : res?.results || [];
      const archived = await fetchConversations({ folder: 'archived' }).catch(() => []);
      const more = Array.isArray(archived) ? archived : archived?.results || [];
      setRows([...list, ...more].filter((c) => c.singles));
    } catch { setRows((r) => r || []); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (rows === null) return <ActivityIndicator color={GOLD.gold} style={{ marginTop: 60 }} />;
  return (
    <ScrollView contentContainerStyle={styles.pad}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={GOLD.gold}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      {rows.length ? rows.map((c) => (
        <TouchableOpacity key={c.id} style={styles.row} activeOpacity={0.85} testID={`singles-chatrow-${c.id}`}
          onPress={() => navigation.navigate('Chat', { conversationId: c.id, otherUser: c.other_participant,
            singles: true, closed: !!c.closed })} accessibilityRole="button">
          {c.other_participant?.profile_picture
            ? <Image source={{ uri: c.other_participant.profile_picture }} style={styles.avatar} contentFit="cover" />
            : <View style={[styles.avatar, { backgroundColor: GOLD.photo }]} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{c.other_participant?.username}</Text>
            <Text style={styles.preview} numberOfLines={1}>
              {c.closed ? t('singles.chatClosed') : previewText(t, c.last_message, currentUser?.id)}
            </Text>
          </View>
          {c.unread_count > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{c.unread_count}</Text></View>}
        </TouchableOpacity>
      )) : (
        <Centered>
          <Title size={28}>{t('singles.chats.emptyTitle')}</Title>
          <Body style={{ textAlign: 'center' }}>{t('singles.chats.emptyBody')}</Body>
        </Centered>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16, gap: 10, paddingBottom: 32 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16,
    backgroundColor: GOLD.card, borderWidth: 1, borderColor: GOLD.border,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: GOLD.gold },
  name: { color: GOLD.text, fontSize: 16, fontFamily: FACE.bold },
  preview: { color: GOLD.muted, fontSize: 13, fontFamily: FACE.body, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: GOLD.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: GOLD.onGold, fontSize: 11, fontFamily: FACE.heavy },
});
