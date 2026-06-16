import React from 'react';
import { Platform, View } from 'react-native';
import { BlurView } from 'expo-blur';

/**
 * Frosted-glass surface that is safe across navigation transitions.
 *
 * expo-blur's BlurView renders as a solid GREY rectangle inside the bitmap
 * snapshot that react-native-screens takes during a screen transition on
 * Android — producing an intermittent grey flash that "covers the app". And in
 * Expo Go the Android BlurView is only a faux tint anyway (no real blur).
 *
 * So: on iOS we keep the real BlurView (it doesn't flash there); on Android we
 * render a plain View with the same style. Each call site already carries its
 * own translucent backgroundColor / gradient for the glass look, so the result
 * is visually ~identical minus the flash.
 *
 * Drop-in for <BlurView>: same intensity/tint/style/children props.
 */
const GlassView = ({ intensity, tint, experimentalBlurMethod, style, children, ...rest }) => {
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={intensity}
        tint={tint}
        experimentalBlurMethod={experimentalBlurMethod}
        style={style}
        {...rest}
      >
        {children}
      </BlurView>
    );
  }
  return (
    <View style={style} {...rest}>
      {children}
    </View>
  );
};

export default GlassView;
