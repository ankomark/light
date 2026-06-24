// Active-theme provider. The chosen mode ('system' | 'light' | 'dark') lives in
// the shared PreferencesContext (persisted); this resolves it to a concrete
// color scheme — following the OS when mode is 'system' — and exposes the active
// palette via useTheme(). Screens opt in by reading colors from useTheme()
// instead of the static import; everything else keeps the dark default.

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
} from 'react';
import { Appearance } from 'react-native';
import { usePreferences } from './PreferencesContext';
import { PREF_KEYS } from '../utils/preferences';
import { paletteFor } from '../constants/theme';

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const { preferences, setPreference } = usePreferences();
  const mode = preferences[PREF_KEYS.themeMode] || 'dark';

  // Track the OS scheme so 'system' mode follows it live.
  const [systemScheme, setSystemScheme] = useState(Appearance.getColorScheme() || 'dark');
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme || 'dark');
    });
    return () => sub.remove();
  }, []);

  const scheme = mode === 'system' ? systemScheme : mode;
  const colors = paletteFor(scheme);

  const setMode = useCallback((next) => setPreference(PREF_KEYS.themeMode, next), [setPreference]);

  const value = useMemo(
    () => ({ colors, scheme, mode, setMode, isDark: scheme !== 'light' }),
    [colors, scheme, mode, setMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
};

export default ThemeContext;
