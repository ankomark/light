import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, Modal, TextInput, Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchAdminReports, fetchAdminByUrl, resolveReport, dismissReport, removeReportTarget,
  assignReport, addReportNote, bulkReports,
} from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' },
];

// Targets we can soft-remove (users are handled via suspend/ban on the Users tab).
const REMOVABLE = new Set(['post', 'comment', 'track']);

const TargetPreview = ({ target }) => {
  if (!target) return <Text style={styles.targetGone}>Content no longer available</Text>;
  const author = target.author;
  return (
    <View style={styles.targetCard}>
      {author && (
        <View style={styles.targetAuthor}>
          <Image
            source={author.profile_picture ? { uri: author.profile_picture } : DEFAULT_AVATAR}
            placeholder={DEFAULT_AVATAR}
            contentFit="cover"
            transition={120}
            style={styles.targetAvatar}
          />
          <Text style={styles.targetAuthorName}>@{author.username}</Text>
          {target.is_removed && <Text style={styles.removedPill}>removed</Text>}
        </View>
      )}
      <Text style={styles.targetBody} numberOfLines={3}>
        {target.caption || target.content || target.title || target.name || `${target.type} #${target.id}`}
      </Text>
    </View>
  );
};

const AdminReports = () => {
  const [filter, setFilter] = useState('pending');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [noteFor, setNoteFor] = useState(null);   // report being annotated
  const [noteText, setNoteText] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);

  const load = useCallback(async (status) => {
    setLoading(true);
    try {
      const res = await fetchAdminReports(status);
      setReports(res?.results || (Array.isArray(res) ? res : []));
      setNextUrl(res?.next || null);
    } catch {
      setReports([]);
      setNextUrl(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !nextUrl) return;
    setLoadingMore(true);
    try {
      const res = await fetchAdminByUrl(nextUrl);
      setReports((prev) => {
        const have = new Set(prev.map((r) => r.id));
        return [...prev, ...(res?.results || []).filter((r) => !have.has(r.id))];
      });
      setNextUrl(res?.next || null);
    } catch {
      // silent — pull-to-refresh recovers
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextUrl]);

  useFocusEffect(useCallback(() => { load(filter); }, [load, filter]));

  // Resolve/dismiss/remove drop the row from this status-filtered list.
  const act = async (id, fn) => {
    setBusyId(id);
    try {
      await fn();
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch {
      Alert.alert('Error', 'Action failed. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  // Assign/note keep the row but update it in place.
  const update = async (id, fn) => {
    setBusyId(id);
    try {
      const updated = await fn();
      setReports((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch {
      Alert.alert('Error', 'Action failed. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemove = (item) => {
    Alert.alert(
      'Remove content',
      `This hides the reported ${item.content_type} from everyone. You can restore it later from the Content tab.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => act(item.id, () => removeReportTarget(item.id)) },
      ],
    );
  };

  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const toggleSelect = (id) => setSelected((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const runBulk = async (op) => {
    if (selected.size === 0) return;
    const ids = [...selected];
    setBulkBusy(true);
    try {
      await bulkReports(ids, op);
      setReports((prev) => prev.filter((r) => !ids.includes(r.id)));
      exitSelect();
    } catch {
      Alert.alert('Error', 'Bulk action failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  const openNote = (item) => { setNoteFor(item); setNoteText(item.moderator_notes || ''); };
  const saveNote = async () => {
    const item = noteFor;
    setNoteFor(null);
    await update(item.id, () => addReportNote(item.id, noteText.trim()));
  };

  const renderItem = ({ item }) => {
    const busy = busyId === item.id;
    const canRemove = REMOVABLE.has(item.content_type) && !item.target?.is_removed;
    const dup = item.duplicate_count || 1;
    const checked = selected.has(item.id);
    return (
      <Pressable
        onPress={() => selectMode && toggleSelect(item.id)}
        style={[styles.card, checked && styles.cardSelected]}
      >
        <View style={styles.cardHead}>
          {selectMode && (
            <View style={[styles.checkbox, checked && styles.checkboxOn]}>
              {checked && <Ionicons name="checkmark" size={13} color="#0A1628" />}
            </View>
          )}
          <View style={styles.reasonPill}><Text style={styles.reasonText}>{item.reason}</Text></View>
          {dup > 1 && (
            <View style={styles.dupPill}>
              <Ionicons name="people" size={11} color="#FFD27A" />
              <Text style={styles.dupText}>{dup} reports</Text>
            </View>
          )}
          <Text style={styles.metaText}>{item.content_type} #{item.object_id}</Text>
        </View>

        <TargetPreview target={item.target} />

        {item.description ? <Text style={styles.desc}>“{item.description}”</Text> : null}

        <View style={styles.subRow}>
          <Text style={styles.reporter}>Reported by @{item.reporter?.username || 'unknown'}</Text>
          {item.assigned_to && (
            <Text style={styles.assigned}>· assigned @{item.assigned_to.username}</Text>
          )}
        </View>
        {item.moderator_notes ? (
          <Text style={styles.note}>📝 {item.moderator_notes}</Text>
        ) : null}

        {!selectMode && (busy ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
        ) : (
          <>
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.btnResolve]} onPress={() => act(item.id, () => resolveReport(item.id))}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#0A1628" />
                <Text style={styles.btnTextDark}>Resolve</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => act(item.id, () => dismissReport(item.id))}>
                <Text style={styles.btnTextLight}>Dismiss</Text>
              </TouchableOpacity>
              {canRemove && (
                <TouchableOpacity style={[styles.btn, styles.btnRemove]} onPress={() => confirmRemove(item)}>
                  <Ionicons name="trash-outline" size={16} color={colors.white} />
                  <Text style={styles.btnTextLight}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.actionsSecondary}>
              <TouchableOpacity style={styles.linkBtn} onPress={() => update(item.id, () => assignReport(item.id))}>
                <Ionicons name="person-outline" size={14} color={colors.accent} />
                <Text style={styles.linkText}>{item.assigned_to ? 'Unassign' : 'Assign to me'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkBtn} onPress={() => openNote(item)}>
                <Ionicons name="create-outline" size={14} color={colors.accent} />
                <Text style={styles.linkText}>{item.moderator_notes ? 'Edit note' : 'Add note'}</Text>
              </TouchableOpacity>
            </View>
          </>
        ))}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Reports</Text>
        <TouchableOpacity onPress={() => (selectMode ? exitSelect() : setSelectMode(true))}>
          <Text style={styles.selectToggle}>{selectMode ? 'Cancel' : 'Select'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <TouchableOpacity key={f.key} style={[styles.pill, active && styles.pillActive]}
              onPress={() => { exitSelect(); setFilter(f.key); }} activeOpacity={0.85}>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, selectMode && selected.size > 0 && { paddingBottom: 96 }]}
          showsVerticalScrollIndicator={false}
          onRefresh={() => load(filter)}
          refreshing={loading}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} /> : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="shield-checkmark-outline" size={48} color={colors.textSecondary} />
              <Text style={styles.emptyText}>No {filter} reports</Text>
            </View>
          }
        />
      )}

      {/* Bulk action bar */}
      {selectMode && selected.size > 0 && (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkCount}>{selected.size} selected</Text>
          {bulkBusy ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <View style={styles.bulkBtns}>
              <TouchableOpacity style={[styles.bulkBtn, styles.bulkResolve]} onPress={() => runBulk('resolve')}>
                <Text style={styles.btnTextDark}>Resolve</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.bulkBtn, styles.bulkDismiss]} onPress={() => runBulk('dismiss')}>
                <Text style={styles.btnTextLight}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Internal note editor */}
      <Modal visible={!!noteFor} transparent animationType="fade" onRequestClose={() => setNoteFor(null)}>
        <View style={styles.noteBackdrop}>
          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>Internal note</Text>
            <TextInput
              style={styles.noteInput}
              placeholder="Visible to moderators only…"
              placeholderTextColor={colors.placeholder}
              value={noteText}
              onChangeText={setNoteText}
              multiline
              autoFocus
            />
            <View style={styles.noteActions}>
              <TouchableOpacity onPress={() => setNoteFor(null)}><Text style={styles.noteCancel}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.noteSave} onPress={saveNote}><Text style={styles.noteSaveText}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  titleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
  },
  title: {
    ...typography.h1, color: colors.textPrimary,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  selectToggle: { ...typography.label, color: colors.accent, fontWeight: '700' },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, marginRight: spacing.xs,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  cardSelected: { borderColor: colors.accent, borderWidth: 1.5 },
  bulkBar: {
    position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(14,32,56,0.97)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...shadows.md,
  },
  bulkCount: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  bulkBtns: { flexDirection: 'row', gap: spacing.sm },
  bulkBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  bulkResolve: { backgroundColor: colors.accent },
  bulkDismiss: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pill: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  pillTextActive: { color: '#0A1628' },
  list: { padding: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: 'rgba(16,28,46,0.85)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.md, marginBottom: spacing.sm, ...shadows.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  reasonPill: {
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full,
    backgroundColor: 'rgba(224,36,94,0.18)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(224,36,94,0.5)',
  },
  reasonText: { ...typography.caption, color: '#FF6B9A', fontWeight: '700', textTransform: 'capitalize' },
  dupPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full,
    backgroundColor: 'rgba(244,162,97,0.18)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.5)',
  },
  dupText: { ...typography.caption, color: '#FFD27A', fontWeight: '700', fontSize: 11 },
  metaText: { ...typography.caption, color: colors.textMuted, marginLeft: 'auto' },
  targetCard: {
    backgroundColor: 'rgba(10,22,40,0.6)', borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)',
    padding: spacing.sm, marginBottom: spacing.sm,
  },
  targetAuthor: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  targetAvatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surface },
  targetAuthorName: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  removedPill: {
    ...typography.caption, color: colors.error, fontWeight: '700',
    marginLeft: 'auto', textTransform: 'uppercase', fontSize: 10,
  },
  targetBody: { ...typography.caption, color: colors.textSecondary },
  targetGone: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic', marginBottom: spacing.sm },
  desc: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic', marginBottom: spacing.xs },
  subRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  reporter: { ...typography.caption, color: colors.textMuted },
  assigned: { ...typography.caption, color: colors.accent },
  note: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionsSecondary: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm, paddingTop: spacing.xs },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkText: { ...typography.caption, color: colors.accent, fontWeight: '600' },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md,
  },
  btnResolve: { backgroundColor: colors.accent },
  btnGhost: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  btnRemove: { backgroundColor: colors.error, marginLeft: 'auto' },
  btnTextDark: { ...typography.caption, color: '#0A1628', fontWeight: '800' },
  btnTextLight: { ...typography.caption, color: colors.white, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl * 1.5, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary },

  noteBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.lg },
  noteCard: {
    backgroundColor: '#0E2038', borderRadius: radius.lg, padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  noteTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  noteInput: {
    minHeight: 90, color: colors.textPrimary, fontSize: 15, textAlignVertical: 'top',
    backgroundColor: colors.inputBg, borderRadius: radius.md, padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  noteActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.lg, marginTop: spacing.md },
  noteCancel: { ...typography.label, color: colors.textSecondary, fontWeight: '700' },
  noteSave: { backgroundColor: colors.accent, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  noteSaveText: { ...typography.label, color: '#0A1628', fontWeight: '800' },
});

export default AdminReports;
