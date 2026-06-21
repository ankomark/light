import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import AsyncStorage from '@react-native-async-storage/async-storage';

// expo-speech is a native module; on a dev client that hasn't been rebuilt since
// it was added it isn't present. Load it defensively so the reader still works
// (the Listen button just hides) instead of crashing on "native module" errors.
let Speech = null;
try { Speech = require('expo-speech'); } catch { Speech = null; }
const SPEECH_OK = !!(Speech && typeof Speech.speak === 'function');
import { saveReadingProgress } from '../services/api';
import { markdownTheme, markdownImageRule, resolveWritingTheme, fontFamilyFor, isLightBg } from '../utils/publications';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const FONT_SIZES = [15, 17, 19, 22];

// Strip markdown/images down to plain prose for text-to-speech.
const toSpeech = (md = '') => md
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')       // images
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')      // links → text
  .replace(/[#>*_`~-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const ChapterReader = ({ route, navigation }) => {
  const { publication } = route.params;
  const chapters = publication?.chapters || [];
  const [index, setIndex] = useState(route.params?.index ?? 0);
  const [fontIdx, setFontIdx] = useState(1);
  const [tocOpen, setTocOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [progress, setProgress] = useState(0); // scroll fraction of the chapter
  const scrollRef = useRef(null);
  const restoredRef = useRef(false);

  // Author's reading look (background / text colour / font / size nudge).
  const wt = resolveWritingTheme(publication?.theme);
  const wtFont = fontFamilyFor(wt.font);
  const light = isLightBg(wt.bg);
  const chrome = light ? '#1A1A1A' : colors.textPrimary;       // top-bar icons/title
  const subtleBorder = light ? 'rgba(0,0,0,0.12)' : colors.border;

  const chapter = chapters[index] || { title: '', body: '' };
  const canPrev = index > 0;
  const canNext = index < chapters.length - 1;
  const scrollKey = (i) => `read:${publication?.id}:${i}`;

  // Persist reading position (fire-and-forget) whenever the chapter changes.
  useEffect(() => {
    if (publication?.id != null) {
      saveReadingProgress(publication.id, index).catch(() => {});
    }
  }, [publication?.id, index]);

  // Restore the saved scroll offset for the current chapter (once per chapter).
  useEffect(() => {
    restoredRef.current = false;
    setProgress(0);
    AsyncStorage.getItem(scrollKey(index)).then((y) => {
      const val = parseFloat(y);
      if (val > 0) setTimeout(() => scrollRef.current?.scrollTo({ y: val, animated: false }), 60);
    }).catch(() => {});
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop narration when leaving the screen or changing chapter.
  useEffect(() => () => { if (SPEECH_OK) Speech.stop(); }, []);
  useEffect(() => { if (SPEECH_OK) Speech.stop(); setSpeaking(false); }, [index]);

  const onScroll = useCallback((e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const max = Math.max(1, contentSize.height - layoutMeasurement.height);
    setProgress(Math.min(1, Math.max(0, contentOffset.y / max)));
    if (restoredRef.current) AsyncStorage.setItem(scrollKey(index), String(contentOffset.y)).catch(() => {});
    restoredRef.current = true;
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next) => {
    setTocOpen(false);
    setIndex(next);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const toggleListen = () => {
    if (!SPEECH_OK) return;
    if (speaking) { Speech.stop(); setSpeaking(false); return; }
    const text = toSpeech(chapter.body);
    if (!text) return;
    setSpeaking(true);
    Speech.speak(text, { rate: 0.96, onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false), onError: () => setSpeaking(false) });
  };

  const cycleFont = () => setFontIdx((i) => (i + 1) % FONT_SIZES.length);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: wt.bg }]} edges={['top']}>
      <View style={[styles.topBar, { borderBottomColor: subtleBorder }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={chrome} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: chrome }]} numberOfLines={1}>{publication?.title}</Text>
        {SPEECH_OK && (
          <TouchableOpacity onPress={toggleListen} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name={speaking ? 'stop-circle' : 'volume-high-outline'} size={21} color={speaking ? colors.accent : chrome} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={cycleFont} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="text" size={20} color={chrome} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTocOpen(true)} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="list" size={22} color={chrome} />
        </TouchableOpacity>
      </View>

      {/* Reading progress bar */}
      <View style={[styles.progressTrack, { backgroundColor: subtleBorder }]}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={64}
        onScroll={onScroll}
      >
        <Text style={styles.chapterEyebrow}>
          Chapter {index + 1} of {chapters.length}
        </Text>
        <Text style={[styles.chapterTitle, { color: wt.text, fontFamily: wtFont }]}>{chapter.title || `Chapter ${index + 1}`}</Text>
        <View style={styles.rule} />

        <Markdown
          style={markdownTheme(FONT_SIZES[fontIdx] + wt.scale, { color: wt.text, fontFamily: wtFont })}
          rules={markdownImageRule}
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

      {/* Table of contents */}
      <Modal visible={tocOpen} transparent animationType="fade" onRequestClose={() => setTocOpen(false)}>
        <Pressable style={styles.tocBackdrop} onPress={() => setTocOpen(false)}>
          <Pressable style={styles.tocCard}>
            <Text style={styles.tocTitle}>Contents</Text>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {chapters.map((c, i) => {
                const active = i === index;
                return (
                  <TouchableOpacity key={i} style={[styles.tocRow, active && styles.tocRowActive]} onPress={() => go(i)} activeOpacity={0.8}>
                    <Text style={[styles.tocNum, active && styles.tocActiveText]}>{i + 1}</Text>
                    <Text style={[styles.tocLabel, active && styles.tocActiveText]} numberOfLines={1}>{c.title || `Chapter ${i + 1}`}</Text>
                    {active && <Ionicons name="bookmark" size={14} color={colors.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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
  iconBtn: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center' },

  progressTrack: { height: 2.5, width: '100%' },
  progressFill: { height: '100%', backgroundColor: colors.accent },

  tocBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  tocCard: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md, ...shadows.lg },
  tocTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm, letterSpacing: 0.4 },
  tocRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  tocRowActive: { backgroundColor: colors.card },
  tocNum: { ...typography.label, color: colors.textMuted, fontWeight: '800', width: 22, textAlign: 'center' },
  tocLabel: { ...typography.body, color: colors.textSecondary, flex: 1 },
  tocActiveText: { color: colors.textPrimary, fontWeight: '700' },

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
