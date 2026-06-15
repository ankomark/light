import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Modal, TextInput, Alert } from 'react-native';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import axios from 'axios';
import { API_URL, getAccessToken } from '../services/api';
import ReportModal from './ReportModal';
import { colors, spacing, radius, typography } from '../constants/theme';

const PostActions = ({ post, onUpdate, onDelete, navigation }) => {
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [editedCaption, setEditedCaption] = useState(post.caption);
  const [loading, setLoading] = useState(false);

  const handleEditPost = async () => {
    if (!editedCaption.trim()) {
      Alert.alert('Error', 'Caption cannot be empty');
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
      Alert.alert('Success', 'Post updated successfully');
    } catch (error) {
      console.error('Error updating post:', error);
      Alert.alert('Error', 'Failed to update post');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePost = () => {
    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              setLoading(true);
              const token = await getAccessToken();
              await axios.delete(`${API_URL}/social-posts/${post.id}/`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              onDelete();
              if (navigation) navigation.goBack();
              Alert.alert('Success', 'Post deleted successfully');
            } catch (error) {
              console.error('Error deleting post:', error);
              Alert.alert('Error', 'Failed to delete post');
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
      {/* Report — stays as a direct flag button on other people's posts. */}
      {!post.can_edit && (
        <TouchableOpacity onPress={() => setReportVisible(true)} style={styles.button}>
          <MaterialIcons name="flag" size={22} color={colors.warning} />
        </TouchableOpacity>
      )}

      {/* Author: a single "..." trigger opening a tap-to-open Edit/Delete sheet. */}
      {post.can_edit && (
        <TouchableOpacity
          onPress={() => setMenuVisible(true)}
          style={styles.button}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Post options"
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
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => { setMenuVisible(false); setEditModalVisible(true); }}
            >
              <MaterialIcons name="edit" size={22} color={colors.primary} />
              <Text style={styles.sheetLabel}>Edit post</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => { setMenuVisible(false); handleDeletePost(); }}
            >
              <MaterialIcons name="delete" size={22} color={colors.error} />
              <Text style={[styles.sheetLabel, styles.sheetLabelDestructive]}>Delete post</Text>
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
        <View style={styles.modalContainer}>
          <TouchableOpacity
            onPress={() => setEditModalVisible(false)}
            style={styles.modalCloseButton}
          >
            <Feather name="x" size={24} color={colors.textPrimary} />
          </TouchableOpacity>

          <Text style={styles.modalTitle}>Edit Post</Text>

          <TextInput
            style={styles.editInput}
            value={editedCaption}
            onChangeText={setEditedCaption}
            placeholder="Edit your caption..."
            placeholderTextColor={colors.placeholder}
            multiline
            numberOfLines={4}
          />
          
          <TouchableOpacity 
            onPress={handleEditPost}
            style={styles.saveButton}
            disabled={loading}
          >
            <Text style={styles.saveButtonText}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Text>
          </TouchableOpacity>
        </View>
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
    padding: 20,
    paddingTop: 50,
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