// Video mode: with it on (the switch on the Videos screen, or Settings), the
// app opens in the Videos feed instead of Home.
//
// Home stays underneath, so "back", the feed's close button and its Home tab
// all land there as usual. Decided once per launch, and only from a plain
// start: if a notification or link already took the user somewhere, or
// they're not signed in, the app opens as it would anyway.
import { useEffect } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { useAuth } from '../context/useAuth';
import { navigationRef } from '../services/navigationRef';
import { PREF_KEYS } from '../utils/preferences';

let decided = false;

export const openVideosIfVideoMode = () => {
  const state = navigationRef.getRootState?.();
  const routes = state?.routes || [];
  // Only from a plain start on Home.
  if (routes.length !== 1 || routes[0].name !== 'Home') return false;
  // Home's own route is kept (same key), so it isn't mounted a second time.
  navigationRef.reset({ index: 1, routes: [routes[0], { name: 'Videos' }] });
  return true;
};

const VideoModeStart = () => {
  const { preferences, loaded } = usePreferences();
  const { isAuthenticated, isEmailVerified, isLoading } = useAuth();

  useEffect(() => {
    if (decided || !loaded || isLoading) return undefined;
    decided = true;
    if (!preferences[PREF_KEYS.videoMode] || !isAuthenticated || !isEmailVerified) return undefined;
    // The navigator may still be settling its first state: try until it's
    // ready, for a moment at most.
    let tries = 0;
    let timer = null;
    const attempt = () => {
      if (navigationRef.isReady() && navigationRef.getRootState?.()) {
        openVideosIfVideoMode();
        return;
      }
      tries += 1;
      if (tries < 40) timer = setTimeout(attempt, 50);
    };
    attempt();
    return () => clearTimeout(timer);
  }, [loaded, isLoading, isAuthenticated, isEmailVerified, preferences]);

  return null;
};

// Test-only reset.
export const __resetVideoModeStart = () => { decided = false; };

export default VideoModeStart;
