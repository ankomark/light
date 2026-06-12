import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';

const GroupRequestItem = ({ request, onApprove, onReject }) => {
  return (
    <View style={styles.container}>
      <Image
        source={
          // Backend exposes the resolved URL as `profile_picture`; `profile.picture`
          // is write-only and never present in responses.
          request.user?.profile_picture || request.user?.profile?.picture_url
            ? { uri: request.user.profile_picture || request.user.profile.picture_url }
            : require('../assets/user-placeholder.png')
        }
        style={styles.avatar}
      />
      <View style={styles.info}>
        <Text style={styles.name}>{request.user?.username || 'Username'}</Text>
        <Text style={styles.message}>{request.message || 'No message provided'}</Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.approveButton} onPress={onApprove}>
          <Text style={styles.buttonText}>Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rejectButton} onPress={onReject}>
          <Text style={styles.buttonText}>Reject</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
    backgroundColor: '#E5E7EB',
    resizeMode: 'cover',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '500',
  },
  message: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
  },
  approveButton: {
    backgroundColor: '#4CAF50',
    padding: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  rejectButton: {
    backgroundColor: '#F44336',
    padding: 8,
    borderRadius: 4,
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
  },
});

export default GroupRequestItem;