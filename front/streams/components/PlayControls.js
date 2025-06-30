


import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from "react-native";
import Slider from "@react-native-community/slider";
import { Audio } from "expo-av";

const PlayControls = ({ track }) => {
  const soundRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(1); // Avoid division by zero error

  useEffect(() => {
    const setupAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
        });

        if (!track || !track.audio_file) {
          console.warn("Invalid track data");
          return;
        }

        if (soundRef.current) {
          await soundRef.current.unloadAsync();
          soundRef.current = null;
        }

        const { sound } = await Audio.Sound.createAsync(
          { uri: track.audio_file },
          { shouldPlay: false }
        );

        soundRef.current = sound;

        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded) {
            setDuration(status.durationMillis / 1000 || 1);
            setCurrentTime(status.positionMillis / 1000);
          }
        });
      } catch (error) {
        console.error("Error loading audio:", error);
      }
    };

    setupAudio();

    return () => {
      if (soundRef.current) {
        soundRef.current
          .unloadAsync()
          .then(() => (soundRef.current = null))
          .catch((err) => console.warn("Error unloading audio:", err));
      }
    };
  }, [track]);

  const togglePlay = async () => {
    if (!soundRef.current) return;

    try {
      if (isPlaying) {
        await soundRef.current.pauseAsync();
      } else {
        await soundRef.current.playAsync();
      }
      setIsPlaying(!isPlaying);
    } catch (error) {
      console.error("Error toggling playback:", error);
    }
  };

  const handleSeek = async (value) => {
    if (!soundRef.current) return;
    const newTime = (value / 100) * duration;
    await soundRef.current.setPositionAsync(newTime * 1000);
    setCurrentTime(newTime);
  };

  const formatTime = (time) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  return (
    <View style={styles.container}>
      {/* Progress Bar */}
      <View style={styles.sliderContainer}>
        <Slider
          style={styles.progressBar}
          minimumValue={0}
          maximumValue={100}
          value={duration ? (currentTime / duration) * 100 : 0}
          onSlidingComplete={handleSeek}
          thumbTintColor="white"
          minimumTrackTintColor="red"
          maximumTrackTintColor="gray"
        />
      </View>

      {/* Time Info */}
      <View style={styles.timeInfo}>
        <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
        <Text style={styles.timeText}>{formatTime(duration)}</Text>
      </View>

      {/* Play/Pause Button */}
      <TouchableOpacity onPress={togglePlay} style={styles.playButton}>
        <Text style={styles.buttonText}>{isPlaying ? "Pause" : "Play"}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    padding: 2,
    // backgroundColor: "black",
    borderRadius: 10,
    margin: 10,
    width: Dimensions.get("window").width * 0.9, // Make it more responsive
  },
  sliderContainer: {
    width: "100%",
    paddingHorizontal: 1,
    marginTop: 0,
  },
  progressBar: {
    width: "100%",
    height: 10, // Increase height for visibility
  },
  timeInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginVertical: 10,
    paddingHorizontal: 10,
  },
  timeText: {
    color: "white",
    fontSize: 14,
  },
  playButton: {
    padding: 8,
    backgroundColor: "green",
    borderRadius: 8,
    marginTop: 1,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});

export default PlayControls;
