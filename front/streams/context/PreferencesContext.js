// Reactive wrapper around the AsyncStorage-backed preferences in
// utils/preferences.js. Loading them through a provider means a change made in
// Settings (e.g. "Data saver") propagates live to the players and feed without
// each surface having to re-read storage or remount.

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  setPreference as persistPreference,
} from '../utils/preferences';
import { useOptionalAuth } from './useAuth';
import { SYNCED_KEYS, pullPrefs, queuePref, forgetPendingPrefs } from '../utils/prefsSync';

const PreferencesContext = createContext(null);

export const PreferencesProvider = ({ children }) => {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getPreferences().then((p) => {
      if (alive) {
        setPreferences(p);
        setLoaded(true);
      }
    });
    return () => { alive = false; };
  }, []);

  // Signed in: choices are kept with the account too (utils/prefsSync.js).
  const auth = useOptionalAuth();
  const userId = auth?.currentUser?.id ?? null;
  const userRef = useRef(userId);
  userRef.current = userId;

  // Optimistic update: reflect in state immediately, persist in the background.
  const setPreference = useCallback(async (key, value) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    await persistPreference(key, value);
    if (userRef.current) queuePref(key, value).catch(() => {});
  }, []);

  // On sign-in (and each launch signed in): the account's choices come down
  // and win — they are what this person last chose, on whichever phone. An
  // account with none yet takes this phone's. Offline, the phone's stand.
  const prefsRef = useRef(preferences);
  prefsRef.current = preferences;
  const lastUser = useRef(null);
  useEffect(() => {
    if (!loaded) return undefined;
    const was = lastUser.current;
    lastUser.current = userId;
    if (!userId) {
      if (was) forgetPendingPrefs();
      return undefined;
    }
    let alive = true;
    (async () => {
      const server = await pullPrefs();
      if (!alive || !server) return;
      const keys = Object.keys(server);
      if (keys.length) {
        const changed = keys.filter((k) => JSON.stringify(server[k]) !== JSON.stringify(prefsRef.current[k]));
        if (!changed.length) return;
        setPreferences((prev) => ({ ...prev, ...server }));
        await Promise.all(changed.map((k) => persistPreference(k, server[k]).catch(() => {})));
      } else {
        // The account's first phone to sync: its choices become the account's.
        await Promise.all(SYNCED_KEYS.map((k) => queuePref(k, prefsRef.current[k])));
      }
    })().catch(() => {});
    return () => { alive = false; };
  }, [userId, loaded]);

  const value = useMemo(
    () => ({ preferences, setPreference, loaded }),
    [preferences, setPreference, loaded]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};

export const usePreferences = () => {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within a PreferencesProvider');
  return ctx;
};

export default PreferencesContext;
