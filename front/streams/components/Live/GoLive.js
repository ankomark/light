import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBroadcast } from '../../services/api';
import { colors, typography, spacing, radius } from '../../constants/theme';

const KINDS = [
  { key: 'radio', label: 'Radio', icon: 'radio', hint: 'Audio only' },
  { key: 'tv', label: 'TV', icon: 'television-classic', hint: 'Video' },
  { key: 'podcast', label: 'Podcast', icon: 'microphone', hint: 'Video + talk' },
];

const GoLive = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState(route.params?.kind || 'radio');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    const t = title.trim();
    if (t.length < 3) { Alert.alert('Go Live', 'Give your broadcast a title.'); return; }
    setBusy(true);
    try {
      const res = await createBroadcast(kind, t);
      // Replace so Back doesn't return to the form mid-broadcast.
      navigation.replace('LiveRoom', { url: res.url, token: res.token, broadcast: res.broadcast, role: 'host' });
    } catch (e) {
      Alert.alert('Go Live', e?.response?.data?.error || 'Could not start the broadcast.');
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Go Live</Text>
        <View style={{ width: 26 }} />
      </View>

      <Text style={styles.label}>Type</Text>
      <View style={styles.kindRow}>
        {KINDS.map((k) => {
          const active = kind === k.key;
          return (
            <TouchableOpacity key={k.key} style={[styles.kindCard, active && styles.kindCardActive]}
              onPress={() => setKind(k.key)} activeOpacity={0.85}>
              <MaterialCommunityIcons name={k.icon} size={26} color={active ? '#0A1628' : colors.accent} />
              <Text style={[styles.kindLabel, active && styles.kindLabelActive]}>{k.label}</Text>
              <Text style={[styles.kindHint, active && { color: '#0A1628' }]}>{k.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Morning Devotion"
        placeholderTextColor={colors.placeholder}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
      />

      <TouchableOpacity style={[styles.goBtn, busy && { opacity: 0.6 }]} onPress={start} disabled={busy} activeOpacity={0.85}>
        {busy ? <ActivityIndicator color="#0A1628" /> : (
          <>
            <Ionicons name="radio" size={20} color="#0A1628" />
            <Text style={styles.goBtnText}>Go Live</Text>
          </>
        )}
      </TouchableOpacity>
      <Text style={styles.note}>Your followers will be notified that you're on air. Nothing is recorded.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1628', paddingHorizontal: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  label: {
    ...typography.label, color: colors.accent, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: spacing.sm, marginTop: spacing.md,
  },
  kindRow: { flexDirection: 'row', gap: spacing.sm },
  kindCard: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.md,
    backgroundColor: 'rgba(16,28,46,0.85)', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  kindCardActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  kindLabel: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  kindLabelActive: { color: '#0A1628' },
  kindHint: { ...typography.caption, color: colors.textMuted },
  input: {
    color: colors.textPrimary, fontSize: 16, backgroundColor: colors.inputBg,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  goBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.accent, borderRadius: radius.full, paddingVertical: spacing.md, marginTop: spacing.xl,
  },
  goBtnText: { ...typography.button, color: '#0A1628', fontWeight: '800' },
  note: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});

export default GoLive;
