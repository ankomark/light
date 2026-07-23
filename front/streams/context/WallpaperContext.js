// App-wide wallpaper source. RotatingBackground renders on ~21 screens, so the
// active set is fetched ONCE here and shared, rather than per-mount.
//
// Wallpapers are admin-managed rows (see the Wallpapers admin screen). The
// bundled list below is ONLY a bootstrap for the very first launch, before the
// device has ever reached the server:
//
//   urls === null  -> never fetched (cold start / offline first run) -> bundled
//   urls === []    -> the server said there are none -> show none
//   urls.length    -> the admin-curated set
//
// That distinction is what makes deletion stick. Treating an empty response as
// "fall back to the bundled images" would resurrect wallpapers an admin had
// just deleted, which is exactly what they asked the app not to do.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWallpapers } from '../services/api';

const CACHE_KEY = 'wallpapers:byScope';

// First-launch bootstrap only. These same URLs are seeded into the database by
// migration 0078, so once the device syncs they arrive as ordinary rows the
// admin can reorder, hide or delete.
export const BOOTSTRAP_WALLPAPERS = {
  general: [
    'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/s366jodfjqsiikqn39ps.jpg',
    'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/f0y17m0ksh6a2tbq33f6.jpg',
    'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/jyd6lms0aunhdjo68xuw.jpg',
    'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/cvw0s1bab1zxoy024zg6.jpg',
    'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/run4ngtxwlslhn0ontn9.jpg',
  ],
  music: [
    'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/wg19rbjnqphztrcsan0b.jpg',
    'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/fjcbdllwljh0dvglousp.jpg',
    'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/jxggwl3ltobv4l0o8sqq.jpg',
    'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/ikinna96rzqdle0ztcoy.jpg',
    'https://pub-9c5a2f0a7a2244be84e39a116c2dc4d5.r2.dev/wallpapers/gvwuacmn04nq1b25axs1.jpg',
  ],
};

const groupByScope = (rows) => {
  const grouped = {};
  for (const row of rows) {
    if (!row?.image_url) continue;
    const scope = row.scope || 'general';
    (grouped[scope] ||= []).push(row.image_url);
  }
  return grouped;
};

const WallpaperContext = createContext({
  wallpapersByScope: null,
  refresh: async () => {},
});

export const WallpaperProvider = ({ children }) => {
  // null = never resolved. {} = resolved, admin has none.
  const [byScope, setByScope] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchWallpapers();
      const rows = Array.isArray(data) ? data : data?.results || [];
      const grouped = groupByScope(rows);
      setByScope(grouped);
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(grouped)).catch(() => {});
    } catch {
      // Offline or server error — whatever is cached (or the bootstrap) stands.
      // Deliberately NOT treated as "no wallpapers": a flaky network must never
      // blank the app's background.
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        const cached = raw ? JSON.parse(raw) : null;
        if (alive && cached && typeof cached === 'object') setByScope(cached);
      } catch {
        // Ignore a corrupt cache entry; the fetch below settles it.
      }
      if (alive) refresh();
    })();
    return () => { alive = false; };
  }, [refresh]);

  const value = useMemo(() => ({ wallpapersByScope: byScope, refresh }), [byScope, refresh]);

  return <WallpaperContext.Provider value={value}>{children}</WallpaperContext.Provider>;
};

/**
 * Wallpapers for one surface. Returns [] once the server has confirmed the
 * admin curated none — callers render their plain background in that case.
 */
export const useWallpapers = (scope = 'general') => {
  const { wallpapersByScope, refresh } = useContext(WallpaperContext);
  const wallpapers = useMemo(() => {
    // Never reached the server on this device yet — bootstrap so a first cold
    // launch isn't a blank screen.
    if (wallpapersByScope === null) return BOOTSTRAP_WALLPAPERS[scope] || [];
    return wallpapersByScope[scope] || [];
  }, [wallpapersByScope, scope]);
  return { wallpapers, refresh };
};

export default WallpaperContext;
