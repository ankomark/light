import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform, UIManager } from 'react-native';

// Enable LayoutAnimation on old-architecture Android so the lift is smooth.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Tracks the on-screen keyboard height so a chat input can be lifted to float
 * directly above it.
 *
 * We drive this off `Keyboard` events (the keyboard's own frame) rather than
 * `KeyboardAvoidingView`, which relies on the Android window resizing when the
 * keyboard opens — and under `edgeToEdgeEnabled` Android no longer resizes, so
 * the keyboard ends up covering the input. Reading the height directly works on
 * both platforms (and in Expo Go, no native rebuild).
 */
export default function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS emits *Will* events (before the animation) so the lift stays in sync
    // with the sliding keyboard; Android only reliably emits *Did*.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setHeight(e?.endCoordinates?.height || 0);
    };
    const onHide = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setHeight(0);
    };
    const s = Keyboard.addListener(showEvt, onShow);
    const h = Keyboard.addListener(hideEvt, onHide);
    return () => { s.remove(); h.remove(); };
  }, []);

  return height;
}
