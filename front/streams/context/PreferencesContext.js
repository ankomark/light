// Reactive wrapper around the AsyncStorage-backed preferences in
// utils/preferences.js. Loading them through a provider means a change made in
// Settings (e.g. "Data saver") propagates live to the players and feed without
// each surface having to re-read storage or remount.

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  setPreference as persistPreference,
} from '../utils/preferences';

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

  // Optimistic update: reflect in state immediately, persist in the background.
  const setPreference = useCallback(async (key, value) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    await persistPreference(key, value);
  }, []);

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
