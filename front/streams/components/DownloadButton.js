// Download a track: an icon, then a live percentage while it saves, then a
// green check once it's kept for offline listening.
//
// With `onSaveToPhone`, a tap asks which kind of download the person wants:
//   - Save to phone: the file goes to the phone's own music library (the
//     original behaviour of this button — the caller does it);
//   - Download for offline listening: kept inside the app and played from
//     there, no connection needed.
// Without it (Now Playing, the song page) a tap goes straight to the offline
// download.
import React, { useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useDownloadState, downloadTrack, removeDownload, cancelDownload } from '../utils/downloads';
import { useI18n } from '../context/I18nContext';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import ChoiceSheet from './ChoiceSheet';
import { colors } from '../constants/theme';

const DownloadButton = ({ track, size = 20, color = colors.textSecondary, onSaveToPhone, style }) => {
  const { t } = useI18n();
  const { status, progress } = useDownloadState(track?.id);
  const [sheet, setSheet] = useState(false);
  const { preferences } = usePreferences();

  const saveOffline = async () => {
    // Download quality and "Wi-Fi only" come from Settings → Playback & Data.
    const wifiOnly = !!preferences[PREF_KEYS.downloadWifiOnly];
    const net = wifiOnly ? await NetInfo.fetch().catch(() => null) : null;
    downloadTrack(track, {
      quality: preferences[PREF_KEYS.downloadQuality] || 'standard',
      wifiOnly,
      network: net?.type === 'wifi' ? 'wifi' : (net?.type || ''),
    }).catch((e) => {
      if (e?.code === 'wifi_only') {
        Alert.alert(t('downloads.wifiOnlyTitle'), t('downloads.wifiOnlyBody'));
        return;
      }
      Alert.alert(t('trackItem.downloadFailedTitle'), e?.message || t('trackItem.downloadFailedBody'));
    });
  };
  const removeOffline = () => removeDownload(track.id);

  const onPress = () => {
    if (!track) return;
    if (status === 'downloading') {
      cancelDownload(track.id);
      return;
    }
    if (status !== 'done' && !onSaveToPhone) {
      saveOffline();
      return;
    }
    setSheet(true);
  };

  // Not downloaded: phone or offline. Already offline: it can still go to
  // the phone, or come out of the app.
  const options = status === 'done'
    ? [
      ...(onSaveToPhone ? [{ key: 'phone', label: t('downloads.saveToPhone'), icon: 'smartphone', onPress: onSaveToPhone }] : []),
      { key: 'remove', label: t('downloads.removeOffline'), icon: 'delete-outline', destructive: true, onPress: removeOffline },
    ]
    : [
      { key: 'phone', label: t('downloads.saveToPhone'), icon: 'smartphone', onPress: onSaveToPhone },
      { key: 'offline', label: t('downloads.offline'), icon: 'offline-pin', onPress: saveOffline },
    ];

  return (
    <>
    <TouchableOpacity
      onPress={onPress}
      hitSlop={8}
      style={[styles.btn, style]}
      accessibilityRole="button"
      accessibilityLabel={status === 'done' ? t('downloads.downloaded') : t('downloads.download')}
    >
      {status === 'downloading' ? (
        <View style={[styles.ring, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
          <Text style={styles.pct}>{Math.round(progress * 100)}</Text>
        </View>
      ) : (
        <MaterialIcons
          name={status === 'done' ? 'download-done' : 'file-download'}
          size={size}
          color={status === 'done' ? colors.success : color}
        />
      )}
    </TouchableOpacity>
    {/* A sibling, not a child: touches inside the sheet must not also be
        seen by the button in the React tree. */}
    <ChoiceSheet
      visible={sheet}
      title={t('downloads.chooseTitle')}
      subtitle={track?.title}
      options={options}
      onClose={() => setSheet(false)}
      cancelLabel={t('common.cancel')}
    />
    </>
  );
};

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  ring: { borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  pct: { color: colors.primary, fontSize: 9, fontWeight: '800' },
});

export default DownloadButton;
