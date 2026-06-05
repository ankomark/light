import { createNavigationContainerRef } from '@react-navigation/native';

// A navigation ref usable from components rendered outside the navigator tree
// (e.g. the global MiniPlayer overlay, which can't call useNavigation).
export const navigationRef = createNavigationContainerRef();

export function navigate(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}
