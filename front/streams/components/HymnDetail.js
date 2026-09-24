import React, { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useHymnFavorites } from '../services/hymnFavorites';

const HymnDetail = ({ route }) => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { hymn, hymnalName, lang = 'en' } = route.params;
  const verses = Array.isArray(hymn.verses) ? hymn.verses : [];

  // Favourite: kept on the phone for quick singing and memorising.
  const { isFavorite, toggle } = useHymnFavorites();
  const favorite = isFavorite(lang, hymn.number);
  const [note, setNote] = useState(null);
  const fade = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onFavorite = async () => {
    const on = await toggle(lang, hymn.number);
    setNote(t(on ? 'hymns.favAdded' : 'hymns.favRemoved'));
    fade.setValue(1);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setNote(null));
    }, 1800);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>{hymnalName || 'Hymnal'}</Text>
        <TouchableOpacity
          onPress={onFavorite}
          style={styles.iconBtn}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityState={{ selected: favorite }}
          accessibilityLabel={t(favorite ? 'hymns.removeFavorite' : 'hymns.addFavorite')}
          testID="hymn-favorite"
        >
          <Ionicons name={favorite ? 'heart' : 'heart-outline'} size={24} color={favorite ? '#FF4D6D' : colors.textPrimary} />
        </TouchableOpacity>
      </View>
      {note ? (
        <Animated.View style={[styles.note, { opacity: fade }]} pointerEvents="none">
          <Ionicons name={favorite ? 'heart' : 'heart-dislike-outline'} size={14} color="#fff" />
          <Text style={styles.noteText}>{note}</Text>
        </Animated.View>
      ) : null}

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Title block */}
        <Text style={styles.hymnNumber}>HYMN {hymn.number}</Text>
        <Text style={styles.hymnTitle}>{hymn.title}</Text>
        <View style={styles.titleRule} />

        {/* Verses, with the refrain repeated after each (as it's sung) */}
        {verses.map((verse, idx) => (
          <View key={`verse-${idx}`}>
            <View style={styles.verseBlock}>
              <Text style={styles.verseNumber}>{idx + 1}</Text>
              <View style={styles.verseTextWrap}>
                {verse.split('\n').map((line, i) => (
                  <Text key={i} style={styles.verseLine}>{line}</Text>
                ))}
              </View>
            </View>

            {hymn.refrain ? (
              <View style={styles.refrainBlock}>
                <View style={styles.refrainLabelRow}>
                  <Ionicons name="musical-notes" size={15} color={colors.accent} />
                  <Text style={styles.refrainLabel}>{t('hymns.refrain')}</Text>
                </View>
                {hymn.refrain.split('\n').map((line, i) => (
                  <Text key={i} style={styles.refrainLine}>{line}</Text>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  topBarTitle: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  note: {
    position: 'absolute', top: 64, alignSelf: 'center', zIndex: 5,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  noteText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  hymnNumber: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  hymnTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  titleRule: {
    width: 56, height: 3, borderRadius: 2,
    backgroundColor: colors.accent,
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },

  verseBlock: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  verseNumber: {
    ...typography.h3,
    color: colors.primary,
    fontWeight: '800',
    width: 28,
  },
  verseTextWrap: { flex: 1 },
  verseLine: {
    fontSize: 18,
    lineHeight: 30,
    color: colors.textPrimary,
  },

  refrainBlock: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    padding: spacing.md,
    marginBottom: spacing.lg,
    marginLeft: 28,
    ...shadows.sm,
  },
  refrainLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs,
  },
  refrainLabel: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    fontStyle: 'italic',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  refrainLine: {
    fontSize: 17,
    lineHeight: 28,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
});

export default HymnDetail;
