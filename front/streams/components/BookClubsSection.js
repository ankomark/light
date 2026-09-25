// On a book's page: the clubs reading it (yours, and public ones), and
// "Start a book club" — a name, a pace, public or private — which makes the
// group and its reading plan.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from './BottomSheet';
import useKeyboardHeight from '../hooks/useKeyboardHeight';
import useCachedData from '../utils/useCachedData';
import { userKey } from '../utils/screenCache';
import { useAuth } from '../context/useAuth';
import { fetchBookClubs, createBookClub } from '../services/api';
import { notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export const PACES = [
  { key: 'week1', chapters_per_step: 1, every_days: 7 },
  { key: 'week2', chapters_per_step: 2, every_days: 7 },
  { key: 'days3', chapters_per_step: 1, every_days: 3 },
];

const BookClubsSection = ({ pub, navigation, isAuthenticated }) => {
  const { t } = useI18n();
  const kbHeight = useKeyboardHeight();       // the sheet rises with the keyboard
  const { currentUser } = useAuth();
  // The clubs reading it: the last copy at once, then fresh.
  const { data } = useCachedData(userKey(currentUser?.id, `clubs:${pub.id}`),
    async () => (await fetchBookClubs(pub.id))?.results || []);
  const clubs = data || [];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pace, setPace] = useState('week1');
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);


  const start = async () => {
    const p = PACES.find((x) => x.key === pace);
    setBusy(true);
    try {
      const club = await createBookClub(pub.id, {
        name: name.trim() || t('club.defaultName', { title: pub.title }), private: !isPublic,
        chapters_per_step: p.chapters_per_step, every_days: p.every_days,
      });
      setOpen(false);
      navigation.navigate('BookClub', { clubId: club.id });
    } catch {
      notify(t('common.error'), t('club.startFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.section} testID="book-clubs">
      <Text style={styles.title}>{t('club.sectionTitle')}</Text>
      {clubs.map((c) => (
        <TouchableOpacity key={c.id} style={styles.row} onPress={() => navigation.navigate('BookClub', { clubId: c.id })}
          testID={`book-club-${c.id}`}>
          <Ionicons name="people" size={18} color={colors.accent} />
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
            <Text style={styles.meta}>{t('club.members', { n: c.members })}{c.is_member ? ` · ${t('club.youreIn')}` : ''}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.start} testID="club-start"
        onPress={() => (isAuthenticated ? setOpen(true) : navigation.navigate('Login'))}>
        <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
        <Text style={styles.startText}>{t('club.start')}</Text>
      </TouchableOpacity>

      <BottomSheet

        keyboardHeight={kbHeight}
        visible={open}
        onClose={() => setOpen(false)}
        heightRatio={0.6}
        header={(
          <View style={styles.head}>
            <Text style={styles.sheetTitle}>{t('club.start')}</Text>
            <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity>
          </View>
        )}
      >
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={100}
            placeholder={t('club.defaultName', { title: pub.title })} placeholderTextColor={colors.placeholder} testID="club-name" />
          <Text style={styles.label}>{t('club.pace')}</Text>
          {PACES.map((p) => (
            <TouchableOpacity key={p.key} style={[styles.choice, pace === p.key && styles.choiceOn]} onPress={() => setPace(p.key)}
              accessibilityRole="radio" accessibilityState={{ checked: pace === p.key }} testID={`club-pace-${p.key}`}>
              <Ionicons name={pace === p.key ? 'radio-button-on' : 'radio-button-off'} size={18} color={colors.primary} />
              <Text style={styles.choiceText}>{t(`club.pace.${p.key}`)}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.choice} onPress={() => setIsPublic((v) => !v)} accessibilityRole="switch"
            accessibilityState={{ checked: isPublic }} testID="club-public">
            <Ionicons name={isPublic ? 'checkbox' : 'square-outline'} size={18} color={colors.primary} />
            <Text style={styles.choiceText}>{t('club.public')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.go} onPress={start} disabled={busy} testID="club-create">
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.goText}>{t('club.create')}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </BottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginTop: spacing.xl },
  flex: { flex: 1 },
  title: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  name: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  meta: { ...typography.caption, color: colors.textSecondary },
  start: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  startText: { ...typography.label, color: colors.primary, fontWeight: '700' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  sheetTitle: { ...typography.h3, color: colors.textPrimary },
  sheetBody: { paddingHorizontal: spacing.md, gap: spacing.sm },
  input: {
    color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', marginTop: spacing.xs },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  choiceOn: {},
  choiceText: { ...typography.body, color: colors.textPrimary },
  go: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  goText: { ...typography.button, color: colors.white },
});

export default BookClubsSection;
