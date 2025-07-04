import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';

const GroupMemberItem = ({ member }) => {
  return (
    <View style={styles.container}>
      <Image
        source={
          member.user?.profile?.picture
            ? { uri: member.user.profile.picture }
            : require('../assets/user-placeholder.png')
        }
        style={styles.avatar}
        onError={(e) => console.error('Image load error:', e.nativeEvent.error)}
      />
      <View style={styles.info}>
        <Text style={styles.name}>
          {member.user?.username || 'Username'}
        </Text>
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
    backgroundColor: '#E5E7EB',
    resizeMode: 'cover',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '500',
    color: '#006060',
  },
  adminBadge: {
    fontSize: 12,
    color: '#4CAF50',
    marginTop: 4,
  },
});

export default GroupMemberItem;