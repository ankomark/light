import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, Image, Linking, Modal, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../services/imageProcessing';
import {
  fetchVideoStudios, createVideoStudio, updateVideoStudio, deleteVideoStudio,
} from '../services/api';
import { useAuth } from '../context/useAuth';
import { uploadMedia } from '../services/cloudinary';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

// Top-level Services buckets. `key` is stored in Videostudio.category.
const CATEGORIES = [
  { key: 'media', labelKey: 'services.cat.media' },
  { key: 'hospitality', labelKey: 'services.cat.hospitality' },
  { key: 'health', labelKey: 'services.cat.health' },
  { key: 'professional', labelKey: 'services.cat.professional' },
  { key: 'home', labelKey: 'services.cat.home' },
];

// Per-category service-type tags. Keys are stored (free-form) in
// Videostudio.service_types; labels are localised via i18n keys.
const SERVICE_TYPES_BY_CATEGORY = {
  media: [
    ['music_video', 'services.type.music_video'],
    ['live_event', 'services.type.live_event'],
    ['editing', 'services.type.editing'],
    ['recording', 'services.type.recording'],
    ['mixing', 'services.type.mixing'],
    ['voice_over', 'services.type.voice_over'],
    ['podcast', 'services.type.podcast'],
    ['documentary', 'services.type.documentary'],
    ['other', 'services.type.other'],
  ],
  hospitality: [
    ['hotel', 'services.type.hotel'],
    ['lodge', 'services.type.lodge'],
    ['restaurant', 'services.type.restaurant'],
    ['catering', 'services.type.catering'],
    ['event_venue', 'services.type.event_venue'],
    ['tours', 'services.type.tours'],
    ['transport', 'services.type.transport'],
    ['other', 'services.type.other'],
  ],
  health: [
    ['clinic', 'services.type.clinic'],
    ['counseling', 'services.type.counseling'],
    ['dental', 'services.type.dental'],
    ['pharmacy', 'services.type.pharmacy'],
    ['fitness', 'services.type.fitness'],
    ['nutrition', 'services.type.nutrition'],
    ['home_care', 'services.type.home_care'],
    ['other', 'services.type.other'],
  ],
  professional: [
    ['legal', 'services.type.legal'],
    ['accounting', 'services.type.accounting'],
    ['consulting', 'services.type.consulting'],
    ['it_services', 'services.type.it_services'],
    ['design', 'services.type.design'],
    ['tutoring', 'services.type.tutoring'],
    ['translation', 'services.type.translation'],
    ['other', 'services.type.other'],
  ],
  home: [
    ['plumbing', 'services.type.plumbing'],
    ['electrical', 'services.type.electrical'],
    ['cleaning', 'services.type.cleaning'],
    ['carpentry', 'services.type.carpentry'],
    ['painting', 'services.type.painting'],
    ['gardening', 'services.type.gardening'],
    ['moving', 'services.type.moving'],
    ['other', 'services.type.other'],
  ],
};
// Flat key -> i18n label-key map across every category (for card tags / search).
const SERVICE_LABEL_KEY = Object.fromEntries(
  Object.values(SERVICE_TYPES_BY_CATEGORY).flat(),
);
const serviceLabel = (key, t) => (SERVICE_LABEL_KEY[key] ? t(SERVICE_LABEL_KEY[key]) : key);

const CURRENCIES = ['USD', 'EUR', 'GBP', 'KES', 'NGN', 'GHS', 'ZAR', 'TZS', 'UGX'];
const CURRENCY_SYMBOL = {
  USD: '$', EUR: '€', GBP: '£', KES: 'KSh', NGN: '₦', GHS: 'GH₵', ZAR: 'R', TZS: 'TSh', UGX: 'USh',
};

const EMPTY = {
  name: '', description: '', location: '', contact_phone: '', contact_email: '',
  whatsapp_number: '', category: 'media', service_types: [], youtube_link: '', service_rates: '',
  rate_description: '', currency: 'USD',
};

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

