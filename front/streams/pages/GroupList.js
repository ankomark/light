import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  StyleSheet, 
  ActivityIndicator, 
  Alert, 
  TouchableOpacity,
  RefreshControl 
} from 'react-native';
import { useAuth } from '../context/useAuth';
import { fetchGroups, createGroup, deleteGroup } from '../services/api';
import GroupItem from './GroupItem';
import { useFocusEffect } from '@react-navigation/native';

const GroupList = ({ navigation }) => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const { currentUser } = useAuth();

  // Memoized fetch function
  const loadGroups = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) setLoading(true);
      const data = await fetchGroups();
      setGroups(data);
      return data;
    } catch (error) {
      console.error('Failed to load groups:', error);
      Alert.alert(
        'Error', 
        error.detail || error.message || 'Failed to load groups. Please try again.'
      );
      throw error;
    } finally {
      if (showLoader) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load data on focus and initial mount
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      
      const loadData = async () => {
        try {
          if (isActive) setLoading(true);
          await loadGroups();
        } catch (error) {
          if (isActive) {
            setGroups([]);
          }
        }
      };

      loadData();
      
      return () => {
        isActive = false;
      };
    }, [loadGroups])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadGroups(false);
  }, [loadGroups]);

  const handleCreateGroup = useCallback(async (groupData) => {
    try {
      setCreatingGroup(true);
      const newGroup = await createGroup(groupData);
      
      // Optimistic update
      setGroups(prev => [newGroup, ...prev]);
      
      navigation.navigate('GroupDetail', { 
        groupSlug: newGroup.slug,
        // Pass the new group to avoid immediate refetch
        group: newGroup 
      });
    } catch (error) {
      console.error('Failed to create group:', error);
      Alert.alert(
        'Error',
        error.detail || error.message || 'Failed to create group. Please try again.'
      );
    } finally {
      setCreatingGroup(false);
    }
  }, [navigation]);

  const handleDeleteGroup = useCallback(async (group) => {
    Alert.alert(
      'Delete Group',
      `Are you sure you want to delete "${group.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteGroup(group.slug);
              setGroups(prev => prev.filter(g => g.slug !== group.slug));
            } catch (error) {
              console.error('Failed to delete group:', error);
              Alert.alert(
                'Error',
                error.detail || error.message || 'Failed to delete group. Please try again.'
              );
            }
          },
        },
      ]
    );
  }, []);

  const handleEditGroup = useCallback((group) => {
    navigation.navigate('CreateGroup', {
      group,
      onSubmit: (updatedGroup) => {
        setGroups(prev => prev.map(g => 
          g.slug === updatedGroup.slug ? updatedGroup : g
        ));
      },
    });
  }, [navigation]);

  const renderGroupItem = useCallback(({ item }) => (
    <GroupItem 
      group={item} 
      onPress={() => navigation.navigate('GroupDetail', { 
        groupSlug: item.slug,
        group: item // Pass the group to avoid immediate refetch
      })}
      onDelete={() => handleDeleteGroup(item)}
      onEdit={() => handleEditGroup(item)}
      isCreator={currentUser?.id === item.creator?.id}
    />
  ), [currentUser?.id, handleDeleteGroup, handleEditGroup, navigation]);

  const renderEmptyComponent = useCallback(() => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>No groups found</Text>
      <Text style={styles.emptySubtext}>Create your first group to get started</Text>
    </View>
  ), []);

  if (loading && !refreshing) {
    return (
      <View style={styles.fullScreenLoader}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={[styles.createButton, creatingGroup && styles.disabledButton]}
        onPress={() => navigation.navigate('CreateGroup', { 
          onCreate: handleCreateGroup 
        })}
        disabled={creatingGroup}
      >
        {creatingGroup ? (
          <ActivityIndicator color="white" size="small" />
        ) : (
          <Text style={styles.createButtonText}>Create New Group</Text>
        )}
      </TouchableOpacity>

      <FlatList
        data={groups}
        keyExtractor={(item) => item.slug}
        renderItem={renderGroupItem}
        ListEmptyComponent={renderEmptyComponent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#4F46E5']}
            tintColor="#4F46E5"
          />
        }
        contentContainerStyle={groups.length === 0 && styles.listContent}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={11}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  fullScreenLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButton: {
    backgroundColor: '#4F46E5',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  disabledButton: {
    backgroundColor: '#A5B4FC',
    opacity: 0.7,
  },
  createButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6B7280',
  },
  listContent: {
    flexGrow: 1,
  },
});

export default React.memo(GroupList);