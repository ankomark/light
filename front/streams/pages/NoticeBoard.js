// The notice board: official announcements from the leadership, pinned ones
// first. Opens on the last board seen (memory, then disk) and refreshes in
// place — a first-ever open shows notice-shaped placeholders, never a spinner
// — and loads 20 at a time as you scroll. Anyone can send the admins a
// private note; admins post notices and read the notes.
import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, Switch,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  fetchNotices, createNotice, deleteNotice,
  createAdminNote, fetchAdminNotes, markAdminNoteRead, deleteAdminNote,
} from '../services/api';
import { useAuth } from '../context/useAuth';
import { useI18n } from '../context/I18nContext';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { confirmAction, notify } from '../utils/adminConfirm';
import { NoticeListSkeleton } from '../components/SkeletonLoader';
import { colors, typography, spacing, radius } from '../constants/theme';

// Calm, not bright: smoked glass cards and the warm accent (no light blue).
const GLASS = 'rgba(8,12,18,0.62)';
const GLASS_EDGE = 'rgba(255,255,255,0.09)';

const formatDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const NoticeCard = memo(({ item, onDelete, t }) => (
  <View style={[styles.card, item.is_pinned && styles.cardPinned]} testID={`notice-${item.id}`}>
    {item.is_pinned && (
      <View style={styles.pinnedTag}>
        <MaterialCommunityIcons name="pin" size={12} color={colors.accent} />
        <Text style={styles.pinnedText}>{t('notice.pinned')}</Text>
      </View>
    )}
    <View style={styles.cardHeader}>
      <Text style={styles.cardTitle}>{item.title}</Text>
      {item.can_manage && (
        <TouchableOpacity onPress={() => onDelete(item)} hitSlop={8} accessibilityLabel={t('common.delete')}
          testID={`notice-delete-${item.id}`}>
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </TouchableOpacity>
      )}
    </View>
    <Text style={styles.cardBody} selectable>{item.body}</Text>
    <View style={styles.cardFooter}>
      <MaterialCommunityIcons name="account-circle-outline" size={14} color={colors.textMuted} />
      <Text style={styles.cardMeta}>
        {item.created_by_username || t('notice.leadership')} · {formatDate(item.created_at)}
      </Text>
    </View>
  </View>
));
NoticeCard.displayName = 'NoticeCard';

