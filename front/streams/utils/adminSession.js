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
let current = null;          // { token, expiresAt }
let asker = null;            // (reason) => Promise<boolean>
let asking = null;           // one question at a time, however many requests wait

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
  try {
    if (current) await SecureStore.setItemAsync(KEY, JSON.stringify(current));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // The session still works for this run of the app.
  }
};

export const clearAdminSession = () => setAdminSession(null);

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
