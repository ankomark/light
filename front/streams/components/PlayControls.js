import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { colors, spacing } from "../constants/theme";

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

const formatTime = (ms) => {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

const PlayControls = ({ track }) => {
  const soundRef = useRef(null);
  const isMounted = useRef(true);
  const seekingRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [seekValue, setSeekValue] = useState(0);

  const onStatus = (status) => {
    if (!isMounted.current || !status.isLoaded) return;
    if (status.durationMillis) setDurationMs(status.durationMillis);
    setIsBuffering(Boolean(status.isBuffering) && Boolean(status.shouldPlay));
    setIsPlaying(Boolean(status.isPlaying));
    if (!seekingRef.current) setPositionMs(status.positionMillis || 0);
    if (status.didJustFinish) {
      soundRef.current?.setStatusAsync({ shouldPlay: false, positionMillis: 0 }).catch(() => {});
      setPositionMs(0);
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    isMounted.current = true;
    const load = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
        });
        if (!track?.audio_file) {
          setIsLoading(false);
          return;
        }
        setIsLoading(true);
        const { sound } = await Audio.Sound.createAsync(
          { uri: track.audio_file },
          { shouldPlay: false, progressUpdateIntervalMillis: 250 },
          onStatus
        );
        soundRef.current = sound;
        if (isMounted.current) setIsLoading(false);
      } catch (error) {
        console.error("Error loading audio:", error);
        if (isMounted.current) setIsLoading(false);
      }
    };
    load();
    return () => {
      isMounted.current = false;
      const s = soundRef.current;
      soundRef.current = null;
      if (s) s.unloadAsync().catch(() => {});
    };
  }, [track?.audio_file]);

  const togglePlay = async () => {
    const s = soundRef.current;
    if (!s) return;
    try {
      if (isPlaying) await s.pauseAsync();
      else await s.playAsync();
    } catch (error) {
      console.error("Error toggling playback:", error);
    }
  };

  const skip = async (deltaMs) => {
    const s = soundRef.current;
    if (!s || !durationMs) return;
    const target = Math.max(0, Math.min(durationMs, positionMs + deltaMs));
    try {
      await s.setPositionAsync(target);
      setPositionMs(target);
    } catch (error) {
      console.error("Error seeking:", error);
    }
  };

  const progress = seekingRef.current
    ? seekValue
    : durationMs > 0
    ? positionMs / durationMs
    : 0;

  return (
    <View style={styles.container}>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={1}
        value={progress}
        onSlidingStart={() => { seekingRef.current = true; }}
        onValueChange={setSeekValue}
        onSlidingComplete={async (v) => {
          const target = v * durationMs;
          try { await soundRef.current?.setPositionAsync(target); } catch (e) {}
          setPositionMs(target);
          seekingRef.current = false;
        }}
        thumbTintColor={colors.white}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.border}
        disabled={isLoading || durationMs === 0}
      />

      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{formatTime(positionMs)}</Text>
        <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity onPress={() => skip(-10000)} disabled={isLoading} hitSlop={HIT}>
          <MaterialIcons name="replay-10" size={28} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={togglePlay}
          style={styles.playButton}
          activeOpacity={0.85}
          disabled={isLoading}
        >
          {isLoading || isBuffering ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={28}
              color={colors.white}
              style={!isPlaying && { marginLeft: 3 }}
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => skip(10000)} disabled={isLoading} hitSlop={HIT}>
          <MaterialIcons name="forward-10" size={28} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: "100%", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  slider: { width: "100%", height: 32 },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: -4, paddingHorizontal: 4 },
  timeText: { color: colors.textSecondary, fontSize: 12, fontVariant: ["tabular-nums"] },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
    marginTop: spacing.sm,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
});

export default PlayControls;
