/**
 * Camera and microphone, asked for before anything goes live.
 *
 * WebRTC would ask by itself when publishing starts, but a "no" there failed
 * silently: the host went live muted with a black camera, a co-host came on
 * stage unheard. Asking first means a refusal is said, and when the phone
 * will not ask again (refused for good), the way to Settings is offered.
 *
 * Returns true when publishing may go ahead. If the permission module is
 * missing (an old build), it lets WebRTC ask as before.
 */
import { Alert, Linking } from 'react-native';

let Camera = null;
try {
  Camera = require('expo-camera').Camera;
} catch {
  Camera = null;
}

export async function ensureLivePermissions({ video, t }) {
  if (!Camera?.requestMicrophonePermissionsAsync) return true;
  let mic;
  let cam = { granted: true };
  try {
    mic = await Camera.requestMicrophonePermissionsAsync();
    if (video) cam = await Camera.requestCameraPermissionsAsync();
  } catch {
    return true;   // could not ask: let WebRTC try
  }
  if (mic?.granted && cam?.granted) return true;

  const forGood = (!mic?.granted && mic?.canAskAgain === false) || (!cam?.granted && cam?.canAskAgain === false);
  const body = t(video ? 'live.permBodyVideo' : 'live.permBodyAudio');
  Alert.alert(
    t('live.permTitle'),
    forGood ? `${body} ${t('live.permInSettings')}` : body,
    forGood
      ? [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('live.openSettings'), onPress: () => { Linking.openSettings?.().catch?.(() => {}); } },
      ]
      : [{ text: t('common.done') }],
  );
  return false;
}
