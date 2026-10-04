/**
 * Telling the server about a sign-out, without making the person wait for it.
 *
 * The phone signs out at once: tokens and the account's data are gone
 * locally before any network call. Then one request (POST /auth/logout/)
 * retires the refresh token and switches off this phone's notifications for
 * the account. If it can't get through — offline, a dead network — it is kept
 * (in secure storage: it holds a refresh token) and sent again on the next
 * launch or sign-in, so an offline sign-out still ends the session and the
 * notifications in the end.
 *
 * Any answer from the server counts as done: a token it refuses is already
 * as good as revoked. Only "never reached it" is retried.
 */
import axios from 'axios';
import * as SecureStore from './secureStorage';
import { API_URL } from './api';

const PENDING_KEY = 'pendingSignOuts';
const TIMEOUT_MS = 10000;
const MAX_KEPT = 5;          // a phone signed out offline again and again

const readPending = async () => {
  try {
    const list = JSON.parse((await SecureStore.getItemAsync(PENDING_KEY)) || '[]');
    return Array.isArray(list) ? list.filter((p) => p && typeof p.refresh === 'string') : [];
  } catch {
    return [];
  }
};

const writePending = async (list) => {
  try {
    if (list.length) await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(list.slice(-MAX_KEPT)));
    else await SecureStore.deleteItemAsync(PENDING_KEY);
  } catch { /* best effort */ }
};

/** True when the server answered (whatever it said); false when it couldn't be reached. */
const send = async ({ refresh, deviceToken }) => {
  try {
    await axios.post(
      `${API_URL}/auth/logout/`,
      { refresh, ...(deviceToken ? { device_token: deviceToken } : {}) },
      { timeout: TIMEOUT_MS },
    );
    return true;
  } catch (err) {
    return !!err?.response;
  }
};

// One flush at a time: a launch and a sign-in together must not send twice.
let flushing = null;

/** Send every sign-out that couldn't get through before. Never throws. */
export const flushPendingSignOuts = () => {
  if (!flushing) {
    flushing = (async () => {
      const pending = await readPending();
      if (!pending.length) return;
      const left = [];
      for (const p of pending) {
        if (!(await send(p))) left.push(p);
      }
      await writePending(left);
    })().catch(() => {}).finally(() => { flushing = null; });
  }
  return flushing;
};

/**
 * Tell the server, in the background. Resolves when it is sent or kept for
 * later; callers need not wait for it.
 */
export const reportSignOut = async ({ refresh, deviceToken }) => {
  if (!refresh) return;
  if (await send({ refresh, deviceToken })) return;
  await writePending([...(await readPending()), { refresh, deviceToken: deviceToken || null }]);
};
