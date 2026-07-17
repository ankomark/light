import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import Markdown from 'react-native-markdown-display';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchPublication, createPublication, updatePublication,
} from '../services/api';
import {
  CATEGORIES, markdownTheme, markdownImageRule, WRITING_BGS, WRITING_TEXT_COLORS, WRITING_FONTS,
  DEFAULT_WRITING_THEME, fontFamilyFor, extractInlineImages, appendInlineImage, expandInlineImages,
} from '../utils/publications';
import { uploadMedia } from '../services/cloudinary';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';

const blankChapter = () => ({ key: `${Date.now()}_${Math.random()}`, title: '', body: '', images: {}, preview: false });

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
  const [theme, setTheme] = useState(DEFAULT_WRITING_THEME); // reading look (bg/text/font/scale)
  const [showDesign, setShowDesign] = useState(false);

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
        setTheme({ ...DEFAULT_WRITING_THEME, ...(p.theme || {}) });
        setChapters(
          (p.chapters || []).length
            ? p.chapters.map((c, i) => {
                // Pull stored data-URI images out of the editable text into tokens.
                const { body, images } = extractInlineImages(c.body || '');
                return { key: `e${c.id ?? i}`, title: c.title || '', body, images, preview: false };
              })
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

  // ── Local autosave / crash recovery ──────────────────────────────────────
  const draftKey = `pubdraft:${editId || 'new'}`;

  // Offer to restore a previous unsaved draft for a brand-new publication.
  useEffect(() => {
    if (editId) return; // edits load from the server
    AsyncStorage.getItem(draftKey).then((raw) => {
      if (!raw) return;
      let d;
      try { d = JSON.parse(raw); } catch { return; }
      const hasContent = d?.title?.trim() || (d?.chapters || []).some((c) => c.title || c.body);
      if (!hasContent) return;
      Alert.alert('Unsaved draft', 'Restore your last unsaved draft?', [
        { text: 'Discard', style: 'destructive', onPress: () => AsyncStorage.removeItem(draftKey).catch(() => {}) },
        { text: 'Restore', onPress: () => {
          setTitle(d.title || '');
          setSummary(d.summary || '');
          setCategory(d.category || 'devotional');
          setTheme({ ...DEFAULT_WRITING_THEME, ...(d.theme || {}) });
          setChapters((d.chapters || []).length
            ? d.chapters.map((c, i) => ({ key: `r${i}`, title: c.title || '', body: c.body || '', images: {}, preview: false }))
            : [blankChapter()]);
        } },
      ]);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced text-only autosave (no base64 — keeps the snapshot small so the
  // typed work survives a crash; images are re-added on restore).
  useEffect(() => {
    if (loading) return undefined;
    const t = setTimeout(() => {
      const snapshot = {
        title, summary, category, theme,
        chapters: chapters.map((c) => ({
          title: c.title,
          body: (c.body || '').replace(/!\[[^\]]*\]\(img:\/\/[^)\s]+\)/g, '').trim(),
        })),
        at: Date.now(),
      };
      AsyncStorage.setItem(draftKey, JSON.stringify(snapshot)).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [title, summary, category, theme, chapters, loading]); // eslint-disable-line react-hooks/exhaustive-deps

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
          { compress: 0.6, format: SaveFormat.JPEG }
        );
        const uploaded = await uploadMedia(
          { uri: processed.uri, name: `cover_${Date.now()}.jpg`, mimeType: 'image/jpeg' },
          'cover',
        );
        setCover(uploaded.url);
      }
    } catch (err) {
      console.error('Cover picker error:', err);
      Alert.alert('Error', 'Failed to upload image.');
    }
  };

  const updateChapter = useCallback((key, patch) => {
    setChapters((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }, []);

  // Track each chapter's cursor/selection so the toolbar inserts at the caret.
  const selRef = useRef({});
  const [pendingSel, setPendingSel] = useState(null); // {key,start,end} applied once
  const onBodySelect = (key, e) => {
    selRef.current[key] = e.nativeEvent.selection;
    setPendingSel((p) => (p && p.key === key ? null : p)); // release control after it lands
  };

  // Insert markdown for the tapped format. It wraps the SELECTED text (real
  // formatting) and moves the caret — it never injects placeholder words, so
  // nothing like "bold text" can end up in the published reading.
  const applyFormat = (key, kind) => {
    const c = chapters.find((x) => x.key === key);
    if (!c) return;
    const body = c.body || '';
    const sel = selRef.current[key] || { start: body.length, end: body.length };
    const start = Math.min(sel.start, sel.end);
    const end = Math.max(sel.start, sel.end);
    const picked = body.slice(start, end);
    let before = body.slice(0, start);
    let after = body.slice(end);
    let insert = '';
    let caret = null; // [start, end] in the new body

    const wrap = (mk) => {
      insert = `${mk}${picked}${mk}`;
      const base = before.length;
      // selection → cursor after the wrap; no selection → cursor between markers.
      caret = picked ? [base + insert.length, base + insert.length] : [base + mk.length, base + mk.length];
    };
    const prefixLine = (pfx) => {
      const lineStart = before.lastIndexOf('\n') + 1;
      before = body.slice(0, lineStart);
      insert = `${pfx}${body.slice(lineStart, end)}`;
      after = body.slice(end);
      const pos = before.length + insert.length;
      caret = [pos, pos];
    };

    switch (kind) {
      case 'bold': wrap('**'); break;
      case 'italic': wrap('*'); break; // '*' renders intraword; '_' does not
      case 'h1': prefixLine('# '); break;
      case 'h2': prefixLine('## '); break;
      case 'quote': prefixLine('> '); break;
      case 'list': prefixLine('- '); break;
      case 'numbered': prefixLine('1. '); break;
      case 'link': {
        const text = picked || 'link';
        insert = `[${text}](url)`;
        const base = before.length;
        // Highlight the part the author should replace next (text or the url).
        caret = picked ? [base + text.length + 3, base + text.length + 6] : [base + 1, base + 1 + text.length];
        break;
      }
      case 'divider': before = body.slice(0, end); after = body.slice(end); insert = '\n\n---\n\n'; { const pos = before.length + insert.length; caret = [pos, pos]; } break;
      default: return;
    }

    updateChapter(key, { body: `${before}${insert}${after}` });
    if (caret) {
      selRef.current[key] = { start: caret[0], end: caret[1] };
      setPendingSel({ key, start: caret[0], end: caret[1] });
    }
  };

  const FORMAT_TOOLS = [
    { kind: 'h1', icon: 'format-header-1', set: 'mci' },
    { kind: 'h2', icon: 'format-header-2', set: 'mci' },
    { kind: 'bold', icon: 'format-bold', set: 'mci' },
    { kind: 'italic', icon: 'format-italic', set: 'mci' },
    { kind: 'quote', icon: 'format-quote-close', set: 'mci' },
    { kind: 'list', icon: 'format-list-bulleted', set: 'mci' },
    { kind: 'numbered', icon: 'format-list-numbered', set: 'mci' },
    { kind: 'link', icon: 'link-variant', set: 'mci' },
    { kind: 'divider', icon: 'minus', set: 'mci' },
  ];

  // Pick + crop an image and drop it into the chapter as a markdown image, so it
  // renders inline both in the live preview and in the reader.
  const insertImage = async (key) => {
    try {
      const { status: perm } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm !== 'granted') { Alert.alert('Permission required', 'Enable photo access to add images.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true, // gives the crop UI
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;
      const processed = await manipulateAsync(
        result.assets[0].uri, [{ resize: { width: 1000 } }],
        { compress: 0.6, format: SaveFormat.JPEG, base64: true }
      );
      const dataUri = `data:image/jpeg;base64,${processed.base64}`;
      // Insert only a short token into the text; keep the heavy data URI in the
      // side map so the TextInput never holds the giant base64 string.
      setChapters((prev) => prev.map((c) => {
        if (c.key !== key) return c;
        const next = appendInlineImage(c.body || '', c.images || {}, dataUri);
        return { ...c, body: next.body, images: next.images, preview: false };
      }));
    } catch {
      Alert.alert('Error', 'Could not add the image.');
    }
  };

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
      // Expand image tokens back to real data URIs for storage / the reader.
      .map((c, i) => ({ order: i + 1, title: c.title.trim(), body: expandInlineImages(c.body, c.images).trim() }))
      .filter((c) => c.title || c.body);
    if (cleaned.length === 0) {
      Alert.alert('Add content', 'Add at least one chapter with a title or text.');
      return;
    }
    const payload = {
      title: title.trim(),
      summary: summary.trim(),
      cover: cover || '',
      theme,
      category,
      status: publish ? 'published' : 'draft',
      chapters: cleaned,
    };
    try {
      setSaving(true);
      const saved = editId
        ? await updatePublication(editId, payload)
        : await createPublication(payload);
      AsyncStorage.removeItem(draftKey).catch(() => {}); // work is safely on the server now
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

        {/* Reading design: background, font, text colour */}
        <TouchableOpacity style={styles.designToggle} onPress={() => setShowDesign((s) => !s)} activeOpacity={0.85}>
          <MaterialIcons name="palette" size={18} color={colors.accent} />
          <Text style={styles.designToggleText}>Reading design</Text>
          <View style={[styles.designPeek, { backgroundColor: theme.bg }]}>
            <Text style={[styles.designPeekText, { color: theme.text, fontFamily: fontFamilyFor(theme.font) }]}>Aa</Text>
          </View>
          <Ionicons name={showDesign ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        {showDesign && (
          <View style={styles.designPanel}>
            <View style={[styles.designPreview, { backgroundColor: theme.bg }]}>
              <Text style={[styles.designPreviewText, { color: theme.text, fontFamily: fontFamilyFor(theme.font), fontSize: 17 + theme.scale }]}>
                The heavens declare the glory of God.
              </Text>
            </View>

            <Text style={styles.designLabel}>Background</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.swatchRow}>
              {WRITING_BGS.map((b) => (
                <TouchableOpacity
                  key={b.key}
                  onPress={() => setTheme((t) => ({ ...t, bg: b.bg, text: b.text }))}
                  style={[styles.bgSwatch, { backgroundColor: b.bg }, theme.bg === b.bg && styles.swatchActive]}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.bgSwatchText, { color: b.text }]}>Aa</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.designLabel}>Text colour</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.swatchRow}>
              {WRITING_TEXT_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setTheme((t) => ({ ...t, text: c }))}
                  style={[styles.colorDot, { backgroundColor: c }, theme.text === c && styles.colorDotActive]}
                  activeOpacity={0.85}
                />
              ))}
            </ScrollView>

            <Text style={styles.designLabel}>Font</Text>
            <View style={styles.fontRow}>
              {WRITING_FONTS.map((f) => {
                const active = theme.font === f.key;
                return (
                  <TouchableOpacity key={f.key} onPress={() => setTheme((t) => ({ ...t, font: f.key }))} style={[styles.fontChip, active && styles.fontChipActive]} activeOpacity={0.85}>
                    <Text style={[styles.fontChipText, { fontFamily: f.family }, active && styles.fontChipTextActive]}>{f.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.designLabel}>Reading size</Text>
            <View style={styles.sizeRow}>
              <TouchableOpacity style={styles.sizeBtn} onPress={() => setTheme((t) => ({ ...t, scale: Math.max(-2, t.scale - 1) }))}><Text style={styles.sizeBtnText}>A−</Text></TouchableOpacity>
              <Text style={styles.sizeValue}>{theme.scale > 0 ? `+${theme.scale}` : theme.scale}</Text>
              <TouchableOpacity style={styles.sizeBtn} onPress={() => setTheme((t) => ({ ...t, scale: Math.min(4, t.scale + 1) }))}><Text style={styles.sizeBtnText}>A+</Text></TouchableOpacity>
            </View>
          </View>
        )}

        {/* Chapters */}
        <View style={styles.chaptersHeader}>
          <Text style={styles.sectionTitle}>Chapters</Text>
          <Text style={styles.hint}>Markdown supported · tap the image icon to add a photo</Text>
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
                <TouchableOpacity onPress={() => insertImage(ch.key)} hitSlop={6} style={styles.toolBtn}>
                  <Ionicons name="image-outline" size={18} color={colors.accent} />
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
              <View style={[styles.previewBox, { backgroundColor: theme.bg }]}>
                <Markdown
                  style={markdownTheme(16 + theme.scale, { color: theme.text, fontFamily: fontFamilyFor(theme.font) })}
                  rules={markdownImageRule}
                >
                  {expandInlineImages(ch.body, ch.images) || '_Nothing to preview yet._'}
                </Markdown>
              </View>
            ) : (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="always"
                  style={styles.toolbar}
                  contentContainerStyle={styles.toolbarRow}
                >
                  {FORMAT_TOOLS.map((tool) => (
                    <TouchableOpacity key={tool.kind} style={styles.toolBtnFmt} onPress={() => applyFormat(ch.key, tool.kind)} activeOpacity={0.7}>
                      <MaterialCommunityIcons name={tool.icon} size={18} color={colors.textPrimary} />
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={styles.toolBtnFmt} onPress={() => insertImage(ch.key)} activeOpacity={0.7}>
                    <MaterialCommunityIcons name="image-plus" size={18} color={colors.accent} />
                  </TouchableOpacity>
                </ScrollView>
                <TextInput
                  style={[styles.bodyInput, { backgroundColor: theme.bg, color: theme.text, fontFamily: fontFamilyFor(theme.font) }]}
                  placeholder="Write your chapter here… select text, then tap a format."
                  placeholderTextColor={`${theme.text}80`}
                  value={ch.body}
                  onChangeText={(t) => updateChapter(ch.key, { body: t })}
                  onSelectionChange={(e) => onBodySelect(ch.key, e)}
                  selection={pendingSel?.key === ch.key ? { start: pendingSel.start, end: pendingSel.end } : undefined}
                  multiline
                  textAlignVertical="top"
                />
              </>
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

  // Reading design panel
  designToggle: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.lg, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: 'rgba(244,162,97,0.4)',
  },
  designToggleText: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  designPeek: { marginLeft: 'auto', width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  designPeekText: { fontSize: 13, fontWeight: '700' },
  designPanel: {
    marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: spacing.xs,
  },
  designPreview: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.sm, ...shadows.sm },
  designPreviewText: { lineHeight: 24 },
  designLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.sm },
  swatchRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs, alignItems: 'center' },
  bgSwatch: { width: 46, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  bgSwatchText: { fontSize: 13, fontWeight: '700' },
  swatchActive: { borderColor: colors.accent, borderWidth: 2 },
  colorDot: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.4)' },
  colorDotActive: { borderColor: colors.accent, borderWidth: 3 },
  fontRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  fontChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  fontChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  fontChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  fontChipTextActive: { color: colors.white },
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  sizeBtn: { width: 44, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sizeBtnText: { ...typography.label, color: colors.textPrimary, fontWeight: '800' },
  sizeValue: { ...typography.label, color: colors.textSecondary, minWidth: 28, textAlign: 'center' },

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
  toolbar: { flexGrow: 0, marginBottom: spacing.xs },
  toolbarRow: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 2 },
  toolBtnFmt: {
    width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
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
