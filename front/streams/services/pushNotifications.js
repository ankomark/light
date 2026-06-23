import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import { API_URL } from './api';

// The EAS project id is what ties an Expo push token to this project. Resolve it
// from the build config (works in dev, preview and production builds).
const PROJECT_ID =
  Constants?.expoConfig?.extra?.eas?.projectId ??
  Constants?.easConfig?.projectId ??
  null;

// How to show notifications when the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const PUSH_TOKEN_KEY = 'expoPushToken';

export async function registerForPushNotifications() {
  if (!Device.isDevice) {
    // Push tokens only work on physical devices
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // Android requires a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Advent Light',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1DA1F2',
    });
  }

  try {
    // Passing projectId explicitly is required in bare/EAS builds and avoids a
    // class of "no project id found" failures.
    const tokenData = await Notifications.getExpoPushTokenAsync(
      PROJECT_ID ? { projectId: PROJECT_ID } : undefined
    );
    const token = tokenData.data;
    await registerTokenWithBackend(token);
    return token;
  } catch (error) {
    // The common Android cause is missing FCM credentials (no google-services.json
    // in the build) or running in Expo Go, which can't mint a remote token. This
    // is non-fatal — the app works without push — so keep it a quiet warning
    // rather than a scary error on every login.
    const msg = String(error?.message || error);
    const fcmMissing = msg.includes('FirebaseApp is not initialized') || msg.includes('fcm');
    if (fcmMissing) {
      console.warn(
        '[Push] No Android push token — FCM is not configured for this build. ' +
        'Add google-services.json + upload FCM credentials to EAS, then rebuild. ' +
        'See https://docs.expo.dev/push-notifications/fcm-credentials/'
      );
    } else {
      console.warn('[Push] Could not get a push token:', msg);
    }
    return null;
  }
}

export async function registerTokenWithBackend(token) {
  try {
    const accessToken = await SecureStore.getItemAsync('accessToken');
    if (!accessToken || !token) return;

    await axios.post(
      `${API_URL}/device-tokens/register/`,
      { token, platform: Platform.OS },
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000 }
    );

    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch (error) {
    console.error('[Push] Failed to register token with backend:', error?.message);
  }
}

export async function unregisterPushToken() {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    const accessToken = await SecureStore.getItemAsync('accessToken');
    if (!token || !accessToken) return;

    await axios.post(
      `${API_URL}/device-tokens/unregister/`,
      { token },
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 8000 }
    );

    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  } catch (error) {
    console.error('[Push] Failed to unregister token:', error?.message);
  }
}

export function addNotificationReceivedListener(handler) {
  return Notifications.addNotificationReceivedListener(handler);
}

export function addNotificationResponseListener(handler) {
  // Fired when the user taps a notification (background or killed)
  return Notifications.addNotificationResponseReceivedListener(handler);
}
