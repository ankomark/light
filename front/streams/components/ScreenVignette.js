import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * A soft edge vignette that darkens the screen's borders and corners, giving a
 * "curved glass" / premium feel — the center sits forward, the edges recede.
 * Purely decorative: absolute-fill + pointerEvents="none" so it never blocks
 * touches. Sits above the feed content but below the frosted top bar (zIndex 5).
 *
 * Props:
 *  - strength: edge opacity 0-1 (default 0.5)
 *  - side / vertical: falloff width/height in px for the left-right / top-bottom edges
 *  - zIndex: paint order (default 5 — sits above the feed; pass higher to also
 *    frame the frosted top bar)
 *  - tintRgb: edge color as an "r,g,b" string (default black; pass a navy like
 *    "8,20,40" for a dark-blue glass vignette)
 */
const ScreenVignette = ({ strength = 0.5, side = 24, vertical = 46, zIndex = 5, tintRgb = '0,0,0' }) => {
  const dark = `rgba(${tintRgb},${strength})`;
  return (
    <View style={[styles.root, { zIndex }]} pointerEvents="none">
      {/* Left edge */}
      <LinearGradient
        colors={[dark, 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.fillV, { left: 0, width: side }]}
      />
      {/* Right edge */}
      <LinearGradient
        colors={['transparent', dark]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.fillV, { right: 0, width: side }]}
      />
      {/* Top edge */}
      <LinearGradient
        colors={[dark, 'transparent']}
        style={[styles.fillH, { top: 0, height: vertical }]}
      />
      {/* Bottom edge */}
      <LinearGradient
        colors={['transparent', dark]}
        style={[styles.fillH, { bottom: 0, height: vertical }]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
  fillV: { position: 'absolute', top: 0, bottom: 0 },
  fillH: { position: 'absolute', left: 0, right: 0 },
});

export default ScreenVignette;
