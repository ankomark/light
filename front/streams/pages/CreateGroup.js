import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createGroup, updateGroup, deleteGroup } from '../services/api';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import RotatingBackground from '../components/RotatingBackground';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const NAVY = '#0A1628';

const GroupForm = ({ navigation, route }) => {
  const { t } = useI18n();
  const { group: existingGroup } = route.params || {};
  const isEditMode = !!existingGroup;

  const [name, setName] = useState(existingGroup?.name || '');
  const [description, setDescription] = useState(existingGroup?.description || '');
  const [isPrivate, setIsPrivate] = useState(existingGroup?.is_private ?? true);
  const [coverImage, setCoverImage] = useState(existingGroup?.cover_image || null);
  const [isLoading, setIsLoading] = useState(false);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('chat.permissionRequired'), t('group.create.permissionPhotos'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets?.length) {
        const processedImage = await manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 1024 } }],
          { compress: 0.7, format: SaveFormat.JPEG }
        );
        setCoverImage(processedImage.uri);
      }
    } catch (error) {
      console.error('Image picker error:', error);
      Alert.alert(t('common.error'), t('group.create.imageFailed'));
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      Alert.alert(t('group.create.nameRequiredTitle'), t('group.create.nameRequired'));
      return;
    }
    // Turning a private group public exposes it to discovery — confirm first.
    if (isEditMode && existingGroup?.is_private && !isPrivate) {
      Alert.alert(
        t('group.create.goPublicTitle'),
        t('group.create.goPublicBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('group.create.goPublicConfirm'), style: 'destructive', onPress: doSubmit },
        ],
      );
      return;
    }
    doSubmit();
  };

  const doSubmit = async () => {
    try {
      setIsLoading(true);

      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('description', description || '');
      formData.append('is_private', String(isPrivate));

      if (coverImage && typeof coverImage === 'string' && coverImage.startsWith('file://')) {
        formData.append('cover_image', {
          uri: coverImage,
          name: `cover_${Date.now()}.jpg`,
          type: 'image/jpeg',
        });
      }

      if (isEditMode) {
        // The API looks groups up by slug (lookup_field='slug'), not the numeric pk.
        const response = await updateGroup(existingGroup.slug, formData);
        route.params?.onSubmit?.(response);
        navigation.goBack();
      } else {
        const response = await createGroup(formData);
        // Drop this form from the stack and open the new group's chat directly.
        navigation.replace('GroupDetail', { groupSlug: response.slug, group: response });
      }
    } catch (error) {
      console.error('Error:', error);
      // Error shapes vary: apiRequest throws an Error with .response.data;
      // createGroup (raw axios) rejects with the response body object itself.
      const body = error?.response?.data || (error instanceof Error ? null : error);
      const nameErr = Array.isArray(body?.name) ? body.name[0]
        : (typeof body?.name === 'string' ? body.name : null);
      const msg = nameErr || body?.detail || body?.error || body?.message
        || error?.message || t('group.create.saveFailed');
      Alert.alert(t('common.error'), msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      t('group.create.deleteTitle'),
      t('group.create.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              setIsLoading(true);
              await deleteGroup(existingGroup.slug);
              route.params?.onDelete?.();
              navigation.goBack();
            } catch (error) {
              console.error('Delete error:', error);
              Alert.alert(t('common.error'), t('group.create.deleteFailed'));
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  const canSubmit = !!name.trim() && !isLoading;

  return (
    <View style={styles.root}>
      <RotatingBackground intervalMs={60000} scrimColor="rgba(10,22,40,0.86)" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {isEditMode ? t('group.create.editTitle') : t('group.create.createTitle')}
          </Text>
          {isEditMode ? (
            <TouchableOpacity onPress={handleDelete} style={styles.iconBtn} hitSlop={10}>
              <Ionicons name="trash-outline" size={22} color={colors.error} />
            </TouchableOpacity>
          ) : (
            <View style={styles.iconBtn} />
          )}
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.formContainer}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TouchableOpacity
              style={styles.coverImageContainer}
              onPress={pickImage}
              activeOpacity={0.85}
            >
              {coverImage ? (
                <>
                  <Image source={{ uri: coverImage }} style={styles.coverImage} contentFit="cover" transition={150} />
                  <View style={styles.coverImageOverlay}>
                    <MaterialIcons name="edit" size={22} color="#fff" />
                  </View>
                </>
              ) : (
                <View style={styles.coverImagePlaceholder}>
                  <MaterialIcons name="add-a-photo" size={30} color={colors.textMuted} />
                  <Text style={styles.coverImageText}>{t('group.create.addCover')}</Text>
                </View>
              )}
            </TouchableOpacity>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('group.create.name')}</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder={t('group.create.namePlaceholder')}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="words"
                autoFocus={!isEditMode}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>{t('group.create.description')}</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={description}
                onChangeText={setDescription}
                placeholder={t('group.create.descriptionPlaceholder')}
                placeholderTextColor={colors.placeholder}
                multiline
                numberOfLines={4}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>{t('group.create.privacy')}</Text>
              <View style={styles.privacyContainer}>
                <TouchableOpacity
                  style={[styles.privacyOption, isPrivate && styles.selectedOption]}
                  onPress={() => setIsPrivate(true)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="lock-closed" size={16} color={isPrivate ? colors.accent : colors.textSecondary} />
                  <Text style={isPrivate ? styles.selectedText : styles.optionText}>{t('group.create.private')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.privacyOption, !isPrivate && styles.selectedOption]}
                  onPress={() => setIsPrivate(false)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="earth" size={16} color={!isPrivate ? colors.accent : colors.textSecondary} />
                  <Text style={!isPrivate ? styles.selectedText : styles.optionText}>{t('group.create.public')}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.privacyHint}>
                {isPrivate ? t('group.create.privateHint') : t('group.create.publicHint')}
              </Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={() => navigation.goBack()}
              disabled={isLoading}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.submitButton, !canSubmit && styles.disabledButton]}
              onPress={handleSubmit}
              disabled={!canSubmit}
              activeOpacity={0.85}
            >
              {isLoading ? (
                <ActivityIndicator color={NAVY} size="small" />
              ) : (
                <Text style={styles.submitButtonText}>
                  {isEditMode ? t('group.create.saveChanges') : t('group.create.createBtn')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY },
  safe: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '800', flex: 1, textAlign: 'center' },

  formContainer: { padding: spacing.md, paddingBottom: spacing.xl },

  coverImageContainer: {
    height: 160, marginBottom: spacing.lg, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: 'rgba(16,46,80,0.55)', justifyContent: 'center', alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  coverImage: { width: '100%', height: '100%' },
  coverImageOverlay: {
    position: 'absolute', top: spacing.sm, right: spacing.sm,
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  coverImagePlaceholder: { justifyContent: 'center', alignItems: 'center', gap: spacing.xs },
  coverImageText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },

  inputGroup: { marginBottom: spacing.md },
  label: { ...typography.label, color: colors.textSecondary, fontWeight: '700', marginBottom: spacing.xs },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, fontSize: 15,
    backgroundColor: 'rgba(13,35,64,0.85)', color: colors.textPrimary,
  },
  multilineInput: { minHeight: 110, textAlignVertical: 'top', paddingTop: spacing.sm + 2 },

  section: { marginTop: spacing.xs, marginBottom: spacing.md },
  privacyContainer: { flexDirection: 'row', gap: spacing.sm },
  privacyOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: spacing.sm + 2, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(13,35,64,0.7)',
  },
  selectedOption: { borderColor: colors.accent, backgroundColor: 'rgba(244,162,97,0.14)' },
  optionText: { ...typography.button, color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
  selectedText: { ...typography.button, color: colors.accent, fontWeight: '800', fontSize: 14 },
  privacyHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },

  footer: {
    flexDirection: 'row', gap: spacing.sm, padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)',
  },
  button: { flex: 1, paddingVertical: spacing.sm + 4, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
  cancelButton: { backgroundColor: 'rgba(18,30,46,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  cancelButtonText: { ...typography.button, color: colors.textSecondary, fontWeight: '700' },
  submitButton: { backgroundColor: colors.accent, ...shadows.sm },
  disabledButton: { opacity: 0.55 },
  submitButtonText: { ...typography.button, color: NAVY, fontWeight: '800' },
});

export default GroupForm;
