import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchBlockedUsers, unblockUser } from '../services/api';
import { typography, spacing, radius, shadows } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../context/I18nContext';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');

const BlockedUsers = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  // A list that could not be read is not an empty one: "no one blocked"
  // would be wrong, and the people blocked would seem free to reach you.
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setLoading(true);
    try {
      const data = await fetchBlockedUsers();
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUnblock = (item) => {
    Alert.alert(t('blocked.unblockTitle'), t('blocked.unblockConfirm', { name: item.username }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('blocked.unblock'),
        onPress: async () => {
          setBusyId(item.id);
          const at = users.findIndex((u) => u.id === item.id);
          setUsers((cur) => cur.filter((u) => u.id !== item.id)); // optimistic
          try {
            await unblockUser(item.id);
          } catch {
            // Back where it was, among the list as it is now.
            setUsers((cur) => {
              const next = cur.filter((u) => u.id !== item.id);
              next.splice(Math.max(0, Math.min(at, next.length)), 0, item);
              return next;
            });
            Alert.alert(t('common.error'), t('blocked.unblockFailed'));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }) => (
    <View style={styles.row}>
      <Image
        source={item.profile_picture ? { uri: item.profile_picture } : DEFAULT_AVATAR}
        defaultSource={DEFAULT_AVATAR}
        style={styles.avatar}
      />
      <Text style={styles.username} numberOfLines={1}>@{item.username}</Text>
      <TouchableOpacity
        style={styles.unblockBtn}
        onPress={() => handleUnblock(item)}
        testID={`unblock-${item.id}`}
        disabled={busyId === item.id}
        activeOpacity={0.8}
      >
        {busyId === item.id
          ? <ActivityIndicator size="small" color={colors.primary} />
          : <Text style={styles.unblockText}>{t('blocked.unblock')}</Text>}
      </TouchableOpacity>
    </View>
  );

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
        <Text style={styles.headerTitle}>{t('blocked.title')}</Text>
        <View style={styles.backBtn} />
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : failed ? (
        <View style={styles.empty} testID="blocked-failed">
          <MaterialCommunityIcons name="wifi-off" size={48} color={colors.border} />
          <Text style={styles.emptyTitle}>{t('blocked.loadFailed')}</Text>
          <TouchableOpacity onPress={load} style={styles.unblockBtn} testID="blocked-retry">
            <Text style={styles.unblockText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="account-cancel-outline" size={56} color={colors.border} />
              <Text style={styles.emptyTitle}>{t('blocked.empty')}</Text>
              <Text style={styles.emptySub}>{t('blocked.emptySub')}</Text>
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
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    marginRight: spacing.md,
  },
  username: { ...typography.body, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  unblockBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
    minWidth: 90,
    alignItems: 'center',
  },
  unblockText: { ...typography.label, color: colors.primary, fontWeight: '700' },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.md },
  emptySub: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' },
});

export default BlockedUsers;
