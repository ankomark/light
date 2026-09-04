// Local, device-scoped user preferences backed by AsyncStorage.
//
// These are client-only settings (playback, data usage, notification master
// switch cache) that don't need a server round-trip. Keep reads cheap by
// loading them all at once via getPreferences(); write individual keys with
// setPreference(). Defaults live here so every consumer agrees on them.

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'pref:';

export const PREF_KEYS = {
  autoplayVideo: 'autoplayVideo',
  dataSaver: 'dataSaver',
  audioQuality: 'audioQuality', // 'auto' | 'high' | 'data_saver'
  videoQuality: 'videoQuality', // 'auto' | 'hd' | 'data_saver'
  pushEnabled: 'pushEnabled',
  themeMode: 'themeMode',       // 'system' | 'light' | 'dark'
  language: 'language',         // 'system' | 'en' | 'sw' | ...
  quizSound: 'quizSound',       // game effect sounds + haptics
  quizMusic: 'quizMusic',       // the background music, muted separately
  weatherPlace: 'weatherPlace', // the town the weather screen opens on
  calendarReminders: 'calendarReminders', // date reminders, scheduled on-device
};

export const DEFAULT_PREFERENCES = {
  [PREF_KEYS.autoplayVideo]: true,
  [PREF_KEYS.dataSaver]: false,
  [PREF_KEYS.audioQuality]: 'auto',
  [PREF_KEYS.videoQuality]: 'auto',
  [PREF_KEYS.pushEnabled]: true,
  // Default to dark so the existing (dark-only) screens are unaffected until a
  // user explicitly opts into light/system.
  [PREF_KEYS.themeMode]: 'dark',
  [PREF_KEYS.language]: 'system',
  // Sound on by default — a game that starts silent feels broken. The effects
  // are turned off from Settings; the header button is for the music.
  [PREF_KEYS.quizSound]: true,
  [PREF_KEYS.quizMusic]: true,
  // No default place: the weather screen asks once, then remembers.
  [PREF_KEYS.weatherPlace]: null,
  [PREF_KEYS.calendarReminders]: true,
};

const serialize = (value) => JSON.stringify(value);
const deserialize = (raw, fallback) => {
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
};

// The mute button in the games used to govern the music AND the effect sounds
// together. When they were split, `quizSound` kept its old stored value — so
// anyone who had ever muted was left with the correct/wrong sounds switched
// off, meaning nothing at all, because the button they were pressing now wrote
// `quizMusic` instead. Their game went silent and no amount of unmuting fixed
// it. This gives the effects back once, on the next load.
const SOUND_SPLIT_KEY = PREFIX + 'migrated:soundSplit';

const migrateSoundSplit = async (prefs, raws) => {
  try {
    if (await AsyncStorage.getItem(SOUND_SPLIT_KEY)) return prefs;

    const next = { ...prefs };
    if (prefs[PREF_KEYS.quizSound] === false) {
      // That `false` meant "mute", from a time when muting meant everything.
      next[PREF_KEYS.quizSound] = true;
      await setPreference(PREF_KEYS.quizSound, true);
      // Carry the intent to where it belongs — unless the music has since been
      // set deliberately, in which case that choice wins.
      if (raws[PREF_KEYS.quizMusic] == null) {
        next[PREF_KEYS.quizMusic] = false;
        await setPreference(PREF_KEYS.quizMusic, false);
      }
    }
    await AsyncStorage.setItem(SOUND_SPLIT_KEY, '1');
    return next;
  } catch {
    return prefs;      // a migration that cannot run must not break loading
  }
};

// Load every known preference in one multiGet, falling back to defaults.
export const getPreferences = async () => {
  try {
    const keys = Object.values(PREF_KEYS);
    const pairs = await AsyncStorage.multiGet(keys.map((k) => PREFIX + k));
    const result = { ...DEFAULT_PREFERENCES };
    const raws = {};
    pairs.forEach(([storageKey, raw]) => {
      const key = storageKey.slice(PREFIX.length);
      raws[key] = raw;
      result[key] = deserialize(raw, DEFAULT_PREFERENCES[key]);
    });
    return await migrateSoundSplit(result, raws);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
};

export const getPreference = async (key) => {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return deserialize(raw, DEFAULT_PREFERENCES[key]);
  } catch {
    return DEFAULT_PREFERENCES[key];
  }
};

export const setPreference = async (key, value) => {
  try {
    await AsyncStorage.setItem(PREFIX + key, serialize(value));
  } catch {
    // Persisting a preference is best-effort; the in-memory value still applies.
  }
};

