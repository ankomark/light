// Start an organisation, or edit one you run: its name, what kind it is,
// where, its site, a few words about it and its logo. The owner can close
// it (its books stay, under their authors' names).
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../services/imageProcessing';
import { uploadMedia } from '../services/cloudinary';
import { createOrganization, deleteOrganization, fetchOrganization, updateOrganization } from '../services/api';
import { dropCache, userKey } from '../utils/screenCache';
import { confirmAction, notify } from '../utils/adminConfirm';
import { ORG_KINDS, ORG_ICON, OrgLogo } from './OrganizationPage';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const OrganizationEdit = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const slug = route.params?.slug || null;
  const [form, setForm] = useState({ name: '', kind: 'church', location: '', website: '', description: '', logo: '' });
  const [role, setRole] = useState(slug ? null : 'owner');
  const [loading, setLoading] = useState(!!slug);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!slug) return;
    fetchOrganization(slug).then((o) => {
      setForm({ name: o.name, kind: o.kind, location: o.location || '', website: o.website || '',
        description: o.description || '', logo: o.logo || '' });
      setRole(o.my_role);
      setLoading(false);
    }).catch(() => { notify(t('common.error'), t('org.loadFailed')); navigation.goBack(); });
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickLogo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (r.canceled || !r.assets?.length) return;
    setUploading(true);
    try {
      const small = await compressImage(r.assets[0].uri, { width: 400, quality: 0.7 });
      const up = await uploadMedia({ uri: small.uri, name: `org_${Date.now()}.jpg`, mimeType: 'image/jpeg' }, 'cover');
      set('logo')(up.url);
    } catch {
      notify(t('common.error'), t('pub.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (form.name.trim().length < 2) { notify(t('org.nameNeeded'), t('org.nameNeededBody')); return; }
    setSaving(true);
    try {
      const o = slug ? await updateOrganization(slug, form) : await createOrganization(form);
      dropCache(userKey(currentUser?.id, `org:${o.slug}`));
      dropCache(userKey(currentUser?.id, 'orgs:mine'));
      if (slug) navigation.goBack();
      else navigation.replace('OrganizationPage', { slug: o.slug, name: o.name });
    } catch (err) {
      notify(t('common.error'), err?.data?.error || t('org.failed'));
    } finally {
      setSaving(false);
    }
  };

  const close = async () => {
    const ok = await confirmAction({
      title: t('org.closeTitle', { name: form.name }), message: t('org.closeBody'),
      confirmLabel: t('org.close'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    try {
      await deleteOrganization(slug);
      dropCache(userKey(currentUser?.id, 'orgs:mine'));
      navigation.popToTop?.();
    } catch {
      notify(t('common.error'), t('org.failed'));
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{slug ? t('org.edit') : t('org.new')}</Text>
        <TouchableOpacity onPress={save} disabled={saving || loading} style={styles.saveBtn} testID="org-save">
          {saving ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.saveText}>{t('common.save')}</Text>}
        </TouchableOpacity>
      </View>
      {loading ? <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View> : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {!slug ? <Text style={styles.intro}>{t('org.intro')}</Text> : null}
          <TouchableOpacity style={styles.logoRow} onPress={pickLogo} disabled={uploading} testID="org-logo">
            <OrgLogo org={form} size={72} />
            <View style={styles.flex}>
              <Text style={styles.logoLabel}>{t('org.logo')}</Text>
              <Text style={styles.hint}>{uploading ? t('pub.uploading') : t('org.logoHint')}</Text>
            </View>
            {uploading ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="image-outline" size={20} color={colors.accent} />}
          </TouchableOpacity>

          <Text style={styles.label}>{t('org.name')}</Text>
          <TextInput style={styles.input} value={form.name} onChangeText={set('name')} maxLength={120}
            placeholder={t('org.namePlaceholder')} placeholderTextColor={colors.placeholder} testID="org-name" />

          <Text style={styles.label}>{t('org.kindLabel')}</Text>
          <View style={styles.kinds}>
            {ORG_KINDS.map((k) => (
              <TouchableOpacity key={k} style={[styles.chip, form.kind === k && styles.chipOn]} onPress={() => set('kind')(k)}
                accessibilityRole="radio" accessibilityState={{ checked: form.kind === k }} testID={`org-kind-${k}`}>
                <Ionicons name={ORG_ICON[k]} size={14} color={form.kind === k ? colors.white : colors.textSecondary} />
                <Text style={[styles.chipText, form.kind === k && styles.chipTextOn]}>{t(`org.kind.${k}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>{t('org.location')}</Text>
          <TextInput style={styles.input} value={form.location} onChangeText={set('location')} maxLength={120}
            placeholder={t('org.locationPlaceholder')} placeholderTextColor={colors.placeholder} testID="org-location" />

          <Text style={styles.label}>{t('org.website')}</Text>
          <TextInput style={styles.input} value={form.website} onChangeText={set('website')} maxLength={300}
            autoCapitalize="none" keyboardType="url" placeholder="example.org" placeholderTextColor={colors.placeholder}
            testID="org-website" />

          <Text style={styles.label}>{t('org.about')}</Text>
          <TextInput style={[styles.input, styles.area]} value={form.description} onChangeText={set('description')}
            maxLength={2000} multiline placeholder={t('org.aboutPlaceholder')} placeholderTextColor={colors.placeholder}
            testID="org-about" />

          <Text style={styles.hint}>{t('org.verifyNote')}</Text>

          {slug && role === 'owner' ? (
            <TouchableOpacity style={styles.danger} onPress={close} testID="org-close">
              <Ionicons name="trash-outline" size={16} color={colors.error} />
              <Text style={styles.dangerText}>{t('org.close')}</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, minWidth: 64, alignItems: 'center' },
  saveText: { ...typography.label, color: colors.white, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl, width: '100%', maxWidth: 640, alignSelf: 'center' },
  intro: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  logoRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  logoLabel: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', marginTop: spacing.sm },
  hint: { ...typography.caption, color: colors.textMuted },
  input: {
    color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  area: { minHeight: 100, textAlignVertical: 'top' },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  chipTextOn: { color: colors.white },
  danger: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'center', marginTop: spacing.xl, padding: spacing.sm },
  dangerText: { ...typography.label, color: colors.error, fontWeight: '700' },
});

export default OrganizationEdit;
