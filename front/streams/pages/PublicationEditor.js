import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../services/imageProcessing';
import Markdown from 'react-native-markdown-display';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchPublication, createPublication, updatePublication,
} from '../services/api';
import { forgetBook, notePublicationsChanged } from '../services/publicationStore';
import {
  CATEGORIES, categoryLabel, markdownTheme, markdownImageRule, WRITING_BGS, WRITING_TEXT_COLORS, WRITING_FONTS,
  DEFAULT_WRITING_THEME, fontFamilyFor, extractInlineImages, expandInlineImages,
} from '../utils/publications';
import { uploadMedia } from '../services/cloudinary';
import { confirmAction, notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import { useAuth } from '../context/useAuth';

// `id` is the saved chapter's (none until first saved): sent back so the save
// updates it in place — its history and readers' places kept.
const blankChapter = (extra = {}) => ({
  key: `${Date.now()}_${Math.random()}`, id: null, title: '', body: '', images: {}, preview: false,
  status: 'published', isRemoved: false, ...extra,
});

// A picture goes into the chapter as a plain markdown image of its R2 address:
// a few dozen characters instead of hundreds of KB of base64 in the chapter —
// which the reader used to download for every chapter, pictures and all.
// (Older chapters' base64 pictures still work: they're kept as short tokens
// while editing, as before.)
const addImageMarkdown = (body, url) =>
  `${body}${body && !body.endsWith('\n') ? '\n\n' : ''}![image](${url})\n\n`;

// Legacy base64 tokens aren't worth keeping in the crash-recovery snapshot.
const stripTokens = (body) => (body || '').replace(/!\[[^\]]*\]\(img:\/\/[^)\s]+\)/g, '').trim();

const FORMAT_TOOLS = [
  { kind: 'h1', icon: 'format-header-1' },
  { kind: 'h2', icon: 'format-header-2' },
  { kind: 'bold', icon: 'format-bold' },
  { kind: 'italic', icon: 'format-italic' },
  { kind: 'quote', icon: 'format-quote-close' },
  { kind: 'list', icon: 'format-list-bulleted' },
  { kind: 'numbered', icon: 'format-list-numbered' },
  { kind: 'link', icon: 'link-variant' },
  { kind: 'divider', icon: 'minus' },
];

/** The markdown for a format tapped on `body` with `sel` selected →
 *  { body, caret: [start, end] }. It wraps the SELECTED text (real formatting)
 *  and moves the caret — it never injects placeholder words, so nothing like
 *  "bold text" can end up in the published reading. */
export const formatBody = (body = '', sel, kind) => {
  const s = sel || { start: body.length, end: body.length };
  const start = Math.min(s.start, s.end);
  const end = Math.max(s.start, s.end);
  const picked = body.slice(start, end);
  let before = body.slice(0, start);
  let after = body.slice(end);
  let insert = '';
  let caret = null;

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
    case 'divider': {
      before = body.slice(0, end); after = body.slice(end); insert = '\n\n---\n\n';
      const pos = before.length + insert.length;
      caret = [pos, pos];
      break;
    }
    default: return null;
  }
  return { body: `${before}${insert}${after}`, caret };
};

