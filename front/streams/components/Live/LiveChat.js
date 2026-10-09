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

const ChatRow = ({ item, hostLabel, onPress }) => (
  item.system ? (
    // "Mary joined": quiet, not a person to tap.
    <View style={[styles.row, styles.systemRow]}>
      <Text style={styles.systemText}>{item.text}</Text>
    </View>
  ) : (
    <TouchableOpacity style={styles.row} activeOpacity={0.8} disabled={!onPress || !item.uid}
      onPress={() => onPress?.(item)} testID={`chat-${item.id}`}>
      {item.host
        ? <Text style={styles.hostBadge}>{hostLabel}</Text>
        : <Text style={styles.name} numberOfLines={1}>{item.name}</Text>}
      <Text style={styles.text}>{item.text}</Text>
    </TouchableOpacity>
  )
);

// The comment the host pinned, above the chat for everyone.
const PinnedRow = ({ pinned, label, onUnpin }) => (
  <View style={styles.pinned} testID="chat-pinned">
    <Ionicons name="pin" size={13} color={live.gold} />
    <Text style={styles.pinnedText} numberOfLines={2}>
      <Text style={styles.name}>{label} · @{pinned.name} </Text>{pinned.text}
    </Text>
    {!!onUnpin && (
      <TouchableOpacity onPress={onUnpin} hitSlop={10} accessibilityRole="button" testID="chat-unpin">
        <Ionicons name="close" size={16} color={live.inkDim} />
      </TouchableOpacity>
    )}
  </View>
);

const LiveChat = ({
  messages, draft, onChangeDraft, onSend, style, pinned, onUnpin, onPressMessage, muted,
  // How tall the message list may grow (landscape passes the room it has; 0
  // = composer only, when the keyboard leaves no room for messages).
  listMaxHeight = 200,
}) => {
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
      {!!pinned?.text && <PinnedRow pinned={pinned} label={t('live.pinnedLabel')} onUnpin={onUnpin} />}
      {listMaxHeight > 0 && <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        renderItem={({ item }) => <ChatRow item={item} hostLabel={t('live.hostBadge')} onPress={onPressMessage} />}
        showsVerticalScrollIndicator={false}
        style={[styles.list, { maxHeight: listMaxHeight }]}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />}
      {muted ? (
        // Muted by the host: said plainly, instead of messages that vanish.
        <View style={[styles.composer, styles.mutedBox]} testID="chat-muted">
          <Ionicons name="volume-mute-outline" size={16} color={live.inkDim} />
          <Text style={styles.mutedText}>{t('live.youAreMuted')}</Text>
        </View>
      ) : (
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
      )}
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
  systemRow: { backgroundColor: 'rgba(6,13,26,0.25)', borderColor: 'transparent' },
  systemText: { fontSize: 11.5, color: live.inkDim, fontStyle: 'italic' },
  pinned: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 6, borderRadius: radius.md,
    backgroundColor: 'rgba(10,27,51,0.85)', borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
  },
  pinnedText: { flex: 1, fontSize: 12, color: '#EAF0F7' },
  mutedBox: { paddingVertical: 10, paddingHorizontal: spacing.sm },
  mutedText: { flex: 1, fontSize: 12.5, color: live.inkDim },
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
