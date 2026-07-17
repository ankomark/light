import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, Linking, Modal, KeyboardAvoidingView, Platform,
  TouchableWithoutFeedback, Keyboard, ScrollView, Image,
} from 'react-native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
  fetchMediaStations, createMediaStation, updateMediaStation, deleteMediaStation,
} from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const TYPES = ['TV', 'Radio', 'Podcast'];
const FILTERS = ['All', ...TYPES];

// Optional link fields shown on each station card and in the add form.
const LINK_FIELDS = [
  { key: 'website',   label: 'Website',   icon: 'globe-outline',   color: colors.primary, placeholder: 'https://…' },
  { key: 'youtube',   label: 'YouTube',   icon: 'logo-youtube',    color: '#FF0000',      placeholder: 'https://youtube.com/…' },
  { key: 'facebook',  label: 'Facebook',  icon: 'logo-facebook',   color: '#1877F2',      placeholder: 'https://facebook.com/…' },
  { key: 'instagram', label: 'Instagram', icon: 'logo-instagram',  color: '#E4405F',      placeholder: 'https://instagram.com/…' },
  { key: 'whatsapp',  label: 'WhatsApp',  icon: 'logo-whatsapp',   color: '#25D366',      placeholder: 'https://wa.me/…' },
];

const EMPTY_STATION = { name: '', type: 'TV', logo: '', website: '', youtube: '', facebook: '', instagram: '', whatsapp: '' };

// Build the list of links present on a station.
const getStationLinks = (item) =>
  LINK_FIELDS
    .map((f) => ({ ...f, url: (item[f.key] || '').trim() }))
    .filter((f) => f.url);

const typeMeta = (type) => {
  switch (type) {
    case 'TV': return { icon: 'tv', color: colors.primary };
    case 'Radio': return { icon: 'radio', color: colors.warning };
    case 'Podcast': return { icon: 'podcasts', color: colors.success };
    default: return { icon: 'public', color: colors.textMuted };
  }
};

