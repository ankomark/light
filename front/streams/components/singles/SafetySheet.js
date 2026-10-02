// Report or block someone in Single & Searching — reachable from every
// profile and every match. A report goes to the moderators; blocking hides
// you from each other everywhere in the app and ends any match.
import React, { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../context/I18nContext';
import { reportSingles, blockSingles } from '../../services/api';
import { notify } from '../../utils/adminConfirm';
import { GOLD, FACE, GoldButton, Label } from './SinglesKit';

export const REASONS = ['fake', 'scam', 'inappropriate', 'harassment', 'underage', 'married', 'other'];

export default function SafetySheet({ profile, visible, onClose, onDone }) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState('menu');           // menu | report
  const [reason, setReason] = useState(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);

  const close = () => { setMode('menu'); setReason(null); setDetails(''); onClose?.(); };

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      await reportSingles(profile.id, reason, details.trim(), alsoBlock);
      notify(t('singles.safety.reportedTitle'), t('singles.safety.reportedBody'));
      close();
      onDone?.(alsoBlock ? 'blocked' : 'reported');
    } catch {
      notify(t('common.error'), t('singles.safety.failed'));
    } finally {
      setBusy(false);
    }
  };

  const block = async () => {
    setBusy(true);
    try {
      await blockSingles(profile.id);
      close();
      onDone?.('blocked');
    } catch {
      notify(t('common.error'), t('singles.safety.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <TouchableOpacity style={styles.scrim} activeOpacity={1} onPress={close} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: 18 + insets.bottom }]} testID="singles-safety">
        <View style={styles.grip} />
        {mode === 'menu' ? (
          <>
            <Text style={styles.title}>{t('singles.safety.title', { name: profile?.first_name || '' })}</Text>
            <TouchableOpacity style={styles.row} onPress={() => setMode('report')} accessibilityRole="button"
              testID="singles-safety-report">
              <Ionicons name="flag-outline" size={22} color={GOLD.gold} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{t('singles.safety.report')}</Text>
                <Text style={styles.rowSub}>{t('singles.safety.reportSub')}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.row} onPress={block} accessibilityRole="button" testID="singles-safety-block"
              disabled={busy}>
              <Ionicons name="ban-outline" size={22} color={GOLD.danger} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: GOLD.danger }]}>{t('singles.safety.block')}</Text>
                <Text style={styles.rowSub}>{t('singles.safety.blockSub')}</Text>
              </View>
            </TouchableOpacity>
          </>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
            <Text style={styles.title}>{t('singles.safety.whyTitle')}</Text>
            <View style={styles.reasons}>
              {REASONS.map((r) => (
                <TouchableOpacity key={r} onPress={() => setReason(r)} accessibilityRole="radio"
                  accessibilityState={{ selected: reason === r }} testID={`singles-reason-${r}`}
                  style={[styles.reason, reason === r && styles.reasonOn]}>
                  <Text style={[styles.reasonText, reason === r && { color: GOLD.onGold }]}>
                    {t(`singles.reason.${r}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Label>{t('singles.safety.details')}</Label>
            <TextInput style={styles.input} value={details} onChangeText={setDetails} multiline maxLength={1000}
              placeholder={t('singles.safety.detailsHint')} placeholderTextColor={GOLD.muted}
              accessibilityLabel={t('singles.safety.details')} />
            <View style={styles.switchRow}>
              <Text style={styles.rowTitle}>{t('singles.safety.alsoBlock')}</Text>
              <Switch value={alsoBlock} onValueChange={setAlsoBlock} trackColor={{ true: GOLD.gold, false: GOLD.border }}
                thumbColor="#FFFFFF" accessibilityLabel={t('singles.safety.alsoBlock')} />
            </View>
            <GoldButton label={t('singles.safety.send')} icon="flag" onPress={send} busy={busy} disabled={!reason}
              testID="singles-safety-send" />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: GOLD.cardDeep, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 8,
    maxHeight: '85%', borderTopWidth: 1, borderColor: GOLD.border,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: GOLD.border, marginBottom: 6 },
  title: { color: GOLD.text, fontFamily: FACE.title, fontSize: 26, textAlign: 'center', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, minHeight: 56 },
  rowTitle: { color: GOLD.text, fontSize: 15.5, fontFamily: FACE.bold },
  rowSub: { color: GOLD.muted, fontSize: 13, fontFamily: FACE.body, marginTop: 2 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reason: {
    paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 999,
    borderWidth: 1, borderColor: GOLD.border, backgroundColor: GOLD.card,
  },
  reasonOn: { backgroundColor: GOLD.gold, borderColor: GOLD.gold },
  reasonText: { color: GOLD.sub, fontSize: 14, fontFamily: FACE.semi },
  input: {
    minHeight: 90, borderRadius: 12, borderWidth: 1, borderColor: GOLD.border, backgroundColor: GOLD.card,
    color: GOLD.text, padding: 12, fontSize: 15, fontFamily: FACE.body, textAlignVertical: 'top',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 },
});
