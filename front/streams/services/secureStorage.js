import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Cross-platform secure storage with the same async API as expo-secure-store.
 *
 * expo-secure-store ships an empty stub on web (its ExpoSecureStore.web.js is
 * `export default {}`), so its methods throw in the browser — which broke web
 * login (the token was obtained but couldn't be stored). On web we fall back to
 * sessionStorage; native keeps using the Keychain/Keystore-backed SecureStore.
 *
 * sessionStorage (not localStorage): the web build is the admin console, so we
 * don't want a long-lived admin JWT sitting on disk. sessionStorage is scoped to
 * the tab and cleared when it closes — a stolen/shared machine can't reuse the
 * token, and there's no persisted token after the session ends. (It's still
 * same-origin readable, so pair this with a CSP header on the host to blunt XSS.)
 *
 * Same method names as SecureStore, so call sites only swap the import.
 */
const isWeb = Platform.OS === 'web';
const ls = () => (typeof window !== 'undefined' ? window.sessionStorage : null);

export const setItemAsync = (key, value, options) => {
  if (isWeb) { ls()?.setItem(key, value); return Promise.resolve(); }
  return SecureStore.setItemAsync(key, value, options);
};

export const getItemAsync = (key, options) => {
  if (isWeb) return Promise.resolve(ls()?.getItem(key) ?? null);
  return SecureStore.getItemAsync(key, options);
};

export const deleteItemAsync = (key, options) => {
  if (isWeb) { ls()?.removeItem(key); return Promise.resolve(); }
  return SecureStore.deleteItemAsync(key, options);
};
