// import React, { useState, useEffect } from "react";
// import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
// import { Audio } from "expo-av";

// const AudioPlayer = ({ track }) => {
//   const [sound, setSound] = useState(null);
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [duration, setDuration] = useState(0);
//   const [position, setPosition] = useState(0);

//   useEffect(() => {
//     loadAudio();
//     return () => unloadAudio();
//   }, [track]);

//   const loadAudio = async () => {
//     try {
//       if (sound) {
//         await sound.unloadAsync();
//       }

//       const { sound: newSound } = await Audio.Sound.createAsync(
//         { uri: track.audio_file },
//         { shouldPlay: false }
//       );

//       setSound(newSound);

//       newSound.setOnPlaybackStatusUpdate((status) => {
//         if (status.isLoaded) {
//           setDuration(status.durationMillis / 1000);
//           setPosition(status.positionMillis / 1000);
//         }
//       });
//     } catch (error) {
//       console.error("Error loading audio:", error);
//     }
//   };

//   const unloadAudio = async () => {
//     if (sound) {
//       try {
//         await sound.stopAsync();
//         await sound.unloadAsync();
//         setSound(null);
//       } catch (error) {
//         console.warn("Error unloading audio:", error);
//       }
//     }
//   };

//   const togglePlayback = async () => {
//     if (!sound) return;

//     try {
//       if (isPlaying) {
//         await sound.pauseAsync();
//       } else {
//         await sound.playAsync();
//       }
//       setIsPlaying(!isPlaying);
//     } catch (error) {
//       console.error("Error toggling playback:", error);
//     }
//   };

//   const formatTime = (time) => {
//     const minutes = Math.floor(time / 60);
//     const seconds = Math.floor(time % 60).toString().padStart(2, "0");
//     return `${minutes}:${seconds}`;
//   };

//   return (
//     <View style={styles.trackItem}>
//       <Text style={styles.trackTitle}>{track.title}</Text>
//       <Text>Uploaded by: {track.artist}</Text>

//       {/* Play/Pause Controls */}
//       <TouchableOpacity onPress={togglePlayback} style={styles.controlButton}>
//         <Text style={styles.buttonText}>{isPlaying ? "Pause" : "Play"}</Text>
//       </TouchableOpacity>

//       {/* Time Info */}
//       <View style={styles.timeInfo}>
//         <Text>{formatTime(position)}</Text>
//         <Text>{duration > 0 ? formatTime(duration) : "0:00"}</Text>
//       </View>
//     </View>
//   );
// };

// const styles = StyleSheet.create({
//   trackItem: {
//     padding: 16,
//     backgroundColor: "#fff",
//     borderRadius: 10,
//     marginBottom: 10,
//     alignItems: "center",
//   },
//   trackTitle: {
//     fontSize: 18,
//     fontWeight: "bold",
//     marginBottom: 8,
//   },
//   controlButton: {
//     padding: 8,
//     backgroundColor: "#007bff",
//     borderRadius: 5,
//     marginBottom: 10,
//   },
//   buttonText: {
//     color: "white",
//     fontSize: 16,
//   },
//   timeInfo: {
//     flexDirection: "row",
//     justifyContent: "space-between",
//     width: "100%",
//     fontSize: 12,
//     color: "black",
//   },
// });

// export default AudioPlayer;
