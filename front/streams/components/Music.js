import React from 'react'
import { View, StyleSheet } from "react-native";
import TrackList from './TrackList';
import { colors } from '../constants/theme';

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
    flex: 1,
    backgroundColor: colors.bg,
  },
});
