import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Modal, TextInput, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardLift from './tickets/KeyboardLift';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import axios from 'axios';
import { API_URL, getAccessToken, markNotInterested } from '../services/api';
import ReportModal from './ReportModal';
import { emit, EVENTS } from '../utils/appEvents';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const PostActions = ({ post, onUpdate, onDelete, onNotInterested }) => {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const editScroll = useRef(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [otherMenuVisible, setOtherMenuVisible] = useState(false);
  const [editedCaption, setEditedCaption] = useState(post.caption);
  const [loading, setLoading] = useState(false);

  const handleNotInterested = async () => {
    setOtherMenuVisible(false);
    // Optimistically remove it from the feed; the ranked feed will also show
    // less from this author/topic going forward.
    (onNotInterested ?? onDelete)?.();
    try {
      await markNotInterested(post.id);
    } catch (e) {
      // Non-fatal: the local hide already happened; the signal just didn't save.
      console.warn('not_interested failed', e?.message);
    }
  };

  const handleEditPost = async () => {
    if (!editedCaption.trim()) {
      Alert.alert(t('common.error'), t('post.captionEmpty'));
      return;
    }

    try {
      setLoading(true);
      const token = await getAccessToken();
      const response = await axios.patch(
        `${API_URL}/social-posts/${post.id}/`,
        { caption: editedCaption },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      onUpdate(response.data);
      setEditModalVisible(false);
      Alert.alert(t('market.success'), t('post.updatedOk'));
    } catch (error) {
      console.error('Error updating post:', error);
      Alert.alert(t('common.error'), t('post.updateFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePost = () => {
    Alert.alert(
      t('post.delete'),
      t('post.deleteConfirm'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('common.delete'),
          onPress: async () => {
            try {
              setLoading(true);
              const token = await getAccessToken();
              await axios.delete(`${API_URL}/social-posts/${post.id}/`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              onDelete();
              // Every feed that shows it drops it too (deleted from its own
              // screen, the feed underneath still had it).
              emit(EVENTS.POST_DELETED, { postId: post.id });
              Alert.alert(t('market.success'), t('post.deletedOk'));
            } catch (error) {
              console.error('Error deleting post:', error);
              Alert.alert(t('common.error'), t('post.deleteFailed'));
            } finally {
              setLoading(false);
            }
          },
          style: 'destructive',
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Other people's posts: a "..." menu with Not interested + Report. */}
      {!post.can_edit && (
        <TouchableOpacity
          onPress={() => setOtherMenuVisible(true)}
          style={styles.button}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('post.options')}
        >
          <MaterialIcons name="more-horiz" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      )}

      {/* Viewer action sheet: Not interested / Report. */}
      <Modal
        visible={otherMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setOtherMenuVisible(false)}
      >
        <View style={styles.sheetRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOtherMenuVisible(false)} />
          <View style={[styles.sheet, { paddingBottom: 28 + insets.bottom }]}>
            <View style={styles.sheetHandle} />
            <TouchableOpacity style={styles.sheetItem} onPress={handleNotInterested}>
              <MaterialIcons name="not-interested" size={22} color={colors.textSecondary} />
              <Text style={styles.sheetLabel}>{t('post.notInterested')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => { setOtherMenuVisible(false); setReportVisible(true); }}
            >
              <MaterialIcons name="flag" size={22} color={colors.warning} />
              <Text style={styles.sheetLabel}>{t('post.report')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Author: a single "..." trigger opening a tap-to-open Edit/Delete sheet. */}
      {post.can_edit && (
        <TouchableOpacity
          onPress={() => setMenuVisible(true)}
          style={styles.button}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('post.options')}
        >
          <MaterialIcons name="more-horiz" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      )}

      {/* Author action sheet: Edit / Delete. */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <View style={styles.sheetRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuVisible(false)} />
          <View style={[styles.sheet, { paddingBottom: 28 + insets.bottom }]}>
            <View style={styles.sheetHandle} />
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => {
                setMenuVisible(false);
                setEditedCaption(post.caption || '');   // what's posted, not a cancelled edit
                setEditModalVisible(true);
              }}
            >
              <MaterialIcons name="edit" size={22} color={colors.primary} />
              <Text style={styles.sheetLabel}>{t('post.edit')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => { setMenuVisible(false); handleDeletePost(); }}
            >
              <MaterialIcons name="delete" size={22} color={colors.error} />
              <Text style={[styles.sheetLabel, styles.sheetLabelDestructive]}>{t('post.delete')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ReportModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        contentType="post"
        objectId={post.id}
      />

      {/* Edit Post Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setEditModalVisible(false)}
      >
        {/* Clear of the notch and the gesture bar; Save stays above the keyboard. */}
        <KeyboardLift scrollRef={editScroll} style={styles.modalContainer}>
          <ScrollView ref={editScroll} keyboardShouldPersistTaps="handled"
                      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}>
            <TouchableOpacity
              onPress={() => setEditModalVisible(false)}
              style={styles.modalCloseButton}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              hitSlop={8}
            >
              <Feather name="x" size={24} color={colors.textPrimary} />
            </TouchableOpacity>

            <Text style={styles.modalTitle}>{t('post.editTitle')}</Text>

            <TextInput
              style={styles.editInput}
              value={editedCaption}
              onChangeText={setEditedCaption}
              placeholder={t('post.captionPlaceholder')}
              placeholderTextColor={colors.placeholder}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              testID="post-edit-caption"
            />

            <TouchableOpacity
              onPress={handleEditPost}
              style={styles.saveButton}
              disabled={loading}
              accessibilityRole="button"
              testID="post-edit-save"
            >
              <Text style={styles.saveButtonText}>
                {loading ? t('common.saving') : t('post.saveChanges')}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardLift>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  button: {
    marginLeft: 8,
    padding: 4,
  },
  // Action sheet
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: 8,
    marginBottom: 6,
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 22,
  },
  sheetLabel: {
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  sheetLabelDestructive: {
    color: colors.error,
  },
  modalContainer: {
    flex: 1,
    paddingHorizontal: 20,   // top and bottom come from the safe-area insets
    backgroundColor: colors.bg,
  },
  modalCloseButton: {
    position: 'absolute',
    top: 10,
    right: 15,
    zIndex: 1,
    padding: spacing.xs,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: 20,
    textAlign: 'center',
  },
  editInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 15,
    marginBottom: 20,
    minHeight: 100,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
    textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: colors.primary,
    padding: 15,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  saveButtonText: {
    color: colors.white,
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default PostActions;