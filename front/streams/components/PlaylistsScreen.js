import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, Alert, Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { fetchPlaylists, createPlaylist } from '../services/api';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';

const CoverCollage = ({ images = [] }) => {
  if (!images.length) {
    return (
      <View style={[styles.cover, styles.coverPlaceholder]}>
        <MaterialCommunityIcons name="playlist-music" size={26} color={colors.textMuted} />
      </View>
    );
  }
  if (images.length === 1) {
    return <Image source={{ uri: images[0] }} style={styles.cover} contentFit="cover" transition={150} />;
  }
  const cells = [0, 1, 2, 3];
  return (
    <View style={[styles.cover, styles.collage]}>
      {cells.map((i) => (
        images[i]
          ? <Image key={i} source={{ uri: images[i] }} style={styles.collageCell} contentFit="cover" transition={150} />
          : <View key={i} style={[styles.collageCell, styles.collageBlank]} />
      ))}
    </View>
  );
};

const PlaylistsScreen = () => {
  const navigation = useNavigation();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [createVisible, setCreateVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchPlaylists();
      setPlaylists(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const created = await createPlaylist(name);
      setCreateVisible(false);
      setNewName('');
      setPlaylists((prev) => [{ ...created, track_count: 0, cover_images: [] }, ...prev]);
      navigation.navigate('PlaylistDetail', { playlistId: created.id, name: created.name });
    } catch {
      Alert.alert('Error', 'Could not create the playlist. Please try again.');
    } finally {
      setCreating(false);
    }
  }, [newName, creating, navigation]);

  const renderItem = useCallback(({ item }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('PlaylistDetail', { playlistId: item.id, name: item.name })}
    >
      <CoverCollage images={item.cover_images} />
      <View style={styles.cardInfo}>
        <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.cardMeta}>
          {item.track_count ?? 0} {item.track_count === 1 ? 'track' : 'tracks'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  ), [navigation]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={playlists}
        keyExtractor={(item) => `pl_${item.id}`}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="playlist-music-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              {error ? "Couldn't load your playlists." : 'No playlists yet'}
            </Text>
            <Text style={styles.emptySub}>Create one and add your favorite tracks.</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => setCreateVisible(true)}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>

      <Modal visible={createVisible} transparent animationType="fade" onRequestClose={() => setCreateVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCreateVisible(false)}>
          <Pressable style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Playlist</Text>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="Playlist name"
              placeholderTextColor={colors.placeholder}
              autoFocus
              maxLength={100}
              onSubmitEditing={handleCreate}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setCreateVisible(false)} style={styles.modalBtn}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreate}
                style={[styles.modalBtn, styles.modalCreate, (!newName.trim() || creating) && styles.modalDisabled]}
                disabled={!newName.trim() || creating}
              >
                {creating
                  ? <ActivityIndicator size="small" color={colors.white} />
                  : <Text style={styles.modalCreateText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const COVER = 56;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.md, paddingBottom: 120, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  cover: { width: COVER, height: COVER, borderRadius: radius.sm, backgroundColor: colors.surface, overflow: 'hidden' },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  collage: { flexDirection: 'row', flexWrap: 'wrap' },
  collageCell: { width: COVER / 2, height: COVER / 2 },
  collageBlank: { backgroundColor: colors.surface },
  cardInfo: { flex: 1 },
  cardName: { ...typography.label, fontSize: 15, color: colors.textPrimary },
  cardMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyText: { ...typography.h3, color: colors.textSecondary },
  emptySub: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 90,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.lg,
  },
  modalTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
    fontSize: 16,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  modalBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full },
  modalCancel: { ...typography.button, color: colors.textSecondary },
  modalCreate: { backgroundColor: colors.primary, minWidth: 88, alignItems: 'center' },
  modalCreateText: { ...typography.button, color: colors.white },
  modalDisabled: { opacity: 0.5 },
});

export default PlaylistsScreen;
