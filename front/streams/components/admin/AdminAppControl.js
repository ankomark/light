// Running the app (admin phase 4): maintenance mode with a message for
// members (admins still get in), and parts of the app switched off. A change
// asks for a fresh authenticator code (the server's rule) and is logged.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useI18n } from '../../context/I18nContext';
import { fetchAppSettings, saveAppSettings } from '../../services/api';
import { useAppStatus } from '../../context/AppStatusContext';
import { confirmAction, notify } from '../../utils/adminConfirm';
import { ADMIN, ErrorState } from './AdminKit';

const FEATURES = ['marketplace', 'quiz', 'puzzle', 'live'];

export default function AdminAppControl() {
  const { t } = useI18n();
  const { refresh } = useAppStatus();
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const data = await fetchAppSettings();
      setSettings(data);
      setMessage(data?.maintenance?.message || '');
    } catch {
      setFailed(true);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async (changes) => {
    setBusy(true);
    try {
      const data = await saveAppSettings(changes);
      setSettings(data);
      refresh();
    } catch (e) {
      notify(t('common.error'), e?.data?.error || t('admin.actionFailedShort'));
    } finally {
      setBusy(false);
    }
  };

  const setMaintenance = async (on) => {
    const ok = await confirmAction({
      title: on ? t('adminApp.downTitle') : t('adminApp.upTitle'),
      message: on ? t('adminApp.downBody') : t('adminApp.upBody'),
      confirmLabel: on ? t('adminApp.down') : t('adminApp.up'),
      destructive: on,
    });
    if (ok) save({ maintenance: { on, message: message.trim() } });
  };

  if (failed) return <ErrorState onRetry={load} />;
  if (!settings) return <ActivityIndicator color={ADMIN.gold} style={{ marginTop: 60 }} />;
  const down = !!settings.maintenance?.on;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('adminApp.title')}</Text>

      <View style={[styles.card, down && styles.cardDown]} testID="app-maintenance">
        <View style={styles.rowHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{t('adminApp.maintenance')}</Text>
            <Text style={styles.cardSub}>{down ? t('adminApp.isDown') : t('adminApp.isUp')}</Text>
          </View>
          <Switch value={down} onValueChange={setMaintenance} disabled={busy}
                  trackColor={{ false: '#2A3E5E', true: ADMIN.danger }} thumbColor="#FFFFFF" testID="app-maintenance-switch" />
        </View>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder={t('adminApp.messagePlaceholder')}
          placeholderTextColor="#5E7290"
          multiline
          maxLength={300}
          testID="app-maintenance-message"
        />
        {down && message.trim() !== (settings.maintenance?.message || '') && (
          <TouchableOpacity style={styles.save} onPress={() => save({ maintenance: { on: true, message: message.trim() } })}>
            <Text style={styles.saveText}>{t('adminApp.updateMessage')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.section}>{t('adminApp.parts')}</Text>
      <View style={styles.card}>
        {FEATURES.map((f, i) => (
          <View key={f} style={[styles.rowHead, i > 0 && styles.divider]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t(`adminApp.feature.${f}`)}</Text>
              <Text style={styles.cardSub}>{settings.features?.[f] ? t('adminApp.on') : t('adminApp.off')}</Text>
            </View>
            <Switch value={!!settings.features?.[f]} disabled={busy}
                    onValueChange={(v) => save({ features: { [f]: v } })}
                    trackColor={{ false: '#2A3E5E', true: ADMIN.gold }} thumbColor="#FFFFFF" testID={`app-feature-${f}`} />
          </View>
        ))}
      </View>
      <Text style={styles.note}>{t('adminApp.note')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48, gap: 12 },
  title: { color: ADMIN.text, fontSize: 26, fontWeight: '800' },
  section: { color: ADMIN.gold, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 8 },
  card: { backgroundColor: ADMIN.card, borderRadius: 16, padding: 14, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: ADMIN.border },
  cardDown: { borderColor: 'rgba(255,122,107,0.6)' },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ADMIN.border, paddingTop: 12 },
  cardTitle: { color: ADMIN.text, fontSize: 15.5, fontWeight: '800' },
  cardSub: { color: ADMIN.muted, fontSize: 12.5, marginTop: 2 },
  input: {
    minHeight: 70, borderRadius: 12, padding: 12, color: ADMIN.text, fontSize: 14.5, textAlignVertical: 'top',
    backgroundColor: ADMIN.field, borderWidth: 1, borderColor: '#1E3150',
  },
  save: { height: 42, borderRadius: 12, backgroundColor: ADMIN.gold, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: ADMIN.onGold, fontWeight: '800' },
  note: { color: '#7D8FA8', fontSize: 12.5, lineHeight: 18 },
});
