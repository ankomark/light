import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  Image, 
  StyleSheet, 
  TouchableOpacity, 
  ActivityIndicator,
  SafeAreaView 
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GroupHeader = ({ 
  group, 
  isMember, 
  isAdmin, 
  onJoinRequest, 
  onShowMembers, 
  onShowRequests,
  groupSlug 
}) => {
  const [requestSent, setRequestSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const checkRequestStatus = async () => {
      const status = await AsyncStorage.getItem(`joinRequest-${groupSlug}`);
      setRequestSent(status === 'true');
    };
    checkRequestStatus();
  }, [groupSlug]);

  const handleJoinPress = async () => {
    if (requestSent) return;
    
    setIsLoading(true);
    try {
      await onJoinRequest();
      setRequestSent(true);
      await AsyncStorage.setItem(`joinRequest-${groupSlug}`, 'true');
    } catch (error) {
      console.error('Join request failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerContent}>
          <Image 
            source={group.cover_image ? { uri: group.cover_image } : require('../assets/group-placeholder.png')} 
            style={styles.image}
          />
          
          <View style={styles.infoContainer}>
            <Text style={styles.name} numberOfLines={1}>{group.name}</Text>
            <View style={styles.memberContainer}>
              <MaterialIcons name="people" size={16} color="#6B7280" />
              <Text style={styles.members}>{group.member_count} members</Text>
              {group.is_private && (
                <View style={styles.privacyBadge}>
                  <MaterialIcons name="lock" size={14} color="#6B7280" />
                  <Text style={styles.privacyText}>Private</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        
        <Text style={styles.description} numberOfLines={3}>
          {group.description || 'No description provided'}
        </Text>
        
        <View style={styles.buttonContainer}>
          {!isMember ? (
            requestSent ? (
              <View style={styles.requestSentButton}>
                <Text style={styles.requestSentText}>
                  Request Sent
                </Text>
                <MaterialIcons name="check-circle" size={16} color="#10B981" style={styles.checkIcon} />
              </View>
            ) : (
              <TouchableOpacity 
                style={styles.joinButton} 
                onPress={handleJoinPress}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text style={styles.joinButtonText}>
                    {group.is_private ? 'Request to Join' : 'Join Group'}
                  </Text>
                )}
              </TouchableOpacity>
            )
          ) : (
            <View style={styles.memberButtons}>
              <TouchableOpacity 
                style={styles.actionButton} 
                onPress={onShowMembers}
              >
                <Text style={styles.actionButtonText}>Members</Text>
              </TouchableOpacity>
              
              {isAdmin && (
                <TouchableOpacity 
                  style={[styles.actionButton, styles.requestButton]} 
                  onPress={onShowRequests}
                >
                  <Text style={styles.actionButtonText}>Requests</Text>
                </TouchableOpacity>
              )}
              
              <View style={[
                styles.memberBadge,
                isAdmin && styles.adminBadge
              ]}>
                <Text style={styles.memberBadgeText}>
                  {isAdmin ? 'Admin' : 'Member'}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#0A192F',
  },
  container: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  image: {
    width: 80,
    height: 80,
    borderRadius: 12,
    marginRight: 16,
    backgroundColor: '#F3F4F6',
  },
  infoContainer: {
    flex: 1,
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  memberContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  members: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 6,
    fontFamily: 'System',
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#F9FAFB',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  privacyText: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 4,
    fontWeight: '500',
  },
  description: {
    fontSize: 15,
    color: '#4B5563',
    lineHeight: 22,
    marginBottom: 20,
    fontFamily: 'System',
  },
  buttonContainer: {
    flexDirection: 'row',
  },
  joinButton: {
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    flex: 1,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  joinButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
    fontFamily: 'System',
  },
  requestSentButton: {
    backgroundColor: '#ECFDF5',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  requestSentText: {
    color: '#065F46',
    fontWeight: '600',
    fontSize: 16,
    marginRight: 6,
    fontFamily: 'System',
  },
  checkIcon: {
    marginLeft: 4,
  },
  memberButtons: {
    flexDirection: 'row',
    gap: 10,
    flex: 1,
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  requestButton: {
    backgroundColor: '#EDE9FE',
    borderColor: '#DDD6FE',
  },
  actionButtonText: {
    color: '#4B5563',
    fontWeight: '600',
    fontSize: 16,
    fontFamily: 'System',
  },
  memberBadge: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  adminBadge: {
    backgroundColor: '#E0E7FF',
    borderColor: '#C7D2FE',
  },
  memberBadgeText: {
    color: '#4B5563',
    fontWeight: '600',
    fontSize: 14,
    fontFamily: 'System',
  },
});

export default GroupHeader;