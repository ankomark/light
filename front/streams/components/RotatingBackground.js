import React, { useContext, useEffect, useRef, useState } from 'react';
import { Animated, AppState, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { NavigationContext } from '@react-navigation/native';
import ScreenVignette from './ScreenVignette';
import { useWallpapers } from '../context/WallpaperContext';

// Opaque base behind the wallpaper so a transition/cold-load gap is dark — never
// the grey navigator scene.
const BASE_BG = '#0A1628';

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
 *  - images: string[]            (defaults to the admin-managed wallpaper set)
 *  - intervalMs: number          (how long each image shows; default 7000)
 *  - scrimColor: string          (dim overlay over the image for legibility)
 *  - vignette / vignetteStrength (curved-glass edge darkening)
 */
const RotatingBackground = ({
  images,
  scope = 'general',
  intervalMs = 7000,
  scrimColor = 'transparent',
  vignette = true,          // darken the wallpaper edges (curved-glass look)
  vignetteStrength = 0.5,
}) => {
  // Admins curate the set server-side; an explicit `images` prop still wins for
  // screens that want a specific backdrop.
  const { wallpapers } = useWallpapers(scope);
  const list = images && images.length ? images : wallpapers;
  const hasImages = list.length > 0;
  // Two stacked layers. `bottom` is always fully opaque; `top` fades the next
  // image in, then we copy that image down to `bottom` *while top still fully
  // covers it*. The bottom image's source therefore never changes while it's
  // visible, so there's no one-frame gap that flashes the dark app background.
  const [bottom, setBottom] = useState(0);
  const [top, setTop] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;
  const idxRef = useRef(0);
  // The latest set, read by the timer without restarting it on every render.
  const listRef = useRef(list);
  listRef.current = list;

  // An admin deleting wallpapers can shrink the list while this is mounted, so
  // stale indices would point past the end. Reset to the start on any change.
  useEffect(() => {
    idxRef.current = 0;
    setBottom(0);
    setTop(0);
    opacity.setValue(0);
  }, [list.length, opacity]);

  // Rotate only while someone can see it: a screen further down the stack, or
  // the app in the background, keeps its timer (and its downloads) quiet.
  const navigation = useContext(NavigationContext);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    let focused = navigation?.isFocused ? navigation.isFocused() : true;
    let active = AppState.currentState !== 'background';
    const update = () => setVisible(focused && active);
    const subs = [
      AppState.addEventListener('change', (st) => { active = st !== 'background'; update(); }),
    ];
    if (navigation?.addListener) {
      subs.push({ remove: navigation.addListener('focus', () => { focused = true; update(); }) });
      subs.push({ remove: navigation.addListener('blur', () => { focused = false; update(); }) });
    }
    update();
    return () => subs.forEach((x) => (typeof x.remove === 'function' ? x.remove() : null));
  }, [navigation]);

  useEffect(() => {
    if (list.length < 2 || !visible) return undefined;
    let live = true;
    const timer = setInterval(async () => {
      const urls = listRef.current;
      if (urls.length < 2) return;
      const next = (idxRef.current + 1) % urls.length;
      // On the phone before it fades in: on a slow network the fade would
      // otherwise reveal an empty layer. Not loaded in time: skip this turn.
      const ready = await Image.prefetch(urls[next], 'memory-disk').catch(() => false);
      if (!live || !ready) return;
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
    return () => { live = false; clearInterval(timer); };
  }, [list.length, intervalMs, opacity, visible]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: BASE_BG }]} pointerEvents="none">
      {/* No wallpapers is a valid admin choice (they deleted them all), and it
          must not resurrect the bundled ones — the plain BASE_BG stands in. */}
      {hasImages && (
        <>
          {/* Stable bottom layer */}
          {/* Kept on disk: the next launch paints it with no download. */}
          <Image source={{ uri: list[bottom] }} style={StyleSheet.absoluteFill} contentFit="cover"
                 cachePolicy="memory-disk" transition={0} />
          {/* Top layer fades the next image in over the bottom */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
            <Image source={{ uri: list[top] }} style={StyleSheet.absoluteFill} contentFit="cover"
                   cachePolicy="memory-disk" transition={0} />
          </Animated.View>
        </>
      )}
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
