// Messages: the chats, freshest first — Primary, Requests (from people you
// don't follow, until you accept) and Archived — with a search over names
// and words. Painted from the last list seen, then kept live off the DM
// socket (new messages bubble up, typing shows in the row, the green dot is
// who's online); a slow poll behind it, a quick one while the socket's down.
// Long-press a chat: mute, archive, delete.
import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, AppState, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchConversations, fetchConversationsByUrl, fetchUnreadMessageCount, setConversationState,
} from '../services/api';
import { subscribeDM, isDMOpen, announceDM } from '../services/dmSocket';
import { useAuth } from '../context/useAuth';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { shortAgo, previewText } from '../utils/dmView';
import { confirmAction, notify } from '../utils/adminConfirm';
import { PersonListSkeleton } from './SkeletonLoader';
import ChoiceSheet from './ChoiceSheet';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
const FOLDERS = ['primary', 'requests', 'archived'];
const POLL_LIVE_MS = 60000;   // the socket tells us; this only catches up
const POLL_MS = 15000;        // no socket: ask more often

// Memoised: rows whose chat didn't change skip their render.
const ConversationItem = memo(({ item, onPress, onLongPress, meId, typing, t }) => {
  const other = item.other_participant;
  const hasUnread = item.unread_count > 0;
  return (
    <TouchableOpacity style={styles.item} onPress={() => onPress(item)} onLongPress={() => onLongPress(item)}
      activeOpacity={0.8} testID={`chat-row-${item.id}`} accessibilityRole="button"
      accessibilityLabel={other?.username}>
      <View style={styles.avatarWrap}>
        <Image source={other?.profile_picture ? { uri: other.profile_picture } : DEFAULT_AVATAR}
          placeholder={DEFAULT_AVATAR} contentFit="cover" transition={150} style={styles.avatar} />
        {item.online ? <View style={styles.onlineDot} testID={`online-${item.id}`} /> : null}
      </View>
      <View style={styles.itemBody}>
        <View style={styles.itemTop}>
          <Text style={[styles.name, hasUnread && styles.nameBold]} numberOfLines={1}>
            {other?.username ?? t('dm.unknown')}
          </Text>
          {item.muted ? <Ionicons name="notifications-off" size={13} color={colors.textMuted} style={styles.muted} /> : null}
          <Text style={[styles.time, hasUnread && styles.timeUnread]}>
            {shortAgo(t, item.last_message?.created_at || item.updated_at)}
          </Text>
        </View>
        <View style={styles.itemBottom}>
          <Text style={[styles.preview, hasUnread && styles.previewBold, typing && styles.typing,
            item.last_message?.is_deleted && styles.italic]} numberOfLines={1}>
            {typing ? t('dm.typing') : previewText(t, item.last_message, meId)}
          </Text>
          {hasUnread && (
            <View style={[styles.badge, item.muted && styles.badgeMuted]}>
              <Text style={styles.badgeText}>{item.unread_count > 9 ? '9+' : item.unread_count}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
});
ConversationItem.displayName = 'ConversationItem';

// Primary keeps the old key, so the first open after an update still paints.
const inboxCacheKey = (userId, folder = 'primary') => userKey(userId, folder === 'primary' ? 'inbox' : `inbox:${folder}`);

const InboxScreen = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const meId = currentUser?.id;
  const [folder, setFolder] = useState('primary');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');            // the query, once they pause
  const searching = q.length > 0;
  const cacheKey = inboxCacheKey(meId, folder);
  // Paint the last list we saw — synchronously when this session has it,
  // from disk otherwise (below) — then refresh it in place.
  const [conversations, setConversations] = useState(() => peekCache(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => !peekCache(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);
  const [requests, setRequests] = useState(0);
  const [typingIn, setTypingIn] = useState({});   // conversation id → true
  const [menuFor, setMenuFor] = useState(null);
  const appState = useRef(AppState.currentState);
  const pollRef = useRef(null);
  const conversationsRef = useRef(conversations);
  const cursorSetRef = useRef(false);
  const viewRef = useRef({ folder, q });
  const typingTimers = useRef({});
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  // Pause, then search.
  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  // Another folder or search: its cached list (if any) at once.
  useEffect(() => {
    viewRef.current = { folder, q };
    cursorSetRef.current = false;
    setNextUrl(null);
    if (q) { setLoading(true); return undefined; }
    const cached = peekCache(cacheKey);
    setConversations(cached ?? []);
    setLoading(!cached);
    let cancelled = false;
    if (!cached) {
      readCache(cacheKey).then((disk) => {
        if (cancelled || !Array.isArray(disk) || !disk.length) return;
        setConversations((prev) => (prev.length ? prev : disk));
        setLoading(false);
      });
    }
    return () => { cancelled = true; };
  }, [cacheKey, folder, q]);

  const put = useCallback((next) => {
    // Only the plain lists are kept (not a search): what the next open paints.
    if (!viewRef.current.q) writeCache(inboxCacheKey(meId, viewRef.current.folder), next.slice(0, 20));
  }, [meId]);

  // Refresh: page 1 replaces the list. Silent: page 1 merged over it (older
  // pages kept), so new activity bubbles up without losing the scroll.
  const load = useCallback(async (silent = false) => {
    const view = { ...viewRef.current };
    try {
      if (!silent) setLoading(true);
      const [res, counts] = await Promise.all([
        fetchConversations({ folder: view.folder, q: view.q }),
        fetchUnreadMessageCount().catch(() => null),
      ]);
      if (viewRef.current.folder !== view.folder || viewRef.current.q !== view.q) return; // they moved on
      if (counts) setRequests(counts.requests || 0);
      const page1 = res?.results ?? (Array.isArray(res) ? res : []);
      setConversations((prev) => {
        if (!silent || view.q) return page1;
        const ids = new Set(page1.map((c) => c.id));
        return [...page1, ...prev.filter((c) => !ids.has(c.id))];
      });
      if (!view.q) writeCache(inboxCacheKey(meId, view.folder), page1);
      if (!silent || !cursorSetRef.current) {
        cursorSetRef.current = true;
        setNextUrl(res?.next ?? null);
      }
    } catch {
      // the list stays; pull to refresh recovers
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [meId]);

  // A new folder or search (the first open is the focus effect's).
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    load(false);
  }, [folder, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (loadingMore || !nextUrl) return;
    setLoadingMore(true);
    try {
      const res = await fetchConversationsByUrl(nextUrl);
      setConversations((prev) => {
        const have = new Set(prev.map((c) => c.id));
        return [...prev, ...(res?.results ?? []).filter((c) => !have.has(c.id))];
      });
      setNextUrl(res?.next ?? null);
    } catch {
      // silent — pull-to-refresh recovers
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextUrl]);

  // Live: a message moves its chat to the top (or brings a new one in),
  // typing shows in the row, the dot follows who's online.
  useEffect(() => {
    const timers = typingTimers.current;
    const soon = { id: null };
    const reloadSoon = () => { clearTimeout(soon.id); soon.id = setTimeout(() => load(true), 400); };
    const unsub = subscribeDM((e) => {
      if (e.type === 'status') {
        clearInterval(pollRef.current);
        pollRef.current = setInterval(() => load(true), e.open ? POLL_LIVE_MS : POLL_MS);
        if (e.open) load(true);
        return;
      }
      const cid = e.conversation_id;
      if (e.type === 'message') {
        const m = e.message || {};
        const mine = (m.sender?.id ?? m.sender_id) === meId;
        const have = conversationsRef.current.find((c) => c.id === cid);
        if (!have || viewRef.current.q) { reloadSoon(); return; }
        if (viewRef.current.folder === 'archived') { reloadSoon(); return; } // a message brings it back
        setTypingIn((prev) => ({ ...prev, [cid]: false }));
        setConversations((prev) => {
          const row = prev.find((c) => c.id === cid);
          const updated = {
            ...row,
            updated_at: m.created_at,
            last_message: { id: m.id, content: m.content, message_type: m.message_type, file_name: m.file_name,
              sender_id: m.sender?.id, created_at: m.created_at, is_deleted: !!m.is_deleted },
            unread_count: mine ? row.unread_count : (row.unread_count || 0) + 1,
          };
          const next = [updated, ...prev.filter((c) => c.id !== cid)];
          put(next);
          return next;
        });
      } else if (e.type === 'deleted') {
        setConversations((prev) => prev.map((c) => (c.id === cid && c.last_message?.id === e.id
          ? { ...c, last_message: { ...c.last_message, content: '', is_deleted: true } } : c)));
      } else if (e.type === 'edited') {
        setConversations((prev) => prev.map((c) => (c.id === cid && c.last_message?.id === e.message?.id
          ? { ...c, last_message: { ...c.last_message, content: e.message.content } } : c)));
      } else if (e.type === 'read' && e.reader_id === meId) {
        setConversations((prev) => prev.map((c) => (c.id === cid ? { ...c, unread_count: 0 } : c)));
      } else if (e.type === 'presence') {
        setConversations((prev) => prev.map((c) => (c.other_participant?.id === e.user_id && !!c.online !== !!e.online
          ? { ...c, online: e.online } : c)));
      } else if (e.type === 'typing') {
        clearTimeout(timers[cid]);
        setTypingIn((prev) => ({ ...prev, [cid]: !!e.is_typing }));
        // A dropped "stopped typing" can't leave it on.
        if (e.is_typing) timers[cid] = setTimeout(() => setTypingIn((prev) => ({ ...prev, [cid]: false })), 6000);
      } else if (e.type === 'state') {
        reloadSoon();
      }
    });
    return () => {
      unsub();
      clearTimeout(soon.id);
      Object.values(timers).forEach(clearTimeout);
    };
  }, [load, meId, put]);

  useFocusEffect(
    useCallback(() => {
      load(conversationsRef.current.length > 0); // keep the list visible while refreshing on re-focus
      pollRef.current = setInterval(() => load(true), isDMOpen() ? POLL_LIVE_MS : POLL_MS);
      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'active' && appState.current !== 'active') load(true);
        appState.current = next;
      });
      return () => {
        clearInterval(pollRef.current);
        pollRef.current = null;
        sub.remove();
      };
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const openChat = useCallback((conversation) => {
    // The chat marks itself read as it opens: clear the badge now.
    if (conversation.unread_count > 0) {
      setConversations((prev) => {
        const next = prev.map((c) => (c.id === conversation.id ? { ...c, unread_count: 0 } : c));
        put(next);
        return next;
      });
    }
    navigation.navigate('Chat', {
      conversationId: conversation.id,
      otherUser: conversation.other_participant,
      isRequest: !!conversation.is_request,
      muted: !!conversation.muted,
      archived: !!conversation.archived,
    });
  }, [navigation, put]);

  // Long-press: mute, archive, delete (for me).
  const change = useCallback(async (conv, changes, { leaves } = {}) => {
    const before = conversationsRef.current;
    setConversations((prev) => (leaves ? prev.filter((c) => c.id !== conv.id)
      : prev.map((c) => (c.id === conv.id ? { ...c, ...changes } : c))));
    try {
      await setConversationState(conv.id, changes);
      announceDM({ type: 'state', conversation_id: conv.id });
    } catch {
      setConversations(before);
      notify(t('dm.actionFailed'));
    }
  }, [t]);

  const menuOptions = menuFor ? [
    { key: 'mute', icon: menuFor.muted ? 'notifications' : 'notifications-off',
      label: menuFor.muted ? t('dm.unmute') : t('dm.mute'),
      onPress: () => change(menuFor, { muted: !menuFor.muted }) },
    ...(menuFor.is_request ? [] : [{ key: 'archive', icon: menuFor.archived ? 'unarchive' : 'archive',
      label: menuFor.archived ? t('dm.unarchive') : t('dm.archive'),
      onPress: () => change(menuFor, { archived: !menuFor.archived }, { leaves: !searching }) }]),
    { key: 'delete', icon: 'delete-outline', destructive: true, label: t('dm.deleteChat'),
      onPress: async () => {
        const ok = await confirmAction({ title: t('dm.deleteChatTitle'), message: t('dm.deleteChatBody'),
          confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), destructive: true });
        if (ok) change(menuFor, { clear: true }, { leaves: true });
      } },
  ] : [];

  const renderItem = useCallback(
    ({ item }) => (
      <ConversationItem item={item} onPress={openChat} onLongPress={setMenuFor} meId={meId}
        typing={!!typingIn[item.id]} t={t} />
    ),
    [openChat, meId, typingIn, t]
  );

  const emptyText = searching ? t('dm.noResults')
    : folder === 'requests' ? t('dm.noRequests')
      : folder === 'archived' ? t('dm.noArchived') : t('inbox.empty');

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Ionicons name="chatbubble-ellipses" size={18} color={colors.accent} />
        <Text style={styles.headerTitle}>{t('inbox.title')}</Text>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput value={query} onChangeText={setQuery} placeholder={t('dm.searchChats')}
          placeholderTextColor={colors.textMuted} style={styles.searchInput} returnKeyType="search"
          autoCorrect={false} autoCapitalize="none" testID="inbox-search" />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={10} accessibilityLabel={t('common.clear')}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {FOLDERS.map((f) => {
          const on = folder === f;
          return (
            <TouchableOpacity key={f} style={[styles.tab, on && styles.tabOn]} onPress={() => setFolder(f)}
              accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`folder-${f}`}>
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t(`dm.folder.${f}`)}</Text>
              {f === 'requests' && requests > 0 ? (
                <View style={styles.tabCount}><Text style={styles.tabCountText}>{requests > 99 ? '99+' : requests}</Text></View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
      {folder === 'requests' && !searching ? <Text style={styles.folderNote}>{t('dm.requestsNote')}</Text> : null}

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        extraData={typingIn}
        contentContainerStyle={[styles.listContent, conversations.length === 0 && styles.emptyContent]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? <ActivityIndicator size="small" color={colors.accent} style={styles.more} /> : null}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" colors={[colors.accent]} />}
        ListEmptyComponent={
          // Nothing cached yet: rows that are about to fill in, not a spinner.
          loading ? <PersonListSkeleton count={7} avatar={52} /> : (
            <View style={styles.emptyContainer}>
              <Ionicons name={searching ? 'search' : 'chatbubbles-outline'} size={56} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>{emptyText}</Text>
              {folder === 'primary' && !searching ? <Text style={styles.emptySubtext}>{t('dm.emptyHint')}</Text> : null}
            </View>
          )
        }
      />

      <ChoiceSheet visible={!!menuFor} title={menuFor?.other_participant?.username} options={menuOptions}
        onClose={() => setMenuFor(null)} cancelLabel={t('common.cancel')} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  titleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  headerTitle: { ...typography.h2, color: colors.textPrimary, fontWeight: '800' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginHorizontal: spacing.md, marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm, borderRadius: radius.full, backgroundColor: 'rgba(16,46,80,0.55)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)', minHeight: 40,
  },
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: spacing.xs, ...typography.body },
  tabs: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
  },
  tabOn: { backgroundColor: 'rgba(244,162,97,0.18)', borderColor: colors.accent },
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  tabTextOn: { color: colors.accent },
  tabCount: { backgroundColor: colors.accent, borderRadius: radius.full, minWidth: 18, paddingHorizontal: 5, alignItems: 'center' },
  tabCountText: { color: '#0A1628', fontSize: 11, fontWeight: '800' },
  folderNote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.md, marginBottom: spacing.sm },

  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, width: '100%', maxWidth: 820, alignSelf: 'center' },
  more: { marginVertical: 16 },
  item: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm, gap: spacing.sm, backgroundColor: 'rgba(16,46,80,0.55)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)', ...shadows.sm,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface,
    borderWidth: 1.5, borderColor: 'rgba(244,162,97,0.3)',
  },
  onlineDot: {
    position: 'absolute', bottom: 1, right: 1, width: 13, height: 13, borderRadius: 6.5,
    backgroundColor: colors.success || '#34C759', borderWidth: 2, borderColor: '#102E50',
  },
  itemBody: { flex: 1 },
  itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  name: { ...typography.label, color: colors.textPrimary, flex: 1, fontWeight: '600' },
  nameBold: { fontWeight: '800' },
  muted: { marginHorizontal: 4 },
  time: { ...typography.caption, color: colors.textMuted },
  timeUnread: { color: colors.accent, fontWeight: '700' },
  itemBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  preview: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  previewBold: { color: colors.textPrimary, fontWeight: '600' },
  typing: { color: colors.accent, fontStyle: 'italic' },
  italic: { fontStyle: 'italic' },
  badge: {
    backgroundColor: colors.accent, borderRadius: radius.full, minWidth: 20, height: 20,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5, marginLeft: spacing.xs,
  },
  badgeMuted: { backgroundColor: colors.textMuted },
  badgeText: { color: '#0A1628', fontSize: 11, fontWeight: '800' },
  emptyContent: { flexGrow: 1 },
  emptyContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl * 2, gap: spacing.sm,
  },
  emptyTitle: { ...typography.h3, color: colors.textSecondary, textAlign: 'center' },
  emptySubtext: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});

export default InboxScreen;
