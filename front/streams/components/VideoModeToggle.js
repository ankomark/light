// The Videos feed's "video mode" switch: on, the app opens here next time
// (VideoModeStart); off, on Home. An icon in the feed's top bar, filled when
// on; each tap says what it now does in a short note under the bar.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePreferences } from '../context/PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import { useI18n } from '../context/I18nContext';

const NOTE_MS = 2600;

const VideoModeToggle = ({ noteTop = 56 }) => {
  const { t } = useI18n();
  const { preferences, setPreference } = usePreferences();
  const on = !!preferences[PREF_KEYS.videoMode];
  const [note, setNote] = useState(null);
  const fade = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const toggle = () => {
    const next = !on;
    setPreference(PREF_KEYS.videoMode, next);
    setNote(t(next ? 'video.mode.onNote' : 'video.mode.offNote'));
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setNote(null));
    }, NOTE_MS);
  };

  return (
    <>
      <TouchableOpacity
        onPress={toggle}
        hitSlop={8}
        accessibilityRole="switch"
        accessibilityState={{ checked: on }}
        accessibilityLabel={t('video.mode.label')}
        accessibilityHint={t('video.mode.hint')}
        testID="video-mode-toggle"
      >
        <Ionicons name={on ? 'phone-portrait' : 'phone-portrait-outline'} size={22} color={on ? '#FFD60A' : '#fff'} />
      </TouchableOpacity>
      {note ? (
        <Animated.View style={[styles.note, { top: noteTop, opacity: fade }]} pointerEvents="none">
          <Ionicons name={on ? 'phone-portrait' : 'home'} size={14} color="#fff" />
          <Text style={styles.noteText}>{note}</Text>
        </Animated.View>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  note: {
    position: 'absolute', right: 0, flexDirection: 'row', alignItems: 'center', gap: 6,
    maxWidth: 260, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  noteText: { color: '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1 },
});

export default VideoModeToggle;