async function pickAndUpload(aspect, width, type, t) {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert(t('chat.permissionRequired'), t('dir.permissionPhotos'));
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect, quality: 0.8,
  });
  if (result.canceled || !result.assets?.length) return null;
  const processed = await compressImage(result.assets[0].uri, { width, quality: 0.6 });
  try {
    const uploaded = await uploadMedia(
      { uri: processed.uri, name: `studio_${Date.now()}.jpg`, mimeType: 'image/jpeg' },
      type,
    );
    return uploaded.url;
  } catch (e) {
    Alert.alert(t('common.uploadFailedTitle'), e?.message ?? t('common.uploadImageFailed'));
    return null;
  }
}

const Studios = () => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const [studios, setStudios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [actionsOpenId, setActionsOpenId] = useState(null); // card whose edit/delete is revealed
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [logo, setLogo] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true); else setLoading(true);
      const res = await fetchVideoStudios();
      const list = Array.isArray(res) ? res : (res?.results ?? []);
      setStudios(list.map((s) => ({ ...s, service_types: Array.isArray(s.service_types) ? s.service_types : [] })));
    } catch (err) {
      console.error('fetchVideoStudios error:', err);
      Alert.alert(t('common.error'), t('studios.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = studios;
    if (categoryFilter !== 'all') list = list.filter((s) => (s.category || 'media') === categoryFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((s) =>
        s.name?.toLowerCase().includes(q) ||
        s.location?.toLowerCase().includes(q) ||
        s.service_types?.some((k) => serviceLabel(k, t).toLowerCase().includes(q))
      );
    }
    return list;
  }, [studios, categoryFilter, search, t]);

  const openCreate = () => {
    setEditingId(null);
    // Pre-select the category the user is currently browsing.
    const cat = categoryFilter !== 'all' ? categoryFilter : 'media';
    setForm({ ...EMPTY, category: cat });
    setLogo(''); setCoverImage(''); setShowForm(true);
  };
  const openEdit = (s) => {
    setEditingId(s.id);
    setForm({
      name: s.name || '', description: s.description || '', location: s.location || '',
      contact_phone: s.contact_phone || '', contact_email: s.contact_email || '',
      whatsapp_number: s.whatsapp_number || '', category: s.category || 'media',
      service_types: s.service_types || [],
      youtube_link: s.youtube_link || '', service_rates: s.service_rates ? String(s.service_rates) : '',
      rate_description: s.rate_description || '', currency: s.currency || 'USD',
    });
    setLogo(s.logo || ''); setCoverImage(s.cover_image || ''); setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(EMPTY); setLogo(''); setCoverImage(''); };

  const toggleService = (key) => {
    setForm((p) => ({
      ...p,
      service_types: p.service_types.includes(key)
        ? p.service_types.filter((k) => k !== key)
        : [...p.service_types, key],
    }));
  };

  const selectCategory = (cat) => {
    // Switching category clears tags that don't belong to the new one.
    const allowed = new Set(SERVICE_TYPES_BY_CATEGORY[cat].map(([k]) => k));
    setForm((p) => ({
      ...p,
      category: cat,
      service_types: p.service_types.filter((k) => allowed.has(k)),
    }));
  };

  const submit = async () => {
    if (!form.name.trim() || !form.location.trim() || form.service_types.length === 0) {
      Alert.alert(t('dir.missingInfo'), t('studios.missingInfo'));
      return;
    }
    const payload = {
      name: form.name.trim(), description: form.description.trim(), location: form.location.trim(),
      contact_phone: form.contact_phone.trim(), contact_email: form.contact_email.trim(),
      whatsapp_number: form.whatsapp_number.trim(), category: form.category,
      service_types: form.service_types,
      youtube_link: form.youtube_link.trim(), rate_description: form.rate_description.trim(),
      currency: form.currency,
    };
    const rate = form.service_rates.trim();
    payload.service_rates = rate ? rate : null;
    // Only send an image when it's a freshly-picked data URI. On edit the field
    // holds a server URL (the list no longer ships base64), so omitting it leaves
    // the stored image untouched instead of overwriting it with the URL string.
    if (logo.startsWith('http')) payload.logo = logo;
    if (coverImage.startsWith('http')) payload.cover_image = coverImage;

    try {
      setSaving(true);
      if (editingId) {
        const updated = await updateVideoStudio(editingId, payload);
        setStudios((prev) => prev.map((s) => (s.id === editingId ? updated : s)));
      } else {
        const created = await createVideoStudio(payload);
        setStudios((prev) => [created, ...prev]);
      }
      closeForm();
    } catch (err) {
      const msg = err?.response?.data?.error || t('studios.saveFailed');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = (s) => {
    Alert.alert(t('studios.deleteTitle'), t('common.deleteConfirm', { name: s.name }), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const prev = studios;
          setStudios((cur) => cur.filter((x) => x.id !== s.id));
          try { await deleteVideoStudio(s.id); }
          catch { setStudios(prev); Alert.alert(t('common.error'), t('studios.deleteFailed')); }
        },
      },
    ]);
  };

  const openLink = (url) => Linking.openURL(url).catch(() => Alert.alert(t('common.error'), t('dir.openLinkFailed')));
  const openWhatsApp = (num) => openLink(`https://wa.me/${num.replace(/[^\d]/g, '')}`);

  const rateText = (s) => {
    if (!s.service_rates) return null;
    const sym = CURRENCY_SYMBOL[s.currency] || '';
    return `${sym}${s.service_rates}${s.rate_description ? ` · ${s.rate_description}` : ''}`;
  };

  const renderItem = ({ item }) => {
    const owner = item.is_owner;
    return (
      <View style={styles.card}>
        <View style={styles.banner}>
          {item.cover_image ? (
            <Image source={{ uri: item.cover_image }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverFallback]}>
              <MaterialIcons name="videocam" size={34} color={colors.textMuted} />
            </View>
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
        </View>

        <View style={styles.cardHeader}>
          <Image
            source={item.logo ? { uri: item.logo } : DEFAULT_AVATAR}
            defaultSource={DEFAULT_AVATAR}
            style={styles.avatar}
          />
          <View style={styles.headerInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              {item.is_verified && <MaterialIcons name="verified" size={16} color={colors.primary} />}
            </View>
            <View style={styles.headerMeta}>
              <Ionicons name="location-outline" size={13} color={colors.textMuted} />
              <Text style={styles.metaText} numberOfLines={1}> {item.location}</Text>
            </View>
          </View>
        </View>

        {item.description ? <Text style={styles.description} numberOfLines={3}>{item.description}</Text> : null}

        {item.service_types?.length > 0 && (
          <View style={styles.serviceTags}>
            {item.service_types.map((k) => (
              <View key={k} style={styles.serviceTag}>
                <Text style={styles.serviceTagText}>{serviceLabel(k, t)}</Text>
              </View>
            ))}
          </View>
        )}

        {rateText(item) ? (
          <View style={styles.rateRow}>
            <MaterialIcons name="payments" size={16} color={colors.accent} />
            <Text style={styles.rateText}>{rateText(item)}</Text>
          </View>
        ) : null}

        <View style={styles.contactRow}>
          {item.contact_phone ? (
            <TouchableOpacity style={styles.contactBtn} onPress={() => openLink(`tel:${item.contact_phone}`)}>
              <Ionicons name="call" size={16} color={colors.textPrimary} />
              <Text style={styles.contactText}>{t('studios.call')}</Text>
            </TouchableOpacity>
          ) : null}
          {item.whatsapp_number ? (
            <TouchableOpacity style={styles.contactBtn} onPress={() => openWhatsApp(item.whatsapp_number)}>
              <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
              <Text style={styles.contactText}>{t('studios.whatsapp')}</Text>
            </TouchableOpacity>
          ) : null}
          {item.youtube_link ? (
            <TouchableOpacity style={styles.contactBtn} onPress={() => openLink(item.youtube_link)}>
              <Ionicons name="logo-youtube" size={16} color="#FF0000" />
              <Text style={styles.contactText}>{t('studios.youtube')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('studios.title')}</Text>
        <Text style={styles.subtitle}>{t('studios.subtitle')}</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.placeholder} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('studios.searchPlaceholder')}
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
        ListHeaderComponent={
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.filterRow}>
            {[{ key: 'all', labelKey: 'services.cat.all' }, ...CATEGORIES].map((c) => {
              const active = c.key === categoryFilter;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setCategoryFilter(c.key)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>{t(c.labelKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcons name="movie-filter" size={46} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('studios.none')}</Text>
          </View>
        }
      />

      {currentUser && (
        <TouchableOpacity style={styles.fab} onPress={openCreate} activeOpacity={0.9}>
          <Ionicons name="add" size={20} color={colors.white} />
          <Text style={styles.fabText}>{t('studios.create')}</Text>
        </TouchableOpacity>
      )}

      <Modal visible={showForm} animationType="slide" onRequestClose={closeForm} statusBarTranslucent>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={closeForm} style={styles.iconBtn} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.topTitle}>{editingId ? t('services.editTitle') : t('services.newTitle')}</Text>
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
            <TouchableOpacity style={styles.coverPicker} onPress={async () => { const u = await pickAndUpload([16, 9], 800, 'cover', t); if (u) setCoverImage(u); }} activeOpacity={0.85}>
              {coverImage ? <Image source={{ uri: coverImage }} style={styles.coverPreview} /> : (
                <View style={styles.coverPlaceholder}>
                  <Ionicons name="image-outline" size={26} color={colors.textMuted} />
                  <Text style={styles.pickerHint}>{t('dir.addCover')}</Text>
                </View>
              )}
            </TouchableOpacity>

            <View style={styles.profileRow}>
              <TouchableOpacity style={styles.profilePicker} onPress={async () => { const u = await pickAndUpload([1, 1], 400, 'cover', t); if (u) setLogo(u); }} activeOpacity={0.85}>
                {logo ? <Image source={{ uri: logo }} style={styles.profilePreview} /> : <Ionicons name="camera-outline" size={24} color={colors.textMuted} />}
              </TouchableOpacity>
              <Text style={styles.profileHint}>{t('studios.logo')}</Text>
            </View>

            <Field label={t('services.nameLabel')} value={form.name} onChange={(t) => setForm({ ...form, name: t })} placeholder={t('studios.namePlaceholder')} />
            <Field label={t('services.descLabel')} value={form.description} onChange={(t) => setForm({ ...form, description: t })} placeholder={t('studios.aboutPlaceholder')} multiline />
            <Field label={t('services.locationLabel')} value={form.location} onChange={(t) => setForm({ ...form, location: t })} placeholder={t('dir.cityCountry')} />

            <Text style={styles.fieldLabel}>{t('services.category')}</Text>
            <View style={styles.serviceWrap}>
              {CATEGORIES.map((c) => {
                const active = form.category === c.key;
                return (
                  <TouchableOpacity key={c.key} style={[styles.serviceChip, active && styles.serviceChipActive]} onPress={() => selectCategory(c.key)} activeOpacity={0.85}>
                    {active && <Ionicons name="checkmark" size={13} color={colors.white} />}
                    <Text style={[styles.serviceChipText, active && styles.serviceChipTextActive]}>{t(c.labelKey)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>{t('studios.services')}</Text>
            <View style={styles.serviceWrap}>
              {(SERVICE_TYPES_BY_CATEGORY[form.category] || []).map(([key, labelKey]) => {
                const active = form.service_types.includes(key);
                return (
                  <TouchableOpacity key={key} style={[styles.serviceChip, active && styles.serviceChipActive]} onPress={() => toggleService(key)} activeOpacity={0.85}>
                    {active && <Ionicons name="checkmark" size={13} color={colors.white} />}
                    <Text style={[styles.serviceChipText, active && styles.serviceChipTextActive]}>{t(labelKey)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>{t('studios.rate')}</Text>
            <View style={styles.rateInputRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.currencyScroll} contentContainerStyle={styles.currencyRow}>
                {CURRENCIES.map((c) => {
                  const active = form.currency === c;
                  return (
                    <TouchableOpacity key={c} style={[styles.currencyChip, active && styles.currencyChipActive]} onPress={() => setForm({ ...form, currency: c })}>
                      <Text style={[styles.currencyText, active && styles.currencyTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
            <TextInput
              style={styles.input}
              value={form.service_rates}
              onChangeText={(t) => setForm({ ...form, service_rates: t })}
              placeholder={t('studios.amountPlaceholder')}
              placeholderTextColor={colors.placeholder}
              keyboardType="numeric"
            />
            <Field label="" value={form.rate_description} onChange={(t) => setForm({ ...form, rate_description: t })} placeholder={t('studios.rateNotePlaceholder')} />

            <Field label="WhatsApp number" value={form.whatsapp_number} onChange={(t) => setForm({ ...form, whatsapp_number: t })} placeholder={t('dir.phonePlaceholder')} keyboardType="phone-pad" />
            <Field label="Contact phone" value={form.contact_phone} onChange={(t) => setForm({ ...form, contact_phone: t })} placeholder={t('dir.phonePlaceholder')} keyboardType="phone-pad" />
            <Field label="Contact email" value={form.contact_email} onChange={(t) => setForm({ ...form, contact_email: t })} placeholder={t('studios.emailPlaceholder')} keyboardType="email-address" />
            <Field label="YouTube link" value={form.youtube_link} onChange={(t) => setForm({ ...form, youtube_link: t })} placeholder={t('dir.youtubePlaceholder')} keyboardType="url" />

            <View style={{ height: spacing.xl }} />
          </KeyboardAwareScrollView>

          <View style={styles.saveBar}>
            <TouchableOpacity style={[styles.saveBtn, styles.cancelBtn]} onPress={closeForm} disabled={saving}>
              <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, styles.submitBtn]} onPress={submit} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.white} /> : (
                <Text style={styles.submitBtnText}>{editingId ? 'Save Changes' : 'Create Studio'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
};

const Field = ({ label, value, onChange, placeholder, multiline, keyboardType }) => (
  <>
    {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
    <TextInput
      style={[styles.input, multiline && styles.multiline, !label && { marginTop: spacing.sm }]}
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
  container: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },

  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.card, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
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

  card: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  banner: { height: 120, backgroundColor: colors.surface },
  cover: { width: '100%', height: '100%' },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  ownerActions: { position: 'absolute', top: spacing.sm, right: spacing.sm, flexDirection: 'row', gap: spacing.xs },
  ownerBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },

  cardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, marginTop: -22 },
  avatar: { width: 56, height: 56, borderRadius: radius.md, borderWidth: 3, borderColor: colors.card, backgroundColor: colors.surface },
  headerInfo: { flex: 1, marginLeft: spacing.sm, paddingTop: 22 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...typography.h3, color: colors.textPrimary, flexShrink: 1 },
  headerMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  metaText: { ...typography.caption, color: colors.textMuted, flex: 1 },

  description: { ...typography.body, color: colors.textSecondary, paddingHorizontal: spacing.md, marginTop: spacing.sm, lineHeight: 20 },

  serviceTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  serviceTag: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  serviceTagText: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },

  rateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  rateText: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },

  contactRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.md },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.md },
  contactText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted },

  fab: {
    position: 'absolute', bottom: spacing.lg, right: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
    borderRadius: radius.full, ...shadows.lg,
  },
  fabText: { ...typography.button, color: colors.white },

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
  profilePicker: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  profilePreview: { width: '100%', height: '100%' },
  profileHint: { ...typography.caption, color: colors.textMuted, flex: 1 },

  fieldLabel: { ...typography.label, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 15,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },

  serviceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  serviceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  serviceChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  serviceChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  serviceChipTextActive: { color: colors.white },

  rateInputRow: { marginBottom: spacing.sm },
  currencyScroll: { flexGrow: 0 },
  currencyRow: { gap: spacing.xs, flexDirection: 'row' },
  currencyChip: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  currencyChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  currencyText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  currencyTextActive: { color: colors.white },

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

export default Studios;
