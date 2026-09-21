// Stale-while-revalidate cache for list screens.
//
// The app used to open every screen on an empty array with `loading = true`, so
// a cold start — or just switching tabs after a couple of minutes — meant a
// spinner or a skeleton even when the same rows had been on screen seconds
// earlier. The fix isn't a faster request; it's not waiting for one. A screen
// paints the last payload synchronously-ish from disk, then revalidates in the
// background and swaps the rows in when they differ.
//
// Two layers, on purpose:
//   - a module-level Map, so a tab switch inside one session is a plain object
//     read with NO await at all (AsyncStorage is a native round trip: cheap,
//     but a frame or two, which is exactly the flash we're removing);
//   - AsyncStorage, so the first paint after a cold start is real content.
//
// What belongs here: list payloads that are pleasant-but-not-harmful to show a
// few seconds stale (feed pages, the track library, the stories bar). What does
// NOT: anything where stale is wrong rather than merely old — balances, auth
// state, moderation decisions.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@cache:';

// Bump to invalidate every cached payload at once — do this when a serializer
// changes shape, so an upgraded app can't paint rows the new code can't read.
const SCHEMA = 'v1';

// How long a cached payload may still be painted on open. Past this we skip the
// stale paint and show the skeleton, because content old enough to be wrong is
// worse than a brief wait.
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const memory = new Map();

const fullKey = (key) => `${PREFIX}${SCHEMA}:${key}`;

/** Synchronous read of this session's in-memory copy. Returns null on a miss —
 *  callers that want the disk copy too follow up with readCache(). */
export const peekCache = (key) => {
  const hit = memory.get(key);
  return hit ? hit.data : null;
};

/**
 * Last stored payload for `key`, or null when absent, unreadable or older than
 * `maxAgeMs`. Never throws: a cache miss must degrade to a normal fetch, not an
 * error screen.
 */
export const readCache = async (key, maxAgeMs = DEFAULT_MAX_AGE_MS) => {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at <= maxAgeMs) return hit.data;
  try {
    const raw = await AsyncStorage.getItem(fullKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > maxAgeMs) return null;
    memory.set(key, parsed);
    return parsed.data;
  } catch {
    return null;   // corrupt entry / storage unavailable — just fetch
  }
};

/** Store `data` under `key`. Fire-and-forget: the caller already has the data,
 *  so a failed write must never surface to the user.
 *
 *  `persist: false` keeps it in this session's memory only — for payloads with
 *  one key per item (a post's comments, say), where writing each to disk would
 *  grow storage without bound for a benefit that only matters within a session. */
export const writeCache = (key, data, { persist = true } = {}) => {
  const entry = { at: Date.now(), data };
  memory.set(key, entry);
  if (!persist) return;
  AsyncStorage.setItem(fullKey(key), JSON.stringify(entry)).catch(() => {});
};

/** Drop one key (e.g. on logout, or after an edit that invalidates a list). */
export const dropCache = (key) => {
  memory.delete(key);
  AsyncStorage.removeItem(fullKey(key)).catch(() => {});
};

/** Drop every cached payload — used on logout so the next account never paints
 *  the previous one's feed. */
export const clearAllCaches = async () => {
  memory.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(PREFIX));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    // best-effort
  }
};

/** Cache keys are per-user: two accounts on one device must never see each
 *  other's rows. Callers pass the current user id (undefined before login). */
export const userKey = (userId, name) => `u${userId ?? 'anon'}:${name}`;
