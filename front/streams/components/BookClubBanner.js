// On a group's page: when the group is a book club, a line to its book and
// reading plan. Nothing otherwise (and nothing if it can't be known offline).
import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchClubOfGroup } from '../services/api';
import { colors, typography, spacing } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const BookClubBanner = ({ groupSlug, navigation }) => {
  const { t } = useI18n();
  const [club, setClub] = useState(null);
  useEffect(() => {
    let alive = true;
    if (groupSlug) fetchClubOfGroup(groupSlug).then((r) => { if (alive) setClub(r?.club || null); }).catch(() => {});
    return () => { alive = false; };
  }, [groupSlug]);
  if (!club) return null;
  return (
    <TouchableOpacity style={styles.bar} onPress={() => navigation.navigate('BookClub', { clubId: club })}
      accessibilityRole="button" testID="group-book-club">
      <Ionicons name="book" size={16} color={colors.accent} />
      <Text style={styles.text}>{t('club.readingTogether')}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 10,
    backgroundColor: 'rgba(244,162,97,0.10)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  text: { ...typography.label, color: colors.textPrimary, fontWeight: '700', flex: 1 },
});

export default BookClubBanner;
