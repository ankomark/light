import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import Markdown from 'react-native-markdown-display';
import {
  fetchPublication, createPublication, updatePublication,
} from '../services/api';
import { CATEGORIES, markdownTheme } from '../utils/publications';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const blankChapter = () => ({ key: `${Date.now()}_${Math.random()}`, title: '', body: '', preview: false });

const PublicationEditor = ({ route, navigation }) => {
  const editId = route.params?.id || null;
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [cover, setCover] = useState('');
  const [category, setCategory] = useState('devotional');
  const [status, setStatus] = useState('draft');
  const [chapters, setChapters] = useState([blankChapter()]);

  // Load existing publication when editing.
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const p = await fetchPublication(editId);
        setTitle(p.title || '');
        setSummary(p.summary || '');
        setCover(p.cover || '');
        setCategory(p.category || 'other');
        setStatus(p.status || 'draft');
        setChapters(
          (p.chapters || []).length
            ? p.chapters.map((c, i) => ({ key: `e${c.id ?? i}`, title: c.title || '', body: c.body || '', preview: false }))
            : [blankChapter()]
        );
      } catch {
        Alert.alert('Error', 'Could not load this publication.');
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [editId, navigation]);

  const pickCover = async () => {
    try {
      const { status: perm } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm !== 'granted') {
        Alert.alert('Permission required', 'Please enable photo library access to add a cover.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.length) {
        const processed = await manipulateAsync(
          result.assets[0].uri,
          [{ resize: { width: 600 } }],
          { compress: 0.6, format: SaveFormat.JPEG, base64: true }
        );
        setCover(`data:image/jpeg;base64,${processed.base64}`);
      }
    } catch (err) {
      console.error('Cover picker error:', err);
      Alert.alert('Error', 'Failed to select image.');
    }
  };

  const updateChapter = useCallback((key, patch) => {
    setChapters((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }, []);

  const addChapter = () => setChapters((prev) => [...prev, blankChapter()]);

  const removeChapter = (key) => {
    if (chapters.length === 1) {
      Alert.alert('Keep one chapter', 'A publication needs at least one chapter.');
      return;
    }
    setChapters((prev) => prev.filter((c) => c.key !== key));
  };

  const moveChapter = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= chapters.length) return;
    setChapters((prev) => {
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const save = async (publish) => {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please give your publication a title.');
      return;
    }
    const cleaned = chapters
      .map((c, i) => ({ order: i + 1, title: c.title.trim(), body: c.body.trim() }))
      .filter((c) => c.title || c.body);
    if (cleaned.length === 0) {
      Alert.alert('Add content', 'Add at least one chapter with a title or text.');
      return;
    }
    const payload = {
      title: title.trim(),
      summary: summary.trim(),
      cover: cover || '',
      category,
      status: publish ? 'published' : 'draft',
      chapters: cleaned,
    };
    try {
      setSaving(true);
      const saved = editId
        ? await updatePublication(editId, payload)
        : await createPublication(payload);
      navigation.navigate('PublicationDetail', { id: saved.id });
    } catch (err) {
      const msg = err?.response?.data?.error || 'Could not save. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{editId ? 'Edit' : 'New publication'}</Text>
        <View style={styles.iconBtn} />
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        enableOnAndroid
        enableResetScrollToCoords={false}
        extraScrollHeight={Platform.OS === 'ios' ? 24 : 90}
        keyboardOpeningTime={0}
      >
        {/* Cover */}
        <View style={styles.coverRow}>
          <TouchableOpacity style={styles.coverPicker} onPress={pickCover} activeOpacity={0.85}>
            {cover ? (
              <Image source={{ uri: cover }} style={styles.coverImg} />
            ) : (
              <>
                <Ionicons name="image-outline" size={26} color={colors.textMuted} />
                <Text style={styles.coverHint}>Cover</Text>
              </>
            )}
          </TouchableOpacity>
          <View style={styles.coverSide}>
            <Text style={styles.label}>Cover image</Text>
            <Text style={styles.hint}>Optional. A portrait image looks best.</Text>
            {cover ? (
              <TouchableOpacity onPress={() => setCover('')}><Text style={styles.removeLink}>Remove</Text></TouchableOpacity>
            ) : null}
          </View>
        </View>

        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          placeholder="Publication title"
          placeholderTextColor={colors.placeholder}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.label}>Summary</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="A short description shown in the list"
          placeholderTextColor={colors.placeholder}
          value={summary}
          onChangeText={setSummary}
          multiline
        />

        <Text style={styles.label}>Category</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.catScroll}
          contentContainerStyle={styles.catRow}
          keyboardShouldPersistTaps="handled"
        >
          {CATEGORIES.map((c) => {
            const active = c.key === category;
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.catChip, active && styles.catChipActive]}
                onPress={() => setCategory(c.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.catChipText, active && styles.catChipTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Chapters */}
        <View style={styles.chaptersHeader}>
          <Text style={styles.sectionTitle}>Chapters</Text>
          <Text style={styles.hint}>Markdown supported (# heading, **bold**, lists…)</Text>
        </View>

        {chapters.map((ch, idx) => (
          <View key={ch.key} style={styles.chapterCard}>
            <View style={styles.chapterTop}>
              <Text style={styles.chapterNum}>Chapter {idx + 1}</Text>
              <View style={styles.chapterTools}>
                <TouchableOpacity onPress={() => moveChapter(idx, -1)} disabled={idx === 0} hitSlop={6} style={styles.toolBtn}>
                  <Ionicons name="arrow-up" size={17} color={idx === 0 ? colors.textMuted : colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => moveChapter(idx, 1)} disabled={idx === chapters.length - 1} hitSlop={6} style={styles.toolBtn}>
                  <Ionicons name="arrow-down" size={17} color={idx === chapters.length - 1 ? colors.textMuted : colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => updateChapter(ch.key, { preview: !ch.preview })} hitSlop={6} style={styles.toolBtn}>
                  <Ionicons name={ch.preview ? 'create-outline' : 'eye-outline'} size={18} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeChapter(ch.key)} hitSlop={6} style={styles.toolBtn}>
                  <MaterialIcons name="delete-outline" size={19} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>

            <TextInput
              style={styles.chapterTitleInput}
              placeholder="Chapter title"
              placeholderTextColor={colors.placeholder}
              value={ch.title}
              onChangeText={(t) => updateChapter(ch.key, { title: t })}
            />

            {ch.preview ? (
              <View style={styles.previewBox}>
                <Markdown style={markdownTheme(16)}>{ch.body || '_Nothing to preview yet._'}</Markdown>
              </View>
            ) : (
              <TextInput
                style={styles.bodyInput}
                placeholder="Write your chapter here… Markdown is supported."
                placeholderTextColor={colors.placeholder}
                value={ch.body}
                onChangeText={(t) => updateChapter(ch.key, { body: t })}
                multiline
                textAlignVertical="top"
              />
            )}
          </View>
        ))}

        <TouchableOpacity style={styles.addChapterBtn} onPress={addChapter} activeOpacity={0.85}>
          <Ionicons name="add" size={20} color={colors.primary} />
          <Text style={styles.addChapterText}>Add chapter</Text>
        </TouchableOpacity>

        <View style={{ height: spacing.xxl }} />
      </KeyboardAwareScrollView>

      {/* Save bar */}
      <View style={styles.saveBar}>
        <TouchableOpacity
          style={[styles.saveBtn, styles.draftBtn]}
          onPress={() => save(false)}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.draftBtnText}>Save Draft</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, styles.publishBtn]}
          onPress={() => save(true)}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.publishBtnText}>Publish</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },

  content: { padding: spacing.md },
  label: { ...typography.label, color: colors.textSecondary, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.sm },
  hint: { ...typography.caption, color: colors.textMuted },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 15,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },

  coverRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  coverPicker: {
    width: 96, height: 128, borderRadius: radius.md, backgroundColor: colors.inputBg,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', gap: 4,
  },
  coverImg: { width: '100%', height: '100%' },
  coverHint: { ...typography.caption, color: colors.textMuted },
  coverSide: { flex: 1 },
  removeLink: { ...typography.caption, color: colors.error, fontWeight: '700', marginTop: spacing.xs },

  catScroll: { flexGrow: 0, marginHorizontal: -spacing.md },
  catRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
  catChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  catChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  catChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  catChipTextActive: { color: colors.white },

  chaptersHeader: { marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },

  chapterCard: {
    backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm + 2, marginBottom: spacing.sm,
  },
  chapterTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  chapterNum: { ...typography.label, color: colors.primary, fontWeight: '800' },
  chapterTools: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  toolBtn: { padding: 4 },
  chapterTitleInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 15, fontWeight: '600', marginBottom: spacing.sm,
  },
  bodyInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 15,
    minHeight: 140, lineHeight: 22,
  },
  previewBox: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    backgroundColor: colors.bg, paddingHorizontal: spacing.sm, paddingTop: spacing.xs, minHeight: 140,
  },

  addChapterBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed', borderRadius: radius.md,
    paddingVertical: spacing.sm + 2, marginTop: spacing.xs,
  },
  addChapterText: { ...typography.label, color: colors.primary, fontWeight: '700' },

  saveBar: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  saveBtn: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.md, alignItems: 'center' },
  draftBtn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  draftBtnText: { ...typography.button, color: colors.textPrimary },
  publishBtn: { backgroundColor: colors.primary },
  publishBtnText: { ...typography.button, color: colors.white },
});

export default PublicationEditor;
