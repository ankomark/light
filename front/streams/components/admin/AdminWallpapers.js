import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  fetchAllWallpapers,
  createWallpaper,
  updateWallpaper,
  deleteWallpaper,
  reorderWallpapers,
} from '../../services/api';
import { uploadMedia } from '../../services/cloudinary';
import { compressImage } from '../../services/imageProcessing';
import { useWallpapers } from '../../context/WallpaperContext';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

// Wallpapers are full-screen backdrops, so a generous cap — but still
// downscaled before upload, since R2 stores bytes verbatim (no ingest
// transform) and every device pays for the download on every launch.
const MAX_EDGE = 1920;

// Surfaces an admin can curate independently. Must match Wallpaper.SCOPE_CHOICES.
const SCOPES = [
  { key: 'general', label: 'Most screens' },
  { key: 'music', label: 'Music' },
];

const AdminWallpapers = () => {
  const { refresh: refreshLiveWallpapers } = useWallpapers();
  const [scope, setScope] = useState('general');
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchAllWallpapers();
      setAllItems(Array.isArray(data) ? data : (data?.results || []));
    } catch {
      Alert.alert('Error', 'Could not load wallpapers.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // One fetch covers every scope; the tabs just filter what's already loaded.
  const items = useMemo(
    () => allItems.filter((w) => (w.scope || 'general') === scope),
    [allItems, scope]
  );
  const setItems = useCallback((updater) => {
    setAllItems((current) => {
      const mine = current.filter((w) => (w.scope || 'general') === scope);
      const others = current.filter((w) => (w.scope || 'general') !== scope);
      const next = typeof updater === 'function' ? updater(mine) : updater;
      return [...others, ...next];
    });
  }, [scope]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleAdd = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'We need photo access to add a wallpaper.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    try {
      setUploading(true);
      setProgress(0);

      // Downscale first — this image ships to every device on every launch.
      // sourceWidth keeps an already-small picture from being upscaled.
      const prepared = await compressImage(asset.uri, {
        maxWidth: MAX_EDGE,
        sourceWidth: asset.width,
      });
      const uri = prepared?.uri || asset.uri;

      const uploaded = await uploadMedia(
        { uri, name: 'wallpaper.jpg', mimeType: 'image/jpeg' },
        'wallpaper',
        setProgress,
      );
      await createWallpaper(uploaded.url, '', scope);
      await load();
      await refreshLiveWallpapers();   // apply it app-wide immediately
    } catch (error) {
      console.error('Wallpaper upload failed:', error);
      Alert.alert('Upload failed', error.message || 'Could not upload that image.');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleToggleActive = async (item, next) => {
    setBusyId(item.id);
    const previous = items;
    setItems((cur) => cur.map((w) => (w.id === item.id ? { ...w, is_active: next } : w)));
    try {
      await updateWallpaper(item.id, { is_active: next });
      await refreshLiveWallpapers();
    } catch {
      setItems(previous);
      Alert.alert('Error', 'Could not update that wallpaper.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (item) => {
    Alert.alert(
      'Delete wallpaper',
      'This removes the image permanently. Deactivate it instead if you might want it back.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(item.id);
            const previous = items;
            setItems((cur) => cur.filter((w) => w.id !== item.id));
            try {
              await deleteWallpaper(item.id);
              await refreshLiveWallpapers();
            } catch {
              setItems(previous);
              Alert.alert('Error', 'Could not delete that wallpaper.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  // Swap with the neighbour and persist both positions in one call.
  const move = async (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    try {
      await reorderWallpapers(next.map((w, i) => ({ id: w.id, sort_order: i })));
      await refreshLiveWallpapers();
    } catch {
      load();  // fall back to server truth
      Alert.alert('Error', 'Could not save the new order.');
    }
  };

  const activeCount = useMemo(() => items.filter((w) => w.is_active).length, [items]);

  const renderItem = ({ item, index }) => (
    <View style={styles.card}>
      <Image
        source={{ uri: item.image_url }}
        style={styles.preview}
        contentFit="cover"
        transition={150}
      />
      <View style={styles.cardBody}>
        <View style={styles.cardRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.title || `Wallpaper ${item.id}`}
          </Text>
          {busyId === item.id ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Switch
              value={!!item.is_active}
              onValueChange={(v) => handleToggleActive(item, v)}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.white}
            />
          )}
        </View>
        <Text style={styles.cardMeta}>
          {item.is_active ? 'In rotation' : 'Hidden'}
          {item.uploaded_by_username ? ` · by ${item.uploaded_by_username}` : ''}
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.iconBtn, index === 0 && styles.iconBtnDisabled]}
            onPress={() => move(index, -1)}
            disabled={index === 0}
          >
            <MaterialCommunityIcons name="arrow-up" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, index === items.length - 1 && styles.iconBtnDisabled]}
            onPress={() => move(index, 1)}
            disabled={index === items.length - 1}
          >
            <MaterialCommunityIcons name="arrow-down" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={styles.iconBtn} onPress={() => handleDelete(item)}>
            <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.error} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <View style={styles.intro}>
            <View style={styles.tabs}>
              {SCOPES.map((s) => (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.tab, scope === s.key && styles.tabActive]}
                  onPress={() => setScope(s.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.tabText, scope === s.key && styles.tabTextActive]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.introText}>
              {scope === 'music'
                ? 'Backgrounds for the Music tab. Order sets the rotation; hidden ones stay uploaded but drop out.'
                : 'Backgrounds for most screens. Order sets the rotation; hidden ones stay uploaded but drop out.'}
            </Text>
            {activeCount === 0 && items.length > 0 && (
              <Text style={styles.warnText}>
                Nothing is in rotation — these screens show a plain dark background.
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialCommunityIcons name="image-multiple-outline" size={56} color={colors.border} />
            <Text style={styles.emptyTitle}>No wallpapers here</Text>
            <Text style={styles.emptySub}>
              These screens show a plain dark background until you add one.
            </Text>
          </View>
        }
      />

      <TouchableOpacity
        style={[styles.fab, uploading && styles.fabBusy]}
        onPress={handleAdd}
        disabled={uploading}
        activeOpacity={0.85}
      >
        {uploading ? (
          <>
            <ActivityIndicator size="small" color={colors.white} />
            <Text style={styles.fabText}>{Math.round(progress * 100)}%</Text>
          </>
        ) : (
          <>
            <MaterialCommunityIcons name="plus" size={20} color={colors.white} />
            <Text style={styles.fabText}>Add wallpaper</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: spacing.md, paddingBottom: 96 },

  intro: { marginBottom: spacing.md },
  introText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.inputBg,
    borderRadius: radius.full,
    padding: 4,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { ...typography.label, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: colors.white },
  warnText: { ...typography.caption, color: colors.warning, marginTop: spacing.sm },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  preview: { width: '100%', height: 150, backgroundColor: colors.surface },
  cardBody: { padding: spacing.md },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  cardMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  actions: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  iconBtn: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.inputBg,
    justifyContent: 'center', alignItems: 'center',
    marginRight: spacing.sm,
  },
  iconBtnDisabled: { opacity: 0.35 },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.md },
  emptySub: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },

  fab: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.md,
  },
  fabBusy: { opacity: 0.8 },
  fabText: { ...typography.button, color: colors.white },
});

export default AdminWallpapers;
