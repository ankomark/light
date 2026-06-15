import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import ScreenVignette from './ScreenVignette';

// Wallpapers (sourced from Pinterest). For production these should be re-hosted
// on your own CDN/Cloudinary rather than hot-linked from i.pinimg.com.
const DEFAULT_IMAGES = [
  'https://i.pinimg.com/1200x/4e/2a/0a/4e2a0a5b1137350051c7374a8abb7dda.jpg',
  'https://i.pinimg.com/1200x/06/d3/e8/06d3e808f5e1b81d053bfd35a45f9235.jpg',
  'https://i.pinimg.com/736x/1b/1e/35/1b1e35f6a8ab71705ad5febbde0a6be7.jpg',
  'https://i.pinimg.com/736x/09/c6/1a/09c61af99914b680452f591dafafc9b0.jpg',
  'https://i.pinimg.com/736x/13/3e/bf/133ebf7d5ff84348b2e6455c2be913ef.jpg',
  
];

/**
 * Full-screen background that crossfades through a set of wallpapers on an
 * interval, blurred and dimmed so foreground content stays readable.
 *
 * Props:
 *  - images: string[]            (defaults to the bundled Pinterest set)
 *  - intervalMs: number          (how long each image shows; default 7000)
 *  - blurIntensity: number 0-100 ("blur to 50%"; default 50)
 *  - tint: 'light' | 'dark'      (blur tint; default 'light')
 *  - scrimColor: string          (overlay over the blur for legibility)
 */
const RotatingBackground = ({
  images = DEFAULT_IMAGES,
  intervalMs = 7000,
  blurIntensity = 50,
  tint = 'light',
  scrimColor = 'rgba(255,255,255,0.5)',
  vignette = true,          // darken the wallpaper edges (curved-glass look)
  vignetteStrength = 0.5,
}) => {
  const list = images && images.length ? images : DEFAULT_IMAGES;
  // Two stacked layers. `bottom` is always fully opaque; `top` fades the next
  // image in, then we copy that image down to `bottom` *while top still fully
  // covers it*. The bottom image's source therefore never changes while it's
  // visible, so there's no one-frame gap that flashes the dark app background.
  const [bottom, setBottom] = useState(0);
  const [top, setTop] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const idxRef = useRef(0);

  useEffect(() => {
    if (list.length < 2) return undefined;
    const timer = setInterval(() => {
      const next = (idxRef.current + 1) % list.length;
      setTop(next);            // queue next image on the (still transparent) top layer
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        idxRef.current = next;
        setBottom(next);       // top is fully opaque now, so this swap is hidden
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [list.length, intervalMs, opacity]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Stable bottom layer */}
      <Image source={{ uri: list[bottom] }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {/* Top layer fades the next image in over the bottom */}
      <Animated.Image
        source={{ uri: list[top] }}
        style={[StyleSheet.absoluteFill, { opacity }]}
        resizeMode="cover"
      />
      {/* Blur ("blur to 50%"). experimentalBlurMethod enables real blur on
          Android (ignored on iOS). */}
      <BlurView
        intensity={blurIntensity}
        tint={tint}
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      {/* Legibility scrim */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }]} />
      {/* Curved-glass edge vignette on the wallpaper itself */}
      {vignette && <ScreenVignette strength={vignetteStrength} />}
    </View>
  );
};

export default RotatingBackground;
