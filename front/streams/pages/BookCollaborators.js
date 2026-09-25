// Who works on a book: the author invites people by username as co-author,
// editor or viewer, changes their role, or removes them; a collaborator sees
// the list and can leave.
import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchCollaborators, inviteCollaborator, setCollaboratorRole, removeCollaborator,
} from '../services/api';
import { confirmAction, notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';
import useCachedData from '../utils/useCachedData';
import { userKey } from '../utils/screenCache';

const DEFAULT_AVATAR = require('../assets/avatar-placeholder.jpg');
export const ROLES = ['coauthor', 'editor', 'viewer'];

const BookCollaborators = ({ route, navigation }) => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  const { id, title = '' } = route.params || {};
  const { data, setData, failed, reload: load } = useCachedData(userKey(currentUser?.id, `book-people:${id}`),
    () => fetchCollaborators(id));
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('editor');
  const [busy, setBusy] = useState(false);


  const isOwner = data?.my_role === 'owner';

  const invite = async () => {
    if (!username.trim() || busy) return;
    setBusy(true);
    try {
      const row = await inviteCollaborator(id, username.trim(), role);
      setUsername('');
      setData((d) => ({ ...d, results: [...d.results.filter((r) => r.id !== row.id), row] }));
    } catch (err) {
      notify(t('common.error'), err?.response?.data?.code === 'no_user' ? t('studio.noSuchUser') : t('studio.inviteFailed'));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (row, next) => {
    try {
      const updated = await setCollaboratorRole(id, row.id, next);
      setData((d) => ({ ...d, results: d.results.map((r) => (r.id === row.id ? updated : r)) }));
    } catch {
      notify(t('common.error'), t('studio.inviteFailed'));
    }
  };

  const remove = async (row) => {
    const leaving = row.user?.id === currentUser?.id;
    const ok = await confirmAction({
      title: t(leaving ? 'studio.leaveTitle' : 'studio.removeTitle', { name: row.user?.username }),
      confirmLabel: t(leaving ? 'studio.leave' : 'common.remove'), cancelLabel: t('common.cancel'), destructive: true,
    });
    if (!ok) return;
    try {
      await removeCollaborator(id, row.id);
      if (leaving) { navigation.popToTop?.(); return; }
      setData((d) => ({ ...d, results: d.results.filter((r) => r.id !== row.id) }));
    } catch {
      notify(t('common.error'), t('studio.inviteFailed'));
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.topTitle}>{t('studio.people')}</Text>
          {title ? <Text style={styles.topSub} numberOfLines={1}>{title}</Text> : null}
        </View>
        <View style={styles.iconBtn} />
      </View>

      {!data ? (
        <View style={styles.centered}>
          {failed ? (
            <TouchableOpacity style={styles.btn} onPress={load}><Text style={styles.btnText}>{t('common.retry')}</Text></TouchableOpacity>
          ) : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : (
        <FlatList
          data={data.results}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={isOwner ? (
            <View style={styles.invite}>
              <Text style={styles.label}>{t('studio.invite')}</Text>
              <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none"
                autoCorrect={false} placeholder={t('studio.usernamePlaceholder')} placeholderTextColor={colors.placeholder}
                testID="collab-username" />
              <View style={styles.roles}>
                {ROLES.map((r) => (
                  <TouchableOpacity key={r} style={[styles.chip, role === r && styles.chipOn]} onPress={() => setRole(r)}
                    testID={`collab-role-${r}`}>
                    <Text style={[styles.chipText, role === r && styles.chipTextOn]}>{t(`studio.role.${r}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.hint}>{t(`studio.roleHint.${role}`)}</Text>
              <TouchableOpacity style={styles.btn} onPress={invite} disabled={!username.trim() || busy} testID="collab-invite">
                {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.btnText}>{t('studio.sendInvite')}</Text>}
              </TouchableOpacity>
            </View>
          ) : null}
          ListEmptyComponent={<Text style={styles.muted}>{t('studio.noPeople')}</Text>}
          renderItem={({ item }) => (
            <View style={styles.row} testID={`collab-row-${item.id}`}>
              <Image source={item.user?.profile_picture ? { uri: item.user.profile_picture } : DEFAULT_AVATAR} style={styles.avatar} />
              <View style={styles.flex}>
                <Text style={styles.name}>{item.user?.username}</Text>
                <Text style={styles.meta}>{t(`studio.role.${item.role}`)}{item.accepted ? '' : ` · ${t('studio.invited')}`}</Text>
              </View>
              {isOwner ? (
                <View style={styles.rowActions}>
                  {ROLES.filter((r) => r !== item.role).map((r) => (
                    <TouchableOpacity key={r} onPress={() => changeRole(item, r)} hitSlop={6}>
                      <Text style={styles.link}>{t(`studio.role.${r}`)}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity onPress={() => remove(item)} hitSlop={6} testID={`collab-remove-${item.id}`}>
                    <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                  </TouchableOpacity>
                </View>
              ) : item.user?.id === currentUser?.id ? (
                <TouchableOpacity onPress={() => remove(item)}><Text style={[styles.link, { color: colors.error }]}>{t('studio.leave')}</Text></TouchableOpacity>
              ) : null}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  titleWrap: { flex: 1, alignItems: 'center' },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  topSub: { ...typography.caption, color: colors.textSecondary },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.md, width: '100%', maxWidth: 640, alignSelf: 'center' },
  invite: { gap: spacing.sm, marginBottom: spacing.lg },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase' },
  input: {
    color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  roles: { flexDirection: 'row', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 3, borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  chipTextOn: { color: colors.white },
  hint: { ...typography.caption, color: colors.textMuted },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' },
  btnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  muted: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface },
  name: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  meta: { ...typography.caption, color: colors.textSecondary },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  link: { ...typography.caption, color: colors.primary, fontWeight: '700' },
});

export default BookCollaborators;
