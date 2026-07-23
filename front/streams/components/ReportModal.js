import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { reportContent } from '../services/api';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const REASONS = [
  { key: 'spam', label: 'Spam', icon: 'mail-unread-outline' },
  { key: 'hate', label: 'Hate Speech', icon: 'warning-outline' },
  { key: 'violence', label: 'Violence or Threats', icon: 'skull-outline' },
  { key: 'inappropriate', label: 'Inappropriate Content', icon: 'eye-off-outline' },
  { key: 'misinformation', label: 'Misinformation', icon: 'information-circle-outline' },
  { key: 'copyright', label: 'Copyright Violation', icon: 'copy-outline' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
];

/**
 * Usage:
 *   <ReportModal
 *     visible={showReport}
 *     onClose={() => setShowReport(false)}
 *     contentType="post"   // 'post' | 'user' | 'track' | 'comment' | 'group'
 *     objectId={post.id}
 *   />
 */
const ReportModal = ({ visible, onClose, contentType, objectId }) => {
  const { t } = useI18n();
  const [selectedReason, setSelectedReason] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const reset = () => {
    setSelectedReason('');
    setDescription('');
    setSubmitted(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!selectedReason) {
      Alert.alert(t('report.selectReasonTitle'), t('report.selectReasonBody'));
      return;
    }
    setLoading(true);
    try {
      await reportContent(contentType, objectId, selectedReason, description.trim());
      setSubmitted(true);
    } catch (err) {
      const msg = err.response?.data?.message ?? err.message;
      if (msg?.includes('Already')) {
        setSubmitted(true); // treat duplicate as success
      } else {
        Alert.alert(t('common.error'), t('report.submitFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />

      <View style={styles.sheet}>
        {/* Handle */}
        <View style={styles.handle} />

        {submitted ? (
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={52} color={colors.success ?? '#43A047'} />
            <Text style={styles.successTitle}>{t('report.submitted')}</Text>
            <Text style={styles.successSub}>
              Thanks for keeping Adventist Life safe. We'll review this within 24 hours.
            </Text>
            <TouchableOpacity style={styles.doneBtn} onPress={handleClose}>
              <Text style={styles.doneBtnText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Report {contentType}</Text>
            <Text style={styles.subtitle}>{t('report.why')}</Text>

            {REASONS.map(r => (
              <TouchableOpacity
                key={r.key}
                style={[styles.reasonRow, selectedReason === r.key && styles.reasonSelected]}
                onPress={() => setSelectedReason(r.key)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={r.icon}
                  size={20}
                  color={selectedReason === r.key ? colors.primary : colors.textSecondary}
                />
                <Text style={[styles.reasonLabel, selectedReason === r.key && styles.reasonLabelSelected]}>
                  {r.label}
                </Text>
                {selectedReason === r.key && (
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}

            <TextInput
              style={styles.descInput}
              placeholder={t('report.detailsPlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={500}
            />

            <TouchableOpacity
              style={[styles.submitBtn, (!selectedReason || loading) && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={!selectedReason || loading}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.submitText}>{t('report.submit')}</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  reasonSelected: { backgroundColor: `${colors.primary}20`, borderWidth: 1, borderColor: `${colors.primary}40` },
  reasonLabel: { ...typography.body, color: colors.textSecondary, flex: 1 },
  reasonLabelSelected: { color: colors.textPrimary, fontWeight: '600' },
  descInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 14,
    minHeight: 80,
    marginVertical: spacing.md,
  },
  submitBtn: {
    backgroundColor: colors.error,
    borderRadius: radius.md,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.45 },
  submitText: { ...typography.button, color: colors.white },
  cancelBtn: { alignItems: 'center', paddingVertical: spacing.md },
  cancelText: { ...typography.body, color: colors.textMuted },
  successBox: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
  successTitle: { ...typography.h2, color: colors.textPrimary },
  successSub: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  doneBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  doneBtnText: { ...typography.button, color: colors.white },
});

export default ReportModal;
