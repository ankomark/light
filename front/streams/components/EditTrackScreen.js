import React, { useState } from 'react';
import {
  View, Text, TextInput, Alert, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, ScrollView, Platform, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { apiRequest } from '../services/api';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const EditTrackScreen = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { track } = useRoute().params;

  const [title, setTitle] = useState(track.title || '');
  const [album, setAlbum] = useState(track.album || '');
  const [lyrics, setLyrics] = useState(track.lyrics || '');
  const [saving, setSaving] = useState(false);

  const handleUpdate = async () => {
    if (!title.trim()) {
      Alert.alert(t('track.edit.requiredTitle'), t('track.edit.requiredBody'));
      return;
    }
    setSaving(true);
    try {
      // Metadata-only PATCH — no audio re-upload, so it's fast and responsive.
      await apiRequest('patch', `/tracks/${track.id}/`, {
        title: title.trim(),
        album: album.trim(),
        lyrics: lyrics.trim(),
      });
      // TrackList reloads on focus, so just go back.
      navigation.goBack();
    } catch (error) {
      Alert.alert(t('common.error'), error.message || t('track.edit.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 85 : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>{t('track.edit.title')}</Text>

        <Text style={styles.label}>{t('track.edit.titleLabel')}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t('track.edit.titlePlaceholder')}
          placeholderTextColor={colors.placeholder}
          maxLength={100}
        />

        <Text style={styles.label}>{t('track.album')}</Text>
        <TextInput
          style={styles.input}
          value={album}
          onChangeText={setAlbum}
          placeholder={t('track.edit.albumPlaceholder')}
          placeholderTextColor={colors.placeholder}
          maxLength={100}
        />

        <Text style={styles.label}>{t('track.lyrics')}</Text>
        <TextInput
          style={[styles.input, styles.lyrics]}
          value={lyrics}
          onChangeText={setLyrics}
          placeholder={t('track.edit.lyricsPlaceholder')}
          placeholderTextColor={colors.placeholder}
          multiline
          textAlignVertical="top"
          maxLength={5000}
        />

        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={handleUpdate}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>{t('track.edit.save')}</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancel} onPress={() => navigation.goBack()} disabled={saving}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.lg, textAlign: 'center' },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 16,
    marginBottom: spacing.sm,
  },
  lyrics: { minHeight: 140, textAlignVertical: 'top' },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
    ...shadows.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { ...typography.button, color: colors.white },
  cancel: { alignItems: 'center', marginTop: spacing.md, padding: spacing.sm },
  cancelText: { color: colors.textSecondary, fontSize: 15 },
});

export default EditTrackScreen;
