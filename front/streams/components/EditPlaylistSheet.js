// Edit a playlist you own: name, description, cover and who can see it — and
// delete it. Opened from the playlist page.
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { updatePlaylist } from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import { compressImage } from '../services/imageProcessing';
import PlaylistCover from './PlaylistCover';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const VISIBILITIES = [
  { key: 'private', icon: 'lock-closed' },
  { key: 'unlisted', icon: 'link' },
  { key: 'public', icon: 'globe-outline' },
];

const EditPlaylistSheet = ({ visible, playlist, onClose, onSaved, onDelete }) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  // undefined = unchanged, null = remove, { uri } = a newly picked picture.
  const [cover, setCover] = useState(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !playlist) return;
    setName(playlist.name || '');
    setDescription(playlist.description || '');
    setVisibility(playlist.visibility || 'private');
    setCover(undefined);
  }, [visible, playlist]);

  const pickCover = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.9,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const small = await compressImage(res.assets[0].uri, { width: 800, quality: 0.82 });
    setCover({ uri: small.uri });
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const changes = { name: trimmed, description: description.trim(), visibility };
      if (cover === null) changes.cover_image = null;
      else if (cover?.uri) {
        const up = await uploadMedia({ uri: cover.uri, mimeType: 'image/jpeg', name: `playlist_${Date.now()}.jpg` }, 'cover');
        changes.cover_image = up.url;
      }
      const updated = await updatePlaylist(playlist.id, changes);
      onSaved?.(updated);
      onClose();
    } catch {
      Alert.alert(t('common.error'), t('playlist.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const shownCover = cover === undefined ? playlist?.cover_image : (cover?.uri || null);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
          <Pressable style={styles.sheet}>
            <View style={styles.handle} />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
              <Text style={styles.title}>{t('playlist.edit')}</Text>

              <View style={styles.coverRow}>
                <PlaylistCover cover={shownCover} images={playlist?.cover_images || []} size={96} radius={10} />
                <View style={styles.coverBtns}>
                  <TouchableOpacity style={styles.smallBtn} onPress={pickCover} activeOpacity={0.85}>
                    <Ionicons name="image-outline" size={16} color={colors.primary} />
                    <Text style={styles.smallBtnText}>{t('playlist.changeCover')}</Text>
                  </TouchableOpacity>
                  {shownCover ? (
                    <TouchableOpacity style={styles.smallBtn} onPress={() => setCover(null)} activeOpacity={0.85}>
                      <Ionicons name="close-circle-outline" size={16} color={colors.textSecondary} />
                      <Text style={[styles.smallBtnText, styles.muted]}>{t('playlist.removeCover')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              <Text style={styles.label}>{t('playlist.nameLabel')}</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                maxLength={100}
                placeholder={t('playlist.namePlaceholder')}
                placeholderTextColor={colors.placeholder}
              />

              <Text style={styles.label}>{t('playlist.descriptionLabel')}</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={description}
                onChangeText={setDescription}
                maxLength={300}
                multiline
                placeholder={t('playlist.descriptionPlaceholder')}
                placeholderTextColor={colors.placeholder}
              />

              <Text style={styles.label}>{t('playlist.whoCanSee')}</Text>
              {VISIBILITIES.map((v) => {
                const on = visibility === v.key;
                return (
                  <TouchableOpacity
                    key={v.key}
                    style={[styles.visRow, on && styles.visRowOn]}
                    onPress={() => setVisibility(v.key)}
                    activeOpacity={0.85}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                  >
                    <Ionicons name={v.icon} size={18} color={on ? colors.primary : colors.textSecondary} />
                    <View style={styles.visText}>
                      <Text style={styles.visTitle}>{t(`playlist.visibility.${v.key}`)}</Text>
                      <Text style={styles.visSub}>{t(`playlist.visibilitySub.${v.key}`)}</Text>
                    </View>
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.textMuted} />
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                style={[styles.saveBtn, (!name.trim() || saving) && styles.disabled]}
                onPress={save}
                disabled={!name.trim() || saving}
                activeOpacity={0.85}
              >
                {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>{t('common.save')}</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} activeOpacity={0.85}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
                <Text style={styles.deleteText}>{t('playlist.deleteTitle')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  kav: { width: '100%', alignItems: 'center' },
  sheet: {
    width: '100%', maxWidth: 560, maxHeight: '92%', backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: spacing.sm },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  title: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  coverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  coverBtns: { gap: spacing.sm },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  smallBtnText: { ...typography.label, color: colors.primary, fontWeight: '700' },
  muted: { color: colors.textSecondary },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.md, marginBottom: 6 },
  input: {
    minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 16,
  },
  multiline: { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' },
  visRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs, minHeight: 56,
  },
  visRowOn: { borderColor: colors.primary },
  visText: { flex: 1 },
  visTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  visSub: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  saveBtn: {
    marginTop: spacing.lg, minHeight: 48, borderRadius: radius.full, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  saveText: { ...typography.button, color: colors.white },
  disabled: { opacity: 0.5 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, marginTop: spacing.sm },
  deleteText: { ...typography.label, color: colors.error, fontWeight: '700' },
});

export default EditPlaylistSheet;
