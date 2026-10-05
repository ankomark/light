/**
 * Keeps a pop-up sheet's fields above the keyboard, on both platforms.
 *
 * KeyboardAvoidingView was used for this, with `behavior` set on iOS only —
 * and on Android it relies on the window resizing for the keyboard, which an
 * edge-to-edge app (and a Modal) no longer does: the keyboard covered the
 * field and the Save button. This pads the bottom by the keyboard's own
 * height instead (hooks/useKeyboardHeight), as BottomSheet already does.
 *
 *   <Modal …><Pressable style={styles.overlay}>
 *     <KeyboardSheetPad style={styles.kav}><Pressable style={styles.sheet}>…</Pressable></KeyboardSheetPad>
 *   </Pressable></Modal>
 */
import React from 'react';
import { View } from 'react-native';
import useKeyboardHeight from '../hooks/useKeyboardHeight';

const KeyboardSheetPad = ({ style, children, testID }) => {
  const keyboard = useKeyboardHeight();
  return <View style={[style, { paddingBottom: keyboard }]} testID={testID}>{children}</View>;
};

export default KeyboardSheetPad;
