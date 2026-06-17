import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchAdminContent, removeContent, restoreContent } from '../../services/api';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

const TYPES = [
  { key: 'post', label: 'Posts' },
  { key: 'track', label: 'Tracks' },
  { key: 'comment', label: 'Comments' },
];

const AdminContent = () => {
  const [type, setType] = useState('post');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async (t) => {
    setLoading(true);
    try {
      const res = await fetchAdminContent(t);
      setItems(res?.results || (Array.isArray(res) ? res : []));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(type); }, [load, type]));

  const toggle = async (item) => {
    const willRemove = !item.is_removed;
    const doIt = async () => {
      setBusyId(item.id);
      try {
        await (willRemove ? removeContent(type, item.id) : restoreContent(type, item.id));
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, is_removed: willRemove } : it)));
      } catch {
        Alert.alert('Error', 'Action failed.');
      } finally {
        setBusyId(null);
      }
    };
    if (willRemove) {
      Alert.alert('Remove content', `Hide this ${type} from everyone? You can restore it later.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doIt },
      ]);
    } else {
      doIt();
    }
  };

  const renderItem = ({ item }) => {
    const author = item.author;
    const text = item.caption || item.content || item.title || `#${item.id}`;
    return (
      <View style={[styles.card, item.is_removed && styles.cardRemoved]}>
        <View style={styles.head}>
          <Image
            source={author?.profile_picture ? { uri: author.profile_picture } : DEFAULT_AVATAR}
            defaultSource={DEFAULT_AVATAR}
            style={styles.avatar}
          />
          <Text style={styles.author} numberOfLines={1}>@{author?.username || 'unknown'}</Text>
          {item.is_removed && <Text style={styles.removedPill}>removed</Text>}
        </View>
        <Text style={styles.body} numberOfLines={3}>{text || '(no text)'}</Text>

        {busyId === item.id ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />
        ) : (
          <TouchableOpacity
            style={[styles.btn, item.is_removed ? styles.btnRestore : styles.btnRemove]}
            onPress={() => toggle(item)}
            activeOpacity={0.85}
          >
            <Ionicons name={item.is_removed ? 'refresh-outline' : 'trash-outline'} size={16}
              color={item.is_removed ? '#0A1628' : colors.white} />
            <Text style={item.is_removed ? styles.btnTextDark : styles.btnTextLight}>
              {item.is_removed ? 'Restore' : 'Remove'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Content</Text>
      <View style={styles.filterRow}>
        {TYPES.map((tp) => {
          const active = type === tp.key;
          return (
            <TouchableOpacity key={tp.key} style={[styles.pill, active && styles.pillActive]}
              onPress={() => setType(tp.key)} activeOpacity={0.85}>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{tp.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${type}_${item.id}`}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={() => load(type)}
          refreshing={loading}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>Nothing here</Text></View>}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: {
    ...typography.h1, color: colors.textPrimary, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pill: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full,
    backgroundColor: 'rgba(16,28,46,0.82)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  pillTextActive: { color: '#0A1628' },
  list: { padding: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.md, marginBottom: spacing.sm, ...shadows.sm,
  },
  cardRemoved: { opacity: 0.7, borderColor: 'rgba(229,57,53,0.4)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface },
  author: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  removedPill: {
    ...typography.caption, color: colors.error, fontWeight: '800', fontSize: 10,
    marginLeft: 'auto', textTransform: 'uppercase',
  },
  body: { ...typography.body, color: colors.textSecondary },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, marginTop: spacing.sm,
  },
  btnRemove: { backgroundColor: colors.error },
  btnRestore: { backgroundColor: colors.accent },
  btnTextLight: { ...typography.caption, color: colors.white, fontWeight: '700' },
  btnTextDark: { ...typography.caption, color: '#0A1628', fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary },
});

export default AdminContent;
