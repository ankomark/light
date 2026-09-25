// Asking for the verified tick on a service: the registered name, a licence
// or registration number, a note, and photos of the papers (1 to 4). The
// Adventist Life team looks at it; the owner is told either way. This page
// shows where a request stands — waiting, verified, or refused and why (and
// then it can be asked again).
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../services/imageProcessing';
import { uploadMedia } from '../services/cloudinary';
import { fetchServiceVerification, requestServiceVerification } from '../services/api';
import useCachedData from '../utils/useCachedData';
import { userKey } from '../utils/screenCache';
import { notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

const MAX_DOCS = 4;

const ServiceVerification = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const { id, name = '' } = route.params || {};
  const { data, setData, failed, reload } = useCachedData(userKey(currentUser?.id, `service-verify:${id}`),
    () => fetchServiceVerification(id));
  const [form, setForm] = useState({ legal_name: '', registration_number: '', note: '' });
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const addDoc = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { notify(t('chat.permissionRequired'), t('dir.permissionPhotos')); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (r.canceled || !r.assets?.length) return;
    setUploading(true);
    try {
      const small = await compressImage(r.assets[0].uri, { width: 1600, quality: 0.75 });
      const up = await uploadMedia({ uri: small.uri, name: `verify_${Date.now()}.jpg`, mimeType: 'image/jpeg' }, 'cover');
      setDocs((d) => [...d, up.url].slice(0, MAX_DOCS));
    } catch (e) {
      notify(t('common.uploadFailedTitle'), e?.message || t('common.uploadImageFailed'));
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    if (form.legal_name.trim().length < 2 || !docs.length) { notify(t('verify.title'), t('verify.missing')); return; }
    setSending(true);
    try {
      const v = await requestServiceVerification(id, {
        legal_name: form.legal_name.trim(), registration_number: form.registration_number.trim(), note: form.note.trim(),
        documents: docs,
      });
      setData(v);
      setDocs([]);
    } catch (err) {
      notify(t('common.error'), err?.data?.error || t('verify.failed'));
    } finally {
      setSending(false);
    }
  };

  const status = data?.status;
  const canAsk = data && (status == null || status === 'rejected');
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.flex}>
          <Text style={styles.topTitle}>{t('verify.title')}</Text>
          {name ? <Text style={styles.topSub} numberOfLines={1}>{name}</Text> : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!data ? (
          failed ? (
            <TouchableOpacity style={styles.btn} onPress={reload}><Text style={styles.btnText}>{t('common.retry')}</Text></TouchableOpacity>
          ) : <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            {status === 'approved' ? (
              <View style={[styles.state, styles.stateOk]} testID="verify-approved">
                <MaterialIcons name="verified" size={28} color={colors.primary} />
                <Text style={styles.stateText}>{t('verify.approved')}</Text>
              </View>
            ) : status === 'pending' ? (
              <View style={styles.state} testID="verify-pending">
                <Ionicons name="hourglass-outline" size={26} color={colors.accent} />
                <Text style={styles.stateText}>{t('verify.pending')}</Text>
              </View>
            ) : status === 'rejected' ? (
              <View style={[styles.state, styles.stateNo]} testID="verify-rejected">
                <Ionicons name="close-circle-outline" size={26} color={colors.error} />
                <View style={styles.flex}>
                  <Text style={styles.stateText}>{t('verify.rejected')}</Text>
                  {data.decision_note ? <Text style={styles.reason}>{data.decision_note}</Text> : null}
                </View>
              </View>
            ) : (
              <Text style={styles.intro}>{t('verify.intro')}</Text>
            )}

            {canAsk ? (
              <View style={styles.form} testID="verify-form">
                <Text style={styles.label}>{t('verify.legalName')}</Text>
                <TextInput style={styles.input} value={form.legal_name} onChangeText={set('legal_name')} maxLength={200}
                  placeholder={t('verify.legalNamePlaceholder')} placeholderTextColor={colors.placeholder} testID="verify-legal" />
                <Text style={styles.label}>{t('verify.number')}</Text>
                <TextInput style={styles.input} value={form.registration_number} onChangeText={set('registration_number')}
                  maxLength={100} placeholder={t('verify.numberPlaceholder')} placeholderTextColor={colors.placeholder} autoCapitalize="characters" />
                <Text style={styles.label}>{t('verify.papers')}</Text>
                <Text style={styles.hint}>{t('verify.papersHint', { n: MAX_DOCS })}</Text>
                <View style={styles.docs}>
                  {docs.map((u, i) => (
                    <View key={u} style={styles.doc}>
                      <Image source={{ uri: u }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      <TouchableOpacity style={styles.docRemove} onPress={() => setDocs((d) => d.filter((_, j) => j !== i))} hitSlop={6}
                        accessibilityLabel={t('common.remove')}>
                        <Ionicons name="close" size={14} color={colors.white} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {docs.length < MAX_DOCS ? (
                    <TouchableOpacity style={[styles.doc, styles.docAdd]} onPress={addDoc} disabled={uploading} testID="verify-add-doc">
                      {uploading ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="document-attach-outline" size={24} color={colors.textMuted} />}
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={styles.label}>{t('verify.note')}</Text>
                <TextInput style={[styles.input, styles.area]} value={form.note} onChangeText={set('note')} maxLength={2000} multiline
                  placeholder={t('verify.notePlaceholder')} placeholderTextColor={colors.placeholder} />
                <Text style={styles.hint}>{t('verify.privacy')}</Text>
                <TouchableOpacity style={styles.btn} onPress={send} disabled={sending || uploading} testID="verify-send">
                  {sending ? <ActivityIndicator color={colors.white} /> : <Text style={styles.btnText}>{t('verify.send')}</Text>}
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  topSub: { ...typography.caption, color: colors.textSecondary },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl, width: '100%', maxWidth: 640, alignSelf: 'center' },
  intro: { ...typography.body, color: colors.textSecondary, lineHeight: 21 },
  state: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent,
  },
  stateOk: { borderColor: colors.primary },
  stateNo: { borderColor: colors.error },
  stateText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  reason: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  form: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.sm },
  hint: { ...typography.caption, color: colors.textMuted },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 15,
  },
  area: { minHeight: 90, textAlignVertical: 'top' },
  docs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  doc: { width: 90, height: 90, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.inputBg },
  docAdd: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  docRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  btnText: { ...typography.button, color: colors.white },
});

export default ServiceVerification;
