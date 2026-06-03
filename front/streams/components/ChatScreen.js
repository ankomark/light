import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, Image,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  AppState,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchMessages, sendMessage, markConversationRead } from '../services/api';
import { useAuth } from '../context/useAuth';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const POLL_MS = 3000;

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const ChatScreen = ({ route, navigation }) => {
  const { conversationId, otherUser } = route.params;
  const { currentUser } = useAuth();

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');

  const listRef = useRef(null);
  const pollRef = useRef(null);
  const appState = useRef(AppState.currentState);
  const lastCountRef = useRef(0);
  const isFocused = useRef(true);

  const loadMessages = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchMessages(conversationId);
      if (Array.isArray(data)) {
        setMessages(data);
        // Only auto-scroll if new messages arrived
        if (data.length !== lastCountRef.current) {
          lastCountRef.current = data.length;
          setTimeout(() => listRef.current?.scrollToEnd({ animated: !silent }), 80);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  // Mark messages read when screen opens or gets focus
  const markRead = useCallback(() => {
    markConversationRead(conversationId).catch(() => {});
  }, [conversationId]);

  useFocusEffect(
    useCallback(() => {
      isFocused.current = true;
      loadMessages();
      markRead();
      pollRef.current = setInterval(() => loadMessages(true), POLL_MS);

      const sub = AppState.addEventListener('change', next => {
        if (next === 'active' && appState.current !== 'active' && isFocused.current) {
          loadMessages(true);
          markRead();
          pollRef.current = setInterval(() => loadMessages(true), POLL_MS);
        }
        if (next !== 'active') {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        appState.current = next;
      });

      return () => {
        isFocused.current = false;
        clearInterval(pollRef.current);
        sub.remove();
      };
    }, [loadMessages, markRead])
  );

  const handleSend = useCallback(async () => {
    const content = text.trim();
    if (!content || sending) return;

    // Optimistic insert
    const tempId = `temp_${Date.now()}`;
    const optimistic = {
      id: tempId,
      sender: { id: currentUser?.id, username: currentUser?.username, profile_picture: null },
      content,
      read: false,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, optimistic]);
    setText('');
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const saved = await sendMessage(conversationId, content);
      setMessages(prev => prev.map(m => m.id === tempId ? saved : m));
    } catch {
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setText(content); // restore text
    } finally {
      setSending(false);
    }
  }, [text, sending, conversationId, currentUser]);

  const renderMessage = useCallback(({ item, index }) => {
    const isOwn = item.sender?.id === currentUser?.id;
    const showAvatar = !isOwn && (index === 0 || messages[index - 1]?.sender?.id !== item.sender?.id);

    return (
      <View style={[styles.msgRow, isOwn ? styles.msgRowOwn : styles.msgRowOther]}>
        {!isOwn && (
          <View style={styles.avatarPlaceholder}>
            {showAvatar && (
              <Image
                source={item.sender?.profile_picture
                  ? { uri: item.sender.profile_picture }
                  : DEFAULT_AVATAR}
                defaultSource={DEFAULT_AVATAR}
                style={styles.msgAvatar}
              />
            )}
          </View>
        )}
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
          <Text style={[styles.bubbleText, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther]}>
            {item.content}
          </Text>
          <Text style={[styles.bubbleTime, isOwn ? styles.bubbleTimeOwn : styles.bubbleTimeOther]}>
            {formatTime(item.created_at)}
            {isOwn && (
              <Text> {item.read ? ' ✓✓' : ' ✓'}</Text>
            )}
          </Text>
        </View>
      </View>
    );
  }, [currentUser?.id, messages]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {/* Header */}
      <LinearGradient colors={[colors.surface, colors.bg]} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Image
          source={otherUser?.profile_picture
            ? { uri: otherUser.profile_picture }
            : DEFAULT_AVATAR}
          defaultSource={DEFAULT_AVATAR}
          style={styles.headerAvatar}
        />
        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>{otherUser?.username ?? 'Chat'}</Text>
        </View>
      </LinearGradient>

      {/* Messages */}
      {loading && messages.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => item.id.toString()}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                Say hello to {otherUser?.username} 👋
              </Text>
            </View>
          }
        />
      )}

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Message..."
          placeholderTextColor={colors.placeholder}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={1000}
          returnKeyType="default"
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
          activeOpacity={0.8}
        >
          {sending
            ? <ActivityIndicator size="small" color={colors.white} />
            : <Ionicons name="send" size={18} color={colors.white} />
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl + spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backBtn: { marginRight: spacing.xs },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
  },
  headerInfo: { flex: 1 },
  headerName: { ...typography.h3, color: colors.textPrimary },
  listContent: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    flexGrow: 1,
  },
  msgRow: {
    flexDirection: 'row',
    marginVertical: 2,
    alignItems: 'flex-end',
  },
  msgRowOwn: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  avatarPlaceholder: { width: 30, marginRight: spacing.xs },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  bubble: {
    maxWidth: '75%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    ...shadows.sm,
  },
  bubbleOwn: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.xs ?? 3,
  },
  bubbleOther: {
    backgroundColor: colors.card,
    borderBottomLeftRadius: radius.xs ?? 3,
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextOwn: { color: colors.white },
  bubbleTextOther: { color: colors.textPrimary },
  bubbleTime: { fontSize: 10, marginTop: 3 },
  bubbleTimeOwn: { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  bubbleTimeOther: { color: colors.textMuted },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyText: { ...typography.body, color: colors.textMuted },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 4,
    color: colors.textPrimary,
    fontSize: 15,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  sendBtnDisabled: { opacity: 0.4 },
});

export default ChatScreen;
