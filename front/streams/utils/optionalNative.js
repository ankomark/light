// Native modules that may not be in the installed build.
//
// A package with native code only exists on a phone once a new native build
// is installed; until then the JS arrives (over the air, or in a dev client
// built earlier) and importing it throws at load — "TurboModuleRegistry:
// 'RNViewShot' could not be found" — which, from a top-level import, takes
// the whole app down at launch. So these are required on first use, inside a
// try, and a missing one is simply null: the feature hides or falls back.
//
// Each loader is a function with a literal require() in it, so Metro still
// bundles the package; only its evaluation is deferred.
const cache = new Map();

const optional = (name, load) => () => {
  if (!cache.has(name)) {
    let mod = null;
    try {
      mod = load();
    } catch {
      mod = null;
    }
    cache.set(name, mod);
  }
  return cache.get(name);
};

export const viewShot = optional('view-shot', () => require('react-native-view-shot'));
export const clipboard = optional('clipboard', () => require('expo-clipboard'));
export const speech = optional('speech', () => require('expo-speech'));
export const androidWidget = optional('android-widget', () => require('react-native-android-widget'));

/** Test-only: forget what was found, so a test can pretend a module is missing. */
export const __resetOptionalNative = () => cache.clear();
