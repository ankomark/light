// Which phone this is, sent with every request so the account's "Devices
// signed in" list can name it ("Mary's Galaxy A14 · Android") instead of
// "Other device". Display text only: the server trusts none of it.
//
// expo-device is already in the build (services/pushNotifications.js imports
// it at the top), so it is safe to read here.
import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';

const clean = (value, limit) => String(value || '').replace(/[^\x20-\x7E -￿]/g, '').trim().slice(0, limit);

export const deviceName = () => {
  // The name its owner gave the phone, where the system shares it (Android);
  // otherwise the make and model.
  const given = clean(Device.deviceName, 80);
  if (given && given !== Device.modelName) return given;
  return clean([Device.manufacturer, Device.modelName].filter(Boolean).join(' '), 80) || clean(Platform.OS, 10);
};

let applied = false;

/** Set once, on first import: every request through the shared axios
 *  instance (sign-in and token refresh included) carries them. */
export const applyDeviceHeaders = () => {
  if (applied) return;
  applied = true;
  try {
    const common = axios.defaults.headers.common;
    common['X-Device-Name'] = deviceName();
    common['X-Device-Platform'] = Platform.OS;
    common['X-App-Version'] = clean(Constants.expoConfig?.version, 20);
  } catch {
    // Naming the phone is a nicety; it never stands in the way of a request.
  }
};

applyDeviceHeaders();
