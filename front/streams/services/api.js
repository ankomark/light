import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { extractYoutubeId } from '../utils/youtubeUtils';

const PROD_API_BASE = 'https://web-production-f266.up.railway.app';

// In development, talk to the Django dev server on this machine. The host IP is
// taken from Expo's packager URI (the same IP the device uses to reach Metro),
// so it works on a physical device or emulator without hardcoding a LAN IP.
// Override anytime by setting EXPO_PUBLIC_API_BASE (e.g. http://10.0.2.2:8000).
const resolveApiBase = () => {
  if (process.env.EXPO_PUBLIC_API_BASE) return process.env.EXPO_PUBLIC_API_BASE;
  if (__DEV__) {
    const hostUri =
      Constants.expoConfig?.hostUri ||
      Constants.expoGoConfig?.debuggerHost ||
      Constants.manifest2?.extra?.expoGo?.debuggerHost ||
      Constants.manifest?.debuggerHost ||
      '';
    const host = hostUri.split(':')[0];
    if (host) return `http://${host}:8000`;
  }
  return PROD_API_BASE;
};

export const API_BASE = resolveApiBase();

// Public, internet-reachable base for links we hand to OTHER people (e.g. share
// URLs / link previews). Unlike API_BASE this is NEVER the dev LAN IP — a shared
// link must open for anyone, so it always points at the deployed host.
export const PUBLIC_BASE = process.env.EXPO_PUBLIC_PUBLIC_BASE || PROD_API_BASE;

if (__DEV__) console.log('[api] Using API_BASE =', API_BASE, '| PUBLIC_BASE =', PUBLIC_BASE);
axios.defaults.timeout = 30000;
axios.defaults.headers.common['Content-Type'] = 'application/json';
export const API_URL = `${API_BASE}/api`;

// ── Secure token storage (uses iOS Keychain / Android Keystore) ───────────────
/** Use this anywhere you need the current access token instead of reading AsyncStorage directly. */
export const getAccessToken = () => SecureStore.getItemAsync('accessToken');
export const storeTokens = async (access, refresh) => {
  await Promise.all([
    SecureStore.setItemAsync('accessToken', access),
    SecureStore.setItemAsync('refreshToken', refresh),
  ]);
};

export const clearTokens = async () => {
  await Promise.all([
    SecureStore.deleteItemAsync('accessToken').catch(() => {}),
    SecureStore.deleteItemAsync('refreshToken').catch(() => {}),
  ]);
};

const getAuthToken = async () => {
  const token = await SecureStore.getItemAsync('accessToken');
  if (!token) {
    await clearTokens();
    throw new Error('No authentication token found');
  }
  return token;
};

// ── Mutex: one refresh at a time, all callers share the same promise ──────────
let _refreshPromise = null;

const refreshAuthToken = async () => {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync('refreshToken');
      if (!refreshToken) {
        await clearTokens();
        throw new Error('Session expired - please login again');
      }

      const response = await axios.post(
        `${API_URL}/auth/token/refresh/`,
        { refresh: refreshToken },
        { timeout: 10000 }
      );

      if (!response.data?.access) throw new Error('Invalid token refresh response');

      await storeTokens(response.data.access, refreshToken);
      return response.data.access;
    } catch (error) {
      await clearTokens();
      throw error;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
};


