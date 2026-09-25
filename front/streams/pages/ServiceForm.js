// List a service, or edit yours: cover and logo, name, what it's about,
// where, the category and the services in it, a price (optional), how to
// reach you, your links. A page of its own (it used to be a pop-up):
// safe areas, the keyboard kept off the field, and leaving with unsaved
// changes asks first.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../services/imageProcessing';
import { uploadMedia } from '../services/cloudinary';
import { createVideoStudio, updateVideoStudio, fetchOrganizations } from '../services/api';
import { peekCache, writeCache, userKey } from '../utils/screenCache';
import { useAuth } from '../context/useAuth';
import PlaceSheet from '../components/services/PlaceSheet';
import {
  CATEGORIES, SERVICE_TYPES_BY_CATEGORY, SOCIAL_LINKS, CURRENCIES, DAYS, serviceLabel, withScheme, noteServicesChanged,
} from '../services/servicesCatalog';
import { confirmAction, notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const GALLERY_MAX = 12;
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const WEEKDAYS = ['tue', 'wed', 'thu', 'fri'];
// 8:00 → 08:00, 830 → 08:30: forgiving about how a time is typed.
export const tidyTime = (v) => {
  const d = String(v || '').replace(/[^\d]/g, '');
  if (!d) return '';
  const [h, m] = d.length <= 2 ? [d, '00'] : [d.slice(0, d.length - 2), d.slice(-2)];
  return `${h.padStart(2, '0')}:${m}`;
};

const EMPTY = {
  name: '', description: '', location: '', contact_phone: '', contact_email: '', whatsapp_number: '',
  category: 'media', service_types: [], service_rates: '', rate_description: '', currency: 'KES',
  website_link: '', facebook_link: '', instagram_link: '', tiktok_link: '', twitter_link: '', youtube_link: '',
};
const LINK_KEYS = SOCIAL_LINKS.map((s) => s.key);

const fromService = (s) => ({
  ...EMPTY,
  ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, s[k] ?? EMPTY[k]])),
  service_types: Array.isArray(s.service_types) ? s.service_types : [],
  service_rates: s.service_rates ? String(s.service_rates) : '',
  currency: s.currency || 'KES',
});

const Field = ({ label, value, onChange, placeholder, multiline, keyboardType, testID }) => (
  <>
    {label ? <Text style={styles.label}>{label}</Text> : null}
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
      testID={testID}
    />
  </>
);

