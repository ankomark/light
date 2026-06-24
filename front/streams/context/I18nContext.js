// Lightweight i18n provider. The chosen language lives in PreferencesContext
// ('system' resolves to the device locale, with English as the ultimate
// fallback). Exposes t(key, params) and the language controls via useI18n().
// No native dependency: the device locale is read from Intl.

import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
} from 'react';
import { usePreferences } from './PreferencesContext';
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

export const I18nProvider = ({ children }) => {
  const { preferences, setPreference } = usePreferences();
  const pref = preferences[PREF_KEYS.language] || 'system';
  const lang = resolveLanguage(pref);

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