// One chapter's card. Memoised: typing in one chapter no longer redraws every
// other chapter (and their markdown previews) on each keystroke.
const ChapterCard = memo(({
  ch, idx, count, theme, selection, uploading, t,
  onChange, onFormat, onSelect, onImage, onMove, onRemove, onHistory,
}) => (
  <View style={[styles.chapterCard, ch.status === 'draft' && styles.chapterCardDraft]}>
    <View style={styles.chapterTop}>
      <Text style={styles.chapterNum}>{t('pubDetail.chapterN', { n: idx + 1 })}</Text>
      <View style={styles.chapterTools}>
        {/* Draft: kept from readers while the rest of the book is out. */}
        <TouchableOpacity
          onPress={() => onChange(ch.key, { status: ch.status === 'draft' ? 'published' : 'draft' })}
          style={[styles.draftChip, ch.status === 'draft' && styles.draftChipOn]}
          accessibilityRole="switch"
          accessibilityState={{ checked: ch.status === 'draft' }}
          accessibilityLabel={t('pub.toggleDraft')}
          testID={`editor-draft-${idx}`}
        >
          <Ionicons name={ch.status === 'draft' ? 'eye-off' : 'eye-off-outline'} size={13}
            color={ch.status === 'draft' ? colors.warning : colors.textMuted} />
          <Text style={[styles.draftChipText, ch.status === 'draft' && styles.draftChipTextOn]}>{t('pubDetail.draft')}</Text>
        </TouchableOpacity>
        {ch.id ? (
          <TouchableOpacity onPress={() => onHistory(ch)} hitSlop={6} style={styles.toolBtn}
            accessibilityRole="button" accessibilityLabel={t('pub.history')} testID={`editor-history-${idx}`}>
            <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => onMove(idx, -1)} disabled={idx === 0} hitSlop={6} style={styles.toolBtn}>
          <Ionicons name="arrow-up" size={17} color={idx === 0 ? colors.textMuted : colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onMove(idx, 1)} disabled={idx === count - 1} hitSlop={6} style={styles.toolBtn}>
          <Ionicons name="arrow-down" size={17} color={idx === count - 1 ? colors.textMuted : colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onImage(ch.key)} hitSlop={6} style={styles.toolBtn} disabled={uploading}>
          {uploading ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="image-outline" size={18} color={colors.accent} />}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onChange(ch.key, { preview: !ch.preview })} hitSlop={6} style={styles.toolBtn}>
          <Ionicons name={ch.preview ? 'create-outline' : 'eye-outline'} size={18} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onRemove(ch.key)} hitSlop={6} style={styles.toolBtn}>
          <MaterialIcons name="delete-outline" size={19} color={colors.error} />
        </TouchableOpacity>
      </View>
    </View>

    {ch.isRemoved ? (
      <View style={styles.removedBanner}>
        <Ionicons name="alert-circle" size={15} color={colors.error} />
        <Text style={styles.removedText}>{t('pub.removedByModerator')}</Text>
      </View>
    ) : ch.status === 'draft' ? (
      <Text style={styles.draftNote}>{t('pub.chapterDraft')}</Text>
    ) : null}

    <TextInput
      style={styles.chapterTitleInput}
      placeholder={t('pub.chapterTitlePlaceholder')}
      placeholderTextColor={colors.placeholder}
      value={ch.title}
      onChangeText={(v) => onChange(ch.key, { title: v })}
    />

    {ch.preview ? (
      <View style={[styles.previewBox, { backgroundColor: theme.bg }]}>
        <Markdown
          style={markdownTheme(16 + theme.scale, { color: theme.text, fontFamily: fontFamilyFor(theme.font) })}
          rules={markdownImageRule}
        >
          {expandInlineImages(ch.body, ch.images) || `_${t('pub.previewEmpty')}_`}
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
            <TouchableOpacity key={tool.kind} style={styles.toolBtnFmt} onPress={() => onFormat(ch.key, tool.kind)} activeOpacity={0.7}>
              <MaterialCommunityIcons name={tool.icon} size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.toolBtnFmt} onPress={() => onImage(ch.key)} activeOpacity={0.7} disabled={uploading}
            testID={`editor-image-${idx}`}>
            <MaterialCommunityIcons name="image-plus" size={18} color={colors.accent} />
          </TouchableOpacity>
        </ScrollView>
        {uploading ? <Text style={styles.uploadingText}>{t('pub.uploading')}</Text> : null}
        <TextInput
          style={[styles.bodyInput, { backgroundColor: theme.bg, color: theme.text, fontFamily: fontFamilyFor(theme.font) }]}
          placeholder={t('pub.chapterBodyPlaceholder')}
          placeholderTextColor={`${theme.text}80`}
          value={ch.body}
          onChangeText={(v) => onChange(ch.key, { body: v })}
          onSelectionChange={(e) => onSelect(ch.key, e)}
          selection={selection || undefined}
          multiline
          textAlignVertical="top"
        />
      </>
    )}
  </View>
));

