// The Cover studio: a template, a palette, a subtitle and (for Photo) a
// picture — previewed live here, then drawn at full size on the server (the
// book faces, 1200×1800) and handed back to the editor.
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { renderBookCover } from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import { compressImage } from '../services/imageProcessing';
import { notify } from '../utils/adminConfirm';
import { colors, typography, spacing, radius } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export const COVER_TEMPLATES = ['minimal', 'classic', 'luxury', 'modern', 'photo'];
// bg, text, accent — as the server draws them (songs/writer_studio.py).
export const COVER_PALETTES = {
  navy: ['#0F2744', '#F4DE9B', '#E8ECF3'],
  ivory: ['#F7F3EA', '#2B2A26', '#8C6A1A'],
  forest: ['#10261D', '#E3F0E8', '#C8A96A'],
  wine: ['#3A1420', '#F6E1EA', '#E7C871'],
  sky: ['#1D5A8A', '#FFFFFF', '#FFD7A8'],
  charcoal: ['#1B1D22', '#F2F2F2', '#F4A261'],
};

// A close likeness of the server's drawing, at any size (a 2:3 page).
export const CoverPreview = ({ template, palette, title, subtitle, author, photo, width }) => {
  const [bg, fg, accent] = COVER_PALETTES[palette] || COVER_PALETTES.navy;
  const h = width * 1.5;
  const s = width / 1200;                                    // server pixels → here
  const text = template === 'photo' && photo ? '#FFFFFF' : fg;
  const face = { classic: 'Cinzel_700Bold', luxury: 'Lora_700Bold', modern: undefined }[template] || 'Lora_700Bold';
  return (
    <View style={[styles.cover, { width, height: h, backgroundColor: bg }]} testID="cover-preview">
      {photo && (template === 'photo' || template === 'modern') ? (
        <Image source={{ uri: photo }} style={[StyleSheet.absoluteFill, template === 'modern' && { opacity: 0.28 }]} contentFit="cover" />
      ) : null}
      {template === 'photo' && photo ? <View style={[StyleSheet.absoluteFill, styles.shade]} /> : null}
      {template === 'classic' ? (
        <View style={[StyleSheet.absoluteFill, { margin: 60 * s, borderWidth: Math.max(1, 6 * s), borderColor: accent }]} />
      ) : null}
      {template === 'modern' ? <View style={[styles.band, { height: h * 0.34, backgroundColor: accent }]} /> : null}
      <View style={[styles.coverBody, template === 'modern' ? styles.coverTop : template === 'photo' ? styles.coverBottom : null,
        { padding: 110 * s }]}>
        <Text style={{ color: template === 'luxury' ? accent : text, fontFamily: face, fontWeight: template === 'modern' ? '800' : undefined,
          fontSize: Math.max(12, 120 * s), textAlign: template === 'modern' ? 'left' : 'center',
          textTransform: template === 'classic' ? 'uppercase' : 'none' }} numberOfLines={4}>
          {title || ' '}
        </Text>
        {subtitle ? (
          <Text style={{ color: text, fontStyle: 'italic', fontSize: Math.max(9, 50 * s), marginTop: 20 * s,
            textAlign: template === 'modern' ? 'left' : 'center' }} numberOfLines={2}>{subtitle}</Text>
        ) : null}
      </View>
      <Text style={[styles.coverAuthor, { color: template === 'modern' ? bg : accent, fontSize: Math.max(9, 56 * s),
        bottom: 200 * s, textAlign: template === 'modern' ? 'left' : 'center', paddingHorizontal: 110 * s }]}
        numberOfLines={1}>{author}</Text>
    </View>
  );
};