const AdventistMedia = () => {
  const [stations, setStations] = useState([]);
  const [newStation, setNewStation] = useState(EMPTY_STATION);
  const [editingId, setEditingId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('All');

  const loadStations = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      setError(false);
      const res = await fetchMediaStations(1, 'All');
      setStations(Array.isArray(res) ? res : (res?.results ?? []));
    } catch (err) {
      console.error('Error loading stations:', err);
      setError(true);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadStations(); }, [loadStations]);

  const filteredStations = useMemo(
    () => (filter === 'All' ? stations : stations.filter((s) => s.type === filter)),
    [stations, filter]
  );

  const openUrl = useCallback((url) => {
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open this link.'));
  }, []);

  // Pick a logo, downscale to a small square, upload to R2, and store the URL.
  const pickLogo = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please enable photo library access to add a logo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.length) {
        const processed = await manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 256, height: 256 } }],
          { compress: 0.7, format: SaveFormat.JPEG }
        );
        const uploaded = await uploadMedia(
          { uri: processed.uri, name: `station_${Date.now()}.jpg`, mimeType: 'image/jpeg' },
          'cover',
        );
        setNewStation((prev) => ({ ...prev, logo: uploaded.url }));
      }
    } catch (error) {
      console.error('Logo picker error:', error);
      Alert.alert('Error', 'Failed to upload image.');
    }
  };

  const openCreateForm = () => {
    setEditingId(null);
    setNewStation(EMPTY_STATION);
    setShowAddForm(true);
  };

  const openEditForm = (item) => {
    setEditingId(item.id);
    setNewStation({
      name: item.name || '',
      type: item.type || 'TV',
      logo: item.logo || '',
      website: item.website || '',
      youtube: item.youtube || '',
      facebook: item.facebook || '',
      instagram: item.instagram || '',
      whatsapp: item.whatsapp || '',
    });
    setShowAddForm(true);
  };

  const submitStation = async () => {
    const name = newStation.name.trim();
    if (!name) {
      Alert.alert('Missing info', 'Please enter a station name.');
      return;
    }
    // Build the payload: name, type, logo, and any filled-in links.
    const payload = { name, type: newStation.type, logo: (newStation.logo || '').trim() };
    let linkCount = 0;
    for (const f of LINK_FIELDS) {
      const val = (newStation[f.key] || '').trim();
      if (!val) { payload[f.key] = ''; continue; }
      if (!/^https?:\/\//i.test(val)) {
        Alert.alert('Invalid link', `The ${f.label} link must start with http:// or https://`);
        return;
      }
      payload[f.key] = val;
      linkCount += 1;
    }
    if (linkCount === 0) {
      Alert.alert('Add a link', 'Please add at least one link (website, YouTube, Facebook, etc.).');
      return;
    }

    try {
      setSaving(true);
      if (editingId) {
        const updated = await updateMediaStation(editingId, payload);
        setStations((prev) => prev.map((s) => (s.id === editingId ? updated : s)));
      } else {
        const created = await createMediaStation(payload);
        setStations((prev) => [created, ...prev]);
      }
      closeForm();
    } catch (err) {
      const msg = err?.response?.data?.error || 'Could not save the station. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const closeForm = () => {
    Keyboard.dismiss();
    setShowAddForm(false);
    setEditingId(null);
    setNewStation(EMPTY_STATION);
  };

  const deleteStation = (item) => {
    Alert.alert('Delete station', `Delete “${item.name}”? This affects everyone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const prev = stations;
          setStations((cur) => cur.filter((s) => s.id !== item.id)); // optimistic
          try {
            await deleteMediaStation(item.id);
          } catch (err) {
            setStations(prev); // rollback
            const msg = err?.response?.data?.error || 'Could not delete the station.';
            Alert.alert('Error', msg);
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }) => {
    const meta = typeMeta(item.type);
    const links = getStationLinks(item);
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          {item.logo ? (
            <Image source={{ uri: item.logo }} style={styles.logoImage} />
          ) : (
            <View style={[styles.iconCircle, { backgroundColor: meta.color + '22' }]}>
              <MaterialIcons name={meta.icon} size={22} color={meta.color} />
            </View>
          )}
          <View style={styles.cardBody}>
            <Text style={styles.stationName} numberOfLines={1}>{item.name}</Text>
            <View style={[styles.typeBadge, { backgroundColor: meta.color + '22' }]}>
              <Text style={[styles.typeText, { color: meta.color }]}>{item.type}</Text>
            </View>
          </View>
          {item.is_owner && (
            <View style={styles.ownerActions}>
              <TouchableOpacity style={styles.iconBtn} onPress={() => openEditForm(item)} hitSlop={6}>
                <MaterialIcons name="edit" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={() => deleteStation(item)} hitSlop={6}>
                <MaterialIcons name="delete-outline" size={19} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {links.length > 0 && (
          <View style={styles.linksRow}>
            {links.map((l) => (
              <TouchableOpacity
                key={l.key}
                style={[styles.linkBtn, { borderColor: l.color + '55' }]}
                onPress={() => openUrl(l.url)}
                activeOpacity={0.8}
              >
                <Ionicons name={l.icon} size={15} color={l.color} />
                <Text style={styles.linkBtnText}>{l.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Adventist Media</Text>
          <Text style={styles.subtitle}>TV · Radio · Podcasts</Text>
        </View>
        <View style={styles.countPill}>
          <Text style={styles.countText}>{stations.length}</Text>
        </View>
      </View>

      {/* Type filter */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = f === filter;
          return (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(f)}
              activeOpacity={0.85}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{f}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filteredStations}
        renderItem={renderItem}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={() => loadStations(true)}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcons name={error ? 'cloud-off' : 'podcasts'} size={44} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              {error ? "Couldn't load stations" : `No ${filter === 'All' ? '' : filter + ' '}stations`}
            </Text>
            {error && (
              <TouchableOpacity style={styles.retryBtn} onPress={() => loadStations(true)}>
                <Text style={styles.retryBtnText}>Try Again</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <TouchableOpacity style={styles.fab} onPress={openCreateForm} activeOpacity={0.9}>
        <MaterialIcons name="add" size={22} color={colors.white} />
        <Text style={styles.fabText}>Add a Station</Text>
      </TouchableOpacity>

      {/* Add-station bottom sheet — lifts above the keyboard */}
      <Modal
        visible={showAddForm}
        transparent
        animationType="slide"
        onRequestClose={closeForm}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={closeForm}>
            <View style={styles.backdrop} />
          </TouchableWithoutFeedback>

          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.formTitle}>{editingId ? 'Edit station' : 'New station'}</Text>

            <ScrollView
              style={styles.formScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Logo (optional) */}
              <View style={styles.logoRow}>
                <TouchableOpacity style={styles.logoPicker} onPress={pickLogo} activeOpacity={0.8}>
                  {newStation.logo ? (
                    <Image source={{ uri: newStation.logo }} style={styles.logoPreview} />
                  ) : (
                    <Ionicons name="image-outline" size={26} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
                <View style={styles.logoHint}>
                  <Text style={styles.logoHintTitle}>Logo / thumbnail</Text>
                  <Text style={styles.logoHintSub}>Optional — a default icon is used if none.</Text>
                  {newStation.logo ? (
                    <TouchableOpacity onPress={() => setNewStation({ ...newStation, logo: '' })}>
                      <Text style={styles.logoRemove}>Remove</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              <TextInput
                style={styles.input}
                placeholder="Station name"
                placeholderTextColor={colors.placeholder}
                value={newStation.name}
                onChangeText={(text) => setNewStation({ ...newStation, name: text })}
                returnKeyType="next"
              />

              <Text style={styles.fieldLabel}>Type</Text>
              <View style={styles.typeSelector}>
                {TYPES.map((t) => {
                  const active = newStation.type === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.typeOption, active && styles.typeOptionActive]}
                      onPress={() => setNewStation({ ...newStation, type: t })}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.typeOptionText, active && styles.typeOptionTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Links — add at least one (all optional)</Text>
              {LINK_FIELDS.map((f) => (
                <View key={f.key} style={styles.linkInputRow}>
                  <Ionicons name={f.icon} size={20} color={f.color} style={styles.linkInputIcon} />
                  <TextInput
                    style={styles.linkInput}
                    placeholder={`${f.label} — ${f.placeholder}`}
                    placeholderTextColor={colors.placeholder}
                    value={newStation[f.key]}
                    onChangeText={(text) => setNewStation({ ...newStation, [f.key]: text })}
                    keyboardType="url"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              ))}
            </ScrollView>

            <View style={styles.formButtons}>
              <TouchableOpacity style={[styles.formBtn, styles.cancelBtn]} onPress={closeForm} disabled={saving}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.formBtn, styles.submitBtn, saving && styles.submitBtnDisabled]}
                onPress={submitStation}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.submitBtnText}>{editingId ? 'Save Changes' : 'Add Station'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  countPill: {
    minWidth: 34, height: 28, paddingHorizontal: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  countText: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },

  filterRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  filterChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radius.full, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  filterTextActive: { color: colors.white },

  listContent: { paddingBottom: 96 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
  },
  logoImage: {
    width: 44, height: 44, borderRadius: radius.md,
    marginRight: spacing.sm,
    backgroundColor: colors.surface,
  },
  cardBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stationName: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
  typeBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full },
  typeText: { fontSize: 11, fontWeight: '700' },
  ownerActions: { flexDirection: 'row', alignItems: 'center', marginLeft: spacing.xs },
  iconBtn: { padding: spacing.xs },

  linksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginLeft: 44 + spacing.sm, // align under the title, past the icon
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  linkBtnText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted },
  retryBtn: {
    marginTop: spacing.sm, backgroundColor: colors.primary,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  retryBtnText: { ...typography.label, color: colors.white, fontWeight: '600' },

  fab: {
    position: 'absolute',
    bottom: spacing.lg,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    ...shadows.lg,
  },
  fabText: { ...typography.button, color: colors.white },

  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    maxHeight: '85%',
    ...shadows.lg,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  formTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  formScroll: { flexGrow: 0, flexShrink: 1 },
  logoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  logoPicker: {
    width: 64, height: 64, borderRadius: radius.md,
    backgroundColor: colors.inputBg,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.md,
    overflow: 'hidden',
  },
  logoPreview: { width: '100%', height: '100%' },
  logoHint: { flex: 1 },
  logoHintTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '600' },
  logoHintSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  logoRemove: { ...typography.caption, color: colors.error, fontWeight: '700', marginTop: spacing.xs },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.sm, color: colors.textPrimary, backgroundColor: colors.inputBg,
    fontSize: 15,
  },
  linkInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  linkInputIcon: { marginRight: spacing.xs },
  linkInput: { flex: 1, paddingVertical: spacing.sm, color: colors.textPrimary, fontSize: 14 },
  typeSelector: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  typeOption: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    alignItems: 'center',
  },
  typeOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeOptionText: { ...typography.label, color: colors.textSecondary, fontWeight: '600' },
  typeOptionTextActive: { color: colors.white },
  formButtons: { flexDirection: 'row', gap: spacing.sm },
  formBtn: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.md, alignItems: 'center' },
  cancelBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cancelBtnText: { ...typography.button, color: colors.textSecondary },
  submitBtn: { backgroundColor: colors.primary },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { ...typography.button, color: colors.white },
});

export default AdventistMedia;
