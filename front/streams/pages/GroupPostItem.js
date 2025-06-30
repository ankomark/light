import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

const GroupPostItem = ({ post }) => {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image
          source={
            post.user?.profile?.picture
              ? { uri: post.user.profile.picture }
              : require('../assets/user-placeholder.png')
          }
          style={styles.avatar}
          onError={(e) => console.error('Image load error:', e.nativeEvent.error)}
          onLoad={() => console.log('Profile picture loaded successfully for post:', post.id)}
        />
        <View style={styles.userInfo}>
          <Text style={styles.username}>
            {post.user?.username || 'Username'}
          </Text>
          <Text style={styles.time}>{new Date(post.created_at).toLocaleString()}</Text>
        </View>
        <TouchableOpacity style={styles.moreButton}>
          <MaterialIcons name="more-vert" size={20} color="#6B7280" />
        </TouchableOpacity>
      </View>
      
      <Text style={styles.content}>{post.content}</Text>
      
      {post.attachments && post.attachments.length > 0 && (
        <View style={styles.attachmentsContainer}>
          {/* Render attachments here */}
        </View>
      )}
      
      <View style={styles.footer}>
        <TouchableOpacity style={styles.actionButton}>
          <MaterialIcons name="thumb-up" size={18} color="#6B7280" />
          <Text style={styles.actionText}>Like</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <MaterialIcons name="comment" size={18} color="#666" />
          <Text style={styles.actionText}>Comment</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <MaterialIcons name="share" size={18} color="#666" />
          <Text style={styles.actionText}>Share</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: '#E5E7EB',
    resizeMode: 'cover', // Ensure image fits properly
  },
  userInfo: {
    flex: 1,
  },
  username: {
    fontWeight: '600',
    fontSize: 15,
    color: '#006060',
  },
  time: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  moreButton: {
    padding: 4,
  },
  content: {
    fontSize: 15,
    lineHeight: 22,
    color: '#374151',
    marginBottom: 12,
  },
  attachmentsContainer: {
    marginBottom: 12,
  },
  footer: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 12,
    justifyContent: 'space-between',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionText: {
    marginLeft: 6,
    fontSize: 14,
    color: '#666',
  },
});

export default GroupPostItem;