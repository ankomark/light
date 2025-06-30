import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';

const GroupMemberItem = ({ member }) => {
  return (
    <View style={styles.container}>
      <Image 
        source={member.user.avatar ? { uri: member.user.avatar } : require('../assets/user-placeholder.png')} 
        style={styles.avatar}
      />
      <View style={styles.info}>
        <Text style={styles.name}>{member.user.username}</Text>
        {member.is_admin && <Text style={styles.adminBadge}>Admin</Text>}
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
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '500',
  },
  adminBadge: {
    fontSize: 12,
    color: '#1e88e5',
    marginTop: 4,
  },
});

export default GroupMemberItem; // Must have this export