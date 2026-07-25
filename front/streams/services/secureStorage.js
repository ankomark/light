import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Cross-platform secure storage with the same async API as expo-secure-store.
 *
 * expo-secure-store ships an empty stub on web (its ExpoSecureStore.web.js is
 * `export default {}`), so its methods throw in the browser — which broke web
 * login (the token was obtained but couldn't be stored). On web we fall back to
 * localStorage; native keeps using the Keychain/Keystore-backed SecureStore.
 *
 * Same method names as SecureStore, so call sites only swap the import.
 */
const isWeb = Platform.OS === 'web';
const ls = () => (typeof window !== 'undefined' ? window.localStorage : null);

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
