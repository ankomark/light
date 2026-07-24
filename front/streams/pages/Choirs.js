import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, Linking, Modal, Platform, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../services/imageProcessing';
import {
  fetchChoirs, fetchChoirsByUrl, createChoir, updateChoir, deleteChoir,
  toggleChoirActive, updateChoirMembers,
} from '../services/api';
import { useAuth } from '../context/useAuth';
import { uploadMedia } from '../services/cloudinary';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const GENRES = [
  { key: 'gospel', label: 'Gospel' },
  { key: 'contemporary', label: 'Contemporary' },
  { key: 'traditional', label: 'Traditional' },
  { key: 'mixed', label: 'Mixed' },
];
const GENRE_LABEL = Object.fromEntries(GENRES.map((g) => [g.key, g.label]));
const FILTERS = [{ key: 'all', label: 'All' }, ...GENRES];

const EMPTY = {
  name: '', description: '', location: '', contact_phone: '', contact_email: '',
  genre: 'gospel', youtube_link: '', founded_date: '',
};

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// Pick an image, compress it, upload to R2, and return the public URL.
async function pickAndUpload(aspect, width, type, t) {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert(t('chat.permissionRequired'), t('dir.permissionPhotos'));
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect,
    quality: 0.8,
  });
  if (result.canceled || !result.assets?.length) return null;
  const processed = await compressImage(result.assets[0].uri, { width, quality: 0.6 });
  try {
    const uploaded = await uploadMedia(
      { uri: processed.uri, name: `choir_${Date.now()}.jpg`, mimeType: 'image/jpeg' },
      type,
    );
    return uploaded.url;
  } catch (e) {
    Alert.alert(t('common.uploadFailedTitle'), e?.message ?? t('common.uploadImageFailed'));
    return null;
  }
}

