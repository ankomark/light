// Share the verse of the day as a picture: the card below is both what the
// sheet shows and what is captured, so the preview is exactly what is sent.
//
// A picture because that is how verses travel — a WhatsApp status, a group
// chat, an Instagram story — and a picture carries the app's name with it.
// Text stays one tap away for the chats where a picture is too much, and a
// capture that fails (the web, an old build without the native module) falls
// back to it rather than to an error.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Share, Image, ScrollView,
  ActivityIndicator, Platform, useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
// Not imported at the top: on a build made before these were added, loading
// them crashes the app at launch. See utils/optionalNative.js.
import { viewShot, clipboard } from '../utils/optionalNative';
import { format as fmt, parseISO } from 'date-fns';
import BottomSheet from './BottomSheet';
import { useI18n } from '../context/I18nContext';

const TEAL = '#004B51';
const TEAL_DEEP = '#00343A';
const TEAL_LIFT = '#015C63';
const PARCHMENT = '#F2EFE6';
const GOLD_SOFT = '#E3C46A';
const DISPLAY = 'Cinzel_700Bold';
const DISPLAY_MID = 'Cinzel_600SemiBold';
const SERIF = 'Lora_400Regular';
const APP_NAME = 'Adventist Life';

// 4:5, the shape a phone's feed and status screens show whole.
const RATIO = 5 / 4;
// The "Resting" design (Verse Share Card canvas, board 1): drawn at 400 wide,
// every size below is that design's, scaled to the card's width.
const DESIGN_WIDTH = 400;
// The Bible along the foot: 62% of the width, at the artwork's own shape.
const BOOK_WIDTH = 0.62;
const BOOK_RATIO = 900 / 339;
// How far a verse too long for its room may shrink (the curated verses in
// English never need to; long translations can).
const MIN_FIT = 0.6;
const IS_WEB = Platform.OS === 'web';

export const verseMessage = (verse) => `“${verse.text}”\n— ${verse.reference}`;

/** Whether this build can copy at all (expo-clipboard is native). */
export const canCopy = () => !!clipboard();

/** Put the verse on the clipboard. Resolves true when it got there. */
export const copyVerse = async (verse) => {
  const Clipboard = clipboard();
  if (!Clipboard) return false;
  try {
    await Clipboard.setStringAsync(verseMessage(verse));
    return true;
  } catch {
    return false;
  }
};

/** The picture itself — the "Resting" design: title and date at the top, the
 *  verse centred in the room below them, the app's name, and the open Bible
 *  resting along the foot, below everything, so no verse can run under it.
 *  Sizes follow the card's width, so the preview and the captured file are
 *  one layout at any screen size.
 *
 *  Always 4:5. A verse taller than its room is set smaller, a step at a time,
 *  until it fits. */
export const VerseCard = React.forwardRef(({ verse, width, title }, ref) => {
  const k = width / DESIGN_WIDTH;
  const len = verse.text.length;
  const [fit, setFit] = useState(1);
  const room = useRef(0);
  const used = useRef(0);
  useEffect(() => { setFit(1); room.current = 0; used.current = 0; }, [verse.text, verse.reference, width]);
  const check = () => {
    if (room.current && used.current > room.current) setFit((f) => (f > MIN_FIT ? f * 0.92 : f));
  };
  const [base, lead] = len > 210 ? [16.5, 27] : len > 130 ? [18, 29] : [24, 38];
  const size = base * k * fit;
  // A date, never "Today": the picture outlives the day it was made.
  const day = verse.date ? fmt(parseISO(verse.date), 'd MMMM yyyy') : '';
  const bookW = width * BOOK_WIDTH;
  return (
    <View ref={ref} collapsable={false} style={[styles.card, { width, height: width * RATIO, borderRadius: 24 * k }]}>
      <LinearGradient
        colors={[TEAL_DEEP, TEAL, TEAL_LIFT]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.cardHead, { paddingTop: 28 * k, paddingHorizontal: 28 * k, gap: 4 * k }]}>
        <Text style={[styles.cardTitle, { fontSize: 11 * k, letterSpacing: 2.4 * k }]}>{title}</Text>
        {!!day && <Text style={[styles.cardDate, { fontSize: 11 * k }]}>{day}</Text>}
      </View>

      <View style={[styles.cardRoom, { paddingHorizontal: 32 * k }]} testID="verse-card-room"
            onLayout={(e) => { room.current = e.nativeEvent.layout.height; check(); }}>
        <View testID="verse-card-words" onLayout={(e) => { used.current = e.nativeEvent.layout.height; check(); }}>
          <Text style={[styles.cardQuote, { fontSize: 56 * k, lineHeight: 56 * k, marginBottom: -22 * k }]}>“</Text>
          <Text style={[styles.cardVerse, { fontSize: size, lineHeight: lead * k * fit }]}>{verse.text}</Text>
          <LinearGradient
            colors={['transparent', GOLD_SOFT, 'transparent']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={[styles.cardRule, { marginTop: 18 * k, marginHorizontal: 70 * k }]}
          />
          <Text style={[styles.cardRef, { fontSize: 14 * k, letterSpacing: 1.4 * k, marginTop: 12 * k }]}>{verse.reference}</Text>
        </View>
      </View>

      <Text style={[styles.cardBrand, { fontSize: 9 * k, letterSpacing: 2 * k, marginTop: 14 * k, marginBottom: 8 * k }]}>{APP_NAME}</Text>
      <Image
        source={require('../assets/verse-book.png')}
        style={{ width: bookW, height: bookW / BOOK_RATIO, alignSelf: 'center' }}
        resizeMode="contain"
      />
    </View>
  );
});

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
      ? <ActivityIndicator size="small" color={primary ? TEAL_DEEP : GOLD_SOFT} />
      : <Ionicons name={icon} size={18} color={primary ? TEAL_DEEP : GOLD_SOFT} />}
    <Text style={[styles.optionText, primary && styles.optionTextPrimary]}>{label}</Text>
  </TouchableOpacity>
);

