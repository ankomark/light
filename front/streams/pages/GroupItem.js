import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

const GroupItem = ({ group, onPress, onDelete, onEdit, isCreator }) => {
  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.contentWrapper}>
        <Image
          source={group.cover_image ? { uri: group.cover_image } : require('../assets/group-placeholder.png')}
          style={styles.coverImage}
        />
        <View style={styles.infoContainer}>
          <Text style={styles.name} numberOfLines={1}>{group.name}</Text>
          <Text style={styles.members}>{group.member_count} members</Text>
          <Text style={styles.description} numberOfLines={2}>{group.description || 'No description provided'}</Text>
          <Text style={styles.privacy}>{group.is_private ? 'Private' : 'Public'}</Text>
        </View>
        {isCreator && (
          <View style={styles.actions}>
            <TouchableOpacity onPress={onEdit} style={styles.actionButton}>
              <MaterialIcons name="edit" size={20} color="#0c4a6e" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onDelete} style={styles.actionButton}>
              <MaterialIcons name="delete" size={20} color="#ef4444" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 10,
    marginVertical: 8,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  contentWrapper: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'center',
  },
  coverImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  infoContainer: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 18,
    color: '#0c4a6e',
  },
  members: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  description: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  privacy: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 12,
    color: '#f59e0b',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    marginLeft: 12,
  },
  actionButton: {
    padding: 8,
  },
});

export default GroupItem;