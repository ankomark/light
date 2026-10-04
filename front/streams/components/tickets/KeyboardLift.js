/**
 * Keeps the field being typed in above the keyboard, on the ticket screens —
 * the way Home's and Music's comment boxes do (hooks/useKeyboardHeight).
 *
 * KeyboardAvoidingView can't be used for this: it relies on Android resizing
 * the window when the keyboard opens, and with edge-to-edge Android no longer
 * does, so the keyboard simply covered the fields and the Pay button. This
 * reads the keyboard's own height instead and:
 *
 * - lifts the whole screen by it, so a bottom bar (Pay, Next, Give) sits just
 *   above the keyboard rather than under it;
 * - scrolls the focused field into view inside the given ScrollView, which
 *   Android won't do by itself here.
 *
 *   const scroll = useRef(null);
 *   <KeyboardLift scrollRef={scroll}><ScrollView ref={scroll}>…</ScrollView>{bar}</KeyboardLift>
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useKeyboardHeight from '../../hooks/useKeyboardHeight';

// Room left under the field once it is scrolled up: its label and error stay
// visible, not just the box.
const FIELD_ROOM = 96;

const KeyboardLift = ({ children, scrollRef, style }) => {
  const keyboard = useKeyboardHeight();
  const insets = useSafeAreaInsets?.() || { bottom: 0 };

  useEffect(() => {
    if (!keyboard || !scrollRef?.current) return undefined;
    // After the lift has laid out, bring the field being typed in into view.
    const id = setTimeout(() => {
      try {
        const field = TextInput.State.currentlyFocusedInput?.();
        if (field) scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard?.(field, FIELD_ROOM, true);
      } catch { /* the field stays where it is */ }
    }, 60);
    return () => clearTimeout(id);
  }, [keyboard, scrollRef]);

  // The keyboard covers the bottom inset (the gesture bar) too: lift by the
  // rest, or the bar would float a strip too high.
  const lift = keyboard ? Math.max(0, keyboard - (insets.bottom || 0)) : 0;
  return <View style={[styles.flex, style, lift ? { paddingBottom: lift } : null]}>{children}</View>;
};

const styles = StyleSheet.create({ flex: { flex: 1 } });

export default KeyboardLift;
