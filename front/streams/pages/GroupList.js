import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/useAuth';
import { fetchGroups, createGroup, deleteGroup, joinGroupByCode } from '../services/api';
import GroupItem from './GroupItem';
import { useFocusEffect } from '@react-navigation/native';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const TABS = [
  { key: 'public', label: 'Public', icon: 'earth' },
  { key: 'private', label: 'Private', icon: 'lock-closed' },
  { key: 'mine', label: 'My Groups', icon: 'people' },
];

const GroupList = ({ navigation }) => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [activeTab, setActiveTab] = useState('public');
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const { currentUser } = useAuth();

  // Memoized fetch function
  const loadGroups = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) setLoading(true);
      const data = await fetchGroups();
      setGroups(Array.isArray(data) ? data : []);
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

  const handleJoinByCode = useCallback(async () => {
    const code = joinCode.trim();
    if (!code) return;
    setJoining(true);
    try {
      const group = await joinGroupByCode(code);
      setJoinOpen(false);
      setJoinCode('');
      await loadGroups(false);
      navigation.navigate('GroupDetail', { groupSlug: group.slug, group });
    } catch (e) {
      Alert.alert('Couldn’t join', e?.response?.data?.error || 'This invite link is invalid or has expired.');
    } finally {
      setJoining(false);
    }
  }, [joinCode, loadGroups, navigation]);

  // Split the visible groups into the three tabs. Private groups only ever reach
  // the client when the user is already a member (server-enforced), so the
  // Private tab naturally shows just the private groups they belong to.
  const filtered = useMemo(() => {
    if (activeTab === 'public') return groups.filter(g => !g.is_private);
    if (activeTab === 'private') return groups.filter(g => g.is_private);
    return groups.filter(g => g.is_member); // mine
  }, [groups, activeTab]);

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

  const emptyCopy = {
    public: { title: 'No public groups yet', sub: 'Create one to get the conversation started' },
    private: { title: 'No private groups', sub: 'Private groups you’re added to will appear here' },
    mine: { title: 'You’re not in any groups', sub: 'Join a public group or use an invite link' },
  }[activeTab];

  const renderEmptyComponent = useCallback(() => (
    <View style={styles.emptyContainer}>
      <Ionicons name="people-circle-outline" size={56} color={colors.textMuted} />
      <Text style={styles.emptyText}>{emptyCopy.title}</Text>
      <Text style={styles.emptySubtext}>{emptyCopy.sub}</Text>
    </View>
  ), [emptyCopy]);

  if (loading && !refreshing && groups.length === 0) {
    return (
      <View style={styles.root}>
        <View style={styles.fullScreenLoader}>
          <ActivityIndicator size="large" color="#F4A261" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.container}>
        {/* Tabs */}
        <View style={styles.tabBar}>
          {TABS.map(t => {
            const active = activeTab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setActiveTab(t.key)}
                activeOpacity={0.85}
              >
                <Ionicons name={t.icon} size={15} color={active ? '#0A1628' : colors.textSecondary} />
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Actions */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.createButton, creatingGroup && styles.disabledButton]}
            onPress={() => navigation.navigate('CreateGroup', { onCreate: handleCreateGroup })}
            disabled={creatingGroup}
            activeOpacity={0.85}
          >
            {creatingGroup ? (
              <ActivityIndicator color="#0A1628" size="small" />
            ) : (
              <>
                <Ionicons name="add" size={18} color="#0A1628" />
                <Text style={styles.createButtonText}>New Group</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.codeButton} onPress={() => setJoinOpen(true)} activeOpacity={0.85}>
            <Ionicons name="link" size={18} color={colors.accent} />
            <Text style={styles.codeButtonText}>Join with code</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.slug}
          renderItem={renderGroupItem}
          ListEmptyComponent={renderEmptyComponent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={['#4F46E5']}
              tintColor="#fff"
            />
          }
          contentContainerStyle={filtered.length === 0 && styles.listContent}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={11}
        />
      </View>

      {/* Join with invite code */}
      <Modal visible={joinOpen} transparent animationType="fade" onRequestClose={() => setJoinOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setJoinOpen(false)}>
          <Pressable style={styles.modalCard}>
            <View style={styles.modalIcon}><Ionicons name="link" size={26} color={colors.accent} /></View>
            <Text style={styles.modalTitle}>Join with an invite</Text>
            <Text style={styles.modalText}>Paste the invite code an admin shared with you.</Text>
            <TextInput
              style={styles.codeInput}
              placeholder="Invite code"
              placeholderTextColor={colors.placeholder}
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancelBtn]} onPress={() => setJoinOpen(false)} activeOpacity={0.85}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalJoinBtn, !joinCode.trim() && styles.disabledButton]} onPress={handleJoinByCode} disabled={!joinCode.trim() || joining} activeOpacity={0.85}>
                {joining ? <ActivityIndicator color="#0A1628" size="small" /> : <Text style={styles.modalJoinText}>Join</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: 'transparent' },
  fullScreenLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(13,35,64,0.7)',
    borderRadius: radius.full,
    padding: 4,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: spacing.sm, borderRadius: radius.full,
  },
  tabActive: { backgroundColor: colors.accent, ...shadows.sm },
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  tabTextActive: { color: '#0A1628' },

  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  createButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.accent, paddingVertical: spacing.sm + 4, borderRadius: radius.md, ...shadows.sm,
  },
  createButtonText: { color: '#0A1628', fontWeight: '800', fontSize: 14 },
  codeButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4, borderRadius: radius.md,
    backgroundColor: 'rgba(16,46,80,0.7)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.4)',
  },
  codeButtonText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  disabledButton: { opacity: 0.6 },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 90, gap: spacing.xs },
  emptyText: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm },
  emptySubtext: { fontSize: 13.5, color: colors.textSecondary, textAlign: 'center' },
  listContent: { flexGrow: 1 },

  // Join-with-code modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: {
    width: '100%', maxWidth: 360, backgroundColor: 'rgba(16,46,80,0.98)', borderRadius: radius.xl,
    padding: spacing.lg, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.35)', ...shadows.lg,
  },
  modalIcon: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(244,162,97,0.14)', borderWidth: 1, borderColor: 'rgba(244,162,97,0.5)', marginBottom: spacing.md,
  },
  modalTitle: { ...typography.h3, color: colors.textPrimary, fontWeight: '800', textAlign: 'center' },
  modalText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  codeInput: {
    alignSelf: 'stretch', marginTop: spacing.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, color: colors.textPrimary,
    backgroundColor: 'rgba(13,35,64,0.85)', fontSize: 15,
  },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' },
  modalBtn: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.lg, alignItems: 'center' },
  modalCancelBtn: { backgroundColor: 'rgba(18,30,46,0.9)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  modalCancelText: { ...typography.button, color: colors.textSecondary, fontWeight: '700' },
  modalJoinBtn: { backgroundColor: colors.accent },
  modalJoinText: { ...typography.button, color: '#0A1628', fontWeight: '800' },
});

export default React.memo(GroupList);
