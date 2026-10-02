// What the admins have switched for the whole app (admin phase 4): the app
// down for maintenance, with a message, and parts of it turned off
// (marketplace, quiz, puzzle, live). Asked when the app starts and whenever it
// comes back to the front; a request the server turns away for maintenance
// says so at once (services/api.js calls reportMaintenance).
//
//   const { maintenance, features, refresh } = useAppStatus();
//   const marketOn = useFeature('marketplace');
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { API_URL } from '../services/api';

const DEFAULT = {
  maintenance: { on: false, message: '' },
  features: { marketplace: true, quiz: true, puzzle: true, live: true, singles: true },
};

const AppStatus = createContext({ ...DEFAULT, refresh: () => {} });

let reporter = null;
/** The server turned a request away for maintenance: show it now. */
export const reportMaintenance = (message = '') => reporter?.(message);

export const AppStatusProvider = ({ children }) => {
  const [status, setStatus] = useState(DEFAULT);
  const live = useRef(true);

  const refresh = useCallback(async () => {
    try {
      // A plain fetch: no sign-in needed, and none of the app's interceptors.
      const res = await fetch(`${API_URL}/app-status/`);
      if (!res.ok) return;
      const data = await res.json();
      if (live.current && data && typeof data === 'object') {
        setStatus({
          maintenance: { ...DEFAULT.maintenance, ...(data.maintenance || {}) },
          features: { ...DEFAULT.features, ...(data.features || {}) },
        });
      }
    } catch {
      // Offline: the app works as it last knew.
    }
  }, []);

  useEffect(() => {
    live.current = true;
    refresh();
    reporter = (message) => setStatus((s) => ({ ...s, maintenance: { on: true, message: message || s.maintenance.message } }));
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { live.current = false; reporter = null; sub.remove(); };
  }, [refresh]);

  const value = useMemo(() => ({ ...status, refresh }), [status, refresh]);
  return <AppStatus.Provider value={value}>{children}</AppStatus.Provider>;
};

export const useAppStatus = () => useContext(AppStatus);

/** Whether a part of the app is on ('marketplace' | 'quiz' | 'puzzle' | 'live'). */
export const useFeature = (name) => useContext(AppStatus).features?.[name] !== false;
