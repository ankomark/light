import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  Modal, TextInput, Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchRoles, fetchCapabilities, createRole, updateRole, deleteRole,
} from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';
import { useI18n } from '../../context/I18nContext';

const AdminRoles = () => {
  const { t } = useI18n();
  const [roles, setRoles] = useState([]);
  const [caps, setCaps] = useState([]);          // [{key,label}]
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);  // role being edited, or {} for new
  const [name, setName] = useState('');
  const [selectedCaps, setSelectedCaps] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([fetchRoles(), fetchCapabilities()]);
      setRoles(Array.isArray(r) ? r : (r?.results || []));
      setCaps(Array.isArray(c) ? c : []);
    } catch {
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const capLabel = (key) => caps.find((c) => c.key === key)?.label || key;

  const openNew = () => { setEditing({}); setName(''); setSelectedCaps(new Set()); };
  const openEdit = (role) => { setEditing(role); setName(role.name); setSelectedCaps(new Set(role.capabilities || [])); };
  const close = () => setEditing(null);

  const toggleCap = (key) => setSelectedCaps((prev) => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  const save = async () => {
    const payload = { name: name.trim(), capabilities: [...selectedCaps] };
    if (!payload.name) { Alert.alert(t('admin.roleTitle'), t('admin.roleNameRequired')); return; }
    setSaving(true);
    try {
      if (editing.id) await updateRole(editing.id, payload);
      else await createRole(payload);
      close();
      load();
    } catch (e) {
      Alert.alert(t('admin.roleTitle'), e?.response?.data?.name?.[0] || e?.response?.data?.error || t('admin.roleSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (role) =>
    Alert.alert(t('admin.deleteRoleTitle'), t('admin.deleteRoleConfirm', { name: role.name }), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteRole(role.id); load(); } },
    ]);

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.roleName}>{item.name}</Text>
        <Text style={styles.userCount}>{item.user_count} staff</Text>
      </View>
      <View style={styles.capWrap}>
        {(item.capabilities || []).length === 0
          ? <Text style={styles.noCaps}>{t('admin.noCapabilities')}</Text>
          : item.capabilities.map((k) => (
            <View key={k} style={styles.capChip}><Text style={styles.capChipText}>{capLabel(k)}</Text></View>
          ))}
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.linkBtn} onPress={() => openEdit(item)}>
          <Ionicons name="create-outline" size={16} color={colors.accent} />
          <Text style={styles.linkText}>{t('profile.edit')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={() => confirmDelete(item)}>
          <Ionicons name="trash-outline" size={16} color={colors.error} />
          <Text style={[styles.linkText, { color: colors.error }]}>{t('common.delete')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t('admin.roles')}</Text>
        <TouchableOpacity style={styles.newBtn} onPress={openNew}>
          <Ionicons name="add" size={18} color="#0A1628" />
          <Text style={styles.newBtnText}>{t('admin.newRole')}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={roles}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={load}
          refreshing={loading}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>{t('admin.noRoles')}</Text></View>}
        />
      )}

      {/* Role editor */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{editing?.id ? 'Edit role' : 'New role'}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('admin.rolePlaceholder')}
              placeholderTextColor={colors.placeholder}
              value={name}
              onChangeText={setName}
            />
            <Text style={styles.capsLabel}>{t('admin.capabilities')}</Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              {caps.map((c) => {
                const on = selectedCaps.has(c.key);
                return (
                  <TouchableOpacity key={c.key} style={styles.capRow} onPress={() => toggleCap(c.key)} activeOpacity={0.8}>
                    <View style={[styles.checkbox, on && styles.checkboxOn]}>
                      {on && <Ionicons name="checkmark" size={14} color="#0A1628" />}
                    </View>
                    <Text style={styles.capRowText}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={styles.sheetActions}>
              <TouchableOpacity onPress={close} disabled={saving}><Text style={styles.cancel}>{t('common.cancel')}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="#0A1628" /> : <Text style={styles.saveText}>{t('common.save')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  titleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm,
  },
  title: {
    ...typography.h1, color: colors.textPrimary,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: colors.accent, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
  },
  newBtnText: { ...typography.caption, color: '#0A1628', fontWeight: '800' },
  list: { padding: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.md, marginBottom: spacing.sm, ...shadows.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roleName: { ...typography.h3, color: colors.textPrimary, fontWeight: '700' },
  userCount: { ...typography.caption, color: colors.textMuted },
  capWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  capChip: {
    backgroundColor: 'rgba(244,162,97,0.15)', borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.4)',
  },
  capChipText: { ...typography.caption, color: colors.accent, fontWeight: '600', fontSize: 11 },
  noCaps: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic' },
  cardActions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkText: { ...typography.caption, color: colors.accent, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#0E2038', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
    padding: spacing.md, paddingBottom: spacing.xl,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: spacing.sm },
  sheetTitle: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.sm },
  input: {
    color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  capsLabel: {
    ...typography.caption, color: colors.accent, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.6, marginTop: spacing.md, marginBottom: spacing.xs,
  },
  capRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  capRowText: { ...typography.body, color: colors.textPrimary },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.lg, marginTop: spacing.md },
  cancel: { ...typography.label, color: colors.textSecondary, fontWeight: '700' },
  saveBtn: { backgroundColor: colors.accent, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, minWidth: 80, alignItems: 'center' },
  saveText: { ...typography.label, color: '#0A1628', fontWeight: '800' },
});

export default AdminRoles;