// Whether the media host can serve per-quality renditions.
//
// FALSE today: media lives on R2, which has no delivery-transform tier, and the
// serializers return the same URL for `media_url` and `optimized_url`. The old
// Cloudinary references (the only URLs the transforms below could rewrite) were
// blanked by migration 0070, so applyAudioQuality/applyVideoQuality are no-ops
// against every URL now in the database.
//
// Flip to true once a transform tier exists (the planned custom media domain).
// Consumers gate on this instead of silently offering choices that do nothing.
export const MEDIA_QUALITY_TIERS_AVAILABLE = false;

// Resolve the video-quality preference into knobs that work on ANY host, since
// we can't pick a rendition. Data saver / "data_saver" suppresses autoplay and
// buffers the bare minimum — in a swipe feed most videos are skipped, so
// buffering less is where the real saving is. "hd" buffers further ahead.
export const resolveVideoQuality = (videoQuality, dataSaver) => {
  const low = dataSaver || videoQuality === 'data_saver';
  if (low) {
    return {
      tier: 'data_saver',
      autoplayAllowed: false,
      // Android accepts a hard byte cap; iOS honours the duration.
      bufferOptions: {
        preferredForwardBufferDuration: 2,
        minBufferForPlayback: 1,
        maxBufferBytes: 2 * 1024 * 1024,
      },
    };
  }
  if (videoQuality === 'hd') {
    return {
      tier: 'hd',
      autoplayAllowed: true,
      bufferOptions: {
        preferredForwardBufferDuration: 30,
        minBufferForPlayback: 2,
        maxBufferBytes: 0,  // 0 = let the player decide
      },
    };
  }
  return {
    tier: 'auto',
    autoplayAllowed: true,
    bufferOptions: {
      preferredForwardBufferDuration: 10,
      minBufferForPlayback: 2,
      maxBufferBytes: 0,
    },
  };
};

// Audio has no rendition tiers to choose between (see above), so the only real
// data lever left is whether we pull the whole file up front. Data saver streams
// instead, so skipping a track after a few seconds doesn't cost the full
// download; otherwise we prefetch for gap-free playback.
export const resolveAudioQuality = (audioQuality, dataSaver) => {
  const low = dataSaver || audioQuality === 'data_saver';
  return { downloadFirst: !low };
};

// Rewrite a Cloudinary delivery URL to request a lower-bandwidth rendition based
// on the user's audio-quality preference (Data saver forces the lowest). Only
// touches Cloudinary `/upload/` URLs and never double-applies; anything else is
// returned unchanged so non-Cloudinary sources keep working.
//
// NOTE: a no-op in practice — see MEDIA_QUALITY_TIERS_AVAILABLE. Kept so the
// tier lands working the day renditions exist.
export const applyAudioQuality = (url, audioQuality, dataSaver) => {
  if (!url || typeof url !== 'string' || !url.includes('/upload/')) return url;
  if (/\/upload\/q_/.test(url)) return url; // already has a quality transform

  let transform = null;
  if (dataSaver || audioQuality === 'data_saver') transform = 'q_auto:low';
  else if (audioQuality === 'auto') transform = 'q_auto';
  // 'high' → no transform: serve the original rendition.

  if (!transform) return url;
  return url.replace('/upload/', `/upload/${transform}/`);
};

// Rewrite a Cloudinary video URL for the chosen video quality. 'hd' requests a
// 1080p-capped high-quality rendition; 'auto' lets Cloudinary pick; Data saver
// (or the data_saver choice) caps to 480p low. Only touches Cloudinary
// `/upload/` URLs and never double-applies.
//
// NOTE: a no-op in practice — see MEDIA_QUALITY_TIERS_AVAILABLE. Playback-side
// quality is carried by resolveVideoQuality() instead.
export const applyVideoQuality = (url, videoQuality, dataSaver) => {
  if (!url || typeof url !== 'string' || !url.includes('/upload/')) return url;
  if (/\/upload\/(q_|w_|h_|c_limit)/.test(url)) return url; // already transformed

  let transform = null;
  if (dataSaver || videoQuality === 'data_saver') transform = 'q_auto:low,w_854,c_limit';
  else if (videoQuality === 'hd') transform = 'q_auto:good,w_1920,c_limit';
  else if (videoQuality === 'auto') transform = 'q_auto';
  // anything else → original.

  if (!transform) return url;
  return url.replace('/upload/', `/upload/${transform}/`);
};
