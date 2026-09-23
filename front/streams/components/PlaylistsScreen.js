// Your Library (the "Playlists" route): Liked Songs and Downloads up top,
// then what you played recently, then your playlists — Spotify-style.
//
// Opens instantly on the last copy (memory, then disk) and refreshes behind
// it; the server sends everything but downloads in one request (GET
// /library/), which matters on a slow connection. Downloads are read from
// the phone.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, Alert, Pressable, RefreshControl,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { fetchLibrary, createPlaylist } from '../services/api';
import { useAuth } from '../context/useAuth';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { useDownloadedTracks } from '../utils/downloads';
import { useContentWidth } from '../utils/layout';
import { TrackListSkeleton } from './SkeletonLoader';
import PlaylistCover from './PlaylistCover';
import TrackRail from './TrackRail';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const VIS_ICON = { private: 'lock-closed', unlisted: 'link', public: 'globe-outline' };

export const playlistMeta = (t, p) => [
  t('library.songCount', { n: p.track_count ?? 0 }),
  p.visibility ? t(`playlist.visibility.${p.visibility}`) : null,
].filter(Boolean).join('  ·  ');

const Shortcut = ({ icon, iconBg, title, sub, onPress, covers }) => (
  <TouchableOpacity style={styles.shortcut} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
    {covers?.length ? (
      <PlaylistCover images={covers} size={52} radius={8} />
    ) : (
      <View style={[styles.shortcutIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={24} color={colors.white} />
      </View>
    )}
    <View style={styles.shortcutText}>
      <Text style={styles.cardName} numberOfLines={1}>{title}</Text>
      <Text style={styles.cardMeta} numberOfLines={1}>{sub}</Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
  </TouchableOpacity>
);

const PlaylistsScreen = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  const cacheKey = userKey(currentUser?.id, 'library');
  const { sideMargin } = useContentWidth({ gutter: 0 });
  const downloads = useDownloadedTracks();
  const [library, setLibrary] = useState(() => peekCache(cacheKey));
  const [loading, setLoading] = useState(() => !peekCache(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const [createVisible, setCreateVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readCache(cacheKey).then((cached) => {
      if (cancelled || !cached) return;
      setLibrary((prev) => prev ?? cached);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  const load = useCallback(async () => {
    try {
      const data = await fetchLibrary();
      setLibrary(data);
      setError(false);
      if (currentUser?.id) writeCache(cacheKey, data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey, currentUser?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const created = await createPlaylist(name);
      setCreateVisible(false);
      setNewName('');
      setLibrary((prev) => (prev ? { ...prev, playlists: [created, ...(prev.playlists || [])] } : prev));
      navigation.navigate('PlaylistDetail', { playlistId: created.id, name: created.name });
    } catch {
      Alert.alert(t('common.error'), t('playlist.createFailed'));
    } finally {
      setCreating(false);
    }
  }, [newName, creating, navigation, t]);

  const renderItem = useCallback(({ item }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('PlaylistDetail', { playlistId: item.id, name: item.name })}
    >
      <PlaylistCover cover={item.cover_image} images={item.cover_images} size={56} />
      <View style={styles.cardInfo}>
        <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
        <View style={styles.metaRow}>
          {item.visibility ? <Ionicons name={VIS_ICON[item.visibility]} size={12} color={colors.textSecondary} /> : null}
          <Text style={styles.cardMeta} numberOfLines={1}>{playlistMeta(t, item)}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  ), [navigation, t]);

  if (loading && !library) {
    return (
      <View style={[styles.container, { paddingHorizontal: sideMargin }]}>
        <TrackListSkeleton count={6} />
      </View>
    );
  }

  const playlists = library?.playlists ?? [];
  const recent = library?.recent ?? [];
  const liked = library?.liked ?? { count: 0, covers: [] };

  const header = (
    <View>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t('library.title')}</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => setCreateVisible(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('playlist.new')}
        >
          <Ionicons name="add" size={20} color={colors.white} />
          <Text style={styles.newBtnText}>{t('library.newPlaylist')}</Text>
        </TouchableOpacity>
      </View>

      <Shortcut
        icon="heart"
        iconBg="#E0457B"
        title={t('library.likedSongs')}
        sub={t('library.songCount', { n: liked.count })}
        onPress={() => navigation.navigate('Favorites')}
      />
      <Shortcut
        icon="arrow-down-circle"
        iconBg="#2E9D6A"
        title={t('downloads.title')}
        sub={t('library.songCount', { n: downloads.length })}
        onPress={() => navigation.navigate('Downloads')}
      />

      {recent.length ? (
        <TrackRail
          title={t('music.recentlyPlayed')}
          tracks={recent}
          source="recent"
          style={{ marginHorizontal: -spacing.md, marginTop: spacing.md }}
        />
      ) : null}

      <Text style={styles.section}>{t('playlist.title')}</Text>
      {error && !playlists.length ? <Text style={styles.cardMeta}>{t('library.loadFailed')}</Text> : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={playlists}
        keyExtractor={(item) => `pl_${item.id}`}
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentContainerStyle={[styles.listContent, { paddingHorizontal: spacing.md + sideMargin }]}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcons name="queue-music" size={44} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('library.noPlaylists')}</Text>
            <Text style={styles.emptySub}>{t('playlist.createPrompt')}</Text>
          </View>
        }
      />

      <Modal visible={createVisible} transparent animationType="fade" onRequestClose={() => setCreateVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCreateVisible(false)}>
          <Pressable style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('playlist.new')}</Text>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder={t('playlist.namePlaceholder')}
              placeholderTextColor={colors.placeholder}
              autoFocus
              maxLength={100}
              onSubmitEditing={handleCreate}
              returnKeyType="done"
            />
            <Text style={styles.modalHint}>{t('library.newIsPrivate')}</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setCreateVisible(false)} style={styles.modalBtn}>
                <Text style={styles.modalCancel}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreate}
                style={[styles.modalBtn, styles.modalCreate, (!newName.trim() || creating) && styles.modalDisabled]}
                disabled={!newName.trim() || creating}
              >
                {creating
                  ? <ActivityIndicator size="small" color={colors.white} />
                  : <Text style={styles.modalCreateText}>{t('common.create')}</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  listContent: { paddingTop: spacing.sm, paddingBottom: 140, flexGrow: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { ...typography.h1, color: colors.textPrimary },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40,
    paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.primary,
  },
  newBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  shortcut: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, ...shadows.sm,
  },
  shortcutIcon: { width: 52, height: 52, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  shortcutText: { flex: 1 },
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
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
  cardInfo: { flex: 1 },
  cardName: { ...typography.label, fontSize: 15, color: colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  cardMeta: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyText: { ...typography.h3, color: colors.textSecondary },
  emptySub: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.lg,
  },
  modalTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  modalHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
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
