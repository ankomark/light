/**
 * Can anyone see this screen right now? True while its navigator screen is
 * focused AND the app is in front.
 *
 * Every screen in the stack stays mounted under the one on top, and the
 * header (with its bell, its wallpaper) is on all of them — so a timer that
 * only checks "mounted" runs once per open screen, in the background too.
 * Pollers and animations ask this instead.
 *
 * Outside a navigator (tests, a modal host) it is just "the app is in front".
 */
import { useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { NavigationContext } from '@react-navigation/native';

export default function useScreenActive() {
  const navigation = useContext(NavigationContext);
  const [active, setActive] = useState(() => (
    (navigation?.isFocused ? navigation.isFocused() : true) && AppState.currentState !== 'background'
  ));
  useEffect(() => {
    let focused = navigation?.isFocused ? navigation.isFocused() : true;
    let front = AppState.currentState !== 'background';
    const update = () => setActive(focused && front);
    const subs = [AppState.addEventListener('change', (s) => { front = s !== 'background'; update(); })];
    if (navigation?.addListener) {
      const offFocus = navigation.addListener('focus', () => { focused = true; update(); });
      const offBlur = navigation.addListener('blur', () => { focused = false; update(); });
      subs.push({ remove: offFocus }, { remove: offBlur });
    }
    update();
    return () => subs.forEach((s) => { if (typeof s.remove === 'function') s.remove(); });
  }, [navigation]);
  return active;
}
