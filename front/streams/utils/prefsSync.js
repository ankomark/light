// The app's choices, kept with the account as well as on the phone, so a new
// phone or a reinstall opens the way its owner left it.
//
// The phone stays the source the app reads from (utils/preferences.js); this
// copies changes up, a moment after they are made and batched, and on sign-in
// brings the account's copy down. A change made offline waits on the phone
// (PENDING_KEY) and goes up before anything comes down, so it is never
// overwritten by an older copy from the server.
//
// The same keys, with the same allowed values, are listed on the server in
// advent-backend/songs/app_prefs.py SYNCED. Whether this phone gets pushes is
// not synced: it belongs to the phone.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchNotificationPreferences, updateNotificationPreferences } from '../services/api';
import { PREF_KEYS } from './preferences';

export const SYNCED_KEYS = [
  PREF_KEYS.autoplayVideo, PREF_KEYS.musicAutoplay, PREF_KEYS.autoDownloadLiked, PREF_KEYS.dataSaver,
  PREF_KEYS.audioQuality, PREF_KEYS.downloadQuality, PREF_KEYS.downloadWifiOnly, PREF_KEYS.videoQuality,
  PREF_KEYS.themeMode, PREF_KEYS.language, PREF_KEYS.quizSound, PREF_KEYS.quizMusic,
  PREF_KEYS.calendarReminders, PREF_KEYS.videoMode, PREF_KEYS.hymnFavSort, PREF_KEYS.hymnLang,
  PREF_KEYS.hymnTextSize, PREF_KEYS.bibleVersion, PREF_KEYS.bibleTextSize, PREF_KEYS.wallpaperOn,
];

const PENDING_KEY = 'pref:sync:pending';
const DEBOUNCE_MS = 1200;

let timer = null;
let flushing = null;

const readPending = async () => {
  try { return JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) || '{}') || {}; } catch { return {}; }
};
const writePending = (pending) => (Object.keys(pending).length
  ? AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  : AsyncStorage.removeItem(PENDING_KEY)).catch(() => {});

/** Send what is waiting. Kept on the phone if it cannot be sent. */
export const flushPrefs = () => {
  if (flushing) return flushing;
  flushing = (async () => {
    const pending = await readPending();
    if (!Object.keys(pending).length) return true;
    try {
      await updateNotificationPreferences({ app_prefs: pending });
    } catch {
      return false;
    }
    // Only what was sent comes off the list: a change made while it was on
    // its way is still waiting.
    const now = await readPending();
    Object.keys(pending).forEach((k) => {
      if (JSON.stringify(now[k]) === JSON.stringify(pending[k])) delete now[k];
    });
    await writePending(now);
    return true;
  })().finally(() => { flushing = null; });
  return flushing;
};

/** A choice was made on this phone: send it shortly, with any others. */
export const queuePref = async (key, value) => {
  if (!SYNCED_KEYS.includes(key)) return;
  const pending = await readPending();
  pending[key] = value;
  await writePending(pending);
  clearTimeout(timer);
  timer = setTimeout(() => { flushPrefs().catch(() => {}); }, DEBOUNCE_MS);
};

/** On sign-in: anything waiting goes up, then the account's copy comes down.
 *  → the account's choices ({} when it has none yet), or null if unreachable. */
export const pullPrefs = async () => {
  const sent = await flushPrefs().catch(() => false);
  if (!sent) return null;   // offline: the phone's own choices stand
  try {
    const data = await fetchNotificationPreferences();
    const server = data?.app_prefs && typeof data.app_prefs === 'object' ? data.app_prefs : {};
    return Object.fromEntries(Object.entries(server).filter(([k]) => SYNCED_KEYS.includes(k)));
  } catch {
    return null;
  }
};

/** Signing out: what this account had waiting is not sent as the next one's. */
export const forgetPendingPrefs = () => {
  clearTimeout(timer);
  return AsyncStorage.removeItem(PENDING_KEY).catch(() => {});
};
