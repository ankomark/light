import { registerRootComponent } from 'expo';
import { NativeModules } from 'react-native';
import TrackPlayer from 'react-native-track-player';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Register the playback service so lock-screen / notification media controls work.
// Only when the native module is present (dev-client / production build); in
// Expo Go this module is missing and the call would throw.
if (NativeModules.TrackPlayerModule) {
  TrackPlayer.registerPlaybackService(() => require('./service'));
}
