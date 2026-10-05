// context/useAuth.js
//
// Shared auth state. Previously `useAuth` was a plain hook, so every component
// that called it spun up its own independent state and ran its own auth check —
// logging in or out in one place never propagated to the others. This now lives
// in a single <AuthProvider> near the root; `useAuth` just reads that context,
// so all existing `useAuth()` callers share one source of truth unchanged.

import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import * as SecureStore from '../services/secureStorage'; // web-safe shim (expo-secure-store stubs web)
import axios from 'axios';
import { API_URL, storeTokens, clearTokens } from '../services/api';
import { clearAllCaches } from '../utils/screenCache';
import { forgetKeptChapters } from '../services/publicationStore';
import { clearReadingQueue } from '../services/readingTracker';
import { clearBookHighlights } from '../services/bookHighlights';
import { registerForPushNotifications, forgetPushToken, ensurePushRegistered } from '../services/pushNotifications';
import { onOnlineChange } from '../hooks/useOnline';
import { getPreference, PREF_KEYS } from '../utils/preferences';
import { reportSignOut, flushPendingSignOuts } from '../services/signOut';
import { setTicketOwner } from '../services/tickets';
import { setOrganiserOwner } from '../services/ticketsOrganiser';

const AuthContext = createContext(null);

// Pure helpers — no component state, safe to keep at module scope.
const processProfilePicture = (picture, size = 200) => {
  if (!picture) return null;

  if (typeof picture === 'string') {
    if (picture.includes('cloudinary')) {
      return picture.replace('/upload/', `/upload/w_${size},h_${size},c_fill/`);
    }
    return picture;
  }

  if (picture?.secure_url) return picture.secure_url;
  if (picture?.url) return picture.url;

  return null;
};

