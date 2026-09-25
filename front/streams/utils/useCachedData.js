// "Paint the last copy at once, then refresh behind it" — the pattern Home and
// Music use — for a screen or a section that loads one thing.
//
// - Opened again this session: drawn on the first render (memory).
// - After a restart: drawn as soon as the phone's copy is read (up to a week
//   old — better than a spinner, and it's refreshed straight after).
// - Offline with nothing kept: `failed`, so the screen can offer Retry.
// - `setData` updates what's shown AND what's kept (a comment just posted
//   is still there next time, even offline).
import { useCallback, useEffect, useRef, useState } from 'react';
import { peekCache, readCache, writeCache } from './screenCache';

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export default function useCachedData(key, fetcher, { enabled = true } = {}) {
  const [data, setShown] = useState(() => (key ? peekCache(key) : null));
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const keyRef = useRef(key);
  keyRef.current = key;

  const load = useCallback(async () => {
    if (!enabled || !key) return;
    setFailed(false);
    let kept = peekCache(key);
    if (kept == null) {
      kept = await readCache(key, KEEP_MS);
      if (keyRef.current !== key) return;              // moved on meanwhile
      setShown(kept ?? null);
    }
    setRefreshing(true);
    try {
      const fresh = await fetchRef.current();
      if (keyRef.current !== key) return;
      setShown(fresh);
      writeCache(key, fresh);
    } catch {
      if (keyRef.current === key && kept == null) setFailed(true);
    } finally {
      if (keyRef.current === key) setRefreshing(false);
    }
  }, [key, enabled]);

  useEffect(() => {
    if (key) setShown(peekCache(key));                  // a different thing: its own copy
    load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const setData = useCallback((next) => {
    setShown((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      if (keyRef.current && value != null) writeCache(keyRef.current, value);
      return value;
    });
  }, []);

  return { data, setData, failed, refreshing, reload: load };
}
