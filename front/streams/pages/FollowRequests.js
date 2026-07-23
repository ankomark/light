import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  fetchFollowRequests,
  approveFollowRequest,
  rejectFollowRequest,
} from '../services/api';
import { typography, spacing, radius, shadows } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

// People asking to follow a private account. Only the account owner sees this —
// the server scopes the list to the requester's own pending rows.
const FollowRequests = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchFollowRequests();
      setRequests(Array.isArray(data) ? data : (data?.results || []));
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const act = async (item, approve) => {
    setBusyId(item.id);
    const previous = requests;
    setRequests((cur) => cur.filter((r) => r.id !== item.id));  // optimistic
    try {
      await (approve ? approveFollowRequest(item.id) : rejectFollowRequest(item.id));
    } catch {
      setRequests(previous);  // revert
      Alert.alert(t('common.error'), t('followReq.updateFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = (item) => {
    Alert.alert(
      'Decline request',
      `Decline @${item.requester?.username}? They won't be told, and they can ask again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Decline', style: 'destructive', onPress: () => act(item, false) },
      ]
    );
  };

  const renderItem = ({ item }) => {
    const user = item.requester || {};
    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.identity}
          onPress={() => navigation.navigate('UserProfile', { userId: user.id })}
          activeOpacity={0.7}
        >
          <Image
            source={user.profile_picture ? { uri: user.profile_picture } : DEFAULT_AVATAR}
            defaultSource={DEFAULT_AVATAR}
            style={styles.avatar}
          />
          <Text style={styles.username} numberOfLines={1}>@{user.username}</Text>
        </TouchableOpacity>

        {busyId === item.id ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.declineBtn}
              onPress={() => handleReject(item)}
              activeOpacity={0.8}
            >
              <Text style={styles.declineText}>{t('common.decline')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.approveBtn}
              onPress={() => act(item, true)}
              activeOpacity={0.8}
            >
              <Text style={styles.approveText}>{t('common.approve')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('followReq.title')}</Text>
        <View style={styles.backBtn} />
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="account-clock-outline" size={56} color={colors.border} />
              <Text style={styles.emptyTitle}>{t('followReq.none')}</Text>
              <Text style={styles.emptySub}>
                While your account is private, people who want to follow you appear here first.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { ...typography.h2, color: colors.textPrimary },

  listContent: { padding: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  identity: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.sm },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    marginRight: spacing.md,
  },
  username: { ...typography.body, color: colors.textPrimary, fontWeight: '600', flex: 1 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  declineBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  declineText: { ...typography.label, color: colors.textSecondary, fontWeight: '600' },
  approveBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  approveText: { ...typography.label, color: colors.white, fontWeight: '700' },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.md },
  emptySub: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});

export default FollowRequests;
