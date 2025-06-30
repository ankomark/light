import React from 'react'
import { View, Text, StyleSheet } from "react-native";
import TrackList from './TrackList';

function Music() {
  return (
    <View style={styles.container}>
        <TrackList />
    </View>
  )
}

export default Music
const styles = StyleSheet.create({
  container: {
    display:'flex',
    flex: 1,
    padding: 8,
    backgroundColor: "#F2F7F5", // Adjust background color to your preference
  },
 
});
