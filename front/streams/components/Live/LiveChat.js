/**
 * Live chat overlay + composer for a broadcast. Messages ride the LiveKit data
 * channel (see LiveRoom). This component is presentation-only: the parent owns
 * the message list and the send handler.
 */
import React, { useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../constants/theme';

const ChatRow = ({ item }) => (
  <View style={styles.row}>
    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
    <Text style={styles.text}>{item.text}</Text>
  </View>
);

const LiveChat = ({ messages, draft, onChangeDraft, onSend, style }) => {
  const listRef = useRef(null);

  useEffect(() => {
    if (messages.length) {
      // Stay pinned to the newest message.
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  const submit = () => {
    const t = (draft || '').trim();
    if (!t) return;
    onSend(t);
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
          placeholder="Say something…"
          placeholderTextColor={colors.placeholder}
          maxLength={200}
          returnKeyType="send"
          onSubmitEditing={submit}
          blurOnSubmit={false}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={submit} hitSlop={8}>
          <Ionicons name="send" size={18} color="#0A1628" />
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
    alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap',
    backgroundColor: 'rgba(0,0,0,0.42)', borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 4, marginTop: 4,
  },
  name: { ...typography.caption, color: colors.accent, fontWeight: '800', marginRight: 6 },
  text: { ...typography.caption, color: '#fff' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  input: {
    flex: 1, color: '#fff', fontSize: 14, backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
});

export default LiveChat;
