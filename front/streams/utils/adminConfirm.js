// Cross-platform confirm / notice helpers.
//
// react-native-web's Alert.alert is a no-op (`static alert() {}`) — on web it
// shows nothing AND never fires the button callbacks, so every destructive
// admin action gated behind an Alert confirmation silently did nothing in the
// browser. These helpers keep a single imperative API — `await confirmAction()`
// — that works on both platforms:
//
//   • Web:    renders a styled in-app modal (see components/admin/ConfirmHost),
//             which registers itself here on mount. If no host is mounted we
//             fall back to the DOM's window.confirm so a call never hangs.
//   • Native: uses the OS Alert with buttons (unchanged phone behaviour).

import { Platform, Alert } from 'react-native';

const joinText = (title, message) => (message ? `${title}\n\n${message}` : title);

// ── Web modal bridge ─────────────────────────────────────────────────────────
// <ConfirmHost/> registers a function here that shows the modal and returns a
// Promise<boolean>. confirmAction() calls it; the modal's buttons resolve it.
let _webHost = null;
export const registerConfirmHost = (fn) => { _webHost = fn; };

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
    if (_webHost) return _webHost({ title, message, confirmLabel, cancelLabel, destructive });
    // Host not mounted yet — never leave the caller hanging.
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return Promise.resolve(window.confirm(joinText(title, message)));
    }
    return Promise.resolve(false);
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

/**
 * Single-button notice (e.g. an error toast). Web: the styled modal in
 * 'notice' mode (falling back to window.alert if the host isn't mounted);
 * native: Alert.alert. Fire-and-forget — returns nothing.
 */
export const notify = (title, message = '') => {
  if (Platform.OS === 'web') {
    if (_webHost) { _webHost({ title, message, variant: 'notice', confirmLabel: 'OK' }); return; }
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(joinText(title, message));
    }
    return;
  }
  Alert.alert(title, message);
};
