// A notice's picture, whatever its shape. The box takes the picture's own
// proportions (kept between `minRatio` and `maxRatio`, width ÷ height) and the
// picture is never cropped: past those limits, a blurred copy fills the sides.
// `width`/`height` (saved with the notice) give the shape before it loads.
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

// Shapes learned on load: for older notices saved without a size.
const ratios = new Map();
const LANDSCAPE = 16 / 9;   // until the picture tells us

const clamp = (r, lo, hi) => Math.min(hi, Math.max(lo, r));

const NoticeCover = ({ uri, width, height, minRatio = 1, maxRatio = 2, style, testID }) => {
  const [loaded, setLoaded] = useState(null);   // { uri, ratio } from this picture's load
  const ratio = (loaded?.uri === uri && loaded.ratio)
    || (width > 0 && height > 0 ? width / height : ratios.get(uri))
    || LANDSCAPE;
  const box = clamp(ratio, minRatio, maxRatio);

  const onLoad = (e) => {
    const { width: w, height: h } = e?.source || {};
    if (!w || !h) return;
    const r = w / h;
    ratios.set(uri, r);
    if (Math.abs(r - ratio) > 0.01) setLoaded({ uri, ratio: r });
  };

  return (
    <View style={[styles.box, { aspectRatio: box }, style]} testID={testID}>
      {Math.abs(box - ratio) > 0.01 ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={24} />
      ) : null}
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} onLoad={onLoad} />
    </View>
  );
};

const styles = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)' },
});

export default NoticeCover;
