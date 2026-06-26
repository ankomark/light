import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image, Alert,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { fetchBroadcasts, fetchBroadcastToken, endBroadcast } from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { isSuperAdmin } from '../../utils/roles';
import { colors, typography, spacing, radius, shadows } from '../../constants/theme';

const DEFAULT_AVATAR = require('../../assets/avatar-placeholder.jpg');

const KINDS = [
  { key: 'meet', label: 'Meet', icon: 'account-group' },
  { key: 'tv', label: 'Go-Live', icon: 'television-classic' },
];

const KIND_ICON = { meet: 'account-group', tv: 'television-classic' };

const LiveHub = ({ navigation }) => {
  const { currentUser } = useAuth();
  const isSuper = isSuperAdmin(currentUser);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);
  const [endingId, setEndingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchBroadcasts();
      setItems(res?.results || (Array.isArray(res) ? res : []));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openViewer = async (b) => {
    setOpening(b.id);
    try {
      const res = await fetchBroadcastToken(b.id);
      navigation.navigate('LiveRoom', { url: res.url, token: res.token, broadcast: res.broadcast, role: 'viewer' });
    } catch {
      Alert.alert('Live', 'This broadcast is no longer available.');
      load();
    } finally {
      setOpening(null);
    }
  };

  // Super admins can terminate any live session straight from the hub.
  const endLive = (b) => {
    Alert.alert(
      'End live session',
      `End @${b.host?.username || 'host'}'s “${b.title}” for everyone?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End live',
          style: 'destructive',
          onPress: async () => {
            setEndingId(b.id);
            try {
              await endBroadcast(b.id);
              setItems((prev) => prev.filter((x) => x.id !== b.id));
            } catch {
              Alert.alert('Live', 'Could not end this session.');
            } finally {
              setEndingId(null);
            }
          },
        },
      ],
    );
  };

  const renderItem = ({ item }) => {
    const host = item.host || {};
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => openViewer(item)} disabled={opening === item.id}>
        <View style={styles.thumb}>
          <Image source={host.profile_picture ? { uri: host.profile_picture } : DEFAULT_AVATAR} defaultSource={DEFAULT_AVATAR} style={styles.thumbImg} />
          <View style={styles.liveTag}><Text style={styles.liveTagText}>LIVE</Text></View>
          <View style={styles.kindTag}>
            <MaterialCommunityIcons name={KIND_ICON[item.kind] || 'account-group'} size={12} color="#fff" />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.cardHost} numberOfLines={1}>@{host.username || 'host'}</Text>
          <View style={styles.viewerRow}>
            <Ionicons name="eye" size={13} color={colors.textMuted} />
            <Text style={styles.viewerText}>{item.viewer_count || 0}</Text>
          </View>
        </View>
        {opening === item.id ? (
          <ActivityIndicator color={colors.accent} />
        ) : isSuper ? (
          endingId === item.id ? (
            <ActivityIndicator color={colors.error} />
          ) : (
            <TouchableOpacity onPress={() => endLive(item)} hitSlop={10} style={styles.endBtn}>
              <Ionicons name="stop-circle" size={24} color={colors.error} />
            </TouchableOpacity>
          )
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Live</Text>

      {/* Go Live CTA */}
      <View style={styles.goLiveRow}>
        {KINDS.map((k) => (
          <TouchableOpacity key={k.key} style={styles.goLiveBtn} activeOpacity={0.85}
            onPress={() => navigation.navigate('GoLive', { kind: k.key })}>
            <MaterialCommunityIcons name={k.icon} size={22} color={colors.accent} />
            <Text style={styles.goLiveLabel}>{k.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Live now</Text>
      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={load}
          refreshing={loading}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="broadcast-off" size={48} color={colors.textSecondary} />
              <Text style={styles.emptyText}>No one is live right now</Text>
              <Text style={styles.emptySub}>Tap Meet or Go-Live above to start your own</Text>
            </View>
          }
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
  goLiveRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  goLiveBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: spacing.md,
    backgroundColor: 'rgba(16,28,46,0.82)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.4)',
  },
  goLiveLabel: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  sectionTitle: {
    ...typography.label, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.md, marginTop: spacing.xs, marginBottom: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(16,28,46,0.82)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.10)',
    padding: spacing.sm + 2, marginBottom: spacing.sm, ...shadows.sm,
  },
  thumb: { width: 56, height: 56, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  thumbImg: { width: '100%', height: '100%' },
  liveTag: {
    position: 'absolute', top: 4, left: 4, backgroundColor: colors.error,
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
  },
  liveTagText: { color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  kindTag: {
    position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 9, width: 18, height: 18, alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  cardHost: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  viewerText: { ...typography.caption, color: colors.textMuted },
  endBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.xs },
  emptyText: { ...typography.body, color: colors.textSecondary },
  emptySub: { ...typography.caption, color: colors.textMuted },
});

export default LiveHub;