const PublicationEditor = ({ route, navigation }) => {
  const { t } = useI18n();
  const { isAuthenticated, currentUser } = useAuth();
  const editId = route.params?.id || null;
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [cover, setCover] = useState('');
  const [coverUploading, setCoverUploading] = useState(false);
  const [category, setCategory] = useState('devotional');
  const [status, setStatus] = useState('draft');
  const [chapters, setChapters] = useState([blankChapter()]);
  const [theme, setTheme] = useState(DEFAULT_WRITING_THEME); // reading look (bg/text/font/scale)
  const [showDesign, setShowDesign] = useState(false);
  const [uploadingKeys, setUploadingKeys] = useState({});   // chapter key → pictures on their way
  const serverUpdatedAt = useRef(null);

  // ── Unsaved changes ────────────────────────────────────────────────────────
  // Anything changed after the form is filled (from the server or a restore)
  // makes leaving ask first — the close button, a swipe, the phone's back.
  const dirty = useRef(false);
  const settled = useRef(false);
  const leaving = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!settled.current) { settled.current = true; return; }
    dirty.current = true;
  }, [title, summary, cover, category, theme, chapters, loading]);

  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (!dirty.current || leaving.current) return;
    e.preventDefault();
    confirmAction({
      title: t('pub.leaveTitle'), message: t('pub.leaveBody'),
      confirmLabel: t('pub.discard'), cancelLabel: t('pub.keepEditing'), destructive: true,
    }).then((ok) => {
      if (!ok) return;
      leaving.current = true;
      AsyncStorage.removeItem(draftKey).catch(() => {});
      navigation.dispatch(e.data.action);
    });
  }), [navigation, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const fill = useCallback((d, { fromServer = false } = {}) => {
    setTitle(d.title || '');
    setSummary(d.summary || '');
    if (fromServer || d.cover) setCover(d.cover || '');
    setCategory(d.category || (fromServer ? 'other' : 'devotional'));
    if (d.status) setStatus(d.status);
    setTheme({ ...DEFAULT_WRITING_THEME, ...(d.theme || {}) });
    setChapters(
      (d.chapters || []).length
        ? d.chapters.map((c, i) => {
            // Stored data-URI images out of the editable text into short tokens.
            const { body, images } = extractInlineImages(c.body || '');
            return blankChapter({
              key: `${fromServer ? 'e' : 'r'}${c.id ?? i}`, id: c.id ?? null, title: c.title || '', body, images,
              status: c.status === 'draft' ? 'draft' : 'published', isRemoved: !!(c.is_removed ?? c.isRemoved),
            });
          })
        : [blankChapter()],
    );
  }, []);

  // ── Local autosave / crash recovery ──────────────────────────────────────
  const draftKey = `pubdraft:${editId || 'new'}`;

  // A snapshot left by a crash (or a closed app) — offered back once. For an
  // edit, only when it's newer than what the server has.
  const offerRestore = useCallback(async (serverAt) => {
    let d;
    try { d = JSON.parse(await AsyncStorage.getItem(draftKey)); } catch { return; }
    const hasContent = d?.title?.trim() || (d?.chapters || []).some((c) => c.title || c.body);
    if (!hasContent) return;
    if (serverAt && !(d.at > Date.parse(serverAt))) return;
    const ok = await confirmAction({
      title: t('pub.unsavedTitle'), message: t('pub.unsavedBody'),
      confirmLabel: t('pub.restore'), cancelLabel: t('pub.discard'),
    });
    // Restored work is unsaved work: leaving still asks.
    if (ok) { fill(d); dirty.current = true; } else AsyncStorage.removeItem(draftKey).catch(() => {});
  }, [draftKey, fill, t]);

  // Load the publication when editing (bodies included — it's the editor).
  useEffect(() => {
    if (!editId) { offerRestore(null); return; }
    (async () => {
      try {
        const p = await fetchPublication(editId);
        serverUpdatedAt.current = p.updated_at;
        fill(p, { fromServer: true });
        setLoading(false);
        offerRestore(p.updated_at);
      } catch {
        notify(t('common.error'), t('pub.loadFailed'));
        leaving.current = true;
        navigation.goBack();
      }
    })();
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced autosave. Pictures are addresses now, so they're kept too; only
  // older base64 pictures (tokens) are left out.
  useEffect(() => {
    if (loading || !dirty.current) return undefined;
    const h = setTimeout(() => {
      const snapshot = {
        title, summary, cover, category, theme,
        chapters: chapters.map((c) => ({ id: c.id, status: c.status, title: c.title, body: stripTokens(c.body) })),
        at: Date.now(),
      };
      AsyncStorage.setItem(draftKey, JSON.stringify(snapshot)).catch(() => {});
    }, 1200);
    return () => clearTimeout(h);
  }, [title, summary, cover, category, theme, chapters, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickImage = async (aspect) => {
    const { status: perm } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm !== 'granted') return { denied: true };
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, // gives the crop UI
      ...(aspect ? { aspect } : {}),
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return null;
    return result.assets[0];
  };

  const pickCover = async () => {
    try {
      const asset = await pickImage([3, 4]);
      if (asset?.denied) { notify(t('chat.permissionRequired'), t('pub.permissionCover')); return; }
      if (!asset) return;
      setCoverUploading(true);
      const processed = await compressImage(asset.uri, { width: 600, quality: 0.6 });
      const uploaded = await uploadMedia(
        { uri: processed.uri, name: `cover_${Date.now()}.jpg`, mimeType: 'image/jpeg' },
        'cover',
      );
      setCover(uploaded.url);
    } catch {
      notify(t('common.error'), t('pub.uploadFailed'));
    } finally {
      setCoverUploading(false);
    }
  };

  const updateChapter = useCallback((key, patch) => {
    setChapters((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }, []);

  // Track each chapter's cursor/selection so the toolbar inserts at the caret.
  const selRef = useRef({});
  const [pendingSel, setPendingSel] = useState(null); // {key,start,end} applied once
  const onBodySelect = useCallback((key, e) => {
    selRef.current[key] = e.nativeEvent.selection;
    setPendingSel((p) => (p && p.key === key ? null : p)); // release control after it lands
  }, []);

  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const applyFormat = useCallback((key, kind) => {
    const c = chaptersRef.current.find((x) => x.key === key);
    if (!c) return;
    const out = formatBody(c.body || '', selRef.current[key], kind);
    if (!out) return;
    updateChapter(key, { body: out.body });
    if (out.caret) {
      selRef.current[key] = { start: out.caret[0], end: out.caret[1] };
      setPendingSel({ key, start: out.caret[0], end: out.caret[1] });
    }
  }, [updateChapter]);

  // Pick + crop a picture, upload it, and put it in the chapter where the
  // reader and the preview both show it.
  const insertImage = useCallback(async (key) => {
    try {
      const asset = await pickImage();
      if (asset?.denied) { notify(t('chat.permissionRequired'), t('pub.permissionImages')); return; }
      if (!asset) return;
      setUploadingKeys((u) => ({ ...u, [key]: (u[key] || 0) + 1 }));
      const processed = await compressImage(asset.uri, { width: 1000, quality: 0.6 });
      const uploaded = await uploadMedia(
        { uri: processed.uri, name: `pubimg_${Date.now()}.jpg`, mimeType: 'image/jpeg' },
        'cover',
      );
      setChapters((prev) => prev.map((c) => (c.key === key
        ? { ...c, body: addImageMarkdown(c.body || '', uploaded.url), preview: false } : c)));
    } catch {
      notify(t('common.error'), t('pub.addImageFailed'));
    } finally {
      setUploadingKeys((u) => {
        const n = (u[key] || 1) - 1;
        const next = { ...u };
        if (n > 0) next[key] = n; else delete next[key];
        return next;
      });
    }
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const addChapter = () => setChapters((prev) => [...prev, blankChapter()]);

  // History: a saved chapter's earlier versions — or, with none, the book's
  // deleted chapters. What's picked there comes back here (not saved).
  const openHistory = useCallback((ch) => {
    navigation.navigate('ChapterHistory', {
      pubId: editId, chapterId: ch?.id ?? null, chapterTitle: ch?.title || '',
    });
  }, [navigation, editId]);

  // A version chosen in History: into its chapter (or, for a deleted chapter,
  // as a new draft chapter at the end). Unsaved until the author saves.
  const restore = route.params?.restore;
  useEffect(() => {
    if (!restore) return;
    const { body, images } = extractInlineImages(restore.body || '');
    setChapters((prev) => {
      const at = restore.chapterId ? prev.findIndex((c) => c.id === restore.chapterId) : -1;
      if (at >= 0) {
        const next = [...prev];
        next[at] = { ...next[at], title: restore.title || '', body, images, preview: false };
        return next;
      }
      return [...prev, blankChapter({ title: restore.title || '', body, images, status: 'draft' })];
    });
    navigation.setParams({ restore: undefined });
  }, [restore]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeChapter = useCallback((key) => {
    if (chaptersRef.current.length === 1) {
      notify(t('pub.keepChapterTitle'), t('pub.keepChapterBody'));
      return;
    }
    setChapters((prev) => (prev.length === 1 ? prev : prev.filter((c) => c.key !== key)));
  }, [t]);

  const moveChapter = useCallback((idx, dir) => {
    setChapters((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const uploadsPending = coverUploading || Object.keys(uploadingKeys).length > 0;

  const save = async (publish) => {
    if (uploadsPending) {
      notify(t('pub.uploading'), t('pub.waitUploads'));
      return;
    }
    if (!title.trim()) {
      notify(t('pub.missingTitleTitle'), t('pub.missingTitleBody'));
      return;
    }
    const cleaned = chapters
      // Expand older base64 tokens back for storage.
      .map((c, i) => ({
        ...(c.id ? { id: c.id } : {}),
        order: i + 1, title: c.title.trim(), body: expandInlineImages(c.body, c.images).trim(), status: c.status,
      }))
      .filter((c) => c.title || c.body);
    if (cleaned.length === 0) {
      notify(t('pub.addContentTitle'), t('pub.addContentBody'));
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
      forgetBook(currentUser?.id, saved.id);   // its page reloads with the new contents
      notePublicationsChanged();
      leaving.current = true;
      // Editing: back to the book page (it reloads). New: the book page takes
      // the editor's place — back from it goes to the list, not the editor.
      if (editId) navigation.goBack();
      else navigation.replace('PublicationDetail', { id: saved.id });
    } catch (err) {
      const msg = err?.response?.data?.error || t('pub.saveFailed');
      notify(t('common.error'), msg);
    } finally {
      setSaving(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <Ionicons name="create-outline" size={46} color={colors.textMuted} />
        <Text style={styles.signInText}>{t('articles.signInMine')}</Text>
        <TouchableOpacity style={styles.signInBtn} onPress={() => navigation.replace('Login')}>
          <Text style={styles.publishBtnText}>{t('auth.login')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: spacing.sm }}>
          <Text style={styles.hint}>{t('common.goBack')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')} testID="editor-close">
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{editId ? t('pub.editTitle') : t('pub.newTitle')}</Text>
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
        <View style={styles.page}>
          {/* Cover */}
          <View style={styles.coverRow}>
            <TouchableOpacity style={styles.coverPicker} onPress={pickCover} activeOpacity={0.85} disabled={coverUploading}>
              {coverUploading ? (
                <ActivityIndicator color={colors.accent} />
              ) : cover ? (
                <Image source={{ uri: cover }} style={styles.coverImg} contentFit="cover" />
              ) : (
                <>
                  <Ionicons name="image-outline" size={26} color={colors.textMuted} />
                  <Text style={styles.coverHint}>{t('pub.cover')}</Text>
                </>
              )}
            </TouchableOpacity>
            <View style={styles.coverSide}>
              <Text style={styles.label}>{t('pub.coverImage')}</Text>
              <Text style={styles.hint}>{t('pub.coverHint')}</Text>
              {cover && !coverUploading ? (
                <TouchableOpacity onPress={() => setCover('')}><Text style={styles.removeLink}>{t('common.remove')}</Text></TouchableOpacity>
              ) : null}
            </View>
          </View>

          <Text style={styles.label}>{t('pub.title')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('pub.titlePlaceholder')}
            placeholderTextColor={colors.placeholder}
            value={title}
            onChangeText={setTitle}
            maxLength={200}
            testID="editor-title"
          />

          <Text style={styles.label}>{t('pub.summary')}</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder={t('pub.summaryPlaceholder')}
            placeholderTextColor={colors.placeholder}
            value={summary}
            onChangeText={setSummary}
            multiline
          />

          <Text style={styles.label}>{t('pub.category')}</Text>
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
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.catChipText, active && styles.catChipTextActive]}>{categoryLabel(c.key, t)}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Reading design: background, font, text colour */}
          <TouchableOpacity style={styles.designToggle} onPress={() => setShowDesign((s) => !s)} activeOpacity={0.85}>
            <MaterialIcons name="palette" size={18} color={colors.accent} />
            <Text style={styles.designToggleText}>{t('pub.readingDesign')}</Text>
            <View style={[styles.designPeek, { backgroundColor: theme.bg }]}>
              <Text style={[styles.designPeekText, { color: theme.text, fontFamily: fontFamilyFor(theme.font) }]}>Aa</Text>
            </View>
            <Ionicons name={showDesign ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          {showDesign && (
            <View style={styles.designPanel}>
              <View style={[styles.designPreview, { backgroundColor: theme.bg }]}>
                <Text style={[styles.designPreviewText, { color: theme.text, fontFamily: fontFamilyFor(theme.font), fontSize: 17 + theme.scale }]}>
                  {t('pub.designSample')}
                </Text>
              </View>

              <Text style={styles.designLabel}>{t('pub.background')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.swatchRow}>
                {WRITING_BGS.map((b) => (
                  <TouchableOpacity
                    key={b.key}
                    onPress={() => setTheme((th) => ({ ...th, bg: b.bg, text: b.text }))}
                    style={[styles.bgSwatch, { backgroundColor: b.bg }, theme.bg === b.bg && styles.swatchActive]}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={b.label}
                  >
                    <Text style={[styles.bgSwatchText, { color: b.text }]}>Aa</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.designLabel}>{t('pub.textColour')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.swatchRow}>
                {WRITING_TEXT_COLORS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setTheme((th) => ({ ...th, text: c }))}
                    style={[styles.colorDot, { backgroundColor: c }, theme.text === c && styles.colorDotActive]}
                    activeOpacity={0.85}
                  />
                ))}
              </ScrollView>

              <Text style={styles.designLabel}>{t('pub.font')}</Text>
              <View style={styles.fontRow}>
                {WRITING_FONTS.map((f) => {
                  const active = theme.font === f.key;
                  return (
                    <TouchableOpacity key={f.key} onPress={() => setTheme((th) => ({ ...th, font: f.key }))} style={[styles.fontChip, active && styles.fontChipActive]} activeOpacity={0.85}>
                      <Text style={[styles.fontChipText, { fontFamily: f.family }, active && styles.fontChipTextActive]}>{f.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.designLabel}>{t('pub.readingSize')}</Text>
              <View style={styles.sizeRow}>
                <TouchableOpacity style={styles.sizeBtn} onPress={() => setTheme((th) => ({ ...th, scale: Math.max(-2, th.scale - 1) }))}><Text style={styles.sizeBtnText}>A−</Text></TouchableOpacity>
                <Text style={styles.sizeValue}>{theme.scale > 0 ? `+${theme.scale}` : theme.scale}</Text>
                <TouchableOpacity style={styles.sizeBtn} onPress={() => setTheme((th) => ({ ...th, scale: Math.min(4, th.scale + 1) }))}><Text style={styles.sizeBtnText}>A+</Text></TouchableOpacity>
              </View>
            </View>
          )}

          {/* Chapters */}
          <View style={styles.chaptersHeader}>
            <Text style={styles.sectionTitle}>{t('pub.chapters')}</Text>
            <Text style={styles.hint}>{t('pub.markdownHint')}</Text>
          </View>

          {chapters.map((ch, idx) => (
            <ChapterCard
              key={ch.key}
              ch={ch}
              idx={idx}
              count={chapters.length}
              theme={theme}
              selection={pendingSel?.key === ch.key ? { start: pendingSel.start, end: pendingSel.end } : null}
              uploading={!!uploadingKeys[ch.key]}
              t={t}
              onChange={updateChapter}
              onFormat={applyFormat}
              onSelect={onBodySelect}
              onImage={insertImage}
              onMove={moveChapter}
              onRemove={removeChapter}
              onHistory={openHistory}
            />
          ))}

          <TouchableOpacity style={styles.addChapterBtn} onPress={addChapter} activeOpacity={0.85}>
            <Ionicons name="add" size={20} color={colors.primary} />
            <Text style={styles.addChapterText}>{t('pub.addChapter')}</Text>
          </TouchableOpacity>

          {editId ? (
            <TouchableOpacity style={styles.deletedLink} onPress={() => openHistory(null)} testID="editor-deleted">
              <Ionicons name="trash-bin-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.deletedLinkText}>{t('pub.deletedChapters')}</Text>
            </TouchableOpacity>
          ) : null}

          <View style={{ height: spacing.xxl }} />
        </View>
      </KeyboardAwareScrollView>

      {/* Save bar */}
      <View style={styles.saveBar}>
        <TouchableOpacity
          style={[styles.saveBtn, styles.draftBtn]}
          onPress={() => save(false)}
          disabled={saving}
          activeOpacity={0.85}
          testID="editor-save-draft"
        >
          {saving ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.draftBtnText}>{t('pub.saveDraft')}</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, styles.publishBtn]}
          onPress={() => save(true)}
          disabled={saving}
          activeOpacity={0.85}
          testID="editor-publish"
        >
          {saving ? <ActivityIndicator color={colors.white} /> : (
            <Text style={styles.publishBtnText}>{status === 'published' && editId ? t('common.save') : t('pub.publish')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.sm },
  signInText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  signInBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginTop: spacing.xs },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },

  content: { padding: spacing.md },
  // A writing column on tablets, not a stretched phone form.
  page: { width: '100%', maxWidth: 760, alignSelf: 'center' },
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
  chapterCardDraft: { borderStyle: 'dashed', borderColor: colors.warning },
  draftChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, marginRight: 2,
  },
  draftChipOn: { borderColor: colors.warning, backgroundColor: 'rgba(255,193,7,0.10)' },
  draftChipText: { ...typography.caption, color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  draftChipTextOn: { color: colors.warning },
  draftNote: { ...typography.caption, color: colors.warning, marginBottom: spacing.xs },
  removedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.sm, marginBottom: spacing.sm,
    borderRadius: radius.sm, backgroundColor: 'rgba(229,57,53,0.10)',
  },
  removedText: { ...typography.caption, color: colors.error, flex: 1 },
  deletedLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.md },
  deletedLinkText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  chapterTools: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  toolBtn: { padding: 4, minWidth: 26, alignItems: 'center' },
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
  uploadingText: { ...typography.caption, color: colors.accent, marginBottom: spacing.xs },
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