const CoverStudio = ({ route, navigation }) => {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const p = route.params || {};
  const [template, setTemplate] = useState('minimal');
  const [palette, setPalette] = useState('navy');
  const [subtitle, setSubtitle] = useState(p.subtitle || '');
  const [author, setAuthor] = useState(p.author || '');
  const [photo, setPhoto] = useState(null);              // { local, url }
  const [busy, setBusy] = useState(null);                // 'photo' | 'make'
  const previewW = Math.min(width - spacing.md * 2, 300);

  const pickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { notify(t('chat.permissionRequired'), t('pub.permissionCover')); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
      if (res.canceled || !res.assets?.length) return;
      setBusy('photo');
      const small = await compressImage(res.assets[0].uri, { width: 1200, quality: 0.8 });
      const up = await uploadMedia({ uri: small.uri, name: `coverphoto_${Date.now()}.jpg`, mimeType: 'image/jpeg' }, 'cover');
      setPhoto({ local: small.uri, url: up.url });
      if (template !== 'modern') setTemplate('photo');
    } catch {
      notify(t('common.error'), t('pub.uploadFailed'));
    } finally {
      setBusy(null);
    }
  };

  const make = async () => {
    if (!p.title) { notify(t('pub.missingTitleTitle'), t('studio.coverNeedsTitle')); return; }
    setBusy('make');
    try {
      const { url } = await renderBookCover({
        template, palette, title: p.title, subtitle: subtitle.trim(), author: author.trim(),
        ...(photo?.url ? { image_url: photo.url } : {}),
      });
      navigation.popTo('PublicationEditor', { cover: url }, { merge: true });
    } catch {
      notify(t('common.error'), t('studio.coverFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn} hitSlop={10}
          accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('studio.coverStudio')}</Text>
        <View style={styles.iconBtn} />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.center}>
          <CoverPreview template={template} palette={palette} title={p.title} subtitle={subtitle} author={author}
            photo={photo?.local} width={previewW} />
        </View>

        <Text style={styles.label}>{t('studio.template')}</Text>
        <View style={styles.row}>
          {COVER_TEMPLATES.map((k) => (
            <TouchableOpacity key={k} style={[styles.chip, template === k && styles.chipOn]} onPress={() => setTemplate(k)}
              accessibilityRole="radio" accessibilityState={{ checked: template === k }} testID={`cover-template-${k}`}>
              <Text style={[styles.chipText, template === k && styles.chipTextOn]}>{t(`studio.tpl.${k}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('studio.palette')}</Text>
        <View style={styles.row}>
          {Object.entries(COVER_PALETTES).map(([k, [bg, fg, accent]]) => (
            <TouchableOpacity key={k} onPress={() => setPalette(k)} accessibilityRole="radio"
              accessibilityState={{ checked: palette === k }} accessibilityLabel={k} testID={`cover-palette-${k}`}
              style={[styles.swatch, { backgroundColor: bg, borderColor: palette === k ? colors.accent : colors.border }]}>
              <View style={[styles.swatchDot, { backgroundColor: accent }]} />
              <Text style={{ color: fg, fontWeight: '800', fontSize: 12 }}>Aa</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto} disabled={busy === 'photo'} testID="cover-photo">
          {busy === 'photo' ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="image-outline" size={18} color={colors.accent} />}
          <Text style={styles.photoText}>{photo ? t('studio.changePhoto') : t('studio.addPhoto')}</Text>
        </TouchableOpacity>

        <Text style={styles.label}>{t('studio.subtitle')}</Text>
        <TextInput style={styles.input} value={subtitle} onChangeText={setSubtitle} maxLength={120}
          placeholder={t('studio.subtitlePlaceholder')} placeholderTextColor={colors.placeholder} testID="cover-subtitle" />
        <Text style={styles.label}>{t('studio.authorName')}</Text>
        <TextInput style={styles.input} value={author} onChangeText={setAuthor} maxLength={80}
          placeholderTextColor={colors.placeholder} testID="cover-author" />

        <TouchableOpacity style={styles.make} onPress={make} disabled={busy === 'make'} testID="cover-make">
          {busy === 'make' ? <ActivityIndicator color={colors.white} /> : <Text style={styles.makeText}>{t('studio.useCover')}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.md, gap: spacing.xs, width: '100%', maxWidth: 640, alignSelf: 'center' },
  center: { alignItems: 'center', marginBottom: spacing.md },
  cover: { borderRadius: 6, overflow: 'hidden', justifyContent: 'center' },
  shade: { backgroundColor: 'rgba(0,0,0,0.35)' },
  band: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  coverBody: { alignItems: 'stretch' },
  coverTop: { position: 'absolute', top: '12%', left: 0, right: 0 },
  coverBottom: { position: 'absolute', bottom: '20%', left: 0, right: 0 },
  coverAuthor: { position: 'absolute', left: 0, right: 0 },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', textTransform: 'uppercase', marginTop: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 3, borderRadius: radius.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  chipTextOn: { color: colors.white },
  swatch: { width: 52, height: 52, borderRadius: radius.md, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatchDot: { position: 'absolute', top: 6, right: 6, width: 10, height: 10, borderRadius: 5 },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md, padding: spacing.sm },
  photoText: { ...typography.label, color: colors.accent, fontWeight: '700' },
  input: {
    color: colors.textPrimary, fontSize: 15, backgroundColor: colors.inputBg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  make: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.lg },
  makeText: { ...typography.button, color: colors.white },
});

export default CoverStudio;
