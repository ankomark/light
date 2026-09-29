// Share something as a picture: the card the sheet shows is the one captured,
// so the preview is exactly what is sent — then text, save to photos, copy.
//
// The same behaviour as the verse of the day's sheet (VerseShareSheet), for
// any card: the caller draws the card (`renderCard(ref, width)`) and gives the
// words that go with it (`message`). A picture that cannot be made — the web,
// a build without the native module — falls back to the text, never an error.
import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Share, ScrollView,
  ActivityIndicator, Platform, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import BottomSheet from './BottomSheet';
import { useI18n } from '../context/I18nContext';
// Loaded on first use, never at launch: an older build may lack them.
import { viewShot, clipboard } from '../utils/optionalNative';

const GOLD = '#F4A261';
const INK = '#0A1628';
const PARCHMENT = '#E8E3DA';
const DISPLAY = 'Cinzel_700Bold';
const DISPLAY_MID = 'Cinzel_600SemiBold';
const IS_WEB = Platform.OS === 'web';

const Option = ({ icon, label, onPress, primary, busy, testID }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={busy}
    style={[styles.option, primary && styles.optionPrimary]}
    accessibilityRole="button"
    accessibilityLabel={label}
    testID={testID}
  >
    {busy
      ? <ActivityIndicator size="small" color={primary ? INK : GOLD} />
      : <Ionicons name={icon} size={18} color={primary ? INK : GOLD} />}
    <Text style={[styles.optionText, primary && styles.optionTextPrimary]}>{label}</Text>
  </TouchableOpacity>
);

export default function ShareCardSheet({
  visible, onClose, title, message, renderCard, onToast, maxCardWidth = 320,
}) {
  const { t } = useI18n();
  const { width: winW } = useWindowDimensions();
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(null);
  const cardW = Math.min(winW - 48, maxCardWidth);

  const shot = viewShot();
  const canSave = !IS_WEB && !!shot;
  const canCopy = !!clipboard();
  const capture = useCallback(async () => {
    if (!shot) throw new Error('view-shot is not in this build');
    return shot.captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
  }, [shot]);

  const shareText = useCallback(() => {
    onClose();
    Share.share({ message }).catch(() => {});
  }, [message, onClose]);

  const shareImage = useCallback(async () => {
    setBusy('image');
    let uri = null;
    try {
      if (await Sharing.isAvailableAsync()) uri = await capture();
    } catch {
      uri = null;
    }
    setBusy(null);
    if (!uri) { shareText(); return; }
    onClose();
    Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title })
      .catch(() => {});
  }, [capture, shareText, onClose, title]);

  const save = useCallback(async () => {
    setBusy('save');
    try {
      // Write-only: adding a picture needs no read access to anyone's photos.
      const perm = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
      if (!perm.granted) { onToast?.(t('share.savePermission')); return; }
      await MediaLibrary.saveToLibraryAsync(await capture());
      onClose();
      onToast?.(t('share.saved'));
    } catch {
      onToast?.(t('share.saveFailed'));
    } finally {
      setBusy(null);
    }
  }, [capture, onClose, onToast, t]);

  const copy = useCallback(async () => {
    let ok = false;
    try {
      await clipboard()?.setStringAsync(message);
      ok = true;
    } catch {
      ok = false;
    }
    onClose();
    onToast?.(ok ? t('share.copied') : t('common.error'));
  }, [message, onClose, onToast, t]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      heightRatio={0.9}
      header={(
        <View style={styles.head}>
          <Text style={styles.headTitle}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={22} color="rgba(232,227,218,0.7)" />
          </TouchableOpacity>
        </View>
      )}
    >
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} testID="share-sheet">
        <View style={styles.previewWrap}>{renderCard(cardRef, cardW)}</View>

        <Option icon="image-outline" label={t('share.asPicture')} onPress={shareImage}
                primary busy={busy === 'image'} testID="share-image" />
        <View style={styles.row}>
          <Option icon="chatbubble-ellipses-outline" label={t('share.asText')} onPress={shareText}
                  testID="share-text" />
          {canSave && (
            <Option icon="download-outline" label={t('share.save')} onPress={save}
                    busy={busy === 'save'} testID="share-save" />
          )}
          {canCopy && (
            <Option icon="copy-outline" label={t('share.copy')} onPress={copy} testID="share-copy" />
          )}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10,
  },
  headTitle: { fontFamily: DISPLAY, fontSize: 15, letterSpacing: 0.8, color: PARCHMENT },
  body: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  previewWrap: {
    alignItems: 'center', marginBottom: 4,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  row: { flexDirection: 'row', gap: 10 },
  option: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: 14,
    backgroundColor: 'rgba(5,8,14,0.9)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,162,97,0.3)',
  },
  optionPrimary: { backgroundColor: GOLD, borderColor: GOLD, paddingVertical: 14 },
  optionText: { fontFamily: DISPLAY_MID, fontSize: 11, letterSpacing: 0.6, color: PARCHMENT },
  optionTextPrimary: { fontFamily: DISPLAY, fontSize: 13, color: INK },
});
