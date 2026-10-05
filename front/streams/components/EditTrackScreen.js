import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, Alert, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardLift from './tickets/KeyboardLift';
import { apiRequest, fetchTrackLyrics, invalidateTrackLyrics } from '../services/api';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
import GenrePicker from './GenrePicker';
import RightsFields, { EMPTY_RIGHTS, isrcLooksValid } from './RightsFields';

const EditTrackScreen = () => {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { track } = useRoute().params;
  // No app header on this screen: clear the notch / status bar ourselves, and
  // keep the field being typed in above the keyboard (KeyboardLift - the
  // window doesn't resize for it on edge-to-edge Android).
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);

  const [title, setTitle] = useState(track.title || '');
  const [album, setAlbum] = useState(track.album || '');
  const [genre, setGenre] = useState(track.genre?.slug ?? null);
  // Licence and credits. A row cached before songs had them has none: only
  // what's changed is sent, so that can't wipe the real ones.
  const initialRights = {
    license: track.license || EMPTY_RIGHTS.license,
    composer: track.composer || '',
    producer: track.producer || '',
    rights_holder: track.rights_holder || '',
    isrc: track.isrc || '',
  };
  const [rights, setRights] = useState(initialRights);
  const [saving, setSaving] = useState(false);

  // `null` means "not loaded yet", which is NOT the same as "no lyrics".
  //
  // This screen is opened from a track row, and the list payload no longer
  // carries the lyrics text (it carries `has_lyrics`). Seeding the field with
  // `track.lyrics || ''` would therefore start it empty and the PATCH below
  // would overwrite the real lyrics with an empty string — silently deleting
  // them. So we fetch them first and refuse to save until they are in hand.
  const [lyrics, setLyrics] = useState(
    typeof track.lyrics === 'string' ? track.lyrics : null
  );
  const [lyricsError, setLyricsError] = useState(false);

  // Fetch the song's lyrics; on failure the field stays locked (saving would
  // wipe them) and a Retry is offered - before, a failed load left the song
  // impossible to save at all.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const loadLyrics = useCallback(() => {
    setLyricsError(false);
    fetchTrackLyrics(track.id)
      .then((text) => { if (aliveRef.current) setLyrics(text ?? ''); })
      .catch(() => { if (aliveRef.current) setLyricsError(true); });
  }, [track.id]);

  useEffect(() => {
    if (lyrics !== null) return;
    loadLyrics();
    // Only on mount / track change - re-running on every keystroke would fight
    // the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  const lyricsReady = lyrics !== null;

  const handleUpdate = async () => {
    if (!title.trim()) {
      Alert.alert(t('track.edit.requiredTitle'), t('track.edit.requiredBody'));
      return;
    }
    if (!lyricsReady) {
      // Belt and braces — the button is disabled in this state too.
      Alert.alert(t('common.error'), t('track.edit.lyricsNotLoaded'));
      return;
    }
    setSaving(true);
    try {
      // Metadata-only PATCH — no audio re-upload, so it's fast and responsive.
      await apiRequest('patch', `/tracks/${track.id}/`, {
        title: title.trim(),
        album: album.trim(),
        lyrics: lyrics.trim(),
        // Only when changed: a row cached before songs had genres has none,
        // and sending that would clear the real one.
        ...(genre !== (track.genre?.slug ?? null) ? { genre } : {}),
        ...Object.fromEntries(Object.entries(rights)
          .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
          .filter(([k, v]) => v !== initialRights[k])),
      });
      // The sheet and Now Playing cache lyrics per track for the session; drop
      // this one so they don't keep showing the words that were just replaced.
      invalidateTrackLyrics(track.id);
      // TrackList reloads on focus, so just go back.
      navigation.goBack();
    } catch (error) {
      // The server's own reason when it gave one (a bad ISRC...), never the
      // raw "Request failed with status code 400".
      const data = error?.response?.data;
      const reason = typeof data === 'object' && data
        ? (data.error || data.detail || Object.values(data).flat().find((v) => typeof v === 'string'))
        : null;
      Alert.alert(t('common.error'), reason || t('track.edit.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.flex, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
    <KeyboardLift scrollRef={scrollRef}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.header}>{t('track.edit.title')}</Text>

        <Text style={styles.label}>{t('track.edit.titleLabel')}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t('track.edit.titlePlaceholder')}
          placeholderTextColor={colors.placeholder}
          maxLength={100}
        />

        <Text style={styles.label}>{t('track.album')}</Text>
        <TextInput
          style={styles.input}
          value={album}
          onChangeText={setAlbum}
          placeholder={t('track.edit.albumPlaceholder')}
          placeholderTextColor={colors.placeholder}
          maxLength={100}
        />

        <Text style={styles.label}>{t('track.genre')}</Text>
        <GenrePicker value={genre} onChange={setGenre} />

        <RightsFields value={rights} onChange={setRights} inputStyle={styles.input} labelStyle={styles.label} />

        <Text style={styles.label}>{t('track.lyrics')}</Text>
        <TextInput
          style={[styles.input, styles.lyrics]}
          value={lyrics ?? ''}
          onChangeText={setLyrics}
          placeholder={
            lyricsReady
              ? t('track.edit.lyricsPlaceholder')
              : t('track.edit.lyricsLoading')
          }
          placeholderTextColor={colors.placeholder}
          // Not editable until the existing lyrics are in hand, so typing can't
          // start from a blank field and replace them.
          editable={lyricsReady}
          multiline
          textAlignVertical="top"
          maxLength={5000}
        />
        {lyricsError && (
          <View style={styles.lyricsErrorRow}>
            <Text style={[styles.lyricsError, { flex: 1 }]}>{t('track.edit.lyricsLoadFailed')}</Text>
            <TouchableOpacity onPress={loadLyrics} hitSlop={8} accessibilityRole="button" testID="edit-track-lyrics-retry">
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, (saving || !lyricsReady || !isrcLooksValid(rights.isrc)) && styles.buttonDisabled]}
          onPress={handleUpdate}
          disabled={saving || !lyricsReady || !isrcLooksValid(rights.isrc)}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>{t('track.edit.save')}</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancel} onPress={() => navigation.goBack()} disabled={saving}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardLift>
    </View>
  );
};

const styles = StyleSheet.create({
  lyricsErrorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  retryText: { color: colors.primary, fontWeight: '700' },
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.lg, textAlign: 'center' },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 16,
    marginBottom: spacing.sm,
  },
  lyrics: { minHeight: 140, textAlignVertical: 'top' },
  lyricsError: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
    ...shadows.md,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { ...typography.button, color: colors.white },
  cancel: { alignItems: 'center', marginTop: spacing.md, padding: spacing.sm },
  cancelText: { color: colors.textSecondary, fontSize: 15 },
});

export default EditTrackScreen;
