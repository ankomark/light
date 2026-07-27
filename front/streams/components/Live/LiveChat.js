/**
 * Live chat overlay + composer for a broadcast. Messages ride the LiveKit data
 * channel (see LiveRoom). This component is presentation-only: the parent owns
 * the message list and the send handler. Messages carry an optional `host` flag
 * so the broadcaster's lines get a champagne HOST badge.
 */
import React, { useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius } from '../../constants/theme';
import { live } from '../../constants/liveTheme';
import { useI18n } from '../../context/I18nContext';

const ChatRow = ({ item }) => (
  <View style={styles.row}>
    {item.host
      ? <Text style={styles.hostBadge}>HOST</Text>
      : <Text style={styles.name} numberOfLines={1}>{item.name}</Text>}
    <Text style={styles.text}>{item.text}</Text>
  </View>
);

const LiveChat = ({ messages, draft, onChangeDraft, onSend, style }) => {
  const { t } = useI18n();
  const listRef = useRef(null);

  useEffect(() => {
    if (messages.length) {
      // Stay pinned to the newest message.
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  const submit = () => {
    const value = (draft || '').trim();
    if (!value) return;
    onSend(value);
  };

  return (
    <View style={[styles.wrap, style]}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        renderItem={ChatRow}
        showsVerticalScrollIndicator={false}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={onChangeDraft}
          placeholder={t('live.chatPlaceholder')}
          placeholderTextColor={live.inkMute}
          maxLength={200}
          returnKeyType="send"
          onSubmitEditing={submit}
          blurOnSubmit={false}
        />
        <TouchableOpacity onPress={submit} hitSlop={8} activeOpacity={0.85}>
          <LinearGradient
            colors={[live.goldBright, live.goldDeep]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.sendBtn}
          >
            <Ionicons name="send" size={17} color={live.onGold} />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { width: '78%' },
  list: { maxHeight: 200 },
  listContent: { justifyContent: 'flex-end', flexGrow: 1, paddingVertical: spacing.xs },
  row: {
    alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    backgroundColor: 'rgba(6,13,26,0.42)', borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: spacing.sm + 2, paddingVertical: 4, marginTop: 5, columnGap: 6, rowGap: 2,
  },
  name: { fontSize: 12, color: live.gold, fontWeight: '800' },
  hostBadge: {
    fontSize: 10, fontWeight: '900', letterSpacing: 0.6, color: live.onGold,
    backgroundColor: live.gold, paddingHorizontal: 7, paddingVertical: 1,
    borderRadius: radius.full, overflow: 'hidden',
  },
  text: { fontSize: 12, color: '#EAF0F7' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  input: {
    flex: 1, color: '#fff', fontSize: 14, backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
  },
});

export default LiveChat;
