// Native modules that may not be in the installed build.
//
// A package with native code only exists on a phone once a new native build
// is installed; until then the JS arrives (over the air, or in a dev client
// built earlier) and loading the package throws — "TurboModuleRegistry:
// 'RNViewShot' could not be found" — which from a top-level import takes the
// whole app down at launch.
//
// A try/catch around require() is not enough: Metro's require reports a
// module's load error to the global error handler before it returns, so the
// error is logged (and in a release build sent to Sentry) even when caught.
// So each package is required only after its native module is seen to be
// registered — asked the non-throwing way — and is null otherwise: the
// feature hides or falls back.
//
// Each loader has a literal require() in it, so Metro still bundles the
// package; only its evaluation is deferred.
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

const cache = new Map();

// Tests have no native side at all: jest.setup.js turns this on so the
// packages' Jest mocks are used; a test of an old build turns it off.
let assumePresent = false;
export const __assumeNativePresent = (on) => { assumePresent = on; cache.clear(); };

// A React Native module (view-shot, the widget): new or old architecture.
const hasRnModule = (name) => {
  try {
    return !!(TurboModuleRegistry.get(name) || NativeModules[name]);
  } catch {
    return false;
  }
};

// An Expo module (clipboard, speech): expo-modules-core's own non-throwing check.
const hasExpoModule = (name) => {
  try {
    return !!require('expo-modules-core').requireOptionalNativeModule(name);
  } catch {
    return false;
  }
};

const optional = (key, isPresent, load) => () => {
  if (!cache.has(key)) {
    let mod = null;
    if (assumePresent || isPresent()) {
      try {
        mod = load() || null;
      } catch {
        mod = null;
      }
    }
    cache.set(key, mod);
  }
  return cache.get(key);
};

// On the web these packages are plain JS (or absent by design), with no
// native module to look for.
const web = Platform.OS === 'web';

export const viewShot = optional('view-shot',
  () => web || hasRnModule('RNViewShot'), () => require('react-native-view-shot'));
export const clipboard = optional('clipboard',
  () => web || hasExpoModule('ExpoClipboard'), () => require('expo-clipboard'));
// Keeps the screen on while a hymn is being sung. Part of Expo itself, so in
// every build; guarded all the same.
export const keepAwake = optional('keep-awake',
  () => web || hasExpoModule('ExpoKeepAwake'), () => require('expo-keep-awake'));
export const speech = optional('speech',
  () => web || hasExpoModule('ExpoSpeech'), () => require('expo-speech'));
export const androidWidget = optional('android-widget',
  () => Platform.OS === 'android' && hasRnModule('AndroidWidget'), () => require('react-native-android-widget'));
