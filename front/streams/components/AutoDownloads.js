// Smart downloads: with "Download liked songs on Wi-Fi" on, the songs you
// like are saved to the phone by themselves whenever it is on Wi-Fi — so they
// play with no connection (a Sabbath away from signal) without saving each
// one by hand. Never on mobile data, one song at a time, a while after the
// app opens (it must not slow the start), newest likes first.
import { useEffect, useRef } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { useAuth } from '../context/useAuth';
import { PREF_KEYS } from '../utils/preferences';
import { getFavoriteTracks } from '../services/api';
import { downloadTrack, isDownloaded } from '../utils/downloads';
import { currentNetwork } from '../services/playReporter';
import { isOnline, onOnlineChange } from '../hooks/useOnline';

// How many liked songs are kept downloaded automatically (newest likes).
export const AUTO_DOWNLOAD_MAX = 50;
// Let the app finish opening (and the downloads index load) first.
const START_DELAY_MS = 15000;

/** Download the liked songs that aren't on the phone yet; stops as soon as
 *  the phone leaves Wi-Fi or `stopped()` says so. Resolves with the count. */
export async function downloadLiked({ quality = 'standard', stopped = () => false } = {}) {
  if (!isOnline() || currentNetwork() !== 'wifi') return 0;
  const liked = await getFavoriteTracks().catch(() => []);
  let saved = 0;
  for (const track of (Array.isArray(liked) ? liked : []).slice(0, AUTO_DOWNLOAD_MAX)) {
    if (stopped() || currentNetwork() !== 'wifi') break;
    if (!track?.audio_file || isDownloaded(track.id)) continue;
    try {
      await downloadTrack(track, { quality, wifiOnly: true, network: currentNetwork() });
      saved += 1;
    } catch {
      // that one later; carry on with the rest
    }
  }
  return saved;
}

export default function AutoDownloads() {
  const { preferences } = usePreferences();
  const { currentUser } = useAuth() || {};
  const on = !!preferences[PREF_KEYS.autoDownloadLiked];
  const quality = preferences[PREF_KEYS.downloadQuality] || 'standard';
  const running = useRef(false);

  useEffect(() => {
    if (!on || !currentUser?.id) return undefined;
    let stopped = false;
    const run = async () => {
      if (running.current || stopped) return;
      running.current = true;
      try { await downloadLiked({ quality, stopped: () => stopped }); } finally { running.current = false; }
    };
    const timer = setTimeout(run, START_DELAY_MS);
    // Back online (often: back on Wi-Fi) - try again.
    const off = onOnlineChange((up) => { if (up) run(); });
    return () => { stopped = true; clearTimeout(timer); off(); };
  }, [on, quality, currentUser?.id]);

  return null;
}