const NoticeBoard = () => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const insets = useSafeAreaInsets();
  const isAdmin = !!currentUser?.is_staff;

  const cacheKey = userKey(currentUser?.id, 'notices');
  const [notices, setNotices] = useState(() => peekCache(cacheKey)?.results ?? []);
  const [loading, setLoading] = useState(() => !peekCache(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);
  const moreRef = useRef(false);
  const freshRef = useRef(false);

  const [composeVisible, setComposeVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [posting, setPosting] = useState(false);

  // Private note to admins (any user can write; only admins can read).
  const [noteVisible, setNoteVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [sendingNote, setSendingNote] = useState(false);

  // Admin inbox of received notes.
  const [inboxVisible, setInboxVisible] = useState(false);
  const [inboxNotes, setInboxNotes] = useState([]);
  const [inboxLoading, setInboxLoading] = useState(false);

  // Cold start: the disk copy, if the network hasn't answered first.
  useEffect(() => {
    if (peekCache(cacheKey)) return undefined;
    let cancelled = false;
    readCache(cacheKey).then((disk) => {
      if (cancelled || freshRef.current || !disk?.results?.length) return;
      setNotices(disk.results);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  // Page 1 replaces the board (and is what the next open paints).
  const load = useCallback(async () => {
    try {
      const res = await fetchNotices(1);
      const rows = res?.results ?? (Array.isArray(res) ? res : []);
      freshRef.current = true;
      setNotices(rows);
      setFailed(false);
      pageRef.current = 1;
      moreRef.current = !!res?.next;
      writeCache(cacheKey, { results: rows });
    } catch {
      setFailed(true);   // what's on screen stays
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey]);

  useEffect(() => { load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !moreRef.current) return;
    setLoadingMore(true);
    try {
      const res = await fetchNotices(pageRef.current + 1);
      pageRef.current += 1;
      moreRef.current = !!res?.next;
      setNotices((prev) => {
        const have = new Set(prev.map((n) => n.id));
        return [...prev, ...(res?.results ?? []).filter((n) => !have.has(n.id))];
      });
    } catch { /* scrolling again retries */ } finally { setLoadingMore(false); }
  }, [loadingMore]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const resetCompose = () => { setTitle(''); setBody(''); setPinned(false); };

  const handlePost = async () => {
    if (!title.trim() || !body.trim()) {
      notify(t('dir.missingInfo'), t('notice.missingInfo'));
      return;
    }
    try {
      setPosting(true);
      await createNotice({ title: title.trim(), body: body.trim(), is_pinned: pinned });
      setComposeVisible(false);
      resetCompose();
      await load();
    } catch (error) {
      const msg = error?.response?.status === 403
        ? t('notice.adminsOnly')
        : (error?.response?.data?.detail || t('notice.postFailed'));
      notify(t('common.error'), msg);
    } finally {
      setPosting(false);
    }
  };

  const handleSendNote = async () => {
    if (!noteText.trim()) {
      notify(t('notice.emptyNoteTitle'), t('notice.emptyNoteBody'));
      return;
    }
    try {
      setSendingNote(true);
      await createAdminNote(noteText.trim());
      setNoteVisible(false);
      setNoteText('');
      notify(t('notice.sentTitle'), t('notice.sentBody'));
    } catch (error) {
      notify(t('common.error'), error?.response?.data?.detail || t('notice.sendNoteFailed'));
    } finally {
      setSendingNote(false);
    }
  };

  const openInbox = async () => {
    setInboxVisible(true);
    setInboxLoading(true);
    try {
      const data = await fetchAdminNotes();
      setInboxNotes(Array.isArray(data) ? data : []);
    } catch {
      notify(t('common.error'), t('notice.loadNotesFailed'));
    } finally {
      setInboxLoading(false);
    }
  };

  const handleToggleNoteRead = async (note) => {
    const next = !note.is_read;
    setInboxNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, is_read: next } : n)));
    try {
      await markAdminNoteRead(note.id, next);
    } catch {
      setInboxNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, is_read: !next } : n)));
    }
  };

  // Web-safe confirms (Alert's buttons never fire on web).
  const handleDeleteNote = async (note) => {
    const ok = await confirmAction({
      title: t('notice.deleteNoteTitle'), message: t('notice.deleteNoteBody'),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    const prev = inboxNotes;
    setInboxNotes((cur) => cur.filter((n) => n.id !== note.id));
    try {
      await deleteAdminNote(note.id);
    } catch {
      setInboxNotes(prev);
      notify(t('common.error'), t('notice.deleteNoteFailed'));
    }
  };

  const handleDelete = useCallback(async (item) => {
    const ok = await confirmAction({
      title: t('notice.deleteNoticeTitle'), message: t('notice.deleteNoticeConfirm', { title: item.title }),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    try {
      await deleteNotice(item.id);
      setNotices((prev) => {
        const next = prev.filter((n) => n.id !== item.id);
        writeCache(cacheKey, { results: next });
        return next;
      });
    } catch {
      notify(t('common.error'), t('notice.deleteNoticeFailed'));
    }
  }, [t, cacheKey]);

  const renderItem = useCallback(({ item }) => <NoticeCard item={item} onDelete={handleDelete} t={t} />, [handleDelete, t]);

  return (
    <View style={styles.root}>
      <FlatList
        data={notices}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, { paddingBottom: spacing.xxl * 2 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.intro}>
              <MaterialCommunityIcons name="bullhorn-variant-outline" size={20} color={colors.accent} />
              <Text style={styles.introText}>
                {t('notice.intro')}{isAdmin ? ` ${t('notice.tapToPost')}` : ''}
              </Text>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setNoteVisible(true)} activeOpacity={0.85}>
                <MaterialCommunityIcons name="email-edit-outline" size={18} color={colors.accent} />
                <Text style={styles.actionBtnText}>{t('notice.noteToAdmins')}</Text>
              </TouchableOpacity>
              {isAdmin && (
                <TouchableOpacity style={styles.actionBtn} onPress={openInbox} activeOpacity={0.85}>
                  <MaterialCommunityIcons name="inbox-arrow-down-outline" size={18} color={colors.accent} />
                  <Text style={styles.actionBtnText}>{t('notice.adminInbox')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={styles.more} /> : null}
        ListEmptyComponent={
          loading ? <NoticeListSkeleton count={4} /> : failed ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>{t('notice.loadFailed')}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }} testID="notices-retry">
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="bulletin-board" size={56} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>{t('notice.none')}</Text>
              <Text style={styles.emptySub}>{isAdmin ? t('notice.postFirst') : t('notice.checkBack')}</Text>
            </View>
          )
        }
      />

      {isAdmin && (
        <TouchableOpacity style={[styles.fab, { bottom: spacing.lg + insets.bottom }]} onPress={() => setComposeVisible(true)}
          activeOpacity={0.85} accessibilityLabel={t('notice.new')} testID="notice-compose">
          <Ionicons name="add" size={28} color="#0A1628" />
        </TouchableOpacity>
      )}

      {/* Compose (admins only) */}
      <Modal visible={composeVisible} animationType="slide" transparent onRequestClose={() => setComposeVisible(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalSheet, { paddingBottom: spacing.md + insets.bottom }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('notice.new')}</Text>
              <TouchableOpacity onPress={() => { setComposeVisible(false); resetCompose(); }} accessibilityLabel={t('common.close')}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <TextInput style={styles.input} placeholder={t('notice.titlePlaceholder')} placeholderTextColor={colors.placeholder}
                value={title} onChangeText={setTitle} maxLength={200} testID="notice-title" />
              <TextInput style={[styles.input, styles.bodyInput]} placeholder={t('notice.bodyPlaceholder')}
                placeholderTextColor={colors.placeholder} value={body} onChangeText={setBody} multiline
                textAlignVertical="top" testID="notice-body" />
              <View style={styles.pinRow}>
                <View style={styles.pinLabelWrap}>
                  <MaterialCommunityIcons name="pin-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.pinLabel}>{t('notice.pinToTop')}</Text>
                </View>
                <Switch value={pinned} onValueChange={setPinned}
                  trackColor={{ false: 'rgba(255,255,255,0.15)', true: colors.accent }} thumbColor={colors.white} />
              </View>
              <TouchableOpacity style={[styles.postButton, posting && styles.postButtonDisabled]} onPress={handlePost}
                disabled={posting} activeOpacity={0.85} testID="notice-post">
                {posting ? <ActivityIndicator color="#0A1628" /> : (
                  <>
                    <Ionicons name="megaphone-outline" size={18} color="#0A1628" />
                    <Text style={styles.postButtonText}>{t('notice.post')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Note to admins (any signed-in user) */}
      <Modal visible={noteVisible} animationType="slide" transparent onRequestClose={() => setNoteVisible(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalSheet, { paddingBottom: spacing.md + insets.bottom }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('notice.noteToAdmins')}</Text>
              <TouchableOpacity onPress={() => { setNoteVisible(false); setNoteText(''); }} accessibilityLabel={t('common.close')}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.privacyHint}>
                <MaterialCommunityIcons name="lock-outline" size={16} color={colors.textMuted} />
                <Text style={styles.privacyHintText}>{t('notice.privateHint')}</Text>
              </View>
              <TextInput style={[styles.input, styles.bodyInput]} placeholder={t('notice.notePlaceholder')}
                placeholderTextColor={colors.placeholder} value={noteText} onChangeText={setNoteText} multiline
                textAlignVertical="top" maxLength={2000} testID="note-body" />
              <TouchableOpacity style={[styles.postButton, sendingNote && styles.postButtonDisabled]} onPress={handleSendNote}
                disabled={sendingNote} activeOpacity={0.85} testID="note-send">
                {sendingNote ? <ActivityIndicator color="#0A1628" /> : (
                  <>
                    <Ionicons name="send-outline" size={18} color="#0A1628" />
                    <Text style={styles.postButtonText}>{t('notice.sendToAdmins')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Admin inbox of received notes (admins only) */}
      <Modal visible={inboxVisible} animationType="slide" transparent onRequestClose={() => setInboxVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, styles.inboxSheet, { paddingBottom: spacing.md + insets.bottom }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('notice.notesFromUsers')}</Text>
              <TouchableOpacity onPress={() => setInboxVisible(false)} accessibilityLabel={t('common.close')}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {inboxLoading ? <NoticeListSkeleton count={3} /> : (
              <FlatList
                data={inboxNotes}
                keyExtractor={(item) => item.id.toString()}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.inboxList}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <MaterialCommunityIcons name="email-open-outline" size={48} color={colors.textMuted} />
                    <Text style={styles.emptyTitle}>{t('notice.noNotes')}</Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={[styles.noteCard, !item.is_read && styles.noteCardUnread]}>
                    <Text style={styles.noteBody} selectable>{item.body}</Text>
                    <View style={styles.cardFooter}>
                      <MaterialCommunityIcons name="account-circle-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.cardMeta}>{item.sender_username || t('notice.unknownSender')} · {formatDate(item.created_at)}</Text>
                    </View>
                    <View style={styles.noteActions}>
                      <TouchableOpacity style={styles.noteActionBtn} onPress={() => handleToggleNoteRead(item)}>
                        <MaterialCommunityIcons name={item.is_read ? 'email-outline' : 'email-open-outline'} size={16} color={colors.accent} />
                        <Text style={styles.noteActionText}>{item.is_read ? t('notice.markUnread') : t('notice.markRead')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.noteActionBtn} onPress={() => handleDeleteNote(item)}>
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                        <Text style={[styles.noteActionText, styles.dangerText]}>{t('common.delete')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.md, width: '100%', maxWidth: 820, alignSelf: 'center' },
  more: { marginVertical: spacing.md },

  intro: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: GLASS,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: GLASS_EDGE,
    padding: spacing.md, marginBottom: spacing.md,
  },
  introText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },

  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: GLASS, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.35)',
    borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
  },
  actionBtnText: { ...typography.caption, color: colors.accent, fontWeight: '700' },

  privacyHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  privacyHintText: { ...typography.caption, color: colors.textMuted, flex: 1 },

  noteCard: {
    backgroundColor: GLASS, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_EDGE, padding: spacing.md, marginBottom: spacing.md,
  },
  noteCardUnread: { borderColor: 'rgba(244,162,97,0.55)' },
  noteBody: { ...typography.body, color: colors.textPrimary },
  noteActions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  noteActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  noteActionText: { ...typography.caption, color: colors.accent, fontWeight: '600' },
  dangerText: { color: colors.error },

  card: {
    backgroundColor: GLASS, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
    borderColor: GLASS_EDGE, padding: spacing.md, marginBottom: spacing.md,
  },
  cardPinned: { borderColor: 'rgba(244,162,97,0.55)', backgroundColor: 'rgba(24,18,12,0.7)' },
  pinnedTag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: spacing.xs },
  pinnedText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  cardBody: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.md },
  cardMeta: { ...typography.caption, color: colors.textMuted },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.md, textAlign: 'center' },
  emptySub: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center', paddingHorizontal: spacing.lg },
  retryBtn: { marginTop: spacing.md, backgroundColor: colors.accent, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: '#0A1628', fontWeight: '800' },

  fab: {
    position: 'absolute', right: spacing.lg, width: 56, height: 56, borderRadius: radius.full,
    backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center', elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#0B1119', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.md, maxHeight: '88%', width: '100%', maxWidth: 720, alignSelf: 'center',
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.3)',
  },
  inboxSheet: { maxHeight: '88%' },
  inboxList: { paddingBottom: spacing.xl },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: spacing.md },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.md, padding: spacing.md, color: colors.textPrimary, fontSize: 15, marginBottom: spacing.md,
  },
  bodyInput: { minHeight: 140 },
  pinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  pinLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pinLabel: { ...typography.body, color: colors.textPrimary },
  postButton: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.accent, height: 52, borderRadius: radius.md, marginBottom: spacing.md,
  },
  postButtonDisabled: { opacity: 0.6 },
  postButtonText: { ...typography.button, color: '#0A1628', fontSize: 16, fontWeight: '800' },
});

export default NoticeBoard;
