// The admin session: opened with a code from an authenticator app (two-step
// sign-in), short-lived, sent with every request as X-Admin-Session (see
// services/api.js). Kept in the phone's secure store until it expires, so
// reopening the app within the session does not ask again.
//
// When the server asks for a code (the session ended, or a dangerous action
// wants a fresh one), `askForCode` is what the admin area registered to ask
// the person; the request is then sent again.
import * as SecureStore from '../services/secureStorage';

const KEY = 'adminSession';
let current = null;          // { token, expiresAt, me? } (me: the gate's last verdict)
let asker = null;            // (reason) => Promise<boolean>
let asking = null;           // one question at a time, however many requests wait

// What the admin area last showed (the gate's verdict, each list's first
// page), so a tab opens at once on the last copy while the server is asked
// again. In memory only, never on disk, and gone when the admin session ends.
const memo = new Map();
export const adminMemo = {
  get: (key) => memo.get(key),
  set: (key, value) => { memo.set(key, value); },
};

export const adminToken = () => {
  if (!current) return null;
  if (current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now()) {
    current = null;
    return null;
  }
  return current.token;
};

export const setAdminSession = async (token, expiresAt) => {
  current = token ? { token, expiresAt } : null;
  if (!current) memo.clear();
  try {
    if (current) await SecureStore.setItemAsync(KEY, JSON.stringify(current));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // The session still works for this run of the app.
  }
};

export const clearAdminSession = () => setAdminSession(null);

/** The server's last word on who this is as an admin, kept with the session
 *  in the secure store, so the admin area opens at once on the next visit
 *  (and is asked again behind it). Gone when the session goes. */
export const adminVerdict = () => (adminToken() ? current?.me || null : null);

export const rememberAdminVerdict = async (me) => {
  if (!current) return;
  current = { ...current, me };
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(current));
  } catch {
    // kept for this run of the app
  }
};

/** The session kept from before, if it has not expired. */
export const restoreAdminSession = async () => {
  if (current) return adminToken();
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) current = JSON.parse(raw);
  } catch {
    current = null;
  }
  return adminToken();
};

/** The admin area says how to ask for a code; null when it closes. */
export const setCodeAsker = (fn) => { asker = fn; };

/** Ask once for a code (`reason`: 'admin_session_required' | 'reauth_required').
 *  True when the person gave one the server accepted. */
export const askForCode = async (reason) => {
  if (!asker) return false;
  if (!asking) {
    asking = Promise.resolve(asker(reason)).catch(() => false).finally(() => { asking = null; });
  }
  return asking;
};
