// metro.config.js
// SDK 54 moved this from the standalone @expo/metro-config package to a subpath
// export of `expo` (same pattern as expo/config-plugins). Requiring the old path
// throws MODULE_NOT_FOUND, which Metro's loader swallows and retries via a broken
// import() — surfacing as a misleading ERR_UNSUPPORTED_ESM_URL_SCHEME on Windows.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add SQLite/database extensions
config.resolver.assetExts.push(
  'db',
  'sqlite'
);

// LiveKit's @livekit/react-native-webrtc imports `event-target-shim/index`, but
// event-target-shim@6's package "exports" map only exposes `.` (not `./index`).
// With Metro's package-exports resolution (on by default in Expo SDK 53) that
// prints a noisy "not listed in exports" warning and falls back to file
// resolution. Redirect the bare `/index` subpath to the package root, which
// resolves to the same index.js — silencing the warning without disabling
// package exports globally (LiveKit's other packages rely on it).
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'event-target-shim/index') {
    return context.resolveRequest(context, 'event-target-shim', platform);
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;