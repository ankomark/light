import { useEffect, useState } from 'react';
import { createNavigationContainerRef } from '@react-navigation/native';

// A navigation ref usable from components rendered outside the navigator tree
// (e.g. the global MiniPlayer overlay, which can't call useNavigation).
export const navigationRef = createNavigationContainerRef();

export function navigate(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}

/** The name of the screen on top, kept current as the user navigates — for
 *  overlays outside the navigator (they can't use useRoute). */
export function useCurrentRouteName() {
  const read = () => (navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined);
  const [name, setName] = useState(read);
  useEffect(() => {
    const update = () => setName(read());
    update();
    return navigationRef.addListener('state', update);
  }, []);
  return name;
}