const ServiceForm = ({ route, navigation }) => {
  const { t, resolvedLanguage } = useI18n();
  const existing = route.params?.service || null;
  const [form, setForm] = useState(() => (existing ? fromService(existing)
    : { ...EMPTY, category: route.params?.category || 'media' }));
  const [logo, setLogo] = useState(existing?.logo || '');
  const [cover, setCover] = useState(existing?.cover_image || '');
  const [gallery, setGallery] = useState(() => existing?.gallery || []);
  const [hours, setHours] = useState(() => existing?.opening_hours || {});
  // Listed under an organisation its owner belongs to (a church clinic,
  // a school), or their own name.
  const { currentUser } = useAuth();
  const orgsKey = userKey(currentUser?.id, 'orgs:mine');
  const [orgSlug, setOrgSlug] = useState(existing?.organization?.slug || '');
  // Its pin on the map (for near me and distances): the phone's location or a place found by name.
  const [pin, setPin] = useState(() => (existing?.latitude != null ? { lat: existing.latitude, lng: existing.longitude } : null));
  const [pinning, setPinning] = useState(false);
  const [myOrgs, setMyOrgs] = useState(() => peekCache(orgsKey) || []);
  useEffect(() => {
    fetchOrganizations({ mine: 1 }).then((r) => { const rows = r?.results || []; setMyOrgs(rows); writeCache(orgsKey, rows); }).catch(() => {});
  }, [orgsKey]);
  const [uploading, setUploading] = useState(null);           // 'logo' | 'cover'
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  // Leaving with changes asks first (a swipe, the back button, the X).
  const start = useRef(JSON.stringify({ form, logo, cover, gallery, hours, orgSlug, pin }));
  const leaving = useRef(false);
  const dirty = JSON.stringify({ form, logo, cover, gallery, hours, orgSlug, pin }) !== start.current;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (!dirtyRef.current || leaving.current) return;
    e.preventDefault();
    confirmAction({
      title: t('pub.leaveTitle'), message: t('pub.leaveBody'),
      confirmLabel: t('pub.discard'), cancelLabel: t('pub.keepEditing'), destructive: true,
    }).then((ok) => { if (ok) { leaving.current = true; navigation.dispatch(e.data.action); } });
  }), [navigation, t]);

  const pick = async (which) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { notify(t('chat.permissionRequired'), t('dir.permissionPhotos')); return; }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true,
      aspect: which === 'logo' ? [1, 1] : which === 'gallery' ? [1, 1] : [16, 9], quality: 0.8,
    });
    if (r.canceled || !r.assets?.length) return;
    setUploading(which);
    try {
      const small = await compressImage(r.assets[0].uri, { width: which === 'logo' ? 400 : which === 'gallery' ? 1200 : 1000, quality: 0.65 });
      const up = await uploadMedia({ uri: small.uri, name: `service_${Date.now()}.jpg`, mimeType: 'image/jpeg' }, 'cover');
      if (which === 'gallery') setGallery((g) => [...g, up.url].slice(0, GALLERY_MAX));
      else (which === 'logo' ? setLogo : setCover)(up.url);
    } catch (e) {
      notify(t('common.uploadFailedTitle'), e?.message || t('common.uploadImageFailed'));
    } finally {
      setUploading(null);
    }
  };

  const toggleTag = (key) => setForm((f) => ({
    ...f,
    service_types: f.service_types.includes(key) ? f.service_types.filter((k) => k !== key) : [...f.service_types, key],
  }));
  const selectCategory = (cat) => {
    // A new category: tags that aren't in it go.
    const allowed = new Set(SERVICE_TYPES_BY_CATEGORY[cat]);
    setForm((f) => ({ ...f, category: cat, service_types: f.service_types.filter((k) => allowed.has(k)) }));
  };

  const save = async () => {
    if (!form.name.trim() || !form.location.trim() || !form.service_types.length) {
      notify(t('dir.missingInfo'), t('studios.missingInfo'));
      return;
    }
    const payload = {
      name: form.name.trim(), description: form.description.trim(), location: form.location.trim(),
      contact_phone: form.contact_phone.trim(), contact_email: form.contact_email.trim(),
      whatsapp_number: form.whatsapp_number.trim(), category: form.category, service_types: form.service_types,
      rate_description: form.rate_description.trim(), currency: form.currency,
      service_rates: form.service_rates.trim() || null,
    };
    // Opening hours: every open day needs both times, closing after opening.
    const badDay = Object.entries(hours).find(([, [a, b]]) => !HHMM.test(a) || !HHMM.test(b) || a >= b);
    if (badDay) {
      notify(t('services.hours'), t('services.hoursInvalid', { day: t(`services.day.${badDay[0]}`) }));
      return;
    }
    payload.opening_hours = hours;
    payload.organization_slug = orgSlug;
    payload.latitude = pin ? Number(pin.lat.toFixed(6)) : null;
    payload.longitude = pin ? Number(pin.lng.toFixed(6)) : null;
    payload.gallery = gallery.filter((u) => u.startsWith('http'));
    // Links: filled in ones as real addresses ("instagram.com/x" → https://…).
    LINK_KEYS.forEach((k) => { const v = form[k].trim(); payload[k] = v ? withScheme(v) : ''; });
    // Pictures: only new uploads (addresses); an old base64 one stays as it is.
    if (logo.startsWith('http')) payload.logo = logo;
    if (cover.startsWith('http')) payload.cover_image = cover;
    setSaving(true);
    try {
      const saved = existing ? await updateVideoStudio(existing.id, payload) : await createVideoStudio(payload);
      noteServicesChanged({
        item: { ...saved, logo: saved.logo || logo, cover_image: saved.cover_image || cover, is_owner: true },
        created: !existing,
      });
      leaving.current = true;
      navigation.goBack();
    } catch (err) {
      const data = err?.data || {};
      const first = Object.values(data).flat().find((v) => typeof v === 'string');
      notify(t('common.error'), data.error || first || t('studios.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.close')} testID="service-form-close">
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{existing ? t('services.editTitle') : t('services.newTitle')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false} enableOnAndroid enableResetScrollToCoords={false}
        extraScrollHeight={Platform.OS === 'ios' ? 24 : 90}>
        <TouchableOpacity style={styles.coverPicker} onPress={() => pick('cover')} disabled={!!uploading} testID="service-cover">
          {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" /> : (
            <View style={styles.coverEmpty}>
              <Ionicons name="image-outline" size={26} color={colors.textMuted} />
              <Text style={styles.hint}>{t('dir.addCover')}</Text>
            </View>
          )}
          {uploading === 'cover' ? <View style={styles.uploading}><ActivityIndicator color={colors.white} /></View> : null}
        </TouchableOpacity>

        <View style={styles.logoRow}>
          <TouchableOpacity style={styles.logoPicker} onPress={() => pick('logo')} disabled={!!uploading} testID="service-logo">
            {logo ? <Image source={{ uri: logo }} style={StyleSheet.absoluteFill} contentFit="cover" />
              : <Ionicons name="camera-outline" size={24} color={colors.textMuted} />}
            {uploading === 'logo' ? <View style={styles.uploading}><ActivityIndicator color={colors.white} /></View> : null}
          </TouchableOpacity>
          <Text style={[styles.hint, styles.flex]}>{t('studios.logo')}</Text>
        </View>

        <Field label={t('services.nameLabel')} value={form.name} onChange={set('name')} placeholder={t('studios.namePlaceholder')} testID="service-name" />
        <Field label={t('services.descLabel')} value={form.description} onChange={set('description')} placeholder={t('studios.aboutPlaceholder')} multiline />
        <Field label={t('services.locationLabel')} value={form.location} onChange={set('location')} placeholder={t('dir.cityCountry')} testID="service-location" />
        <View style={styles.pinRow}>
          <TouchableOpacity style={styles.pinBtn} onPress={() => setPinning(true)} testID="service-pin">
            <Ionicons name={pin ? 'location' : 'location-outline'} size={16} color={colors.primary} />
            <Text style={styles.pinText} numberOfLines={1}>{pin ? (pin.label || t('services.pinned')) : t('services.pinOnMap')}</Text>
          </TouchableOpacity>
          {pin ? (
            <TouchableOpacity onPress={() => setPin(null)} hitSlop={8} accessibilityLabel={t('common.remove')} testID="service-unpin">
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.hint}>{t('services.pinHint')}</Text>

        {myOrgs.length || orgSlug ? (
          <>
            <Text style={styles.label}>{t('services.listedUnder')}</Text>
            <View style={styles.chips}>
              {[{ slug: '', name: currentUser?.username || t('org.myself') }, ...myOrgs].map((o) => {
                const on = o.slug === orgSlug;
                return (
                  <TouchableOpacity key={o.slug || '_me'} style={[styles.chip, on && styles.chipOn]} onPress={() => setOrgSlug(o.slug)}
                    accessibilityRole="radio" accessibilityState={{ checked: on }} testID={`service-org-${o.slug || 'me'}`}>
                    <Ionicons name={o.slug ? 'business-outline' : 'person-outline'} size={13} color={on ? colors.white : colors.textSecondary} />
                    <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{o.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>{t('services.category')}</Text>
        <View style={styles.chips}>
          {CATEGORIES.map((c) => {
            const on = form.category === c.key;
            return (
              <TouchableOpacity key={c.key} style={[styles.chip, on && styles.chipOn]} onPress={() => selectCategory(c.key)}
                accessibilityRole="radio" accessibilityState={{ checked: on }} testID={`service-cat-${c.key}`}>
                {on ? <Ionicons name="checkmark" size={13} color={colors.white} /> : null}
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(c.labelKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>{t('studios.services')}</Text>
        <View style={styles.chips}>
          {SERVICE_TYPES_BY_CATEGORY[form.category].map((key) => {
            const on = form.service_types.includes(key);
            return (
              <TouchableOpacity key={key} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleTag(key)}
                accessibilityRole="checkbox" accessibilityState={{ checked: on }} testID={`service-tag-${key}`}>
                {on ? <Ionicons name="checkmark" size={13} color={colors.white} /> : null}
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{serviceLabel(key, t)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.divider} />
        <View style={styles.sectionHead}>
          <Text style={styles.section}>{t('services.gallery')}</Text>
          <Text style={styles.optional}>{t('services.optional')}</Text>
        </View>
        <Text style={styles.hint}>{t('services.galleryHint', { n: GALLERY_MAX })}</Text>
        <View style={styles.galleryGrid}>
          {gallery.map((u, i) => (
            <View key={`${i}_${u}`} style={styles.galleryItem}>
              <Image source={{ uri: u }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <TouchableOpacity style={styles.galleryRemove} onPress={() => setGallery((g) => g.filter((_, j) => j !== i))}
                hitSlop={6} accessibilityLabel={t('common.remove')} testID={`service-gallery-remove-${i}`}>
                <Ionicons name="close" size={14} color={colors.white} />
              </TouchableOpacity>
            </View>
          ))}
          {gallery.length < GALLERY_MAX ? (
            <TouchableOpacity style={[styles.galleryItem, styles.galleryAdd]} onPress={() => pick('gallery')} disabled={!!uploading}
              testID="service-gallery-add">
              {uploading === 'gallery' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="add" size={26} color={colors.textMuted} />}
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.divider} />
        <View style={styles.sectionHead}>
          <Text style={styles.section}>{t('services.hours')}</Text>
          <Text style={styles.optional}>{t('services.optional')}</Text>
        </View>
        <Text style={styles.hint}>{t('services.hoursHint')}</Text>
        {DAYS.map((d) => {
          const span = hours[d];
          return (
            <View key={d} style={styles.dayRow} testID={`service-day-${d}`}>
              <TouchableOpacity style={styles.dayToggle} onPress={() => setHours((h) => {
                const next = { ...h };
                if (next[d]) delete next[d]; else next[d] = ['08:00', '17:00'];
                return next;
              })} accessibilityRole="switch" accessibilityState={{ checked: !!span }} testID={`service-day-toggle-${d}`}>
                <Ionicons name={span ? 'checkbox' : 'square-outline'} size={20} color={span ? colors.primary : colors.textSecondary} />
                <Text style={styles.dayName}>{t(`services.day.${d}`)}</Text>
              </TouchableOpacity>
              {span ? (
                <View style={styles.dayTimes}>
                  {[0, 1].map((k) => (
                    <TextInput key={k} style={styles.time} value={span[k]} keyboardType="numbers-and-punctuation" maxLength={5}
                      onChangeText={(v) => setHours((h) => ({ ...h, [d]: k ? [h[d][0], v] : [v, h[d][1]] }))}
                      onEndEditing={(e) => setHours((h) => (h[d] ? { ...h, [d]: k ? [h[d][0], tidyTime(e.nativeEvent.text)] : [tidyTime(e.nativeEvent.text), h[d][1]] } : h))}
                      placeholder={k ? '17:00' : '08:00'} placeholderTextColor={colors.placeholder} testID={`service-day-${d}-${k ? 'close' : 'open'}`} />
                  ))}
                </View>
              ) : <Text style={styles.closedText}>{t('services.closed')}</Text>}
            </View>
          );
        })}
        {hours.mon ? (
          <TouchableOpacity style={styles.copyDays} onPress={() => setHours((h) => ({ ...h, ...Object.fromEntries(WEEKDAYS.map((d) => [d, [...h.mon]])) }))}
            testID="service-hours-copy">
            <Ionicons name="copy-outline" size={15} color={colors.primary} />
            <Text style={styles.copyText}>{t('services.copyMonday')}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.divider} />
        <View style={styles.sectionHead}>
          <Text style={styles.section}>{t('services.pricingSection')}</Text>
          <Text style={styles.optional}>{t('services.optional')}</Text>
        </View>
        <Text style={styles.hint}>{t('services.pricingHint')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.currencies}
          keyboardShouldPersistTaps="handled">
          {CURRENCIES.map((c) => (
            <TouchableOpacity key={c} style={[styles.currency, form.currency === c && styles.chipOn]} onPress={() => set('currency')(c)}>
              <Text style={[styles.chipText, form.currency === c && styles.chipTextOn]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TextInput style={styles.input} value={form.service_rates} onChangeText={set('service_rates')} keyboardType="numeric"
          placeholder={t('studios.amountPlaceholder')} placeholderTextColor={colors.placeholder} />
        <Field label="" value={form.rate_description} onChange={set('rate_description')} placeholder={t('studios.rateNotePlaceholder')} />

        <View style={styles.divider} />
        <View style={styles.sectionHead}>
          <Text style={styles.section}>{t('services.contactSection')}</Text>
          <Text style={styles.optional}>{t('services.optional')}</Text>
        </View>
        <Field label={t('services.whatsappLabel')} value={form.whatsapp_number} onChange={set('whatsapp_number')} placeholder={t('dir.phonePlaceholder')} keyboardType="phone-pad" />
        <Field label={t('services.phoneLabel')} value={form.contact_phone} onChange={set('contact_phone')} placeholder={t('dir.phonePlaceholder')} keyboardType="phone-pad" />
        <Field label={t('services.emailLabel')} value={form.contact_email} onChange={set('contact_email')} placeholder={t('studios.emailPlaceholder')} keyboardType="email-address" />

        <View style={styles.divider} />
        <View style={styles.sectionHead}>
          <Text style={styles.section}>{t('services.linksSection')}</Text>
          <Text style={styles.optional}>{t('services.optional')}</Text>
        </View>
        {SOCIAL_LINKS.map((s) => (
          <View key={s.key} style={styles.linkRow}>
            <View style={[styles.linkIcon, { backgroundColor: `${s.color}1A` }]}>
              <Ionicons name={s.icon} size={18} color={s.color} />
            </View>
            <TextInput style={[styles.input, styles.flex]} value={form[s.key]} onChangeText={set(s.key)}
              placeholder={t(s.labelKey)} placeholderTextColor={colors.placeholder} keyboardType="url"
              autoCapitalize="none" autoCorrect={false} />
          </View>
        ))}
        <View style={{ height: spacing.xl }} />
      </KeyboardAwareScrollView>

      <PlaceSheet visible={pinning} onClose={() => setPinning(false)} t={t} title={t('services.pinOnMap')}
        lang={resolvedLanguage === 'sw' ? 'sw' : 'en'} initialQuery={form.location}
        onPick={(p) => { setPin(p); setPinning(false); }} />

      <View style={styles.saveBar}>
        <TouchableOpacity style={[styles.saveBtn, styles.cancel]} onPress={() => navigation.goBack()} disabled={saving}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.saveBtn, styles.submit]} onPress={save} disabled={saving || !!uploading} testID="service-save">
          {saving ? <ActivityIndicator color={colors.white} /> : (
            <Text style={styles.submitText}>{existing ? t('services.saveChanges') : t('studios.create')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.md, width: '100%', maxWidth: 720, alignSelf: 'center' },
  coverPicker: {
    height: 160, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.inputBg,
    borderWidth: 1, borderColor: colors.border,
  },
  coverEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  uploading: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  logoPicker: {
    width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  hint: { ...typography.caption, color: colors.textMuted },
  label: { ...typography.label, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 15,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  chipTextOn: { color: colors.white },
  divider: { height: 1, backgroundColor: colors.border, marginTop: spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  section: { ...typography.label, color: colors.textPrimary, fontWeight: '800', fontSize: 15 },
  optional: {
    ...typography.caption, color: colors.textMuted, fontWeight: '600', fontSize: 11,
    backgroundColor: colors.surface, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  currencies: { gap: spacing.xs, paddingVertical: spacing.sm },
  currency: {
    paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.sm,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  galleryItem: { width: 84, height: 84, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.inputBg },
  galleryAdd: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  galleryRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, minHeight: 44 },
  dayToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  dayName: { ...typography.body, color: colors.textPrimary },
  dayTimes: { flexDirection: 'row', gap: spacing.sm },
  time: {
    width: 72, textAlign: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 6,
    color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 15,
  },
  closedText: { ...typography.caption, color: colors.textMuted },
  copyDays: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: spacing.xs },
  copyText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  pinBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary,
  },
  pinText: { ...typography.label, color: colors.primary, fontWeight: '700', flexShrink: 1 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  linkIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  saveBar: {
    flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  saveBtn: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.md, alignItems: 'center' },
  cancel: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  cancelText: { ...typography.button, color: colors.textSecondary },
  submit: { backgroundColor: colors.primary },
  submitText: { ...typography.button, color: colors.white },
});

export default ServiceForm;