const fetchUserProfile = async (token) => {
  const response = await axios.get(`${API_URL}/profiles/me/`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return {
    ...response.data,
    id: response.data.user_id,
    profile_picture: processProfilePicture(response.data.picture || response.data.picture_url),
    username: response.data.user?.username || response.data.username,
  };
};

// Lightweight status that works even before a profile exists — drives the
// authenticated / email-verified / has-profile routing decisions.
const fetchAuthStatus = async (token) => {
  const response = await axios.get(`${API_URL}/auth/status/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data; // { id, username, email, is_email_verified, has_profile }
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const clearAuthData = async () => {
    // All on the phone, all at once: nothing here waits on the network.
    // Screens paint their last cached payload on open. Those payloads are keyed
    // per account, but dropping them on the way out means a shared phone can't
    // flash the previous user's feed even for a frame.
    await Promise.all([
      clearTokens(),
      clearAllCaches(),
      forgetKeptChapters(),   // publications kept for offline (can be drafts)
      clearReadingQueue(),    // reading not yet sent is the leaving account's
      clearBookHighlights(),  // so are their highlights and notes in books
    ].map((p) => Promise.resolve(p).catch(() => {})));
    setTicketOwner(null);         // tickets are kept per account: the guest list now
    setOrganiserOwner(null);      // their organiser side too: kept for when they're back
    setCurrentUser(null);
    setIsAuthenticated(false);
    setIsEmailVerified(false);
  };

  // Apply an /auth/status/ payload: set flags and load the profile if present.
  const applyStatus = async (token, statusData) => {
    setTicketOwner(statusData.id);  // this account's tickets, nobody else's
    setOrganiserOwner(statusData.id); // and its organiser session
    setIsAuthenticated(true);
    setIsEmailVerified(!!statusData.is_email_verified);
    if (statusData.has_profile) {
      try {
        setCurrentUser(await fetchUserProfile(token));
      } catch {
        setCurrentUser(null);
      }
    } else {
      setCurrentUser(null);
    }
  };

  const checkAuthStatus = async () => {
    try {
      const accessToken = await SecureStore.getItemAsync('accessToken');
      const refreshToken = await SecureStore.getItemAsync('refreshToken');

      if (!accessToken || !refreshToken) {
        setIsAuthenticated(false);
        setCurrentUser(null);
        return;
      }

      // Verify the access token via the status endpoint (works without a profile).
      try {
        await applyStatus(accessToken, await fetchAuthStatus(accessToken));
      } catch (error) {
        // If the access token is invalid, try to refresh it.
        if (error.response?.status === 401) {
          try {
            const response = await axios.post(`${API_URL}/auth/token/refresh/`, {
              refresh: refreshToken,
            });
            // Persist the rotated refresh token (server blacklists the old one).
            await storeTokens(response.data.access, response.data.refresh || refreshToken);
            await applyStatus(response.data.access, await fetchAuthStatus(response.data.access));
          } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);
            await clearAuthData();
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('Auth check error:', error);
      await clearAuthData();
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (username, password) => {
    // Token step: a failure here means bad credentials — clear & propagate so the
    // login screen can show an error.
    let access, refresh;
    try {
      const response = await axios.post(`${API_URL}/auth/token/`, { username, password });
      ({ access, refresh } = response.data || {});
      if (!access || !refresh) {
        throw new Error('Invalid response from server - missing tokens');
      }
      await storeTokens(access, refresh);
    } catch (error) {
      console.error('Login failed:', error);
      await clearAuthData();
      throw error;
    }

    // Valid tokens => authenticated. Status tells us where to route the user
    // (verify email first, then create profile, then home).
    let status = { is_email_verified: false, has_profile: false };
    try {
      status = await fetchAuthStatus(access);
    } catch {
      // Couldn't load status — treat as authenticated-but-unverified/no-profile.
    }
    await applyStatus(access, status);

    // Register push token in the background — don't block login.
    registerForPushNotifications().catch(() => {});
    flushPendingSignOuts();

    return { isVerified: !!status.is_email_verified, hasProfile: !!status.has_profile };
  };

  // Signing out is instant: the phone forgets the account first, then the
  // server is told in the background (session revoked, this phone's
  // notifications off), retried on the next launch if it was offline.
  // A second tap while it runs waits on the first rather than starting over.
  const signingOut = useRef(null);
  const logout = () => {
    if (!signingOut.current) {
      signingOut.current = (async () => {
        const [refresh, deviceToken] = await Promise.all([
          SecureStore.getItemAsync('refreshToken').catch(() => null),
          forgetPushToken(),
        ]);
        await clearAuthData();
        reportSignOut({ refresh, deviceToken }).catch(() => {});
      })().finally(() => { signingOut.current = null; });
    }
    return signingOut.current;
  };

  // Refresh cached user + verification status (e.g. after editing a profile
  // or verifying email). Returns the latest { isVerified, hasProfile }.
  const updateUser = async () => {
    try {
      const token = await SecureStore.getItemAsync('accessToken');
      if (!token) return null;
      const status = await fetchAuthStatus(token);
      await applyStatus(token, status);
      return { isVerified: !!status.is_email_verified, hasProfile: !!status.has_profile };
    } catch (error) {
      console.error('Error updating user data:', error);
      return null;
    }
  };

  useEffect(() => {
    checkAuthStatus();
    flushPendingSignOuts();   // a sign-out that was offline last time
  }, []);

  // Signed in: make sure this phone gets notifications — on launch, and once
  // more whenever the network comes back after a failed try.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let registered = false;
    const attempt = async () => {
      if (registered) return;
      const pushEnabled = await getPreference(PREF_KEYS.pushEnabled).catch(() => undefined);
      registered = await ensurePushRegistered({ pushEnabled });
    };
    attempt();
    const off = onOnlineChange((online) => { if (online) attempt(); });
    return off;
  }, [isAuthenticated]);

  const value = useMemo(
    () => ({
      currentUser,
      isAuthenticated,
      isEmailVerified,
      isLoading,
      login,
      logout,
      updateUser,
      processProfilePicture,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUser, isAuthenticated, isEmailVerified, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// For providers that also run outside the app shell (their tests render them
// without an AuthProvider): null when there's no auth context.
export const useOptionalAuth = () => useContext(AuthContext);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return context;
};
