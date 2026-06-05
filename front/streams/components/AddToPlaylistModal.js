import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchPlaylists, createPlaylist, addTrackToPlaylist } from '../services/api';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';

/**
 * Bottom-sheet modal to add a track to one of the user's playlists, or create
 * a new playlist and add it there. Self-contained: loads playlists on open.
 */
const AddToPlaylistModal = ({ visible, onClose, trackId, trackTitle }) => {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlaylists(await fetchPlaylists());
    } catch {
      setPlaylists([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setNewName('');
      load();
    }
  }, [visible, load]);

  const addTo = useCallback(async (playlist) => {
    if (busyId) return;
    setBusyId(playlist.id);
    try {
      await addTrackToPlaylist(playlist.id, trackId);
      onClose?.();
      Alert.alert('Added', `Added to "${playlist.name}".`);
    } catch {
      Alert.alert('Error', 'Could not add the track. Please try again.');
    } finally {
      setBusyId(null);
    }
  }, [busyId, trackId, onClose]);

  const createAndAdd = useCallback(async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const created = await createPlaylist(name);
      await addTrackToPlaylist(created.id, trackId);
      onClose?.();
      Alert.alert('Added', `Created "${name}" and added the track.`);
    } catch {
      Alert.alert('Error', 'Could not create the playlist. Please try again.');
    } finally {
      setCreating(false);
    }
  }, [newName, creating, trackId, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Add to playlist</Text>
          {trackTitle ? <Text style={styles.subtitle} numberOfLines={1}>{trackTitle}</Text> : null}

          {/* Create new */}
          <View style={styles.createRow}>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="New playlist name"
              placeholderTextColor={colors.placeholder}
              maxLength={100}
              returnKeyType="done"
              onSubmitEditing={createAndAdd}
            />
            <TouchableOpacity
              style={[styles.createBtn, (!newName.trim() || creating) && styles.disabled]}
              onPress={createAndAdd}
              disabled={!newName.trim() || creating}
            >
              {creating
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Ionicons name="add" size={22} color={colors.white} />}
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
          ) : (
            <FlatList
              data={playlists}
              keyExtractor={(item) => `apl_${item.id}`}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.row} onPress={() => addTo(item)} disabled={!!busyId}>
                  <MaterialCommunityIcons name="playlist-music" size={22} color={colors.textSecondary} />
                  <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                  {busyId === item.id
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Text style={styles.rowCount}>{item.track_count ?? 0}</Text>}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No playlists yet — create one above.</Text>
              }
            />
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '75%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.lg,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: spacing.sm, marginBottom: spacing.md },
  title: { ...typography.h3, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.sm },
  createRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.sm },
  input: {
    flex: 1,
    height: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
    fontSize: 15,
  },
  createBtn: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  list: { marginTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowName: { ...typography.body, color: colors.textPrimary, flex: 1 },
  rowCount: { ...typography.caption, color: colors.textMuted },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  closeBtn: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  closeText: { ...typography.button, color: colors.textSecondary },
});

export default AddToPlaylistModal;
