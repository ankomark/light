// A playlist's picture: its own cover when it has one, else a collage of its
// first songs' covers (one fills the square; two to four make a 2×2), else a
// music icon. Used by the Library, the playlist page and profiles.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../constants/theme';

const PlaylistCover = ({ cover, images = [], size = 56, radius = 6, style }) => {
  const box = { width: size, height: size, borderRadius: radius };
  if (cover || images.length === 1) {
    return (
      <Image
        source={{ uri: cover || images[0] }}
        style={[styles.base, box, style]}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
      />
    );
  }
  if (!images.length) {
    return (
      <View style={[styles.base, styles.empty, box, style]}>
        <MaterialCommunityIcons name="playlist-music" size={Math.round(size * 0.46)} color={colors.textMuted} />
      </View>
    );
  }
  const cell = { width: size / 2, height: size / 2 };
  return (
    <View style={[styles.base, styles.grid, box, style]}>
      {[0, 1, 2, 3].map((i) => (images[i]
        ? <Image key={i} source={{ uri: images[i] }} style={cell} contentFit="cover" cachePolicy="memory-disk" transition={150} />
        : <View key={i} style={[cell, styles.blank]} />))}
    </View>
  );
};

const styles = StyleSheet.create({
  base: { backgroundColor: colors.surface, overflow: 'hidden' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  blank: { backgroundColor: colors.surface },
});

export default PlaylistCover;
