// context/useAuth.js
//
// Shared auth state. Previously `useAuth` was a plain hook, so every component
// that called it spun up its own independent state and ran its own auth check —
// logging in or out in one place never propagated to the others. This now lives
// in a single <AuthProvider> near the root; `useAuth` just reads that context,
// so all existing `useAuth()` callers share one source of truth unchanged.

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import { API_URL, storeTokens, clearTokens } from '../services/api';
import { registerForPushNotifications, unregisterPushToken } from '../services/pushNotifications';

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

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const clearAuthData = async () => {
    await clearTokens();
    setCurrentUser(null);
    setIsAuthenticated(false);
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

      // Verify if the access token is still valid.
      try {
        const userData = await fetchUserProfile(accessToken);
        setCurrentUser(userData);
        setIsAuthenticated(true);
      } catch (error) {
        // If the access token is invalid, try to refresh it.
        if (error.response?.status === 401) {
          try {
            const response = await axios.post(`${API_URL}/auth/token/refresh/`, {
              refresh: refreshToken,
            });

            await storeTokens(response.data.access, refreshToken);
            const userData = await fetchUserProfile(response.data.access);
            setCurrentUser(userData);
            setIsAuthenticated(true);
          } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);
            await clearAuthData();
          }
        } else if (error.response?.status === 404) {
          // Valid token but no profile yet (e.g. signed up, profile not created).
          // Still authenticated — let them through to create their profile.
          setCurrentUser(null);
          setIsAuthenticated(true);
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

    // Valid tokens => authenticated, even if a profile hasn't been created yet.
    // A brand-new user has tokens but no profile and should reach CreateProfile.
    let hasProfile = false;
    try {
      const userData = await fetchUserProfile(access);
      setCurrentUser(userData);
      hasProfile = true;
    } catch {
      setCurrentUser(null);
    }
    setIsAuthenticated(true);

    // Register push token in the background — don't block login.
    registerForPushNotifications().catch(() => {});

    return { hasProfile };
  };

  const logout = async () => {
    await unregisterPushToken().catch(() => {});
    // Revoke the refresh token server-side (best-effort) before clearing.
    const refresh = await SecureStore.getItemAsync('refreshToken').catch(() => null);
    if (refresh) {
      await axios.post(`${API_URL}/auth/logout/`, { refresh }).catch(() => {});
    }
    await clearAuthData();
  };

  // Refresh the cached current user (e.g. after editing a profile).
  const updateUser = async () => {
    try {
      const token = await SecureStore.getItemAsync('accessToken');
      if (!token) return null;
      const userData = await fetchUserProfile(token);
      setCurrentUser(userData);
      setIsAuthenticated(true);
      return userData;
    } catch (error) {
      console.error('Error updating user data:', error);
      return null;
    }
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const value = useMemo(
    () => ({
      currentUser,
      isAuthenticated,
      isLoading,
      login,
      logout,
      updateUser,
      processProfilePicture,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUser, isAuthenticated, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return context;
};
