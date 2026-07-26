// Cross-platform confirm / notice helpers.
//
// react-native-web's Alert.alert is a no-op (`static alert() {}`) — on web it
// shows nothing AND never fires the button callbacks, so every destructive
// admin action gated behind an Alert confirmation (remove content, delete role,
// approve appeal, delete wallpaper, …) silently did nothing in the browser.
// These helpers use the DOM's window.confirm/alert on web and fall back to the
// native Alert (with buttons) on iOS/Android, so the same call site works on
// both. On native the behaviour is unchanged.

import { Platform, Alert } from 'react-native';

const joinText = (title, message) => (message ? `${title}\n\n${message}` : title);

/**
 * Ask the user to confirm an action. Returns a Promise<boolean> that resolves
 * true only if they confirmed.
 *
 *   if (await confirmAction({ title: 'Remove', message: '…', confirmLabel: 'Remove', destructive: true })) {
 *     // do it
 *   }
 */
export const confirmAction = ({
  title,
  message = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
}) => {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      return Promise.resolve(false);
    }
    return Promise.resolve(window.confirm(joinText(title, message)));
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
};

/** Single-button notice (e.g. an error toast). Web: window.alert; native: Alert.alert. */
export const notify = (title, message = '') => {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(joinText(title, message));
    }
    return;
  }
  Alert.alert(title, message);
};