const Choirs = ({ navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const [choirs, setChoirs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('all');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [actionsOpenId, setActionsOpenId] = useState(null); // card whose edit/delete is revealed
  const [form, setForm] = useState(EMPTY);
  const [profileImage, setProfileImage] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [saving, setSaving] = useState(false);

  const [editMembersId, setEditMembersId] = useState(null);
  const [membersDraft, setMembersDraft] = useState('');

  const load = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true); else setLoading(true);
      const res = await fetchChoirs();
      setChoirs(res?.results ?? (Array.isArray(res) ? res : []));
      setNextUrl(res?.next ?? null);
    } catch (err) {
      console.error('fetchChoirs error:', err);
      Alert.alert(t('common.error'), t('choirs.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  // Infinite scroll: append the next page of choirs, deduped.
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextUrl) return;
    setLoadingMore(true);
    try {
      const res = await fetchChoirsByUrl(nextUrl);
      setChoirs((prev) => {
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

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = choirs;
    if (genre !== 'all') list = list.filter((c) => c.genre === genre);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        c.name?.toLowerCase().includes(q) ||
        c.location?.toLowerCase().includes(q) ||
        GENRE_LABEL[c.genre]?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [choirs, genre, search]);

  // ── Form ──
  const openCreate = () => {
    setEditingId(null); setForm(EMPTY); setProfileImage(''); setCoverImage(''); setShowForm(true);
  };
  const openEdit = (c) => {
    setEditingId(c.id);
    setForm({
      name: c.name || '', description: c.description || '', location: c.location || '',
      contact_phone: c.contact_phone || '', contact_email: c.contact_email || '',
      genre: c.genre || 'gospel', youtube_link: c.youtube_link || '', founded_date: c.founded_date || '',
    });
    setProfileImage(c.profile_image || '');
    setCoverImage(c.cover_image || '');
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(EMPTY); setProfileImage(''); setCoverImage(''); };

  const submit = async () => {
    if (!form.name.trim() || !form.location.trim()) {
      Alert.alert(t('dir.missingInfo'), t('choirs.missingInfo'));
      return;
    }
    if (form.founded_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.founded_date.trim())) {
      Alert.alert(t('choirs.invalidDateTitle'), t('choirs.invalidDate'));
      return;
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      location: form.location.trim(),
      contact_phone: form.contact_phone.trim(),
      contact_email: form.contact_email.trim(),
      genre: form.genre,
      youtube_link: form.youtube_link.trim(),
    };
    if (form.founded_date.trim()) payload.founded_date = form.founded_date.trim();
    // Only send an image when it's a freshly-picked data URI. On edit the field
    // holds a server URL (the list no longer ships base64), so omitting it leaves
    // the stored image untouched instead of overwriting it with the URL string.
    // Send image URLs (uploaded to R2 by the picker) when present. An unchanged
    // existing URL is re-sent harmlessly; a cleared image isn't touched.
    if (profileImage.startsWith('http')) payload.profile_image = profileImage;
    if (coverImage.startsWith('http')) payload.cover_image = coverImage;

    try {
      setSaving(true);
      if (editingId) {
        const updated = await updateChoir(editingId, payload);
        setChoirs((prev) => prev.map((c) => (c.id === editingId ? updated : c)));
      } else {
        const created = await createChoir(payload);
        setChoirs((prev) => [created, ...prev]);
      }
      closeForm();
    } catch (err) {
      const msg = err?.response?.data?.error || t('choirs.saveFailed');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = (c) => {
    Alert.alert(t('choirs.deleteTitle'), t('common.deleteConfirm', { name: c.name }), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const prev = choirs;
          setChoirs((cur) => cur.filter((x) => x.id !== c.id));
          try { await deleteChoir(c.id); }
          catch { setChoirs(prev); Alert.alert(t('common.error'), t('choirs.deleteFailed')); }
        },
      },
    ]);
  };

  const onToggleActive = async (c) => {
    try {
      const res = await toggleChoirActive(c.id);
      setChoirs((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_active: res.is_active } : x)));
    } catch {
      Alert.alert(t('common.error'), t('choirs.statusFailed'));
    }
  };

  const saveMembers = async (c) => {
    const n = parseInt(membersDraft, 10);
    if (isNaN(n) || n < 0) { Alert.alert(t('dir.invalidTitle'), t('dir.invalidNumber')); return; }
    try {
      const res = await updateChoirMembers(c.id, n);
      setChoirs((prev) => prev.map((x) => (x.id === c.id ? { ...x, members_count: res.members_count } : x)));
      setEditMembersId(null);
    } catch {
      Alert.alert(t('common.error'), t('choirs.membersFailed'));
    }
  };

  // ── Card ──
  const renderItem = ({ item }) => {
    const owner = item.is_owner;
    return (
      <View style={styles.card}>
        {/* Cover banner */}
        <View style={styles.banner}>
          {item.cover_image ? (
            <Image source={{ uri: item.cover_image }} style={styles.cover} contentFit="cover" transition={150} />
          ) : (
            <LinearGradient colors={[colors.surface, colors.bg]} style={styles.cover} />
          )}
          {owner && (
            <View style={styles.ownerActions}>
              {actionsOpenId === item.id ? (
                <>
                  <TouchableOpacity style={styles.ownerBtn} onPress={() => { setActionsOpenId(null); openEdit(item); }} hitSlop={6}>
                    <MaterialIcons name="edit" size={18} color={colors.white} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ownerBtn} onPress={() => { setActionsOpenId(null); onDelete(item); }} hitSlop={6}>
                    <MaterialIcons name="delete-outline" size={19} color={colors.white} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ownerBtn} onPress={() => setActionsOpenId(null)} hitSlop={6}>
                    <MaterialIcons name="close" size={18} color={colors.white} />
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={styles.ownerBtn} onPress={() => setActionsOpenId(item.id)} hitSlop={6}>
                  <MaterialIcons name="more-horiz" size={20} color={colors.white} />
                </TouchableOpacity>
              )}
            </View>
          )}
          <View style={[styles.statusPill, item.is_active ? styles.statusActive : styles.statusInactive]}>
            <Text style={styles.statusText}>{item.is_active ? 'Active' : 'Inactive'}</Text>
          </View>
        </View>

        {/* Header: avatar + name */}
        <View style={styles.cardHeader}>
          <Image
            source={item.profile_image ? { uri: item.profile_image } : DEFAULT_AVATAR}
            placeholder={DEFAULT_AVATAR}
            contentFit="cover"
            transition={150}
            style={styles.avatar}
          />
          <View style={styles.headerInfo}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <View style={styles.headerMeta}>
              <Text style={styles.genreBadge}>{GENRE_LABEL[item.genre] || 'Choir'}</Text>
              <Text style={styles.metaDot}>·</Text>
              <Ionicons name="people-outline" size={13} color={colors.textMuted} />
              <Text style={styles.membersText}> {item.members_count || 0}</Text>
            </View>
          </View>
        </View>

        {item.description ? <Text style={styles.description}>{item.description}</Text> : null}

        <View style={styles.details}>
          <Detail icon="location-outline" text={item.location} />
          {item.contact_phone ? <Detail icon="call-outline" text={item.contact_phone} /> : null}
          {item.contact_email ? <Detail icon="mail-outline" text={item.contact_email} /> : null}
          {item.founded_date ? (
            <Detail icon="calendar-outline" text={`Founded ${new Date(item.founded_date).toLocaleDateString()}`} />
          ) : null}
        </View>

        {item.youtube_link ? (
          <TouchableOpacity
            style={styles.youtubeBtn}
            onPress={() => Linking.openURL(item.youtube_link).catch(() => Alert.alert(t('common.error'), t('dir.openLinkFailed')))}
            activeOpacity={0.85}
          >
            <Ionicons name="logo-youtube" size={18} color="#FF0000" />
            <Text style={styles.youtubeText}>{t('choirs.youtubeChannel')}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Community entry point */}
        <TouchableOpacity
          style={styles.communityBtn}
          onPress={() => navigation.navigate('ChoirCommunity', { choir: item, choirId: item.id })}
          activeOpacity={0.9}
        >
          <Ionicons name="chatbubbles" size={18} color="#0A1628" />
          <Text style={styles.communityText}>{t('dir.openCommunity')}</Text>
          <Ionicons name="chevron-forward" size={16} color="#0A1628" style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>

        {/* Owner controls */}
        {owner && (
          <View style={styles.ownerControls}>
            {editMembersId === item.id ? (
              <View style={styles.membersEdit}>
                <TextInput
                  style={styles.membersInput}
                  value={membersDraft}
                  onChangeText={setMembersDraft}
                  keyboardType="numeric"
                  placeholder={t('choirs.members')}
                  placeholderTextColor={colors.placeholder}
                  autoFocus
                />
                <TouchableOpacity style={styles.miniBtnPrimary} onPress={() => saveMembers(item)}>
                  <MaterialIcons name="check" size={18} color={colors.white} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.miniBtn} onPress={() => setEditMembersId(null)}>
                  <MaterialIcons name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.ctrlBtn}
                onPress={() => { setEditMembersId(item.id); setMembersDraft(String(item.members_count || 0)); }}
              >
                <MaterialIcons name="groups" size={16} color={colors.primary} />
                <Text style={styles.ctrlText}>{t('choirs.members')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.ctrlBtn} onPress={() => onToggleActive(item)}>
              <MaterialIcons name={item.is_active ? 'toggle-on' : 'toggle-off'} size={20} color={item.is_active ? colors.success : colors.textMuted} />
              <Text style={styles.ctrlText}>{item.is_active ? 'Active' : 'Inactive'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <View style={styles.root}>
      <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('choirs.title')}</Text>
        <Text style={styles.subtitle}>{t('choirs.subtitle')}</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.placeholder} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('choirs.searchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={() => load(true)}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={7}
        removeClippedSubviews
        ListFooterComponent={
          loadingMore
            ? <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.md }} />
            : null
        }
        ListHeaderComponent={
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.filterRow}>
            {FILTERS.map((g) => {
              const active = g.key === genre;
              return (
                <TouchableOpacity
                  key={g.key}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setGenre(g.key)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>{g.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcons name="library-music" size={46} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('choirs.none')}</Text>
          </View>
        }
      />

      {currentUser && (
        <TouchableOpacity style={styles.fab} onPress={openCreate} activeOpacity={0.9}>
          <Ionicons name="add" size={20} color={colors.white} />
          <Text style={styles.fabText}>{t('choirs.add')}</Text>
        </TouchableOpacity>
      )}

      {/* Add / Edit form */}
      <Modal visible={showForm} animationType="slide" onRequestClose={closeForm} statusBarTranslucent>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={closeForm} style={styles.iconBtn} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.topTitle}>{editingId ? 'Edit Choir' : 'New Choir'}</Text>
            <View style={styles.iconBtn} />
          </View>

          <KeyboardAwareScrollView
            style={styles.flex}
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            enableOnAndroid
            enableResetScrollToCoords={false}
            extraScrollHeight={Platform.OS === 'ios' ? 24 : 90}
          >
            {/* Cover + profile pickers */}
            <TouchableOpacity style={styles.coverPicker} onPress={async () => { const u = await pickAndUpload([16, 9], 800, 'cover', t); if (u) setCoverImage(u); }} activeOpacity={0.85}>
              {coverImage ? (
                <Image source={{ uri: coverImage }} style={styles.coverPreview} contentFit="cover" transition={150} />
              ) : (
                <View style={styles.coverPlaceholder}>
                  <Ionicons name="image-outline" size={26} color={colors.textMuted} />
                  <Text style={styles.pickerHint}>{t('dir.addCover')}</Text>
                </View>
              )}
            </TouchableOpacity>

            <View style={styles.profileRow}>
              <TouchableOpacity style={styles.profilePicker} onPress={async () => { const u = await pickAndUpload([1, 1], 400, 'profile-image', t); if (u) setProfileImage(u); }} activeOpacity={0.85}>
                {profileImage ? (
                  <Image source={{ uri: profileImage }} style={styles.profilePreview} contentFit="cover" transition={150} />
                ) : (
                  <Ionicons name="camera-outline" size={24} color={colors.textMuted} />
                )}
              </TouchableOpacity>
              <Text style={styles.profileHint}>{t('choirs.logo')}</Text>
            </View>

            <Field label="Choir name *" value={form.name} onChange={(t) => setForm({ ...form, name: t })} placeholder={t('choirs.namePlaceholder')} />
            <Field label="Description" value={form.description} onChange={(t) => setForm({ ...form, description: t })} placeholder={t('choirs.aboutPlaceholder')} multiline />
            <Field label="Location *" value={form.location} onChange={(t) => setForm({ ...form, location: t })} placeholder={t('dir.cityCountry')} />

            <Text style={styles.fieldLabel}>{t('choirs.genre')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.genreRow}>
              {GENRES.map((g) => {
                const active = form.genre === g.key;
                return (
                  <TouchableOpacity key={g.key} style={[styles.filterChip, active && styles.filterChipActive]} onPress={() => setForm({ ...form, genre: g.key })}>
                    <Text style={[styles.filterText, active && styles.filterTextActive]}>{g.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Field label="Contact phone" value={form.contact_phone} onChange={(t) => setForm({ ...form, contact_phone: t })} placeholder={t('dir.phonePlaceholder')} keyboardType="phone-pad" />
            <Field label="Contact email" value={form.contact_email} onChange={(t) => setForm({ ...form, contact_email: t })} placeholder={t('choirs.emailPlaceholder')} keyboardType="email-address" />
            <Field label="YouTube link" value={form.youtube_link} onChange={(t) => setForm({ ...form, youtube_link: t })} placeholder={t('dir.youtubePlaceholder')} keyboardType="url" />
            <Field label="Founded date" value={form.founded_date} onChange={(t) => setForm({ ...form, founded_date: t })} placeholder={t('choirs.datePlaceholder')} />

            <View style={{ height: spacing.xl }} />
          </KeyboardAwareScrollView>

          <View style={styles.saveBar}>
            <TouchableOpacity style={[styles.saveBtn, styles.cancelBtn]} onPress={closeForm} disabled={saving}>
              <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, styles.submitBtn]} onPress={submit} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.white} /> : (
                <Text style={styles.submitBtnText}>{editingId ? 'Save Changes' : 'Add Choir'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
      </View>
    </View>
  );
};

const Detail = ({ icon, text }) => (
  <View style={styles.detailRow}>
    <Ionicons name={icon} size={15} color={colors.textMuted} />
    <Text style={styles.detailText} numberOfLines={1}>{text}</Text>
  </View>
);

const Field = ({ label, value, onChange, placeholder, multiline, keyboardType }) => (
  <>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      style={[styles.input, multiline && styles.multiline]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.placeholder}
      multiline={multiline}
      keyboardType={keyboardType}
      autoCapitalize={keyboardType === 'email-address' || keyboardType === 'url' ? 'none' : 'sentences'}
      autoCorrect={false}
    />
  </>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  screen: { flex: 1, backgroundColor: 'transparent' },
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },

  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: {
    ...typography.h1, color: colors.textPrimary,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  subtitle: {
    ...typography.caption, color: colors.textSecondary, marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5,
  },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: 'rgba(18,30,46,0.82)', borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: spacing.md, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },

  chipScroll: { flexGrow: 0 },
  filterRow: { gap: spacing.sm, paddingVertical: spacing.sm, flexDirection: 'row' },
  filterChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  filterTextActive: { color: colors.white },

  listContent: { paddingHorizontal: spacing.md, paddingBottom: 96 },

  card: {
    backgroundColor: 'rgba(18,30,46,0.82)', borderRadius: radius.lg, overflow: 'hidden',
    marginBottom: spacing.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', ...shadows.md,
  },
  banner: { height: 120, backgroundColor: colors.surface },
  cover: { width: '100%', height: '100%' },
  ownerActions: { position: 'absolute', top: spacing.sm, right: spacing.sm, flexDirection: 'row', gap: spacing.xs },
  ownerBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  statusPill: { position: 'absolute', top: spacing.sm, left: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
  statusActive: { backgroundColor: 'rgba(67,160,71,0.9)' },
  statusInactive: { backgroundColor: 'rgba(0,0,0,0.55)' },
  statusText: { ...typography.caption, color: colors.white, fontWeight: '700', fontSize: 10.5 },

  cardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, marginTop: -22 },
  avatar: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: colors.card,
    backgroundColor: colors.surface,
  },
  headerInfo: { flex: 1, marginLeft: spacing.sm, paddingTop: 22 },
  name: { ...typography.h3, color: colors.textPrimary },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  genreBadge: { ...typography.caption, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10.5 },
  metaDot: { color: colors.textMuted },
  membersText: { ...typography.caption, color: colors.textMuted },

  description: { ...typography.body, color: colors.textSecondary, paddingHorizontal: spacing.md, marginTop: spacing.sm, lineHeight: 20 },

  details: { paddingHorizontal: spacing.md, marginTop: spacing.sm, gap: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  detailText: { ...typography.caption, color: colors.textSecondary, flex: 1 },

  youtubeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginHorizontal: spacing.md, marginTop: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
  },
  youtubeText: { ...typography.label, color: colors.textPrimary, fontWeight: '600' },

  communityBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginHorizontal: spacing.md, marginTop: spacing.sm,
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, ...shadows.sm,
  },
  communityText: { ...typography.label, color: '#0A1628', fontWeight: '800' },

  ownerControls: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.md,
    paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  ctrlBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface },
  ctrlText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  membersEdit: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  membersInput: {
    width: 90, height: 38, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, color: colors.textPrimary, backgroundColor: colors.inputBg,
  },
  miniBtn: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  miniBtnPrimary: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted },

  fab: {
    position: 'absolute', bottom: spacing.lg, right: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
    borderRadius: radius.full, ...shadows.lg,
  },
  fabText: { ...typography.button, color: colors.white },

  // Form
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  formContent: { padding: spacing.md },

  coverPicker: { height: 150, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  coverPreview: { width: '100%', height: '100%' },
  coverPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  pickerHint: { ...typography.caption, color: colors.textMuted },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  profilePicker: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  profilePreview: { width: '100%', height: '100%' },
  profileHint: { ...typography.caption, color: colors.textMuted, flex: 1 },

  fieldLabel: { ...typography.label, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 15,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  genreRow: { gap: spacing.sm, paddingVertical: spacing.xs },

  saveBar: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  saveBtn: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.md, alignItems: 'center' },
  cancelBtn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  cancelBtnText: { ...typography.button, color: colors.textSecondary },
  submitBtn: { backgroundColor: colors.primary },
  submitBtnText: { ...typography.button, color: colors.white },
});

export default Choirs;
