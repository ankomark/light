/**
 * Is the phone online? One NetInfo subscription for the whole app, shared by
 * every screen that asks, so a dozen screens don't each open their own.
 *
 * `true` until NetInfo says otherwise: an unknown state is treated as online,
 * so nothing shows an offline banner on a phone that never reported. "Online"
 * means connected AND (where the OS knows) the internet is reachable — a
 * captive Wi-Fi portal counts as offline.
 */
import { useEffect, useState } from 'react';

let NetInfo = null;
try {
  NetInfo = require('@react-native-community/netinfo').default;
} catch { /* tests / web without it: always online */ }

let current = true;
const listeners = new Set();
let unsubscribe = null;

const toOnline = (state) => {
  if (!state) return true;
  if (state.isConnected === false) return false;
  if (state.isInternetReachable === false) return false;
  return true;
};

const start = () => {
  if (unsubscribe || !NetInfo?.addEventListener) return;
  try {
    unsubscribe = NetInfo.addEventListener((state) => {
      const next = toOnline(state);
      if (next === current) return;
      current = next;
      listeners.forEach((fn) => fn(next));
    });
  } catch { unsubscribe = null; }
};

/** The last known state, for code outside React. */
export const isOnline = () => current;

/**
 * Asks the OS now rather than trusting the last event — at launch no event has
 * arrived yet and `current` is still the optimistic `true`. Never waits more
 * than a moment: an unanswered question counts as the last known state.
 */
export const checkOnline = async (waitMs = 1500) => {
  if (!NetInfo?.fetch) return current;
  try {
    const state = await Promise.race([
      NetInfo.fetch(),
      new Promise((resolve) => { setTimeout(() => resolve(undefined), waitMs); }),
    ]);
    if (state === undefined) return current;
    start();
    return toOnline(state);
  } catch {
    return current;
  }
};

/** Call `fn(online)` on every change; returns the unsubscribe. */
export const onOnlineChange = (fn) => {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export default function useOnline() {
  const [online, setOnline] = useState(current);
  useEffect(() => {
    setOnline(current);
    return onOnlineChange(setOnline);
  }, []);
  return online;
}

/** Tests only. */
export const __setOnline = (value) => {
  current = value;
  listeners.forEach((fn) => fn(value));
};
