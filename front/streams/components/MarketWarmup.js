// Gets the marketplace ready in the background, so opening it — even the
// first time today — shows what people are selling at once instead of a
// spinner: a few seconds after sign-in (out of the way of the start-up work),
// and again whenever the app comes back after a while. Draws nothing.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../context/useAuth';
import { useFeature } from '../context/AppStatusContext';
import { warmMarket } from '../utils/marketFeed';

const AFTER_START_MS = 4000;

export default function MarketWarmup() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  // Switched off: nothing to get ready, and no requests for it.
  const marketOn = useFeature('marketplace');

  useEffect(() => {
    if (!userId || !marketOn) return undefined;
    const timer = setTimeout(() => { warmMarket(); }, AFTER_START_MS);
    // Back from the background: warmMarket itself skips a copy that is fresh.
    const sub = AppState.addEventListener?.('change', (state) => {
      if (state === 'active') warmMarket();
    });
    return () => { clearTimeout(timer); sub?.remove?.(); };
  }, [userId, marketOn]);

  return null;
}
