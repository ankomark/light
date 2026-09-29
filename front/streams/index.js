import './polyfills'; // must run before App (and any LiveKit import)
import { registerRootComponent } from 'expo';

import { Platform } from 'react-native';
import App from './App';

// The home-screen verse widget (Android): Android wakes this headless task
// to draw and refresh it. See widgets/widgetTaskHandler.js.
// Guarded: on a build made before the widget package was added, the module
// is missing, and that must not stop the app from starting.
if (Platform.OS === 'android') {
  const widget = require('./utils/optionalNative').androidWidget();
  if (widget) {
    try {
      widget.registerWidgetTaskHandler(require('./widgets/widgetTaskHandler').default);
    } catch {
      // No widget this build; the app runs without it.
    }
  }
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
