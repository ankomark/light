// The artist's two album sheets:
//   EditAlbumSheet  — title, description, release date, cover; delete.
//   AlbumSongsSheet — which of your songs are on it, in what order.
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { updateAlbum, setAlbumTracks, fetchUserTracks } from '../services/api';
import { uploadMedia } from '../services/cloudinary';
import { compressImage } from '../services/imageProcessing';
import PlaylistCover from './PlaylistCover';
import { colors, spacing, radius, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const Sheet = ({ visible, onClose, title, children }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.overlay} onPress={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <Pressable style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
          {children}
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  </Modal>
);

export const EditAlbumSheet = ({ visible, album, onClose, onSaved, onDelete }) => {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [cover, setCover] = useState(undefined);   // undefined unchanged · null remove · { uri } new
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !album) return;
    setTitle(album.title || '');
    setDescription(album.description || '');
    setDate(album.release_date || '');
    setCover(undefined);
  }, [visible, album]);

  const dateOk = !date.trim() || DATE.test(date.trim());

  const pickCover = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.9,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const small = await compressImage(res.assets[0].uri, { width: 1000, quality: 0.85 });
    setCover({ uri: small.uri });
  };

  const save = async () => {
    if (!title.trim() || !dateOk || saving) return;
    setSaving(true);
    try {
      const changes = { title: title.trim(), description: description.trim(), release_date: date.trim() || null };
      if (cover === null) changes.cover_image = null;
      else if (cover?.uri) {
        const up = await uploadMedia({ uri: cover.uri, mimeType: 'image/jpeg', name: `album_${Date.now()}.jpg` }, 'cover');
        changes.cover_image = up.url;
      }
      onSaved?.(await updateAlbum(album.id, changes));
      onClose();
    } catch {
      Alert.alert(t('common.error'), t('album.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const shown = cover === undefined ? album?.cover : (cover?.uri || null);

  return (
    <Sheet visible={visible} onClose={onClose} title={t('album.edit')}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.coverRow}>
          <PlaylistCover cover={shown} images={[]} size={96} radius={10} />
          <View style={styles.coverBtns}>
            <TouchableOpacity style={styles.smallBtn} onPress={pickCover}>
              <Ionicons name="image-outline" size={16} color={colors.primary} />
              <Text style={styles.smallBtnText}>{t('playlist.changeCover')}</Text>
            </TouchableOpacity>
            {album?.cover_image && cover !== null ? (
              <TouchableOpacity style={styles.smallBtn} onPress={() => setCover(null)}>
                <Ionicons name="close-circle-outline" size={16} color={colors.textSecondary} />
                <Text style={[styles.smallBtnText, styles.muted]}>{t('playlist.removeCover')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        <Text style={styles.label}>{t('album.titleLabel')}</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={100} placeholderTextColor={colors.placeholder} />
        <Text style={styles.label}>{t('playlist.descriptionLabel')}</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          maxLength={300}
          multiline
          placeholderTextColor={colors.placeholder}
        />
        <Text style={styles.label}>{t('album.releaseDate')}</Text>
        <TextInput
          style={[styles.input, !dateOk && styles.inputBad]}
          value={date}
          onChangeText={setDate}
          placeholder="2026-09-23"
          placeholderTextColor={colors.placeholder}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
        {!dateOk ? <Text style={styles.bad}>{t('album.dateFormat')}</Text> : null}
        <TouchableOpacity
          style={[styles.saveBtn, (!title.trim() || !dateOk || saving) && styles.disabled]}
          onPress={save}
          disabled={!title.trim() || !dateOk || saving}
        >
          {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>{t('common.save')}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
          <Ionicons name="trash-outline" size={18} color={colors.error} />
          <Text style={styles.deleteText}>{t('album.delete')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </Sheet>
  );
};

// Pages through your songs (the profile's Music tab endpoint), up to a cap.
const loadAllMine = async (userId, maxPages = 15) => {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await fetchUserTracks(userId, page);
    all.push(...(res?.results ?? []));
    if (!res?.next) break;
  }
  return all;
};

export const AlbumSongsSheet = ({ visible, album, userId, onClose, onSaved }) => {
  const { t } = useI18n();
  const [mine, setMine] = useState(null);
  const [order, setOrder] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !album) return undefined;
    let cancelled = false;
    setOrder((album.tracks || []).map((tr) => tr.id));
    setMine(null);
    loadAllMine(userId).then((rows) => { if (!cancelled) setMine(rows); }).catch(() => { if (!cancelled) setMine([]); });
    return () => { cancelled = true; };
  }, [visible, album, userId]);

  const byId = useMemo(() => {
    const m = {};
    (album?.tracks || []).forEach((tr) => { m[tr.id] = tr; });
    (mine || []).forEach((tr) => { m[tr.id] = tr; });
    return m;
  }, [album, mine]);
  const rest = (mine || []).filter((tr) => !order.includes(tr.id));

  const move = (i, d) => setOrder((o) => {
    const n = [...o];
    const [x] = n.splice(i, 1);
    n.splice(i + d, 0, x);
    return n;
  });

  const save = async () => {
    setSaving(true);
    try {
      onSaved?.(await setAlbumTracks(album.id, order));
      onClose();
    } catch {
      Alert.alert(t('common.error'), t('album.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('album.songs')}>
      <ScrollView contentContainerStyle={styles.content}>
        {order.length === 0 ? <Text style={styles.hint}>{t('album.noSongsYet')}</Text> : null}
        {order.map((id, i) => (
          <View key={`on_${id}`} style={styles.songRow}>
            <Text style={styles.pos}>{i + 1}</Text>
            <Text style={styles.songTitle} numberOfLines={1}>{byId[id]?.title || '…'}</Text>
            <TouchableOpacity style={styles.icon} disabled={i === 0} onPress={() => move(i, -1)} accessibilityLabel={t('player.moveUp')}>
              <MaterialIcons name="keyboard-arrow-up" size={24} color={i === 0 ? colors.textMuted : colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.icon} disabled={i === order.length - 1} onPress={() => move(i, 1)} accessibilityLabel={t('playlist.moveDown')}>
              <MaterialIcons name="keyboard-arrow-down" size={24} color={i === order.length - 1 ? colors.textMuted : colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.icon} onPress={() => setOrder((o) => o.filter((x) => x !== id))} accessibilityLabel={t('album.takeOff')}>
              <MaterialIcons name="remove-circle-outline" size={22} color={colors.error} />
            </TouchableOpacity>
          </View>
        ))}

        <Text style={[styles.label, styles.addLabel]}>{t('album.addSongs')}</Text>
        {mine === null ? <ActivityIndicator color={colors.primary} style={styles.spinner} /> : null}
        {mine && !rest.length ? <Text style={styles.hint}>{t('album.allOnIt')}</Text> : null}
        {rest.map((tr) => (
          <TouchableOpacity key={`off_${tr.id}`} style={styles.songRow} onPress={() => setOrder((o) => [...o, tr.id])} activeOpacity={0.8}>
            <MaterialIcons name="add-circle-outline" size={22} color={colors.primary} />
            <Text style={styles.songTitle} numberOfLines={1}>{tr.title}</Text>
            {tr.album_id && tr.album_id !== album?.id ? <Text style={styles.onOther}>{t('album.onAnother')}</Text> : null}
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={[styles.saveBtn, saving && styles.disabled]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>{t('common.save')}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  kav: { width: '100%', alignItems: 'center' },
  sheet: {
    width: '100%', maxWidth: 560, maxHeight: '92%', backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  content: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  coverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  coverBtns: { gap: spacing.sm },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  smallBtnText: { ...typography.label, color: colors.primary, fontWeight: '700' },
  muted: { color: colors.textSecondary },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.md, marginBottom: 6 },
  addLabel: { marginTop: spacing.lg },
  input: {
    minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, color: colors.textPrimary, backgroundColor: colors.inputBg, fontSize: 16,
  },
  inputBad: { borderColor: colors.error },
  bad: { ...typography.caption, color: colors.error, marginTop: 4 },
  multiline: { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' },
  saveBtn: {
    marginTop: spacing.lg, minHeight: 48, borderRadius: radius.full, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  saveText: { ...typography.button, color: colors.white },
  disabled: { opacity: 0.5 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, marginTop: spacing.sm },
  deleteText: { ...typography.label, color: colors.error, fontWeight: '700' },
  songRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  pos: { width: 22, textAlign: 'right', color: colors.textMuted, fontWeight: '700' },
  songTitle: { flex: 1, ...typography.label, color: colors.textPrimary },
  onOther: { ...typography.caption, color: colors.textMuted },
  icon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  hint: { ...typography.caption, color: colors.textMuted, marginVertical: spacing.sm },
  spinner: { marginVertical: spacing.md },
});
