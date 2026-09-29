import './polyfills'; // must run before App (and any LiveKit import)
import { registerRootComponent } from 'expo';

import { Platform } from 'react-native';
import App from './App';

// The home-screen verse widget (Android): Android wakes this headless task
// to draw and refresh it. See widgets/widgetTaskHandler.js.
if (Platform.OS === 'android') {
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  registerWidgetTaskHandler(require('./widgets/widgetTaskHandler').default);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
