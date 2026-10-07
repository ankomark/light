// Lightweight i18n provider. The chosen language lives in PreferencesContext
// ('system' resolves to the device locale, with English as the ultimate
// fallback). Exposes t(key, params) and the language controls via useI18n().
// No native dependency: the device locale is read from Intl.

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePreferences } from './PreferencesContext';
import { useOptionalAuth } from './useAuth';
import { updateNotificationPreferences } from '../services/api';
import { PREF_KEYS } from '../utils/preferences';
import { STRINGS, SUPPORTED_LANGS, LANGUAGES } from '../i18n/strings';

const I18nContext = createContext(null);

// Best-effort device language (e.g. 'sw-KE' -> 'sw') with no native module.
const deviceLang = () => {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en';
    return locale.split('-')[0].toLowerCase();
  } catch {
    return 'en';
  }
};

export const resolveLanguage = (pref) => {
  const lang = pref === 'system' || !pref ? deviceLang() : pref;
  return SUPPORTED_LANGS.includes(lang) ? lang : 'en';
};

// The languages pushes can be written in (advent-backend/songs/push_text.py).
const PUSH_LANGUAGES = ['en', 'sw'];

/** Tell the server which language this account's pushes should be in: on
 *  sign-in and whenever it changes, once — remembered per account, so it is
 *  not sent on every launch. Offline, it is sent on a later launch. */
const usePushLanguage = (lang) => {
  const auth = useOptionalAuth();
  const userId = auth?.currentUser?.id;
  useEffect(() => {
    if (!userId) return;
    const language = PUSH_LANGUAGES.includes(lang) ? lang : 'en';
    const key = `push:lang:${userId}`;
    (async () => {
      if ((await AsyncStorage.getItem(key).catch(() => null)) === language) return;
      await updateNotificationPreferences({ language });
      await AsyncStorage.setItem(key, language);
    })().catch(() => {});
  }, [userId, lang]);
};

export const I18nProvider = ({ children }) => {
  const { preferences, setPreference } = usePreferences();
  const pref = preferences[PREF_KEYS.language] || 'system';
  const lang = resolveLanguage(pref);
  usePushLanguage(lang);

  const t = useCallback((key, params) => {
    let str = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    if (params) {
      Object.keys(params).forEach((k) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k]));
      });
    }
    return str;
  }, [lang]);

  const setLanguage = useCallback((code) => setPreference(PREF_KEYS.language, code), [setPreference]);

  const value = useMemo(
    () => ({ t, language: pref, resolvedLanguage: lang, setLanguage, languages: LANGUAGES }),
    [t, pref, lang, setLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
};

export default I18nContext;
