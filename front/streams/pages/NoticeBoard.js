import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  fetchNotices,
  createNotice,
  deleteNotice,
  createAdminNote,
  fetchAdminNotes,
  markAdminNoteRead,
  deleteAdminNote,
} from '../services/api';
import { useAuth } from '../context/useAuth';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const formatDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const NoticeBoard = () => {
  const { currentUser } = useAuth();
  const isAdmin = !!currentUser?.is_staff;

  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const load = useCallback(async () => {
    try {
      const data = await fetchNotices();
      setNotices(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load notices:', error);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const resetCompose = () => {
    setTitle('');
    setBody('');
    setPinned(false);
  };

  const handlePost = async () => {
    if (!title.trim() || !body.trim()) {
      Alert.alert('Missing info', 'Please enter both a title and a message.');
      return;
    }
    try {
      setPosting(true);
      await createNotice({ title: title.trim(), body: body.trim(), is_pinned: pinned });
      setComposeVisible(false);
      resetCompose();
      await load();
    } catch (error) {
      const msg = error.response?.status === 403
        ? 'Only admins can post notices.'
        : (error.response?.data?.detail || 'Failed to post notice.');
      Alert.alert('Error', msg);
    } finally {
      setPosting(false);
    }
  };

  const handleSendNote = async () => {
    if (!noteText.trim()) {
      Alert.alert('Empty note', 'Please write your message to the admins.');
      return;
    }
    try {
      setSendingNote(true);
      await createAdminNote(noteText.trim());
      setNoteVisible(false);
      setNoteText('');
      Alert.alert('Sent', 'Your note has been delivered to the admins. Only they can read it.');
    } catch (error) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to send your note.');
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
    } catch (error) {
      console.error('Failed to load admin notes:', error);
      Alert.alert('Error', 'Failed to load notes.');
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

  const handleDeleteNote = (note) => {
    Alert.alert('Delete note', 'Remove this note from the inbox?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const prev = inboxNotes;
          setInboxNotes((cur) => cur.filter((n) => n.id !== note.id));
          try {
            await deleteAdminNote(note.id);
          } catch {
            setInboxNotes(prev);
            Alert.alert('Error', 'Failed to delete note.');
          }
        },
      },
    ]);
  };

  const handleDelete = (item) => {
    Alert.alert('Delete notice', `Remove “${item.title}”?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNotice(item.id);
            setNotices((prev) => prev.filter((n) => n.id !== item.id));
          } catch {
            Alert.alert('Error', 'Failed to delete notice.');
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }) => (
    <View style={[styles.card, item.is_pinned && styles.cardPinned]}>
      {item.is_pinned && (
        <View style={styles.pinnedTag}>
          <MaterialCommunityIcons name="pin" size={12} color={colors.accent} />
          <Text style={styles.pinnedText}>Pinned</Text>
        </View>
      )}

      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        {item.can_manage && (
          <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.cardBody}>{item.body}</Text>

      <View style={styles.cardFooter}>
        <MaterialCommunityIcons name="account-circle-outline" size={14} color={colors.textMuted} />
        <Text style={styles.cardMeta}>
          {item.created_by_username || 'Admin'} · {formatDate(item.created_at)}
        </Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={notices}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.intro}>
              <MaterialCommunityIcons name="bullhorn-variant-outline" size={20} color={colors.primary} />
              <Text style={styles.introText}>
                Official announcements from the leadership. {isAdmin ? 'Tap + to post a new notice.' : ''}
              </Text>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setNoteVisible(true)} activeOpacity={0.85}>
                <MaterialCommunityIcons name="email-edit-outline" size={18} color={colors.primary} />
                <Text style={styles.actionBtnText}>Note to admins</Text>
              </TouchableOpacity>

              {isAdmin && (
                <TouchableOpacity style={styles.actionBtn} onPress={openInbox} activeOpacity={0.85}>
                  <MaterialCommunityIcons name="inbox-arrow-down-outline" size={18} color={colors.primary} />
                  <Text style={styles.actionBtnText}>Admin inbox</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="bulletin-board" size={56} color={colors.border} />
            <Text style={styles.emptyTitle}>No notices yet</Text>
            <Text style={styles.emptySub}>
              {isAdmin ? 'Post the first notice with the + button.' : 'Check back soon for announcements.'}
            </Text>
          </View>
        }
      />

      {isAdmin && (
        <TouchableOpacity style={styles.fab} onPress={() => setComposeVisible(true)} activeOpacity={0.85}>
          <Ionicons name="add" size={28} color={colors.white} />
        </TouchableOpacity>
      )}

      {/* Compose modal (admins only) */}
      <Modal
        visible={composeVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setComposeVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Notice</Text>
              <TouchableOpacity onPress={() => { setComposeVisible(false); resetCompose(); }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <TextInput
                style={styles.input}
                placeholder="Title"
                placeholderTextColor={colors.placeholder}
                value={title}
                onChangeText={setTitle}
                maxLength={200}
              />
              <TextInput
                style={[styles.input, styles.bodyInput]}
                placeholder="Write the announcement..."
                placeholderTextColor={colors.placeholder}
                value={body}
                onChangeText={setBody}
                multiline
                textAlignVertical="top"
              />

              <View style={styles.pinRow}>
                <View style={styles.pinLabelWrap}>
                  <MaterialCommunityIcons name="pin-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.pinLabel}>Pin to top</Text>
                </View>
                <Switch
                  value={pinned}
                  onValueChange={setPinned}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                />
              </View>

              <TouchableOpacity
                style={[styles.postButton, posting && styles.postButtonDisabled]}
                onPress={handlePost}
                disabled={posting}
                activeOpacity={0.85}
              >
                {posting
                  ? <ActivityIndicator color={colors.white} />
                  : <>
                      <Ionicons name="megaphone-outline" size={18} color={colors.white} />
                      <Text style={styles.postButtonText}>Post Notice</Text>
                    </>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Note to admins (any signed-in user) */}
      <Modal
        visible={noteVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setNoteVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Note to admins</Text>
              <TouchableOpacity onPress={() => { setNoteVisible(false); setNoteText(''); }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.privacyHint}>
                <MaterialCommunityIcons name="lock-outline" size={16} color={colors.textMuted} />
                <Text style={styles.privacyHintText}>
                  This message is private — only admins can read it.
                </Text>
              </View>

              <TextInput
                style={[styles.input, styles.bodyInput]}
                placeholder="Write your message to the admins..."
                placeholderTextColor={colors.placeholder}
                value={noteText}
                onChangeText={setNoteText}
                multiline
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.postButton, sendingNote && styles.postButtonDisabled]}
                onPress={handleSendNote}
                disabled={sendingNote}
                activeOpacity={0.85}
              >
                {sendingNote
                  ? <ActivityIndicator color={colors.white} />
                  : <>
                      <Ionicons name="send-outline" size={18} color={colors.white} />
                      <Text style={styles.postButtonText}>Send to admins</Text>
                    </>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Admin inbox of received notes (admins only) */}
      <Modal
        visible={inboxVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setInboxVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '88%' }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Notes from users</Text>
              <TouchableOpacity onPress={() => setInboxVisible(false)}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {inboxLoading ? (
              <View style={{ paddingVertical: spacing.xxl }}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <FlatList
                data={inboxNotes}
                keyExtractor={(item) => item.id.toString()}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: spacing.xl }}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <MaterialCommunityIcons name="email-open-outline" size={48} color={colors.border} />
                    <Text style={styles.emptyTitle}>No notes yet</Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={[styles.noteCard, !item.is_read && styles.noteCardUnread]}>
                    <Text style={styles.noteBody}>{item.body}</Text>
                    <View style={styles.cardFooter}>
                      <MaterialCommunityIcons name="account-circle-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.cardMeta}>
                        {item.sender_username || 'Unknown'} · {formatDate(item.created_at)}
                      </Text>
                    </View>
                    <View style={styles.noteActions}>
                      <TouchableOpacity style={styles.noteActionBtn} onPress={() => handleToggleNoteRead(item)}>
                        <MaterialCommunityIcons
                          name={item.is_read ? 'email-outline' : 'email-open-outline'}
                          size={16}
                          color={colors.primary}
                        />
                        <Text style={styles.noteActionText}>{item.is_read ? 'Mark unread' : 'Mark read'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.noteActionBtn} onPress={() => handleDeleteNote(item)}>
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                        <Text style={[styles.noteActionText, { color: colors.error }]}>Delete</Text>
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  listContent: { padding: spacing.md, paddingBottom: spacing.xxl * 2 },

  intro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  introText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },

  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  actionBtnText: { ...typography.caption, color: colors.primary, fontWeight: '700' },

  privacyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  privacyHintText: { ...typography.caption, color: colors.textMuted, flex: 1 },

  noteCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noteCardUnread: { borderColor: colors.primary },
  noteBody: { ...typography.body, color: colors.textPrimary },
  noteActions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  noteActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  noteActionText: { ...typography.caption, color: colors.primary, fontWeight: '600' },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  cardPinned: { borderColor: colors.accent },
  pinnedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginBottom: spacing.xs,
  },
  pinnedText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  cardBody: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.md },
  cardMeta: { ...typography.caption, color: colors.textMuted },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.md },
  emptySub: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center', paddingHorizontal: spacing.lg },

  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.lg,
  },

  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.md,
    maxHeight: '88%',
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
    marginBottom: spacing.md,
  },
  bodyInput: { minHeight: 140 },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  pinLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pinLabel: { ...typography.body, color: colors.textPrimary },
  postButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    height: 52,
    borderRadius: radius.md,
    marginBottom: spacing.xl,
    ...shadows.md,
  },
  postButtonDisabled: { opacity: 0.6 },
  postButtonText: { ...typography.button, color: colors.white, fontSize: 16 },
});

export default NoticeBoard;
