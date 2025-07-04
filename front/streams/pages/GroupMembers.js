import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, Modal, TouchableOpacity, Image } from 'react-native';
import { fetchGroupMembers } from '../services/api';
import { MaterialIcons } from '@expo/vector-icons';

const GroupMemberItem = ({ member }) => (
  <View style={styles.memberItem}>
    <Image
      source={
        member.user?.profile?.picture
          ? { uri: member.user.profile.picture }
          : require('../assets/user-placeholder.png')
      }
      style={styles.memberAvatar}
    />
    <View style={styles.memberInfo}>
      <Text style={styles.memberName}>
        {member.user?.username || 'Unknown User'}
      </Text>
      {member.is_admin && (
        <Text style={styles.adminBadge}>Admin</Text>
      )}
    </View>
  </View>
);

const GroupMembers = ({ groupSlug, onClose }) => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadMembers = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchGroupMembers(groupSlug);
        setMembers(data);
      } catch (error) {
        console.error('Failed to load members:', error);
        setError('Failed to load members. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    
    loadMembers();
  }, [groupSlug]);

  return (
    <Modal
      animationType="slide"
      transparent={false}
      visible={true}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Group Members</Text>
          <TouchableOpacity onPress={onClose}>
            <MaterialIcons name="close" size={24} color="#1e88e5" />
          </TouchableOpacity>
        </View>
        
        {loading ? (
          <ActivityIndicator size="large" style={styles.loader} />
        ) : (
          <FlatList
            data={members}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => <GroupMemberItem member={item} />}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No members found</Text>
            }
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: 'white',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 16,
    color: '#666',
  },
  listContent: {
    paddingBottom: 20,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  memberAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
    backgroundColor: '#E5E7EB',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  adminBadge: {
    fontSize: 12,
    color: '#4CAF50',
    marginTop: 4,
  },
});

export default GroupMembers;