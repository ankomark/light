import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { saveReadingProgress } from '../services/api';
import { markdownTheme } from '../utils/publications';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const FONT_SIZES = [15, 17, 19, 22];

const ChapterReader = ({ route, navigation }) => {
  const { publication } = route.params;
  const chapters = publication?.chapters || [];
  const [index, setIndex] = useState(route.params?.index ?? 0);
  const [fontIdx, setFontIdx] = useState(1);
  const scrollRef = useRef(null);

  const chapter = chapters[index] || { title: '', body: '' };
  const canPrev = index > 0;
  const canNext = index < chapters.length - 1;

  // Persist reading position (fire-and-forget) whenever the chapter changes.
  useEffect(() => {
    if (publication?.id != null) {
      saveReadingProgress(publication.id, index).catch(() => {});
    }
  }, [publication?.id, index]);

  const go = (next) => {
    setIndex(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const cycleFont = () => setFontIdx((i) => (i + 1) % FONT_SIZES.length);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>{publication?.title}</Text>
        <TouchableOpacity onPress={cycleFont} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="text" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.chapterEyebrow}>
          Chapter {index + 1} of {chapters.length}
        </Text>
        <Text style={styles.chapterTitle}>{chapter.title || `Chapter ${index + 1}`}</Text>
        <View style={styles.rule} />

        <Markdown
          style={markdownTheme(FONT_SIZES[fontIdx])}
          onLinkPress={(url) => { Linking.openURL(url).catch(() => {}); return false; }}
        >
          {chapter.body || '_This chapter has no content yet._'}
        </Markdown>

        <View style={styles.nav}>
          <TouchableOpacity
            style={[styles.navBtn, !canPrev && styles.navBtnDisabled]}
            disabled={!canPrev}
            onPress={() => go(index - 1)}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-back" size={18} color={canPrev ? colors.white : colors.textMuted} />
            <Text style={[styles.navBtnText, !canPrev && styles.navBtnTextDisabled]}>Previous</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navBtn, !canNext && styles.navBtnDisabled]}
            disabled={!canNext}
            onPress={() => go(index + 1)}
            activeOpacity={0.85}
          >
            <Text style={[styles.navBtnText, !canNext && styles.navBtnTextDisabled]}>Next</Text>
            <Ionicons name="chevron-forward" size={18} color={canNext ? colors.white : colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.label, color: colors.textPrimary, flex: 1, textAlign: 'center', fontWeight: '600' },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },

  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  chapterEyebrow: { ...typography.caption, color: colors.primary, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  chapterTitle: { ...typography.h1, color: colors.textPrimary, marginTop: spacing.xs },
  rule: { width: 48, height: 3, borderRadius: 2, backgroundColor: colors.accent, marginTop: spacing.md, marginBottom: spacing.lg },

  nav: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.xl },
  navBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm + 2, ...shadows.sm,
  },
  navBtnDisabled: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  navBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  navBtnTextDisabled: { color: colors.textMuted },
});

export default ChapterReader;