// Request interceptor for adding auth token
axios.interceptors.request.use(async (config) => {
  // if (config.url?.includes(API_URL)) {
    if (config.url?.startsWith(API_URL) && !config.url.includes(`${API_URL}/auth/`)) {
    try {
      const token = await getAuthToken();
      config.headers.Authorization = `Bearer ${token}`;
    } catch (error) {
      console.debug('No token for request', config.url);
      return Promise.reject(error);
    }
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Response interceptor for handling token refresh
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // If 401 and not a refresh request
    if (error.response?.status === 401 && 
        !originalRequest.url.includes('token/refresh') &&
        !originalRequest._retry) {
      
      originalRequest._retry = true;
      try {
        const newToken = await refreshAuthToken();
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return axios(originalRequest);
      } catch (refreshError) {
        await clearTokens();
        throw refreshError;
      }
    }
    return Promise.reject(error);
  }
);

// Enhanced apiRequest function
export const apiRequest = async (method, endpoint, data = null, options = {}) => {
  const url = `${API_URL}${endpoint}`;
  const requestId = `${method}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  try {
    const startTime = Date.now();
    const response = await axios({
      method,
      url,
      data,
      timeout: 60000,
      ...options,
      headers: {
        'X-Request-ID': requestId,
        'Content-Type': 'application/json',
        ...options.headers,
      }
    });
    
    const duration = Date.now() - startTime;
    return response.data;
    
  } catch (error) {
    const errorDetails = {
      requestId,
      method: method?.toUpperCase(),
      endpoint,
      url,
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
    };
    
    if (error.response) {
      // Server responded with error status
      console.error('[NETWORK] Server error response:', {
        ...errorDetails,
        status: error.response.status,
        data: error.response.data
      });
    } else if (error.request) {
      // Request was made but no response
      console.error('[NETWORK] No response received:', {
        ...errorDetails,
        diagnosis: diagnoseNetworkError(error, url)
      });
    } else {
      // Request setup error
      console.error('[NETWORK] Request setup error:', errorDetails);
    }
    
    // Enhanced error messages
    let errorMessage = error.message;
    if (error.message.includes('Network Error')) {
      errorMessage = `Network issue - ${diagnoseNetworkError(error, url)}`;
    } 
    else if (error.response?.status === 401) {
      errorMessage = 'Session expired - please login again';
    }
    else if (error.response?.data) {
      errorMessage = error.response.data.error || 
                    error.response.data.detail || 
                    JSON.stringify(error.response.data);
    }
    
    throw new Error(errorMessage);
  }
};


export const loginUser = async (username, password) => {
  try {
    const response = await axios.post(`${API_URL}/auth/token/`, { username, password });
    await storeTokens(response.data.access, response.data.refresh);
    return response.data;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};
export const logoutUser = async () => {
  await clearTokens();
};

// User endpoints
export const fetchProfile = async () => {
  return apiRequest('get', '/profiles/me/');
};

export const checkProfileExistence = async () => {
  return apiRequest('get', '/profiles/check_or_redirect/');
};

// Track endpoints
export const fetchTracks = async (page = 1, search = '') => {
  const params = { page, page_size: 20 };
  if (search) params.search = search;
  return apiRequest('get', '/tracks/', null, { params });
};

// Playlist endpoints (all scoped to the authenticated user on the backend).
export const fetchPlaylists = async () => {
  const data = await apiRequest('get', '/playlists/');
  return Array.isArray(data) ? data : data?.results ?? [];
};

export const fetchPlaylist = async (id) => {
  return apiRequest('get', `/playlists/${id}/`);
};

export const createPlaylist = async (name) => {
  return apiRequest('post', '/playlists/', { name });
};

export const deletePlaylist = async (id) => {
  return apiRequest('delete', `/playlists/${id}/`);
};

export const addTrackToPlaylist = async (id, trackId) => {
  return apiRequest('post', `/playlists/${id}/add-track/`, { track_id: trackId });
};

export const removeTrackFromPlaylist = async (id, trackId) => {
  return apiRequest('post', `/playlists/${id}/remove-track/`, { track_id: trackId });
};

export const createTrack = async (formData) => {
  return apiRequest('post', '/tracks/upload/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};
// api.js - Updated createSocialPost function
export const createSocialPost = async (postData) => {
  try {
    const response = await apiRequest('post', '/social-posts/', postData, {
      headers: { 'Content-Type': 'application/json' },
    });
    return response;
    
  } catch (error) {
    console.error('[ERROR] Post creation failed:', {
      error: error.response?.data || error.message,
      status: error.response?.status,
      config: error.config
    });
    
    // Enhanced error messages
    let errorMessage = error.response?.data?.error 
      || error.response?.data?.detail
      || error.message;
    
    if (error.response?.status === 401) {
      errorMessage = 'Session expired - please login again';
    } else if (error.message.includes('Network Error')) {
      errorMessage = 'Network issue - check your connection';
    }

    throw new Error(errorMessage);
  }
};

// Paginated social posts — returns { count, next, previous, results }
// Extract the opaque cursor token from a DRF next/previous URL.
export const cursorFromUrl = (url) => {
  if (!url) return null;
  const m = /[?&]cursor=([^&]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
};

// Cursor-paginated feed. Pass cursor=null for the first page, then the cursor
// from the previous response's `next` to page further. `fresh` bypasses the
// server's short-lived feed cache (used by pull-to-refresh / new-post checks).
export const fetchSocialPosts = async (cursor = null, feed = null, search = '', { fresh = false } = {}) => {
  const retry = async (attempt = 1) => {
    try {
      const response = await apiRequest('get', '/social-posts/', null, {
        params: {
          page_size: 20,
          ...(cursor ? { cursor } : {}),
          ...(feed ? { feed } : {}),
          ...(search ? { search } : {}),
          ...(fresh ? { fresh: 1 } : {}),
        },
      });
      // response is { next, previous, results } (cursor pagination omits count)
      if (!response?.results) throw new Error('Invalid response format from server');
      return response;
    } catch (error) {
      if (attempt <= 2 && error.response?.status >= 500) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        return retry(attempt + 1);
      }

      throw error;
    }
  };

  return retry();
};

// Social Post Endpoints
export const likePost = async (postId) => {
    return apiRequest('post', `/social-posts/${postId}/like/`);
  };
  
  export const commentOnPost = async (postId, content) => {
    return apiRequest('post', `/social-posts/${postId}/comment/`, { content });
  };
  
  export const savePost = async (postId) => {
    return apiRequest('post', `/social-posts/${postId}/save_post/`);
  };
  
  export const sharePost = async (postId) => {
    return apiRequest('get', `/social-posts/${postId}/share/`);
  };
  
  export const downloadPostMedia = async (postId) => {
    return apiRequest('get', `/social-posts/${postId}/download/`, null, {
      responseType: 'blob'
    });
  };
  
  
  export const toggleTrackLike = async (trackId) => {
    return apiRequest('post', `/tracks/${trackId}/toggle-like/`); // Change to hyphen
  };

  // Favorite == like in this app: a "favorite" is a track the user has liked,
  // so toggleTrackLike is the single source of truth. This returns the current
  // user's liked tracks for the Favorites screen (backend returns a plain array).
  export const getFavoriteTracks = async () => {
    const res = await apiRequest('get', '/tracks/favorites/');
    return res?.results ?? res ?? [];
  };

  // The current user's saved/bookmarked posts. Each save wraps the post; return
  // the posts themselves (already include media_items, is_saved, etc.).
  export const fetchSavedPosts = async () => {
    const res = await apiRequest('get', '/post-saves/');
    const list = Array.isArray(res) ? res : res?.results ?? [];
    return list.map((s) => s?.post).filter(Boolean);
  };

  // Comment Endpoints
  export const fetchPostComments = async (postId) => {
    const res = await apiRequest('get', `/social-posts/${postId}/comments/`);
    return res?.results ?? res;
  };

  export const fetchTrackComments = async (trackId) => {
    const res = await apiRequest('get', `/tracks/${trackId}/comments/`);
    return res?.results ?? res;
  };
  
  // Notification Endpoints
  export const fetchUnreadNotificationCount = async () => {
    return apiRequest('get', '/notifications/unread_count/');
  };
// Notification endpoints
export const fetchNotifications = async () => {
  const res = await apiRequest('get', '/notifications/');
  return res?.results ?? res;
};

export const markNotificationAsRead = async (notificationId) => {
  return apiRequest('post', `/notifications/${notificationId}/mark_as_read/`);
};
export const fetchSocialPostComments = async (postId) => {
  const res = await apiRequest('get', `/social-posts/${postId}/comments/`);
  return res?.results ?? res;
};

// nitaona
export const fetchComments = async (trackId) => {  // Renamed from fetchTrackComments
  const res = await apiRequest('get', `/tracks/${trackId}/comments/`);
  return res?.results ?? res;
};

export const postComment = async (trackId, content) => {
  return apiRequest('post', `/tracks/${trackId}/comments/`, { content });
};
// Add to api.js
export const fetchFollowersCount = async (userId) => {
  try {
    return await apiRequest('get', `/users/${userId}/followers_count/`);
  } catch (error) {
    if (error.response?.status === 404) {
      // Fallback to using the regular user endpoint
      const user = await apiRequest('get', `/users/${userId}/`);
      return { count: user.followers_count };
    }
    throw error;
  }
};

export const fetchFollowingCount = async (userId) => {
  return apiRequest('get', `/users/${userId}/following_count/`);
};

// Paginated list of users this user follows (each row includes is_following).
export const fetchFollowing = async (userId, page = 1) => {
  return apiRequest('get', `/users/${userId}/following/`, null, {
    params: { page, page_size: 30 },
  });
};

// Paginated list of users who follow this user (each row includes is_following).
export const fetchFollowers = async (userId, page = 1) => {
  return apiRequest('get', `/users/${userId}/followers/`, null, {
    params: { page, page_size: 30 },
  });
};

export const followUser = async (userId) => {
  return apiRequest('post', `/users/${userId}/follow/`);
};

// Public user profile: returns the user with nested profile (bio, location,
// picture_url), followers/following counts, is_following flag and social_posts.
export const fetchUserById = async (userId) => {
  return apiRequest('get', `/users/${userId}/`);
};

// Paginated list of a given user's social posts.
export const fetchUserPosts = async (userId, page = 1) => {
  return apiRequest('get', `/users/${userId}/social_posts/`, null, {
    params: { page, page_size: 18 },
  });
};

// A user's profile only (lighter than fetchUserById — no posts payload).
export const fetchProfileByUser = async (userId) => {
  return apiRequest('get', `/profiles/by_user/${userId}/`);
};
// Utility endpoints
export const checkAuthStatus = async () => {
  try {
    await getAuthToken();
    return true;
  } catch {
    return false;
  }
};
export const fetchHymns = async (params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  return apiRequest('get', `/hymns/?${queryString}`);
};

export const fetchHymnById = async (id) => {
  return apiRequest('get', `/hymns/${id}/`);
};

export const fetchSections = async () => {
  return apiRequest('get', '/sections/');
};

export const toggleFavorite = async (hymnId) => {
  return apiRequest('post', `/hymns/${hymnId}/toggle_favorite/`);
};

//church endpoints

export const fetchChurches = async (params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  const res = await apiRequest('get', `/churches/?${queryString}`);
  return res?.results ?? res;
};

export const fetchChurchById = async (id) => {
  return apiRequest('get', `/churches/${id}/`);
};

export const fetchMyChurches = async () => {
  return apiRequest('get', '/churches/my_churches/');
};

export const createChurch = async (formData) => {
  return apiRequest('post', '/churches/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

export const updateChurch = async (id, formData) => {
  return apiRequest('patch', `/churches/${id}/`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

export const deleteChurch = async (id) => {
  return apiRequest('delete', `/churches/${id}/`);
};

// ==================== MEDIA STATIONS ====================
// Shared, backend-owned. Each row carries `is_owner` so the UI can show
// edit/delete only to the creator. Logo is a base64 data URI (JSON).
export const fetchMediaStations = async (page = 1, type = 'All') => {
  const params = { page, page_size: 100 };
  if (type && type !== 'All') params.type = type;
  return apiRequest('get', '/media-stations/', null, { params });
};

export const createMediaStation = async (data) => {
  return apiRequest('post', '/media-stations/', data);
};

export const updateMediaStation = async (id, data) => {
  return apiRequest('patch', `/media-stations/${id}/`, data);
};

export const deleteMediaStation = async (id) => {
  return apiRequest('delete', `/media-stations/${id}/`);
};

// ==================== PUBLICATIONS (Articles / Books) ====================
// Long-form publications with nested chapters (markdown). Published items are
// public; drafts are visible only to their author. Author-only edit/delete.
export const fetchPublications = async (params = {}) => {
  return apiRequest('get', '/publications/', null, { params: { page_size: 50, ...params } });
};

export const fetchMyPublications = async () => {
  return apiRequest('get', '/publications/mine/', null, { params: { page_size: 50 } });
};

export const fetchPublication = async (id) => {
  return apiRequest('get', `/publications/${id}/`);
};

export const createPublication = async (data) => {
  return apiRequest('post', '/publications/', data);
};

export const updatePublication = async (id, data) => {
  return apiRequest('patch', `/publications/${id}/`, data);
};

export const deletePublication = async (id) => {
  return apiRequest('delete', `/publications/${id}/`);
};

// Publication engagement
export const togglePublicationLike = async (id) =>
  apiRequest('post', `/publications/${id}/like/`);

export const togglePublicationBookmark = async (id) =>
  apiRequest('post', `/publications/${id}/bookmark/`);

export const saveReadingProgress = async (id, chapter) =>
  apiRequest('post', `/publications/${id}/progress/`, { chapter });
// ==================== VIDEO STUDIOS ====================
export const fetchVideoStudios = async (params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  const res = await apiRequest('get', `/video-studios/?${queryString}`);
  return res?.results ?? res;
};

export const fetchVideoStudioById = async (id) => {
  return apiRequest('get', `/video-studios/${id}/`);
};

export const fetchMyVideoStudios = async () => {
  return apiRequest('get', '/video-studios/my_videostudios/');
};

// Video studios now use JSON (images are base64 data URIs), not multipart.
export const createVideoStudio = async (data) => {
  return apiRequest('post', '/video-studios/', data);
};

export const updateVideoStudio = async (id, data) => {
  return apiRequest('patch', `/video-studios/${id}/`, data);
};

export const deleteVideoStudio = async (id) => {
  return apiRequest('delete', `/video-studios/${id}/`);
};

// ==================== AUDIO STUDIOS ====================
export const fetchAudioStudios = async (params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  return apiRequest('get', `/audio-studios/?${queryString}`);
};

export const fetchAudioStudioById = async (id) => {
  return apiRequest('get', `/audio-studios/${id}/`);
};

export const fetchMyAudioStudios = async () => {
  return apiRequest('get', '/audio-studios/my_audiostudios/');
};

export const createAudioStudio = async (formData) => {
  return apiRequest('post', '/audio-studios/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

export const updateAudioStudio = async (id, formData) => {
  return apiRequest('patch', `/audio-studios/${id}/`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

export const deleteAudioStudio = async (id) => {
  return apiRequest('delete', `/audio-studios/${id}/`);
};

// ==================== CHOIRS ====================
export const fetchChoirs = async (params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  const res = await apiRequest('get', `/choirs/?${queryString}`);
  return res?.results ?? res;
};

export const fetchChoirById = async (id) => {
  return apiRequest('get', `/choirs/${id}/`);
};

export const fetchMyChoirs = async () => {
  return apiRequest('get', '/choirs/my_choirs/');
};

// Choirs now use JSON (images are base64 data URIs), not multipart.
export const createChoir = async (data) => {
  return apiRequest('post', '/choirs/', data);
};

export const updateChoir = async (id, data) => {
  return apiRequest('patch', `/choirs/${id}/`, data);
};

export const deleteChoir = async (id) => {
  return apiRequest('delete', `/choirs/${id}/`);
};

// ==================== SOLO ARTISTS ====================
export const fetchSoloArtists = async (params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  return apiRequest('get', `/solo-artists/?${queryString}`);
};

export const fetchSoloArtistById = async (id) => {
  return apiRequest('get', `/solo-artists/${id}/`);
};

export const fetchMySoloArtistProfile = async () => {
  return apiRequest('get', '/solo-artists/my_profile/');
};

export const createSoloArtist = async (formData) => {
  return apiRequest('post', '/solo-artists/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

export const updateSoloArtist = async (id, formData) => {
  return apiRequest('patch', `/solo-artists/${id}/`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

export const deleteSoloArtist = async (id) => {
  return apiRequest('delete', `/solo-artists/${id}/`);
};
// Toggle active status
export const toggleChoirActive = async (choirId) => {
  return apiRequest('post', `/choirs/${choirId}/toggle_active/`);
};

// Update members count
export const updateChoirMembers = async (choirId, count) => {
  return apiRequest('post', `/choirs/${choirId}/update_members/`, { count });
};
export const toggleSoloArtistActive = async (artistId) => {
  return apiRequest('post', `/solo-artists/${artistId}/toggle-active/`);
};

// Group endpoints
export const fetchGroups = async (retries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const data = await apiRequest('get', '/groups/');
      return data?.results ?? data;
    } catch (error) {
      if (attempt === retries) {
        console.error('Failed to fetch groups after retries:', error);
        throw error.response?.data || { message: 'Failed to fetch groups' };
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

export const fetchGroupDetails = async (slug) => {
  return apiRequest('get', `/groups/${slug}/`);
};

export const createGroup = async (formData) => {
  try {
   
    const token = await getAuthToken();
    
    const response = await axios.post(`${API_URL}/groups/`, formData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'multipart/form-data',
      },
      transformRequest: (data) => data, // Important for FormData
    });

    return response.data;
  } catch (error) {
    console.error('Group creation error:', error.response?.data || error.message);
    throw error.response?.data || { message: 'Failed to create group' };
  }
};

export const requestJoinGroup = async (slug, message = "") => {
  try {
    const formData = new FormData();
    formData.append('message', message);
    
    const token = await getAuthToken();
    const response = await axios.post(
      `${API_URL}/groups/${slug}/request-join/`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        transformRequest: (data) => data, // Important for FormData
      }
    );
    return response.data;
  } catch (error) {
    console.error('Join request error:', error.response?.data || error.message);
    throw error.response?.data || { message: 'Failed to send join request' };
  }
};



export const fetchGroupPosts = async (slug, page = 1) => {
  return apiRequest('get', `/groups/${slug}/posts/`, null, { params: { page, page_size: 30 } });
};

// Group chat: send a message (JSON, base64 attachments).
// payload: { content?, message_type?, attachment?, file_name?, duration?, reply_to_id? }
export const sendGroupMessage = async (slug, payload) =>
  apiRequest('post', `/groups/${slug}/posts/`, payload);

export const markGroupRead = async (slug) =>
  apiRequest('post', `/groups/${slug}/mark-read/`);

export const leaveGroup = async (slug) =>
  apiRequest('post', `/groups/${slug}/leave/`);


export const updateGroup = async (groupSlug, formData) => {
  return apiRequest('patch', `/groups/${groupSlug}/`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    transformRequest: (data) => data,
  });
};

export const deleteGroup = async (groupSlug) => {
  await apiRequest('delete', `/groups/${groupSlug}/`);
  return { success: true };
};

// ==================== NOTICE BOARD ====================
// Read by any signed-in user; only staff/admins can post (enforced server-side).
export const fetchNotices = async (page = 1) => {
  const res = await apiRequest('get', '/notices/', null, { params: { page, page_size: 100 } });
  return res?.results ?? res;
};

export const createNotice = async ({ title, body, is_pinned = false }) => {
  return apiRequest('post', '/notices/', { title, body, is_pinned });
};

export const deleteNotice = async (id) => {
  return apiRequest('delete', `/notices/${id}/`);
};
export const fetchGroupJoinRequests = async (slug) => {
  const res = await apiRequest('get', `/groups/${slug}/join-requests/`);
  return res?.results ?? res;
};

export const approveJoinRequest = async (requestId) => {
  return apiRequest('post', `/group-join-requests/${requestId}/approve/`);
};

export const rejectJoinRequest = async (requestId) => {
  return apiRequest('post', `/group-join-requests/${requestId}/reject/`);
};

export const fetchGroupMembers = async (slug) => {
  try {
    const response = await apiRequest('get', `/groups/${slug}/members/`);
    return response; // No need to transform, as backend provides correct structure
  } catch (error) {
    console.error('Failed to fetch members:', error);
    throw error;
  }
};

// ... other exports
export const createGroupPost = async (content, groupSlug, attachments = []) => {
  try {
    const formData = new FormData();
    formData.append('content', content || '');
    
    // Properly format attachments for FormData
    attachments.forEach((attachment) => {
      formData.append('attachments', {
        uri: attachment.uri,
        name: attachment.name || `file_${Date.now()}`,
        type: attachment.type || getMimeTypeFromUri(attachment.uri)
      });
    });

    const token = await getAuthToken();
    const response = await axios.post(
      `${API_URL}/groups/${groupSlug}/posts/`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        transformRequest: () => formData,
      }
    );

    // Validate and normalize the response
    if (!response.data?.id) {
      throw new Error('Invalid post creation response');
    }

    return {
      id: response.data.id,
      content: response.data.content || '',
      created_at: response.data.created_at || new Date().toISOString(),
      user: response.data.user || { username: 'You' }, // Fallback for immediate UI
      attachments: response.data.attachments || [],
      group: response.data.group || { slug: groupSlug }
    };
  } catch (error) {
    console.error('Post creation failed:', error);
    throw error.response?.data || { 
      message: 'Failed to create post',
      details: error.message 
    };
  }
};

export const checkGroupMembership = async (slug) => {
  try {
    const response = await apiRequest('get', `/groups/${slug}/check-membership/`);
    if (!response || typeof response.is_member === 'undefined') {
      throw new Error('Invalid membership check response');
    }
    return response;
  } catch (error) {
    console.error('Failed to check group membership:', error);
    // Return default response if endpoint not found (for backward compatibility)
    if (error.response?.status === 404) {
      return { is_member: false, is_admin: false };
    }
    throw error;
  }
};

// Helper to get mime type from URI
const getMimeTypeFromUri = (uri) => {
  const extension = uri.split('.').pop().toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'mp4':
      return 'video/mp4';
    case 'm4a':
      return 'audio/m4a';
    default:
      return 'application/octet-stream';
  }
};

const getFileExtension = (type) => {
  switch (type) {
    case 'image': return 'jpg';
    case 'video': return 'mp4';
    case 'audio': return 'm4a';
    default: return 'file';
  }
};


// Marketplace endpoints
export const fetchProductCategories = async () => {
  return apiRequest('get', '/marketplace/categories/');
};

export const fetchProducts = async (page = 1, extraParams = {}) => {
  try {
    const response = await apiRequest('get', '/marketplace/products/', null, {
      params: { page, page_size: 20, ...extraParams },
    });
    // response = { count, next, previous, results }
    const results = (response?.results ?? []).map(product => ({
      ...product,
      price: isNaN(parseFloat(product.price)) ? 0 : parseFloat(product.price),
      quantity: isNaN(parseInt(product.quantity)) ? 0 : parseInt(product.quantity),
      currency: product.currency || 'USD',
      is_owner: product.is_owner || false,
    }));
    return { ...response, results };
  } catch (error) {
    const msg = error.response?.data?.error
      ?? error.response?.data?.detail
      ?? 'Failed to load products';
    throw new Error(msg);
  }
};
export const fetchProductById = async (identifier) => {
  try {
    const token = await getAuthToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await axios.get(`${API_URL}/marketplace/products/${identifier}/`, { headers });
    const price = parseFloat(response.data.price);
    const quantity = parseInt(response.data.quantity);
    return {
      ...response.data,
      price: isNaN(price) ? 0 : price,
      quantity: isNaN(quantity) ? 0 : quantity,
      is_owner: response.data.is_owner || false,
    };
  } catch (error) {
    console.error(`API Error [get /marketplace/products/${identifier}/]:`, error);
    if (error.response?.status === 404) {
      throw new Error('Product not found');
    }
    throw new Error(error.response?.data?.detail || 'Failed to fetch product');
  }
};

export const addToCart = async (productId, quantity = 1) => {
  return apiRequest('post', '/marketplace/cart/add_item/', { 
    product_id: productId, 
    quantity 
  });
};

// services/api.js
// services/api.js
export const fetchCart = async () => {
  try {
    // Use the dedicated endpoint for current user's cart
    const response = await apiRequest('get', '/marketplace/cart/my_cart/');
    
    // Backend now returns a single cart object
    return {
      items: response.items || [],
      ...response
    };
  } catch (error) {
    console.error('Error fetching cart:', error);
    
    // Handle 404 by returning an empty cart
    if (error.response && error.response.status === 404) {
      return { items: [] };
    }
    
    return { items: [] };
  }
};

export const removeFromCart = async (itemId) => {
  try {
    // Use the correct endpoint format
    return await apiRequest('delete', `/marketplace/cart/items/${itemId}/`);
  } catch (error) {
    console.error('Error removing item from cart:', error);
    throw error;
  }
};

export const checkoutCart = async () => {
  return apiRequest('post', '/marketplace/cart/checkout/');
};

export const fetchOrders = async (params = {}) => {
  return apiRequest('get', '/marketplace/orders/', { params });
};

export const fetchOrderById = async (id) => {
  return apiRequest('get', `/marketplace/orders/${id}/`);
};

export const processPayment = async (paymentData) => {
  return apiRequest('post', '/marketplace/payments/', paymentData);
};

export const createProduct = async (formData) => {
  try {
    if (formData.price) formData.price = parseFloat(formData.price);
    if (formData.quantity) formData.quantity = parseInt(formData.quantity);
    const token = await getAuthToken();
    const response = await axios.post(`${API_URL}/marketplace/products/`, formData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'multipart/form-data',
      },
      timeout: 30000, // 30 seconds timeout
    });
    return response.data;
  } catch (error) {
    console.error('Product creation error:', error);
    if (error.response) {
      // The request was made and the server responded with a status code
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
      throw error.response.data;
    } else if (error.request) {
      // The request was made but no response was received
      console.error('Request:', error.request);
      throw new Error('No response received from server');
    } else {
      // Something happened in setting up the request
      console.error('Error message:', error.message);
      throw error;
    }
  }
};

export const updateProduct = async (slug, formData) => {
  return apiRequest('patch', `/marketplace/products/${slug}/`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};


export const deleteProduct = async (slug) => {
  return apiRequest('delete', `/marketplace/products/${slug}/`);
};

export const addProductReview = async (slug, rating, comment) => {
  return apiRequest('post', `/marketplace/products/${slug}/reviews/`, { 
    rating, 
    comment 
  });
};

export const fetchWishlist = async () => {
  return apiRequest('get', '/marketplace/wishlist/');
};

export const addToWishlist = async (slug) => {
  return apiRequest('post', '/marketplace/wishlist/add_product/', { 
    product_id: slug  // Update backend to accept slug or update to product_slug
  });
};

export const removeFromWishlist = async (slug) => {
  return apiRequest('post', '/marketplace/wishlist/remove_product/', { 
    product_id: slug  // Update backend to accept slug or update to product_slug
  });
};




// Enhanced liveevent endpoints with comprehensive debugging
// Utility function for consistent logging
const apiLog = (message, data = null, level = 'log') => {
  const logMessage = `[LiveEventsAPI] ${message}`;
  const logData = data ? JSON.stringify(data, null, 2) : '';
  
  switch(level) {
    case 'error':
      console.error(logMessage, logData);
      break;
    case 'warn':
      console.warn(logMessage, logData);
      break;
    default:
      console.log(logMessage, logData);
  }
};

// services/api.js
export const fetchLiveEvents = async (params = {}) => {
  // Normalize parameters
  const normalizedParams = {
    is_active: 'true', // Default to active events
    ...params,
    is_active: params.is_active !== undefined ? 
      String(params.is_active) : 'true'
  };

  try {
    const response = await apiRequest('get', '/live-events/', { params: normalizedParams });
    
    // Validate response structure
    if (!response.data?.results && !Array.isArray(response.data)) {
      throw new Error('Invalid API response structure');
    }

    // Transform data for consistency
    return (response.data.results || response.data).map(event => ({
      ...event,
      thumbnail: event.thumbnail || getDefaultThumbnail(event.youtube_url),
      is_live: event.is_live !== false, // Default to true if undefined
    }));
  } catch (error) {
    console.error('API Error:', error);
    return []; // Fail gracefully
  }
};

// Helper function
const getDefaultThumbnail = (url) => {
  const videoId = extractYoutubeId(url);
  return videoId ? 
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : 
    null;
};

export const createLiveEvent = async (data) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(2, 9);

  try {
    apiLog(`[${requestId}] Creating live event`, {
      inputData: {
        ...data,
        youtube_url: data.youtube_url // Log full URL for verification
      }
    });

    // Validate YouTube URL before sending
    const videoId = extractYoutubeId(data.youtube_url);
    apiLog(`[${requestId}] Extracted YouTube ID`, { videoId });

    if (!videoId) {
      throw new Error('Invalid YouTube URL format');
    }

    // Add default values for critical fields
    const payload = {
      ...data,
      is_live: true,
      viewers_count: 0,
      start_time: new Date().toISOString(),
      thumbnail: data.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      embed_url: data.embed_url || `https://www.youtube.com/embed/${videoId}`
    };

    apiLog(`[${requestId}] Final payload to server`, payload);

    const response = await apiRequest('post', '/live-events/', payload);
    const responseData = response.data || response;
    
    apiLog(`[${requestId}] Creation response`, {
      status: response.status,
      responseData: {
        ...responseData,
        // Truncate large fields for readability
        description: responseData.description ? 
          `${responseData.description.substring(0, 50)}...` : null
      }
    });

    if (!responseData?.id) {
      throw new Error('Server returned incomplete event data');
    }

    // Ensure all required fields are present
    const requiredFields = ['id', 'title', 'is_live', 'youtube_url'];
    const missingFields = requiredFields.filter(field => !responseData[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Return enhanced event data
    const enhancedEvent = {
      ...responseData,
      thumbnail: responseData.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      embed_url: responseData.embed_url || `https://www.youtube.com/embed/${videoId}`,
      is_live: responseData.is_live !== undefined ? responseData.is_live : true,
      viewers_count: responseData.viewers_count || 0,
      start_time: responseData.start_time || new Date().toISOString()
    };

    apiLog(`[${requestId}] Successfully created event`, {
      eventId: enhancedEvent.id,
      processingTime: `${Date.now() - startTime}ms`,
      finalEventData: enhancedEvent
    });

    return enhancedEvent;

  } catch (error) {
    let errorMessage = 'Failed to create event';
    
    if (error.response) {
      // Handle Django REST framework error format
      if (error.response.data?.detail) {
        errorMessage = error.response.data.detail;
      } 
      // Handle custom error format
      else if (error.response.data?.error) {
        errorMessage = error.response.data.error;
      }
      // Handle field-specific errors
      else if (error.response.data?.youtube_url) {
        errorMessage = Array.isArray(error.response.data.youtube_url)
          ? error.response.data.youtube_url.join('\n')
          : error.response.data.youtube_url;
      }
    } else {
      errorMessage = error.message || errorMessage;
    }

    apiLog(`[${requestId}] Error creating event`, {
      error: errorMessage,
      stack: error.stack,
      response: error.response?.data
    }, 'error');
    
    throw new Error(errorMessage);
  }
};

export const incrementViewerCount = async (eventId) => {
  const requestId = Math.random().toString(36).substring(2, 9);
  
  try {
    apiLog(`[${requestId}] Incrementing viewer count`, { eventId });

    const response = await apiRequest('post', `/live-events/${eventId}/increment_viewer/`);
    
    apiLog(`[${requestId}] Viewer count incremented`, {
      newCount: response.data?.viewers_count,
      eventId: eventId
    });
    
    return response;
  } catch (error) {
    apiLog(`[${requestId}] Failed to increment viewer count`, {
      eventId,
      error: {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      }
    }, 'error');
    throw error;
  }
};

export const fetchFeaturedContent = async () => {
  const requestId = Math.random().toString(36).substring(2, 9);
  
  try {
    apiLog(`[${requestId}] Fetching featured content`);

    const response = await apiRequest('get', '/featured-content/');
    
    apiLog(`[${requestId}] Received featured content`, {
      count: response.data?.length || 0
    });

    return response.data || [];
  } catch (error) {
    apiLog(`[${requestId}] Error fetching featured content`, {
      error: error.message,
      stack: error.stack
    }, 'error');
    return [];
  }
};

const cacheLiveEvents = async (events) => {
  const requestId = Math.random().toString(36).substring(2, 9);
  
  try {
    apiLog(`[${requestId}] Caching live events`, {
      eventCount: events.length,
      firstEventId: events[0]?.id
    });

    const cacheData = {
      timestamp: Date.now(),
      data: events.map(event => ({
        ...event,
        thumbnail: event.thumbnail || `https://img.youtube.com/vi/${extractYoutubeId(event.youtube_url)}/mqdefault.jpg`,
        is_live: event.is_live !== undefined ? event.is_live : true,
        viewers_count: event.viewers_count || 0
      }))
    };

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
    
    apiLog(`[${requestId}] Successfully cached events`, {
      cacheSize: JSON.stringify(cacheData).length
    });
  } catch (error) {
    apiLog(`[${requestId}] Error writing to cache`, {
      error: error.message,
      stack: error.stack
    }, 'error');
  }
};

// Enhanced debug utility
export const debugApiResponse = (response, context = 'API') => {
  const debugData = {
    status: response.status,
    data: response.data ? {
      ...response.data,
      _truncated: Object.keys(response.data).reduce((acc, key) => {
        if (typeof response.data[key] === 'string' && response.data[key].length > 100) {
          acc[key] = `${response.data[key].substring(0, 100)}...`;
        }
        return acc;
      }, {})
    } : null,
    headers: response.headers
  };

  apiLog(`Debug response for ${context}`, debugData);
  return response;
};

// ── Profile ───────────────────────────────────────────────────────────────────
export const updateProfile = (formData) =>
  apiRequest('patch', '/profiles/update_me/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

// ── Password reset ────────────────────────────────────────────────────────────
export const forgotPassword = (email) =>
  apiRequest('post', '/auth/forgot-password/', { email });

export const resetPassword = (email, code, new_password) =>
  apiRequest('post', '/auth/reset-password/', { email, code, new_password });

// ── Post insights + view tracking ────────────────────────────────────────────
export const markPostViewed = (postId) =>
  apiRequest('post', `/social-posts/${postId}/viewed/`);

export const fetchPostInsights = (postId) =>
  apiRequest('get', `/social-posts/${postId}/insights/`);

// ── Hashtag feed ──────────────────────────────────────────────────────────────
export const fetchHashtagPosts = (tag, page = 1) =>
  apiRequest('get', '/social-posts/', null, { params: { tag, page, page_size: 20 } });

export const fetchTrendingHashtags = () =>
  apiRequest('get', '/explore/trending_hashtags/');

// ── Stories ──────────────────────────────────────────────────────────────────
export const fetchStoryFeed = () => apiRequest('get', '/stories/feed/');
export const createStory = (data) => apiRequest('post', '/stories/', data);
export const deleteStory = (id) => apiRequest('delete', `/stories/${id}/`);
export const viewStory = (id) => apiRequest('post', `/stories/${id}/view_story/`);

// ── Reports ───────────────────────────────────────────────────────────────────
export const reportContent = (contentType, objectId, reason, description = '') =>
  apiRequest('post', '/reports/', { content_type: contentType, object_id: objectId, reason, description });

// ── Cloudinary signed upload ───────────────────────────────────────────────────
export const getCloudinarySignature = (type) =>
  apiRequest('post', '/upload/sign/', { type });

// ── Direct Messaging ──────────────────────────────────────────────────────────
export const fetchConversations = async () => {
  const res = await apiRequest('get', '/conversations/');
  return res?.results ?? res;
};

export const getOrCreateConversation = (userId) =>
  apiRequest('post', '/conversations/', { user_id: userId });

export const fetchMessages = (conversationId) =>
  apiRequest('get', `/conversations/${conversationId}/messages/`);

// payload: { content?, message_type?, attachment?, file_name?, duration? }
export const sendMessage = (conversationId, payload) =>
  apiRequest('post', `/conversations/${conversationId}/send_message/`,
    typeof payload === 'string' ? { content: payload } : payload);

export const markConversationRead = (conversationId) =>
  apiRequest('post', `/conversations/${conversationId}/mark_read/`);

export const fetchUnreadMessageCount = () =>
  apiRequest('get', '/conversations/unread_count/');

// Export all API functions
export default {
  API_URL,
  loginUser,
  logoutUser,
  fetchProfile,
  fetchTracks,
  createTrack,
  fetchSocialPosts,
  createSocialPost,
  fetchNotifications,
  markNotificationAsRead,
  checkAuthStatus,
  likePost,
  commentOnPost,
  savePost,
  sharePost,
  downloadPostMedia,
  toggleTrackLike,
  fetchPostComments,
  fetchTrackComments,
  fetchUnreadNotificationCount,
  fetchChurches,
  fetchChurchById,
  fetchMyChurches,
  createChurch,
  updateChurch,
  deleteChurch,
  fetchVideoStudios,
  fetchVideoStudioById,
  fetchMyVideoStudios,
  createVideoStudio,
  updateVideoStudio,
  deleteVideoStudio,
  fetchAudioStudios,
  fetchAudioStudioById,
  fetchMyAudioStudios,
  createAudioStudio,
  updateAudioStudio,
  deleteAudioStudio,
  fetchChoirs,
  fetchChoirById,
  fetchMyChoirs,
  createChoir,
  updateChoir,
  deleteChoir,
  fetchSoloArtists,
  fetchSoloArtistById,
  fetchMySoloArtistProfile,
  createSoloArtist,
  updateSoloArtist,
  deleteSoloArtist,
  fetchGroups,
  fetchGroupDetails,
  createGroup,
  requestJoinGroup,
  fetchGroupPosts,
  createGroupPost,
  fetchGroupJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  fetchGroupMembers,
  fetchNotices,
  createNotice,
  deleteNotice,
  fetchProductCategories,
  fetchProducts,
  fetchProductById,
  addToCart,
  fetchCart,
  checkoutCart,
  fetchOrders,
  fetchOrderById,
  addProductReview,
  addToWishlist,
  removeFromWishlist,
  fetchWishlist,
  removeFromCart,
  processPayment,
  createProduct,
  updateProduct,
  deleteProduct
};





































