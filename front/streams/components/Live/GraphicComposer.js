/**
 * Host/co-host authoring sheet for on-screen graphics. Pick a style, type the
 * text, and push it to the stream (or clear the current one). Rendering happens
 * in LiveGraphic on every client; this only produces the { style, title, sub }.
 */
import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { live } from '../../constants/liveTheme';
import { useI18n } from '../../context/I18nContext';
import useKeyboardHeight from '../../hooks/useKeyboardHeight';

// Module scope can't call t(), so each style carries a key the render site
// resolves — the same pattern the feed's FEED_REASON map uses.
const STYLES = [
  { key: 'lower3', labelKey: 'live.graphic.style.lower3', icon: 'format-text', sub: true },
  { key: 'banner', labelKey: 'live.graphic.style.banner', icon: 'bullhorn-outline', sub: true },
  { key: 'nametag', labelKey: 'live.graphic.style.nametag', icon: 'card-account-details-outline', sub: true },
  { key: 'ticker', labelKey: 'live.graphic.style.ticker', icon: 'text-long', sub: false },
];

export default function GraphicComposer({ visible, current, onShow, onClear, onClose }) {
  const { t } = useI18n();
  const kbHeight = useKeyboardHeight();
  const [styleKey, setStyleKey] = useState('lower3');
  const [title, setTitle] = useState('');
  const [sub, setSub] = useState('');

  useEffect(() => {
    if (!visible) return;
    setStyleKey(current?.style || 'lower3');
    setTitle(current?.title || '');
    setSub(current?.sub || '');
  }, [visible, current]);

  const showSub = STYLES.find((s) => s.key === styleKey)?.sub;
  const canShow = title.trim().length > 0;

  const submit = () => {
    if (!canShow) return;
    onShow({ style: styleKey, title: title.trim(), sub: showSub ? sub.trim() : '' });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.sheet, kbHeight > 0 ? { marginBottom: kbHeight } : null]}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t('live.graphic.title')}</Text>

          <Text style={styles.label}>{t('live.graphic.style')}</Text>
          <View style={styles.chips}>
            {STYLES.map((s) => {
              const on = s.key === styleKey;
              return (
                <TouchableOpacity key={s.key} style={[styles.chip, on && styles.chipOn]} onPress={() => setStyleKey(s.key)} activeOpacity={0.85}>
                  <MaterialCommunityIcons name={s.icon} size={16} color={on ? live.onGold : live.gold} />
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(s.labelKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>
            {styleKey === 'ticker' ? t('live.graphic.tickerText') : t('live.graphic.text')}
          </Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={styleKey === 'nametag'
              ? t('live.graphic.namePlaceholder')
              : t('live.graphic.textPlaceholder')}
            placeholderTextColor={live.inkMute}
            maxLength={120}
            autoFocus
          />

          {showSub && (
            <>
              <Text style={styles.label}>
                {styleKey === 'nametag' ? t('live.graphic.role') : t('live.graphic.subtitle')}
              </Text>
              <TextInput
                style={styles.input}
                value={sub}
                onChangeText={setSub}
                placeholder={styleKey === 'nametag'
                  ? t('live.graphic.rolePlaceholder')
                  : t('live.graphic.subPlaceholder')}
                placeholderTextColor={live.inkMute}
                maxLength={80}
              />
            </>
          )}

          <TouchableOpacity onPress={submit} disabled={!canShow} activeOpacity={0.9} style={[styles.showWrap, !canShow && { opacity: 0.5 }]}>
            <LinearGradient colors={live.gradCta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.showBtn}>
              <MaterialCommunityIcons name="monitor-share" size={18} color={live.onGold} />
              <Text style={styles.showText}>{t('live.graphic.show')}</Text>
            </LinearGradient>
          </TouchableOpacity>

          {current ? (
            <TouchableOpacity style={styles.clearBtn} onPress={() => { onClear(); onClose(); }} activeOpacity={0.85}>
              <MaterialCommunityIcons name="close-circle-outline" size={16} color={live.inkDim} />
              <Text style={styles.clearText}>{t('live.graphic.clear')}</Text>
            </TouchableOpacity>
          ) : null}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,12,24,0.6)' },
  sheet: {
    backgroundColor: '#0A1B33', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 20, paddingBottom: 34, borderTopWidth: 1, borderColor: live.hair, gap: 8,
  },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', marginBottom: 8 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 4 },
  label: { color: live.gold, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999, backgroundColor: 'rgba(16,46,80,0.5)', borderWidth: StyleSheet.hairlineWidth, borderColor: live.hair,
  },
  chipOn: { backgroundColor: live.gold, borderColor: live.gold },
  chipText: { color: live.ink, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: live.onGold },
  input: {
    color: '#fff', fontSize: 16, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)',
  },
  showWrap: { marginTop: 16, borderRadius: 999 },
  showBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: 999 },
  showText: { color: live.onGold, fontSize: 15.5, fontWeight: '800' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginTop: 4 },
  clearText: { color: live.inkDim, fontSize: 13, fontWeight: '600' },
});
