import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import ScreenVignette from './ScreenVignette';

// Opaque base behind the wallpaper so a transition/cold-load gap is dark — never
// the grey navigator scene.
const BASE_BG = '#0A1628';

// Wallpapers re-hosted on our own Cloudinary (folder: wallpapers), served from
// its CDN with on-the-fly optimization: f_auto (WebP/AVIF where supported),
// q_auto (smart compression), c_limit/w_1080 (cap size, never upscale).
const CLD = 'https://res.cloudinary.com/dxdmo9j4v/image/upload/f_auto,q_auto,c_limit,w_1080/wallpapers';
const DEFAULT_IMAGES = [
  `${CLD}/s366jodfjqsiikqn39ps.jpg`,
  `${CLD}/f0y17m0ksh6a2tbq33f6.jpg`,
  `${CLD}/jyd6lms0aunhdjo68xuw.jpg`,
  `${CLD}/cvw0s1bab1zxoy024zg6.jpg`,
  `${CLD}/run4ngtxwlslhn0ontn9.jpg`,
];

/**
 * Full-screen background that crossfades through a set of wallpapers on an
 * interval. Reusable per screen — pass a single-item `images` array for a static
 * wallpaper, or several to rotate.
 *
 * Note: no live BlurView here. expo-blur can't render inside react-native-screens'
 * transition snapshots on Android, so a full-screen BlurView flashes solid grey
 * during navigation. For a blurred look, bake it into the image URL instead
 * (Cloudinary `e_blur:N`).
 *
 * Props:
 *  - images: string[]            (defaults to the bundled wallpaper set)
 *  - intervalMs: number          (how long each image shows; default 7000)
 *  - scrimColor: string          (dim overlay over the image for legibility)
 *  - vignette / vignetteStrength (curved-glass edge darkening)
 */
const RotatingBackground = ({
  images = DEFAULT_IMAGES,
  intervalMs = 7000,
  scrimColor = 'transparent',
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
    <View style={[StyleSheet.absoluteFill, { backgroundColor: BASE_BG }]} pointerEvents="none">
      {/* Stable bottom layer */}
      <Image source={{ uri: list[bottom] }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {/* Top layer fades the next image in over the bottom */}
      <Animated.Image
        source={{ uri: list[top] }}
        style={[StyleSheet.absoluteFill, { opacity }]}
        resizeMode="cover"
      />
      {/* Legibility scrim */}
      {scrimColor !== 'transparent' && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }]} />
      )}
      {/* Curved-glass edge vignette on the wallpaper itself */}
      {vignette && <ScreenVignette strength={vignetteStrength} />}
    </View>
  );
};

export default RotatingBackground;
