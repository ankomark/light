import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Alert } from 'react-native';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import axios from 'axios';
import { API_URL } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PostActions = ({ post, onUpdate, onDelete, navigation }) => {
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editedCaption, setEditedCaption] = useState(post.caption);
  const [loading, setLoading] = useState(false);

  const handleEditPost = async () => {
    if (!editedCaption.trim()) {
      Alert.alert('Error', 'Caption cannot be empty');
      return;
    }

    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('accessToken');
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
              const token = await AsyncStorage.getItem('accessToken');
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

  if (!post.can_edit) return null;

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => setEditModalVisible(true)} style={styles.button}>
        <MaterialIcons name="edit" size={24} color="#1DA1F2" />
      </TouchableOpacity>
      
      <TouchableOpacity onPress={handleDeletePost} style={styles.button}>
        <MaterialIcons name="delete" size={24} color="#ff4444" />
      </TouchableOpacity>

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
            <Feather name="x" size={24} color="#000" />
          </TouchableOpacity>
          
          <Text style={styles.modalTitle}>Edit Post</Text>
          
          <TextInput
            style={styles.editInput}
            value={editedCaption}
            onChangeText={setEditedCaption}
            placeholder="Edit your caption..."
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
    marginLeft: 15,
  },
  modalContainer: {
    flex: 1,
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#fff',
  },
  modalCloseButton: {
    position: 'absolute',
    top: 10,
    right: 15,
    zIndex: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
    minHeight: 100,
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: '#1DA1F2',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default PostActions;