const VerseShareSheet = ({ visible, onClose, verse, onToast }) => {
  const { t } = useI18n();
  const { width: winW } = useWindowDimensions();
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(null);     // which option is working
  const cardW = Math.min(winW - 48, 320);

  // A picture needs react-native-view-shot in the build; without it the
  // picture option falls back to text and saving is not offered.
  const shot = viewShot();
  const canSave = !IS_WEB && !!shot;
  const capture = useCallback(async () => {
    if (!shot) throw new Error('view-shot is not in this build');
    return shot.captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
  }, [shot]);

  const shareText = useCallback(() => {
    onClose();
    Share.share({ message: verseMessage(verse) }).catch(() => {});
  }, [verse, onClose]);

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
    Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: t('verse.share') })
      .catch(() => {});
  }, [capture, shareText, onClose, t]);

  const save = useCallback(async () => {
    setBusy('save');
    try {
      // Write-only: adding a picture needs no read access to anyone's photos.
      const perm = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
      if (!perm.granted) { onToast?.(t('verse.savePermission')); return; }
      // Saved into the library as the app's own new file, not moved into an
      // album — a move is what makes Android ask "allow this app to modify".
      await MediaLibrary.saveToLibraryAsync(await capture());
      onClose();
      onToast?.(t('verse.saved'));
    } catch {
      onToast?.(t('verse.saveFailed'));
    } finally {
      setBusy(null);
    }
  }, [capture, onClose, onToast, t]);

  const copy = useCallback(async () => {
    const ok = await copyVerse(verse);
    onClose();
    onToast?.(ok ? t('verse.copied') : t('common.error'));
  }, [verse, onClose, onToast, t]);

  if (!verse) return null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      heightRatio={0.9}
      header={(
        <View style={styles.head}>
          <Text style={styles.headTitle}>{t('verse.share')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={22} color="rgba(242,239,230,0.7)" />
          </TouchableOpacity>
        </View>
      )}
    >
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} testID="verse-share-sheet">
        <View style={styles.previewWrap}>
          <VerseCard ref={cardRef} verse={verse} width={cardW} title={t('verse.title')} />
        </View>

        <Option icon="image-outline" label={t('verse.shareImage')} onPress={shareImage}
                primary busy={busy === 'image'} testID="verse-share-image" />
        <View style={styles.row}>
          <Option icon="chatbubble-ellipses-outline" label={t('verse.shareText')} onPress={shareText}
                  testID="verse-share-text" />
          {canSave && (
            <Option icon="download-outline" label={t('verse.save')} onPress={save}
                    busy={busy === 'save'} testID="verse-save" />
          )}
          {canCopy() && (
            <Option icon="copy-outline" label={t('verse.copy')} onPress={copy} testID="verse-copy" />
          )}
        </View>
      </ScrollView>
    </BottomSheet>
  );
};

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

  card: { overflow: 'hidden', backgroundColor: TEAL },
  cardHead: { alignItems: 'center' },
  cardTitle: { fontFamily: DISPLAY_MID, color: GOLD_SOFT, textAlign: 'center', textTransform: 'uppercase' },
  cardDate: { fontFamily: SERIF, color: 'rgba(242,239,230,0.7)', textAlign: 'center' },
  // Whatever is left between the title and the Bible; the verse sits centred in it.
  cardRoom: { flex: 1, justifyContent: 'center', overflow: 'hidden' },
  cardQuote: { fontFamily: DISPLAY, color: 'rgba(227,196,106,0.35)', textAlign: 'center' },
  cardVerse: { fontFamily: SERIF, color: PARCHMENT, textAlign: 'center' },
  cardRule: { height: 1, opacity: 0.8 },
  cardRef: { fontFamily: DISPLAY, color: GOLD_SOFT, textAlign: 'center' },
  cardBrand: {
    alignSelf: 'center', fontFamily: DISPLAY_MID,
    color: 'rgba(242,239,230,0.55)', textTransform: 'uppercase',
  },

  row: { flexDirection: 'row', gap: 10 },
  option: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: 14,
    backgroundColor: 'rgba(0,52,58,0.9)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(227,196,106,0.3)',
  },
  optionPrimary: { backgroundColor: GOLD_SOFT, borderColor: GOLD_SOFT, paddingVertical: 14 },
  optionText: { fontFamily: DISPLAY_MID, fontSize: 11, letterSpacing: 0.6, color: PARCHMENT },
  optionTextPrimary: { fontFamily: DISPLAY, fontSize: 13, color: TEAL_DEEP },
});

export default VerseShareSheet;
