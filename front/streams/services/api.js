import axios from 'axios';
import '../utils/deviceHeaders'; // names this phone on every request
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from './secureStorage'; // web-safe shim (expo-secure-store stubs web)
import Constants from 'expo-constants';
import { extractYoutubeId } from '../utils/youtubeUtils';
import { parseSpectrum } from '../utils/spectrum';
import { adminToken, askForCode, clearAdminSession } from '../utils/adminSession';

const PROD_API_BASE = 'https://web-production-f266.up.railway.app';

// In development, talk to the Django dev server on this machine. The host IP is
// taken from Expo's packager URI (the same IP the device uses to reach Metro),
// so it works on a physical device or emulator without hardcoding a LAN IP.
// Override anytime by setting EXPO_PUBLIC_API_BASE (e.g. http://10.0.2.2:8000).
const resolveApiBase = () => {
  if (process.env.EXPO_PUBLIC_API_BASE) return process.env.EXPO_PUBLIC_API_BASE;
  if (__DEV__) {
    // Web dev: Constants.hostUri is empty in the browser, so derive the backend
    // host from the page URL (the dev server runs on the same machine).
    if (typeof window !== 'undefined' && window.location?.hostname) {
      // Use 127.0.0.1 rather than `localhost`: on Windows `localhost` resolves to
      // ::1 first, and the dev server (daphne/runserver) binds IPv4 only, so the
      // browser gets ECONNREFUSED and axios reports a bare "Network Error".
      const host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
      return `http://${host}:8000`;
    }
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
// The access token is mirrored in memory. Every outbound request runs through
// the interceptor below, and SecureStore.getItemAsync is a *native* call into
// the Keychain / Android Keystore — a few milliseconds each, on the bridge,
// serialized ahead of the request that needs it. A screen that opens five
// endpoints paid that five times before the first byte left the device.
//
// The process memory holding this is no more exposed than the request headers
// it is about to be written into; the Keystore remains the only thing that
// survives the process, which is the property that actually matters. The mirror
// is cleared on logout and on any refresh failure, so a stale token can't
// outlive the session it belongs to.
let _accessToken = null;

/** Use this anywhere you need the current access token instead of reading AsyncStorage directly. */
export const getAccessToken = async () => {
  if (_accessToken) return _accessToken;
  _accessToken = await SecureStore.getItemAsync('accessToken');
  return _accessToken;
};

export const storeTokens = async (access, refresh) => {
  _accessToken = access;
  await Promise.all([
    SecureStore.setItemAsync('accessToken', access),
    SecureStore.setItemAsync('refreshToken', refresh),
  ]);
};

export const clearTokens = async () => {
  _accessToken = null;
  await Promise.all([
    SecureStore.deleteItemAsync('accessToken').catch(() => {}),
    SecureStore.deleteItemAsync('refreshToken').catch(() => {}),
    // Signed out: the admin session goes with the sign-in.
    clearAdminSession().catch(() => {}),
  ]);
};

const getAuthToken = async () => {
  const token = await getAccessToken();
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

      // The server rotates refresh tokens (ROTATE_REFRESH_TOKENS) and blacklists
      // the old one, so we MUST persist the new refresh token it returns —
      // reusing the old one would make the next refresh fail and log the user out.
      await storeTokens(response.data.access, response.data.refresh || refreshToken);
      return response.data.access;
    } catch (error) {
      // Signed out only when the server turned the refresh token down (it
      // expired, or was revoked). No answer at all - a dropped connection,
      // a lift, a tunnel - is not a reason to sign anyone out.
      const status = error?.response?.status;
      if (status === 400 || status === 401 || status === 403 || error?.message?.startsWith('Session expired')) {
        await clearTokens();
      }
      throw error;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
};

/** A fresh access token (the realtime sockets, when theirs was turned away). */
export const refreshAccessToken = () => refreshAuthToken();


// Request interceptor for adding auth token
axios.interceptors.request.use(async (config) => {
  // if (config.url?.includes(API_URL)) {
    if (config.url?.startsWith(API_URL) && !config.url.includes(`${API_URL}/auth/`)) {
    try {
      const token = await getAuthToken();
      config.headers.Authorization = `Bearer ${token}`;
      // The two-step admin session, when there is one (admin tools need it).
      const admin = adminToken();
      if (admin) config.headers['X-Admin-Session'] = admin;
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

// Admin tools: the server asks for an authenticator code when the admin
// session has ended (admin_session_required) or a dangerous action wants a
// fresh one (reauth_required). The admin area asks the person, then the
// request goes again, once.
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (error.response?.status === 403 && error.response?.data?.code === 'suspended') {
      // Suspended: every write is refused (components/SuspendedNotice.js says so, once).
      require('../utils/appEvents').emit('account:suspended', error.response.data);
    }
    if (error.response?.status === 403 && error.response?.data?.code === 'feature_off') {
      // A part of the app switched off since the app last asked.
      require('../context/AppStatusContext').reportFeatureOff();
    }
    if (error.response?.status === 503 && error.response?.data?.code === 'maintenance') {
      // The app has gone down for maintenance since it last asked.
      require('../context/AppStatusContext').reportMaintenance(error.response.data.message);
    }
    const code = error.response?.status === 403 ? error.response?.data?.code : null;
    if ((code === 'admin_session_required' || code === 'reauth_required') && config && !config._adminRetry) {
      if (code === 'admin_session_required') await clearAdminSession();
      const ok = await askForCode(code);
      if (ok) {
        config._adminRetry = true;
        const admin = adminToken();
        if (admin) config.headers['X-Admin-Session'] = admin;
        return axios(config);
      }
    }
    return Promise.reject(error);
  },
);

// Best-effort, human-readable hint for a request that got no server response.
// (Was referenced in the error path but never defined — an actual network error
// then threw a ReferenceError and masked the real failure.)
const diagnoseNetworkError = (error, url) => {
  const msg = error?.message || '';
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(msg)) {
    return `The request to ${url} timed out — the server may be slow or unreachable.`;
  }
  if (/Network Error/i.test(msg)) {
    return `Couldn't reach ${url}. Check your internet connection.`;
  }
  return msg || `Request to ${url} failed with no response.`;
};

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
    
    // One readable line, in development only. These errors are thrown to the
    // caller, which handles them (a message, a retry, a fallback) — so this
    // is console.warn, not console.error: in a dev build every console.error
    // becomes a red full-screen box (with a meaningless stack) even for an
    // expected 404 or a refused request. Release builds log nothing here
    // (no response bodies in device logs).
    if (__DEV__) {
      if (error.response) {
        const body = error.response.data;
        const why = typeof body === 'string' ? body.slice(0, 120)
          : body?.detail || body?.error || (body ? JSON.stringify(body).slice(0, 160) : '');
        console.warn(`[NETWORK] ${errorDetails.method} ${endpoint} → ${error.response.status}${why ? ` — ${why}` : ''}`);
      } else if (error.request) {
        console.warn(`[NETWORK] ${errorDetails.method} ${endpoint} → no response (${diagnoseNetworkError(error, url)})`);
      } else {
        console.warn(`[NETWORK] ${errorDetails.method} ${endpoint} → not sent: ${error.message}`);
      }
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

    const enrichedError = new Error(errorMessage);
    // Preserve the structured axios error so callers can read
    // err.response.data.error / err.status, not just the flattened message.
    if (error.response) {
      enrichedError.response = error.response;
      enrichedError.status = error.response.status;
      enrichedError.data = error.response.data;
    }
    throw enrichedError;
  }
};


export const loginUser = async (username, password) => {
  try {
    const response = await axios.post(`${API_URL}/auth/token/`, { username, password });
    await storeTokens(response.data.access, response.data.refresh);
    return response.data;
  } catch (error) {
    console.warn('Login error:', error);
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
export const fetchTracks = async (page = 1, search = '', genre = '', pageSize = 20) => {
  const params = { page, page_size: pageSize };
  if (search) params.search = search;
  if (genre) params.genre = genre;
  return apiRequest('get', '/tracks/', null, { params });
};

// Songs matching a search, typos forgiven, best first (up to 50; no pages).
export const searchSongs = async (q) => {
  const data = await apiRequest('get', '/explore/search/', null, { params: { q, type: 'tracks' } });
  return { results: Array.isArray(data?.tracks) ? data.tracks : [], next: null };
};

// The Music home in one request (see the backend's MusicHomeView):
// { recent, for_you, trending, new_releases, following, top_country, top_world, genres }.
// Your year in music: { year, minutes, songs, top_songs, top_artists, top_genre, busiest }.
export const fetchMusicRecap = (year) => apiRequest('get', '/music/recap/', null, { params: year ? { year } : {} });

export const fetchMusicHome = (country = '') =>
  apiRequest('get', '/music/home/', null, { params: country ? { country } : {} });

// A whole chart ('trending' | 'top'); no country = worldwide.
export const fetchMusicChart = (chart, country = '') =>
  apiRequest('get', `/music/charts/${chart}/`, null, { params: country ? { country } : {} });

// Genres, for the upload picker: [{ id, slug, name, track_count }].
export const fetchGenres = async () => {
  const data = await apiRequest('get', '/categories/');
  return Array.isArray(data) ? data : data?.results ?? [];
};

// ── Lyrics, fetched on demand ────────────────────────────────────────────────
// The list payload carries `has_lyrics`, not the text: a page of 20 tracks was
// ~59 KB, almost all of it song lyrics nobody had asked to read. The text now
// arrives only for the track whose lyrics are actually opened.
//
// Cached in memory for the session and de-duplicated in flight, because two
// things open lyrics for the same song — the row's sheet and the Now Playing
// panel — and re-reading a song's words should never cost a second request.
const _lyricsCache = new Map();     // trackId -> string
const _lyricsInFlight = new Map();  // trackId -> Promise<string>

export const fetchTrackLyrics = async (trackId) => {
  if (trackId == null) return '';
  const key = String(trackId);
  if (_lyricsCache.has(key)) return _lyricsCache.get(key);
  if (_lyricsInFlight.has(key)) return _lyricsInFlight.get(key);

  const p = apiRequest('get', `/tracks/${trackId}/lyrics/`)
    .then((data) => {
      const text = data?.lyrics ?? '';
      _lyricsCache.set(key, text);
      return text;
    })
    .finally(() => { _lyricsInFlight.delete(key); });

  _lyricsInFlight.set(key, p);
  return p;
};

// What Now Playing needs about the song playing, fresh each time: likes,
// liked-by-me, comment count and the waveform (queued songs carry none).
export const fetchTrackState = (trackId) => apiRequest('get', `/tracks/${trackId}/state/`);

// A song's waveform (Now Playing's seek bar), fetched per song and kept for
// the session. `null` — not processed yet — isn't cached, so it's asked again
// next time the song plays.
const _waveformCache = new Map();
const _waveformInFlight = new Map();

export const fetchTrackWaveform = async (trackId) => {
  if (trackId == null) return null;
  const key = String(trackId);
  if (_waveformCache.has(key)) return _waveformCache.get(key);
  if (_waveformInFlight.has(key)) return _waveformInFlight.get(key);
  const p = apiRequest('get', `/tracks/${trackId}/waveform/`)
    .then((data) => {
      const peaks = Array.isArray(data?.waveform) && data.waveform.length ? data.waveform : null;
      if (peaks) _waveformCache.set(key, peaks);
      return peaks;
    })
    .finally(() => { _waveformInFlight.delete(key); });
  _waveformInFlight.set(key, p);
  return p;
};

// A song's spectrum visualizer file (a public, never-changing R2 file — the
// URL changes if the song does). Kept for the last few songs, so going back
// and forth in a queue doesn't download it again. Failures are just `null`:
// the visualizer is decoration.
const SPECTRUM_KEEP = 6;
const _spectrumCache = new Map();
const _spectrumInFlight = new Map();

export const fetchSpectrum = async (url) => {
  if (!url) return null;
  if (_spectrumCache.has(url)) {
    const hit = _spectrumCache.get(url);
    _spectrumCache.delete(url);           // most recent last
    _spectrumCache.set(url, hit);
    return hit;
  }
  if (_spectrumInFlight.has(url)) return _spectrumInFlight.get(url);
  // Plain fetch, not axios: no app headers or token interceptors on a public
  // file (on the web, extra headers would also cost a CORS preflight).
  const p = fetch(url)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const spec = parseSpectrum(data);
      if (spec) {
        _spectrumCache.set(url, spec);
        while (_spectrumCache.size > SPECTRUM_KEEP) _spectrumCache.delete(_spectrumCache.keys().next().value);
      }
      return spec;
    })
    .catch(() => null)
    .finally(() => { _spectrumInFlight.delete(url); });
  _spectrumInFlight.set(url, p);
  return p;
};

/** Drop a cached copy after the owner edits the track, so the sheet doesn't
 *  keep showing the words they just replaced. */
export const invalidateTrackLyrics = (trackId) => {
  _lyricsCache.delete(String(trackId));
};

// A capped random sample to seed a "shuffle whole library" queue in one request
// (lean payload; the player still streams one track at a time). Returns an array.
export const fetchShuffledTracks = async (limit = 200, search = '') => {
  const params = { limit };
  if (search) params.search = search;
  const data = await apiRequest('get', '/tracks/shuffle/', null, { params });
  return data?.results ?? (Array.isArray(data) ? data : []);
};

// Playlist endpoints (all scoped to the authenticated user on the backend).
export const fetchPlaylists = async () => {
  const data = await apiRequest('get', '/playlists/');
  return Array.isArray(data) ? data : data?.results ?? [];
};

export const fetchPlaylist = async (id) => {
  return apiRequest('get', `/playlists/${id}/`);
};

// `details`: { description, visibility ('private' | 'unlisted' | 'public') }.
export const createPlaylist = async (name, details = {}) => {
  return apiRequest('post', '/playlists/', { name, ...details });
};

// Owner only: { name, description, visibility, cover_image (URL or null) }.
export const updatePlaylist = async (id, changes) => {
  return apiRequest('patch', `/playlists/${id}/`, changes);
};

// The playlist's songs in their new order (exactly its songs, each once).
export const reorderPlaylist = async (id, trackIds) => {
  return apiRequest('post', `/playlists/${id}/reorder/`, { track_ids: trackIds });
};

// A profile's Playlists tab: their public playlists (all of yours on your own).
export const fetchUserPlaylists = async (userId) => {
  const data = await apiRequest('get', `/users/${userId}/playlists/`);
  return Array.isArray(data) ? data : [];
};

// ── Artists ──
// The artist part of a profile: { verified, monthly_listeners, top_tracks, albums }.
export const fetchArtist = (userId) => apiRequest('get', `/users/${userId}/artist/`);
// Artist Studio (your own numbers) for the last `days` (7 | 28 | 90).
export const fetchStudio = (days = 28) => apiRequest('get', '/studio/', null, { params: { days } });
// Albums: an artist's (yours when no id), one with its songs, and editing yours.
export const fetchAlbums = (artistId) =>
  apiRequest('get', '/albums/', null, { params: artistId ? { artist: artistId } : {} });
export const fetchAlbum = (id) => apiRequest('get', `/albums/${id}/`);
// An artist's library: all their albums, and every album song in order.
export const fetchArtistLibrary = (userId) => apiRequest('get', `/users/${userId}/library/`);
export const createAlbum = (data) => apiRequest('post', '/albums/', data);
export const updateAlbum = (id, changes) => apiRequest('patch', `/albums/${id}/`, changes);
export const deleteAlbum = (id) => apiRequest('delete', `/albums/${id}/`);
// Your removed songs: why, and where your dispute stands.
export const fetchRemovedSongs = () => apiRequest('get', '/studio/removed/');
// Dispute a removed song of yours (a counter-notice): why it's yours, in good faith.
export const disputeTrack = (id, message, goodFaith) =>
  apiRequest('post', `/tracks/${id}/dispute/`, { message, good_faith: goodFaith });
// The album's songs in order (your own songs; left-out ones come off it).
export const setAlbumTracks = (id, trackIds) => apiRequest('post', `/albums/${id}/set-tracks/`, { track_ids: trackIds });

// The Library screen in one request: { liked: {count, covers}, playlists, recent }.
export const fetchLibrary = () => apiRequest('get', '/library/');

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
    console.warn('[ERROR] Post creation failed:', {
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

// Follow a DRF pagination `next` link directly, re-issuing it as a feed request.
// Works for BOTH pagination styles — cursor (chronological) and page (ranked
// ?rank=1) — so infinite scroll doesn't care which the server returned.
export const fetchFeedByUrl = async (nextUrl) => {
  if (!nextUrl) return null;
  const params = {};
  (nextUrl.split('?')[1] || '').split('&').forEach((kv) => {
    if (!kv) return;
    const [k, v] = kv.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  });
  return apiRequest('get', '/social-posts/', null, { params });
};

// Cursor-paginated feed. Pass cursor=null for the first page, then the cursor
// from the previous response's `next` to page further. `fresh` bypasses the
// server's short-lived feed cache (used by pull-to-refresh / new-post checks).
export const fetchSocialPosts = async (cursor = null, feed = null, search = '', { fresh = false, contentType = null, rank = false } = {}) => {
  const retry = async (attempt = 1) => {
    try {
      const response = await apiRequest('get', '/social-posts/', null, {
        // A feed page is small: 20 s, not the default minute, so a dead
        // network falls back to the saved feed while the person still cares.
        timeout: FEED_TIMEOUT_MS,
        params: {
          page_size: 20,
          ...(cursor ? { cursor } : {}),
          ...(feed ? { feed } : {}),
          ...(search ? { search } : {}),
          ...(fresh ? { fresh: 1 } : {}),
          ...(contentType ? { content_type: contentType } : {}),
          ...(rank ? { rank: 1 } : {}),
        },
      });
      // response is { next, previous, results } (cursor pagination omits count)
      if (!response?.results) throw new Error('Invalid response format from server');
      return response;
    } catch (error) {
      // Server trouble: twice more. A dropped or timed-out connection (no
      // response at all — common on a moving phone): once more.
      const serverError = error.response?.status >= 500;
      const noResponse = !error.response;
      if ((serverError && attempt <= 2) || (noResponse && attempt <= 1)) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        return retry(attempt + 1);
      }

      throw error;
    }
  };

  return retry();
};
const FEED_TIMEOUT_MS = 20000;

// Social Post Endpoints
// A tap toggles. `{ liked: true }` sets it instead — a double-tap only ever
// likes, even when this copy of the post didn't know it was liked already.
export const likePost = async (postId, { liked } = {}) => {
    return apiRequest('post', `/social-posts/${postId}/like/`,
      typeof liked === 'boolean' ? { liked } : null);
  };
  
  // `parent` makes it a reply (to a top comment or to another reply).
  export const commentOnPost = async (postId, content, parent = null) => {
    return apiRequest('post', `/social-posts/${postId}/comment/`, { content, ...(parent ? { parent } : {}) });
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

// A comment's reply thread, oldest first: { results, next }.
export const fetchCommentReplies = (postId, commentId, page = 1) =>
  apiRequest('get', `/social-posts/${postId}/comments/${commentId}/replies/`, null, { params: { page } });

// One comment (used to find a notified reply's thread).
export const fetchPostComment = (commentId) => apiRequest('get', `/post-comments/${commentId}/`);

// Set / toggle a reaction (❤️ by default). → { reactions, mine }
export const reactToComment = (commentId, emoji) =>
  apiRequest('post', `/post-comments/${commentId}/react/`, emoji ? { emoji } : {});

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

// `follow` (true / false) asks for that state; left out, the server toggles.
// Always pass it where the screen knows what the person tapped for: a stale
// copy then can't turn "Follow" into an unfollow.
export const followUser = async (userId, follow) => apiRequest(
  'post', `/users/${userId}/follow/`, typeof follow === 'boolean' ? { follow } : null,
);

// ── Follow requests (private accounts) ───────────────────────────────────────
// Following a private account raises a pending request instead of following;
// only the target can approve or reject it.
export const fetchFollowRequests = async () =>
  apiRequest('get', '/follow-requests/');

export const approveFollowRequest = async (requestId) =>
  apiRequest('post', `/follow-requests/${requestId}/approve/`);

export const rejectFollowRequest = async (requestId) =>
  apiRequest('post', `/follow-requests/${requestId}/reject/`);

// ── Blocking ─────────────────────────────────────────────────────────────────
export const blockUser = async (userId) =>
  apiRequest('post', `/users/${userId}/block/`);

export const unblockUser = async (userId) =>
  apiRequest('post', `/users/${userId}/unblock/`);

export const fetchBlockedUsers = async () =>
  apiRequest('get', '/users/blocked/');

// Public user profile: returns the user with nested profile (bio, location,
// picture_url), followers/following counts, is_following flag and social_posts.
export const fetchUserById = async (userId) => {
  return apiRequest('get', `/users/${userId}/`);
};

// Resolve an @name from a caption to { id, username } (404 if unknown/blocked).
export const fetchUserByUsername = (username) =>
  apiRequest('get', '/users/by_username/', null, { params: { u: username } });

// Caption autocomplete.
export const fetchMentionSuggestions = (q) =>
  apiRequest('get', '/users/mention_suggest/', null, { params: { q } });
export const fetchHashtagSuggestions = (q) =>
  apiRequest('get', '/explore/hashtag_suggest/', null, { params: { q } });

// Tag page: the header ({ tag, posts_count }) and the posts under it.
export const fetchHashtagInfo = (tag) =>
  apiRequest('get', '/explore/hashtag/', null, { params: { tag } });
export const fetchPostsByTag = (tag, page = 1) =>
  apiRequest('get', '/social-posts/', null, { params: { tag, page } });

// Sounds people are putting on posts right now (falls back to most-liked).
export const fetchTrendingSounds = () => apiRequest('get', '/tracks/trending_sounds/');

// Paginated list of a given user's social posts.
// A profile's post grid, a page at a time (light tiles, newest first).
export const fetchUserPosts = async (userId, page = 1, pageSize = 30) => {
  return apiRequest('get', `/users/${userId}/social_posts/`, null, {
    params: { page, page_size: pageSize },
  });
};

// A profile's Music tab: the songs that account uploaded, 20 a page, as the
// same rows the library shows.
export const fetchUserTracks = async (userId, page = 1) => {
  return apiRequest('get', `/users/${userId}/tracks/`, null, { params: { page } });
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
  return apiRequest('get', '/publications/', null, { params: { page_size: 20, ...params } });
};

// Follow a paginated `next` link for infinite scroll. Preserves the URL's path
// (e.g. /publications/ vs /publications/mine/) and its query (filters + page).
export const fetchPublicationsByUrl = async (nextUrl) => {
  if (!nextUrl) return null;
  const [base, qs] = nextUrl.split('?');
  const path = base.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');
  const params = {};
  (qs || '').split('&').forEach((kv) => {
    if (!kv) return;
    const [k, v] = kv.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  });
  return apiRequest('get', path, null, { params });
};

export const fetchMyPublications = async () => {
  return apiRequest('get', '/publications/mine/', null, { params: { page_size: 50 } });
};

// `toc`: the book page — chapters without their bodies (a fraction of the
// bytes). Without it the bodies come too, which the editor needs.
export const fetchPublication = async (id, { toc = false } = {}) => {
  return apiRequest('get', `/publications/${id}/`, null, toc ? { params: { toc: 1 } } : undefined);
};

// One chapter by its place in the book (0-based): { index, count, chapter }.
export const fetchPublicationChapter = async (id, index) =>
  apiRequest('get', `/publications/${id}/chapters/${index}/`);

// Reading as it happened: [{ index, seconds, furthest, position, at }].
export const sendReadingActivity = async (id, events) =>
  apiRequest('post', `/publications/${id}/reading/`, { events });

// The author's kept copies of a chapter (newest first), or — with no
// chapter — the book's deleted chapters. { results: [...] }, no bodies.
export const fetchChapterRevisions = async (id, chapterId) =>
  apiRequest('get', `/publications/${id}/revisions/`, null,
    chapterId != null ? { params: { chapter: chapterId } } : undefined);

// Discover: { continue, picks, trending, following, new, rising }.
export const fetchBooksHome = async () => apiRequest('get', '/publications/home/');

// Reviews: { summary, mine, can_review, reason, results, next }.
export const fetchBookReviews = async (id, page = 1) =>
  apiRequest('get', `/publications/${id}/reviews/`, null, { params: { page } });
export const saveBookReview = async (id, { rating, body }) =>
  apiRequest('post', `/publications/${id}/reviews/`, { rating, body });
export const deleteMyBookReview = async (id) => apiRequest('delete', `/publications/${id}/reviews/`);

// A chapter's discussion: { locked, reached?, count, results }.
export const fetchChapterDiscussion = async (id, index, { reveal = false } = {}) =>
  apiRequest('get', `/publications/${id}/chapters/${index}/comments/`, null,
    reveal ? { params: { reveal: 1 } } : undefined);
export const postChapterComment = async (id, index, body, parent = null) =>
  apiRequest('post', `/publications/${id}/chapters/${index}/comments/`, { body, ...(parent ? { parent } : {}) });
export const deleteChapterComment = async (id, commentId) =>
  apiRequest('delete', `/publications/${id}/comments/${commentId}/`);

// ── Author Studio and book clubs ──
// How a book is read (totals): { readers, finished, completion, daily, funnel, … }.
export const fetchBookAnalytics = async (id, days = 30) =>
  apiRequest('get', `/publications/${id}/analytics/`, null, { params: { days } });
// All the author's books: { readers, reading_seconds, finished, followers, books, daily }.
export const fetchAuthorAnalytics = async (days = 30) =>
  apiRequest('get', '/publications/analytics/', null, { params: { days } });
export const fetchBookClubs = async (id) => apiRequest('get', `/publications/${id}/clubs/`);
export const createBookClub = async (id, spec) => apiRequest('post', `/publications/${id}/clubs/`, spec);
export const fetchBookClub = async (clubId) => apiRequest('get', `/publications/clubs/${clubId}/`);
export const fetchClubOfGroup = async (slug) => apiRequest('get', `/publications/clubs/by-group/${slug}/`);
// ── AI in books ──
// { enabled, used, limit } — whether to offer the AI tools.
export const fetchAiStatus = async () => apiRequest('get', '/publications/ai-status/');
// A reader's question: { kind: 'explain' | 'define' | 'summary', chapter, passage?, lang } → { text? , terms?, cached }.
export const askBookAi = async (id, spec) => apiRequest('post', `/publications/${id}/ai/`, spec);
// A writer's helper: { kind: 'improve' | 'shorten' | 'grammar' | 'structure', text?, lang } → { text }.
export const askWriterAi = async (id, spec) => apiRequest('post', `/publications/${id}/ai/write/`, spec);
// The manuscript check: { status, issues: [{ chapter, quote, problem, suggestion }] }.
export const startManuscriptCheck = async (id) => apiRequest('post', `/publications/${id}/ai/check/`);
export const fetchManuscriptCheck = async (id) => apiRequest('get', `/publications/${id}/ai/check/`);
// The reader's highlight collections: { results: [{ name, count }] }.
export const fetchHighlightCollections = async () => apiRequest('get', '/book-highlights/collections/');
// ── Organisations (conferences, schools, publishing houses…) ──
export const fetchOrganizations = async (params = {}) => apiRequest('get', '/organizations/', null, { params });
export const createOrganization = async (data) => apiRequest('post', '/organizations/', data);
export const fetchOrganization = async (slug) => apiRequest('get', `/organizations/${slug}/`);
export const updateOrganization = async (slug, data) => apiRequest('patch', `/organizations/${slug}/`, data);
export const deleteOrganization = async (slug) => apiRequest('delete', `/organizations/${slug}/`);
export const followOrganization = async (slug, on) => apiRequest(on ? 'post' : 'delete', `/organizations/${slug}/follow/`);
export const fetchOrgMembers = async (slug) => apiRequest('get', `/organizations/${slug}/members/`);
export const inviteOrgMember = async (slug, username, role) =>
  apiRequest('post', `/organizations/${slug}/members/`, { username, role });
export const setOrgMemberRole = async (slug, id, role) =>
  apiRequest('patch', `/organizations/${slug}/members/${id}/`, { role });
export const removeOrgMember = async (slug, id) => apiRequest('delete', `/organizations/${slug}/members/${id}/`);
export const respondOrgInvite = async (slug, accept) => apiRequest('post', `/organizations/${slug}/respond/`, { accept });
export const fetchOrgInvitations = async () => apiRequest('get', '/organizations/invitations/');
// A book (or a passage from it) posted to the social feed: { caption?, quote?, chapter_id?, block? } → the post.
export const shareBookToFeed = async (id, spec = {}) => apiRequest('post', `/publications/${id}/share-to-feed/`, spec);

// ── Writer Studio ──
// Who works on a book: { results: [{ id, user, role, accepted }], my_role }.
export const fetchCollaborators = async (id) => apiRequest('get', `/publications/${id}/collaborators/`);
export const inviteCollaborator = async (id, username, role) =>
  apiRequest('post', `/publications/${id}/collaborators/`, { username, role });
export const setCollaboratorRole = async (id, cid, role) =>
  apiRequest('patch', `/publications/${id}/collaborators/${cid}/`, { role });
export const removeCollaborator = async (id, cid) => apiRequest('delete', `/publications/${id}/collaborators/${cid}/`);
// Books you've been invited to work on: { results: [...] }.
export const fetchBookInvitations = async () => apiRequest('get', '/publications/invitations/');
export const answerBookInvitation = async (cid, accept) =>
  apiRequest('post', `/publications/invitations/${cid}/${accept ? 'accept' : 'decline'}/`);
// EPUB: POST makes one (the worker), GET → { status, url }.
export const requestBookExport = async (id) => apiRequest('post', `/publications/${id}/export/`);
export const fetchBookExport = async (id) => apiRequest('get', `/publications/${id}/export/`);
// A cover from a template → { url }.
export const renderBookCover = async (spec) => apiRequest('post', '/publications/cover-render/', spec);

// An author's page: { author, followers_count, is_following, readers_count, finished_count, books }.
export const fetchAuthorPage = async (userId) => apiRequest('get', `/publications/authors/${userId}/`);

// The reader's own numbers: streak, this week / month, last 7 days.
// `today` is the phone's date (YYYY-MM-DD) — the server's day is UTC.
export const fetchReadingStats = async (today) =>
  apiRequest('get', '/publications/reading-stats/', null, { params: { today } });

// Highlights and notes in books: one book's ({ publication }), everything
// (the library, paged), or what changed ({ since }).
export const fetchBookHighlights = async (params = {}) =>
  apiRequest('get', '/book-highlights/', null, { params });

// The phone's highlight changes: [{ op: 'upsert' | 'delete', client_id, ... }].
export const syncBookHighlights = async (ops) =>
  apiRequest('post', '/book-highlights/sync/', { ops });

// One kept copy with its text, and what's changed since.
export const fetchChapterRevision = async (id, revisionId) =>
  apiRequest('get', `/publications/${id}/revisions/${revisionId}/`);

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

// Services, a page at a time: { results, next } — search / category / tags on the server.
export const fetchServicesPage = async (params = {}) => apiRequest('get', '/video-studios/', null, { params });
// The next page (the server's own link carries the filters).
export const fetchServicesByUrl = async (nextUrl) => fetchPublicationsByUrl(nextUrl);

// The Services home: { counts: {category: n}, featured, verified, new }.
export const fetchServicesHome = async () => apiRequest('get', '/video-studios/home/');
// A service's link to share (a rich card that opens it in the app).
export const serviceShareUrl = (id) => `${PUBLIC_BASE}/service/${id}/`;

// A service's reviews: { summary, mine, can_review, is_owner, results, next }.
export const fetchServiceReviews = async (id, page = 1) => apiRequest('get', `/video-studios/${id}/reviews/`, null, { params: { page } });
export const saveServiceReview = async (id, { rating, body }) => apiRequest('post', `/video-studios/${id}/reviews/`, { rating, body });
export const deleteMyServiceReview = async (id) => apiRequest('delete', `/video-studios/${id}/reviews/`);
// The owner's public answer to a review.
export const replyToServiceReview = async (id, rid, reply) => apiRequest('post', `/video-studios/${id}/reviews/${rid}/reply/`, { reply });
export const deleteServiceReply = async (id, rid) => apiRequest('delete', `/video-studios/${id}/reviews/${rid}/reply/`);
// Asking for the verified tick: { status: null | 'pending' | 'approved' | 'rejected', decision_note }.
export const fetchServiceVerification = async (id) => apiRequest('get', `/video-studios/${id}/verification/`);
export const requestServiceVerification = async (id, data) => apiRequest('post', `/video-studios/${id}/verification/`, data);

// Keep a service to come back to (on / off) → { is_saved }.
export const saveService = async (id, on) => apiRequest(on ? 'post' : 'delete', `/video-studios/${id}/save/`);
// How a service is found and reached (its owner's numbers): view | call | whatsapp | message | directions | share.
export const recordServiceEvent = async (id, kind) => apiRequest('post', `/video-studios/${id}/events/`, { kind });
// The owner's numbers over 7 / 30 / 90 days.
export const fetchServiceInsights = async (id, days = 30) => apiRequest('get', `/video-studios/${id}/insights/`, null, { params: { days } });
// Bookings and quotes: { kind: 'booking' | 'quote', date?, time?, note }.
export const requestServiceBooking = async (id, spec) => apiRequest('post', `/video-studios/${id}/bookings/`, spec);
// ?role=mine (what you asked for) | incoming (asked of your services).
export const fetchServiceBookings = async (role = 'mine') => apiRequest('get', '/video-studios/bookings/', null, { params: { role } });
export const respondServiceBooking = async (bid, accept, note = '') =>
  apiRequest('post', `/video-studios/bookings/${bid}/respond/`, { accept, note });
export const cancelServiceBooking = async (bid) => apiRequest('post', `/video-studios/bookings/${bid}/cancel/`);

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

// ==================== COMMUNITIES ====================
// One community engine for every kind — church, choir, news, or anything a user
// invents. The kind is a category row (see fetchCommunityCategories), and each
// category declares the extra fields its communities carry, so this API needs no
// per-kind endpoints. `/communities/` and `/groups/` are the same resource.

export const fetchCommunityCategories = async () =>
  apiRequest('get', '/community-categories/');

export const createCommunityCategory = async (data) =>
  apiRequest('post', '/community-categories/', data);

export const deleteCommunityCategory = async (slug) =>
  apiRequest('delete', `/community-categories/${slug}/`);

// `filters` carries the category-specific keys (e.g. { conference: 'Central' })
// alongside category/search — exactly the directory browse Churches.js had.
export const fetchCommunities = async ({ category, search, parent, page = 1, ...filters } = {}) => {
  const params = new URLSearchParams({ page: String(page), page_size: '20' });
  if (category && category !== 'all') params.set('category', category);
  if (search) params.set('search', search);
  if (parent) params.set('parent', parent);
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  });
  return apiRequest('get', `/communities/?${params.toString()}`);
};

export const fetchCommunitiesByUrl = async (nextUrl) => {
  if (!nextUrl) return null;
  const path = nextUrl.replace(API_URL, '');
  return apiRequest('get', path);
};

// ==================== DAILY BIBLE QUIZ ====================
// Twenty questions a day, generated server-side from the local KJV corpus and
// shared by everyone, so the leaderboard compares like with like. The answers
// are not in the payload — they come back only after you submit.

// `lang`: 'en' | 'sw' — the quiz is built from that language's Bible (the
// server falls back to English when the Swahili one is not imported).
// `play`: opened on the quiz screen to play (not the hub preloading it) —
// the server starts the clock the speed bonus is held to.
export const fetchDailyQuiz = async (day, lang, { play } = {}) => {
  const q = [day && `date=${day}`, lang && `lang=${lang}`, play && 'play=1'].filter(Boolean);
  return apiRequest('get', `/quiz/today/${q.length ? `?${q.join('&')}` : ''}`);
};

// `date`: the day of the quiz played (one opened before midnight can still be
// handed in just after). `shuffled`: the answers are in the order this
// person was shown the choices — false only for a copy kept from before.
export const submitDailyQuiz = async (answers, durationSeconds, lang, { date, shuffled } = {}) =>
  apiRequest('post', '/quiz/submit/', {
    answers,
    duration_seconds: durationSeconds,
    ...(lang ? { language: lang } : {}),
    ...(date ? { date } : {}),
    shuffled: shuffled === true,
  });

// "This question is wrong": reason is wrong_answer | unclear | typo | other.
export const reportQuizQuestion = async (questionId, reason, note = '') =>
  apiRequest('post', '/quiz/report/', { question_id: questionId, reason, note });

// The story journey: { featured: [...], journey: [...] } with stars and locks.
export const fetchQuizStories = async (lang) => apiRequest('get', `/quiz/stories/${lang ? `?lang=${lang}` : ''}`);

// Forty practice questions with their answers, for playing with no connection.
export const fetchOfflinePack = async (lang) => apiRequest('get', `/quiz/offline-pack/${lang ? `?lang=${lang}` : ''}`);

// period: 'today' (default) | 'week' | 'all';
// scope: 'everyone' | 'following' | 'group:<slug>' (a group you belong to).
export const fetchQuizLeaderboard = async (day, { period, scope } = {}) => {
  const q = [
    day && `date=${encodeURIComponent(day)}`,
    period && period !== 'today' && `period=${encodeURIComponent(period)}`,
    scope && scope !== 'everyone' && `scope=${encodeURIComponent(scope)}`,
  ].filter(Boolean);
  return apiRequest('get', `/quiz/leaderboard/${q.length ? `?${q.join('&')}` : ''}`);
};

export const fetchQuizHistory = async () => apiRequest('get', '/quiz/my-history/');

// Lifetime progress: coins from the daily quiz and practice combined, plus the
// level they add up to, with the bar fraction already worked out.
export const fetchQuizStats = async () => apiRequest('get', '/quiz/stats/');

// "Why?" — an answered question's answer explained (level: why|simple|children).
export const askQuizWhy = async (questionId, level = 'why', lang = 'en') =>
  apiRequest('post', '/quiz/why/', { question_id: questionId, level, language: lang });

// The progress screen: history, calendar, badges, strengths, freeze offer.
export const fetchQuizProgress = async () => apiRequest('get', '/quiz/progress/');

// Buy back yesterday: spends coins, restores the day streak.
export const buyStreakFreeze = async () => apiRequest('post', '/quiz/freeze/', {});

// ── Practice modes (Speed Quiz, Streak) ──────────────────────────────────────
// Personal runs, answered one question at a time: Streak has to know the moment
// you are wrong, and Speed times each question separately. The server holds the
// rules — the clock here drives the UI, it does not decide the score.

// mode: 'speed' | 'streak' | 'review' | 'section' (with `category`) |
// 'duel' (with `of`: the Speed run it answers).
export const startQuizSession = async (mode, lang, { category, of, story } = {}) =>
  apiRequest('post', '/quiz-sessions/', {
    mode, ...(lang ? { language: lang } : {}), ...(category ? { category } : {}), ...(of ? { of } : {}),
    ...(story ? { story } : {}),
  });

// ── Live Bible Battle ──────────────────────────────────────────────────────
// Every call answers with the battle's state (see songs/battle.py → state).
export const createBattle = async ({ title, seconds, language } = {}) =>
  apiRequest('post', '/quiz-battles/', { title, seconds, language });
export const joinBattle = async (code) => apiRequest('post', '/quiz-battles/join/', { code });
export const fetchBattle = async (code) => apiRequest('get', `/quiz-battles/${code}/`);
export const startBattle = async (code) => apiRequest('post', `/quiz-battles/${code}/start/`, {});
export const answerBattle = async (code, index, choice) =>
  apiRequest('post', `/quiz-battles/${code}/answer/`, { index, choice });
export const revealBattle = async (code, index) =>
  apiRequest('post', `/quiz-battles/${code}/reveal/`, { index });
export const nextBattle = async (code, index) =>
  apiRequest('post', `/quiz-battles/${code}/next/`, { index });

// A duel side by side: { me, them, verdict }, each with score, points, marks.
export const fetchQuizDuel = async (id) => apiRequest('get', `/quiz-sessions/${id}/duel/`);

export const fetchQuizSession = async (id) =>
  apiRequest('get', `/quiz-sessions/${id}/`);

// `brief`: only the new totals come back (the app already holds the run).
export const answerQuizSession = async (id, questionId, choice, seconds, { brief } = {}) =>
  apiRequest('post', `/quiz-sessions/${id}/answer/`, {
    question_id: questionId,
    choice,
    seconds,
    ...(brief ? { brief: true } : {}),
  });

// 50/50 on a practice question: → { removed: [i, j], cost, balance }.
export const buyQuizHint = async (id, questionId) =>
  apiRequest('post', `/quiz-sessions/${id}/hint/`, { question_id: questionId });

export const finishQuizSession = async (id) =>
  apiRequest('post', `/quiz-sessions/${id}/finish/`, {});

export const fetchQuizBests = async () => apiRequest('get', '/quiz-sessions/best/');

// ── Word puzzle ──────────────────────────────────────────────────────────────
// Levels are built from the local scripture corpus and shared by everyone. The
// grid comes down without the answers: a word is claimed by sending the two
// ends of the drag, and the server reads its own grid to decide.

const langQuery = (lang, sep = '?') => (lang && lang !== 'en' ? `${sep}lang=${lang}` : '');

export const fetchPuzzleLevel = async (theme, level = 1, lang) =>
  apiRequest('get', `/puzzles/level/?theme=${encodeURIComponent(theme)}&level=${level}${langQuery(lang, '&')}`);

// The level to play now, chosen by the server. Takes no theme on purpose:
// which subject comes next is not the client's decision.
export const fetchNextPuzzle = async (lang) => apiRequest('get', `/puzzles/next/${langQuery(lang)}`);

// Today's Daily Puzzle, the same board for everyone. Opening it starts the clock.
export const fetchDailyPuzzle = async (lang) => apiRequest('get', `/puzzles/daily/${langQuery(lang)}`);

// One board by its id — what a friend's challenge link opens. `from` names
// the friend who sent it: they will hear how it went.
export const fetchPuzzle = async (id, { from } = {}) =>
  apiRequest('get', `/puzzles/${id}/${from ? `?from=${encodeURIComponent(from)}` : ''}`);

// A challenge side by side: { me, them, verdict: won | lost | tied | waiting }.
export const fetchPuzzleVersus = async (id, username) =>
  apiRequest('get', `/puzzles/${id}/versus/?user=${encodeURIComponent(username)}`);

// Today's Daily Puzzle leaderboard: scope everyone | following | group:<slug>.
export const fetchPuzzleDailyBoard = async (scope = 'everyone') =>
  apiRequest('get', `/puzzles/daily/leaderboard/${scope && scope !== 'everyone' ? `?scope=${encodeURIComponent(scope)}` : ''}`);

// What a word found on this board means: { word, meaning, source, reference, verse }.
// `language` is the language to explain it in.
export const fetchPuzzleMeaning = async (id, word, language = 'en') =>
  apiRequest('post', `/puzzles/${id}/meaning/`, { word, language });

// The themes, with how far this player has got in each and the stars won.
export const fetchPuzzleThemes = async (lang) => apiRequest('get', `/puzzle-themes/${langQuery(lang)}`);

// One theme's levels map: { theme, levels: [{ level, stars, is_complete }], next_level }.
export const fetchPuzzleLevels = async (slug, lang) =>
  apiRequest('get', `/puzzle-themes/${encodeURIComponent(slug)}/levels/${langQuery(lang)}`);

// A find is tiny and the game queues the next behind it, so it gives up
// quickly on a dead connection (and is kept to send again) rather than
// holding every later find for the default minute.
export const claimPuzzleWord = async (puzzleId, word) =>
  apiRequest('post', `/puzzles/${puzzleId}/found/`, { word }, { timeout: 12000 });

export const buyPuzzleHint = async (puzzleId) =>
  apiRequest('post', `/puzzles/${puzzleId}/hint/`, {});

export const fetchCoinWallet = async () => apiRequest('get', '/puzzles/wallet/');

// One letter, on a tile the player picked: → { row, col, letter, cost, balance }.
export const buyPuzzleLetter = async (puzzleId, row, col) =>
  apiRequest('post', `/puzzles/${puzzleId}/letter/`, { row, col });

// The weather place lives on the server as well as the device: the morning
// briefing is sent by a cron job, which cannot ask a sleeping phone where it is.
export const fetchWeatherPlace = async () => apiRequest('get', '/weather-place/');
export const saveWeatherPlace = async (place) => apiRequest('put', '/weather-place/', place);
export const clearWeatherPlace = async () => apiRequest('delete', '/weather-place/');

// One encouraging verse a day, chosen on the server so everyone sees the same
// one. `day` is optional and only reaches back as far as the server allows.
// `via: 'widget'` marks the home-screen widget's own refresh, which the
// server does not count toward the reading streak.
export const fetchDailyVerse = async (day = null, { via } = {}) => {
  const q = [day && `date=${encodeURIComponent(day)}`, via && `via=${encodeURIComponent(via)}`].filter(Boolean);
  return apiRequest('get', `/daily-verse/${q.length ? `?${q.join('&')}` : ''}`);
};

// Group endpoints
// Returns the paginated envelope { results, next, ... } so the caller can
// infinite-scroll; keeps the retry/backoff since this is the community landing.
// `scope`: 'public' | 'private' | 'mine' — resolved by the server, so each tab
// pages correctly. One try: the list paints from cache while this runs, and a
// failure keeps what's shown (retrying three times only held the spinner up).
export const fetchGroups = async ({ scope, search } = {}) =>
  apiRequest('get', '/groups/', null, {
    params: { page_size: 20, ...(scope ? { scope } : {}), ...(search ? { search } : {}) },
  });

// Follow a paginated `next` link (preserves path + query) for infinite scroll.
export const fetchGroupsByUrl = async (nextUrl) => {
  if (!nextUrl) return null;
  const [base, qs] = nextUrl.split('?');
  const path = base.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');
  const params = {};
  (qs || '').split('&').forEach((kv) => {
    if (!kv) return;
    const [k, v] = kv.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  });
  return apiRequest('get', path, null, { params });
};

export const fetchGroupDetails = async (slug) => {
  return apiRequest('get', `/groups/${slug}/`);
};

// Groups and communities are the same resource on two routes — the route is
// what decides which one you get, so creating must post to the right one.
// Posting a community to /groups/ silently makes a group AND drops its
// category, which is exactly the bug this pair exists to prevent.
const createOnPath = async (path, formData) => {
  try {
    const token = await getAuthToken();

    const response = await axios.post(`${API_URL}${path}`, formData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'multipart/form-data',
      },
      transformRequest: (data) => data, // Important for FormData
    });

    return response.data;
  } catch (error) {
    console.warn(`Creation error (${path}):`, error.response?.data || error.message);
    throw error.response?.data || { message: 'Failed to create' };
  }
};

export const createGroup = (formData) => createOnPath('/groups/', formData);
export const createCommunity = (formData) => createOnPath('/communities/', formData);

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
    console.warn('Join request error:', error.response?.data || error.message);
    throw error.response?.data || { message: 'Failed to send join request' };
  }
};



export const fetchGroupPosts = async (slug, page = 1) => {
  // The newest few (a screenful or so): older ones load when scrolled to.
  return apiRequest('get', `/groups/${slug}/posts/`, null, { params: { page, page_size: 20 } });
};

// Group chat: send a message (JSON, base64 attachments).
// payload: { content?, message_type?, attachment?, file_name?, duration?, reply_to_id? }
export const sendGroupMessage = async (slug, payload) =>
  apiRequest('post', `/groups/${slug}/posts/`, payload);

export const editGroupMessage = async (slug, id, content) =>
  apiRequest('patch', `/groups/${slug}/posts/${id}/edit/`, { content });

// 	ype: 'image' | 'file' | 'audio' (all three when omitted).
export const fetchGroupMedia = async (slug, page = 1, type = '') =>
  apiRequest('get', `/groups/${slug}/posts/media/`, null, { params: { page, ...(type ? { type } : {}) } });

export const searchGroupMessages = async (slug, q) =>
  apiRequest('get', `/groups/${slug}/posts/search/?q=${encodeURIComponent(q)}`);

export const fetchGroupMessageContext = async (slug, messageId) =>
  apiRequest('get', `/groups/${slug}/posts/context/?message_id=${messageId}`);

// Cursor loads: messages immediately older / newer than a given one.
export const fetchGroupPostsBefore = async (slug, id) =>
  apiRequest('get', `/groups/${slug}/posts/?before=${id}`);

export const fetchGroupPostsAfter = async (slug, id) =>
  apiRequest('get', `/groups/${slug}/posts/?after=${id}`);

export const fetchMessageReceipts = async (slug, id) =>
  apiRequest('get', `/groups/${slug}/posts/${id}/receipts/`);

export const pinGroupMessage = async (slug, id) =>
  apiRequest('post', `/groups/${slug}/posts/${id}/pin/`);

export const unpinGroupMessage = async (slug, id) =>
  apiRequest('post', `/groups/${slug}/posts/${id}/unpin/`);

// My side of a group: { archived?: bool, notify?: 'all' | 'mentions' }.
export const setGroupMine = (slug, changes) =>
  apiRequest('post', `/groups/${slug}/me/`, changes);

// No pushes from a group for hours (1, 8, 168), 'always', or 0 to unmute.
export const muteGroup = (slug, hours) =>
  apiRequest('post', `/groups/${slug}/mute/`, { hours });

export const markGroupRead = async (slug) =>
  apiRequest('post', `/groups/${slug}/mark-read/`);

// Group chat: toggle an emoji reaction on a post (returns the updated post).
export const reactToGroupPost = async (slug, postId, emoji) =>
  apiRequest('post', `/groups/${slug}/posts/${postId}/react/`, { emoji });

// Group chat: delete a post (sender or group admin).
export const deleteGroupPost = async (slug, postId) =>
  apiRequest('delete', `/groups/${slug}/posts/${postId}/`);

export const leaveGroup = async (slug) =>
  apiRequest('post', `/groups/${slug}/leave/`);


export const updateCommunity = async (slug, formData) => {
  return apiRequest('patch', `/communities/${slug}/`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

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
// A page of notices ({results, next}), pinned first then newest;
// category ('general' | 'event' | 'urgent' | 'prayer') and q narrow it.
export const fetchNotices = async (page = 1, { category, q } = {}) =>
  apiRequest('get', '/notices/', null, { params: { page, page_size: 20, ...(category ? { category } : {}), ...(q ? { q } : {}) } });

export const fetchNotice = (id) => apiRequest('get', `/notices/${id}/`);

// I've looked at the board: nothing is new any more (the menu badge).
export const markNoticesSeen = () => apiRequest('post', '/notices/seen/');

// publish_at / expires_at: ISO times (null: now / never).
export const createNotice = async ({
  title, body, is_pinned = false, publish_at = null, expires_at = null, category = 'general',
  cover_image = '', cover_width = null, cover_height = null,
}) =>
  apiRequest('post', '/notices/', {
    title, body, is_pinned, publish_at, expires_at, category, cover_image, cover_width, cover_height,
  });

export const updateNotice = (id, changes) => apiRequest('patch', `/notices/${id}/`, changes);

export const deleteNotice = async (id) => {
  return apiRequest('delete', `/notices/${id}/`);
};

// ---- Notes to admins ----
// Any signed-in user can submit a private note; only admins can read them.
export const createAdminNote = async (body) => {
  return apiRequest('post', '/admin-notes/', { body });
};

export const fetchAdminNotes = async (page = 1) => {
  const res = await apiRequest('get', '/admin-notes/', null, { params: { page, page_size: 100 } });
  return res?.results ?? res;
};

// The notes I sent: read yet, and the admins' answer.
export const fetchMyAdminNotes = () => apiRequest('get', '/admin-notes/mine/');

export const replyToAdminNote = (id, reply) => apiRequest('post', `/admin-notes/${id}/reply/`, { reply });

export const markAdminNoteRead = async (id, is_read = true) => {
  return apiRequest('patch', `/admin-notes/${id}/`, { is_read });
};

export const deleteAdminNote = async (id) => {
  return apiRequest('delete', `/admin-notes/${id}/`);
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

// A page of members ({results, next, count}), admins first; `q` searches names.
export const fetchGroupMembers = async (slug, { page = 1, q = '' } = {}) =>
  apiRequest('get', `/groups/${slug}/members/`, null,
    { params: { paged: 1, page, page_size: 40, ...(q ? { q } : {}) } });

// Group admin actions (WhatsApp-style member management).
export const removeGroupMember = async (slug, userId) =>
  apiRequest('post', `/groups/${slug}/remove-member/`, { user_id: userId });

export const setGroupAdmin = async (slug, userId, isAdmin) =>
  apiRequest('post', `/groups/${slug}/set-admin/`, { user_id: userId, is_admin: isAdmin });

export const setGroupModerator = async (slug, userId, isModerator) =>
  apiRequest('post', `/groups/${slug}/set-moderator/`, { user_id: userId, is_moderator: isModerator });

export const setGroupPostingPolicy = async (slug, onlyAdmins) =>
  apiRequest('post', `/groups/${slug}/posting-policy/`, { only_admins_can_post: onlyAdmins });

export const setGroupJoinQuestion = async (slug, question) =>
  apiRequest('post', `/groups/${slug}/join-question/`, { join_question: question });

export const fetchGroupAuditLog = async (slug, page = 1) =>
  apiRequest('get', `/groups/${slug}/audit-log/?page=${page}`);

// Admin: search users to add (excludes existing members).
export const searchGroupUsers = async (slug, q) =>
  apiRequest('get', `/groups/${slug}/search-users/`, null, { params: { q } });

// Admin: add a user directly to the group.
export const addGroupMember = async (slug, userId) =>
  apiRequest('post', `/groups/${slug}/add-member/`, { user_id: userId });

// Admin: get (or rotate, with regenerate=true) the group's invite code.
// limits: { expires_in_hours (0 = never), max_uses (0 = unlimited) }.
export const getGroupInviteLink = async (slug, regenerate = false, limits = {}) =>
  apiRequest('post', `/groups/${slug}/invite-link/`, { regenerate, ...limits });

// The link stops working; no new one is made.
export const revokeGroupInvite = (slug) =>
  apiRequest('post', `/groups/${slug}/invite-link/`, { revoke: true });

// Members may send one message every seconds (0 = off). Admins only.
export const setGroupSlowMode = (slug, seconds) =>
  apiRequest('post', `/groups/${slug}/slow-mode/`, { seconds });

// Anyone: join a group using an invite code.
export const joinGroupByCode = async (code) =>
  apiRequest('post', '/groups/join-by-code/', { code });

export const checkGroupMembership = async (slug) => {
  try {
    const response = await apiRequest('get', `/groups/${slug}/check-membership/`);
    if (!response || typeof response.is_member === 'undefined') {
      throw new Error('Invalid membership check response');
    }
    return response;
  } catch (error) {
    console.warn('Failed to check group membership:', error);
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
    console.warn(`API Error [get /marketplace/products/${identifier}/]:`, error);
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

// The signed-in user's cart, as one object. A 404 (an older server, before
// carts were made on first ask) is an empty cart; any other failure — offline,
// a server error — is thrown, so it is never mistaken for an empty cart.
export const fetchCart = async () => {
  try {
    const response = await apiRequest('get', '/marketplace/cart/my_cart/');
    return { ...response, items: response?.items || [] };
  } catch (error) {
    if (error?.response?.status === 404) return { items: [] };
    throw error;
  }
};

export const removeFromCart = async (itemId) => {
  try {
    // Use the correct endpoint format
    return await apiRequest('delete', `/marketplace/cart/items/${itemId}/`);
  } catch (error) {
    console.warn('Error removing item from cart:', error);
    throw error;
  }
};

// Set a cart line's quantity (the +/- steppers). Validated against stock server
// side, so an over-stock line can be dialled down in place instead of deleted.
export const updateCartItem = async (itemId, quantity) =>
  apiRequest('patch', `/marketplace/cart/items/${itemId}/`, { quantity });

// My details as a seller (contact, payment), kept once and filled into each
// new product; `is_verified` is the staff-given tick.
export const fetchSellerProfile = async () => apiRequest('get', '/marketplace/seller-profile/');
export const saveSellerProfile = async (fields) => apiRequest('put', '/marketplace/seller-profile/', fields);

// The dashboard's numbers: { week, all_time (per currency), awaiting_payment,
// to_send, products, views, low_stock: [{ id, slug, title, quantity }] }.
export const fetchSellerStats = async () => apiRequest('get', '/marketplace/orders/seller-stats/');

// A quick change from the dashboard: price, stock, or on sale / not.
export const quickUpdateProduct = async (slug, fields) =>
  apiRequest('patch', `/marketplace/products/${slug}/`, fields);

// A seller's shop front: { seller, is_verified, location, selling_since,
// products_on_offer, sales, rating, review_count }.
export const fetchShop = async (username) =>
  apiRequest('get', `/marketplace/shops/${encodeURIComponent(username)}/`);

// Each seller's part of an order moves on its own:
// a seller sends theirs (with a note: the rider, the bus, a number)...
export const shipOrderPart = async (orderId, note = '') =>
  apiRequest('post', `/marketplace/orders/${orderId}/ship/`, { note });
// ...the buyer says it arrived (one seller's part, or all that were sent)...
export const markOrderReceived = async (orderId, sellerId) =>
  apiRequest('post', `/marketplace/orders/${orderId}/received/`, sellerId ? { seller_id: sellerId } : {});
// ...and one seller's part can be cancelled without the rest.
export const cancelOrderPart = async (orderId, sellerId) =>
  apiRequest('post', `/marketplace/orders/${orderId}/cancel-part/`, sellerId ? { seller_id: sellerId } : {});

// An order of just this product, straight away — the cart is left alone.
export const buyNow = async (productId, quantity = 1) =>
  apiRequest('post', '/marketplace/cart/buy_now/', { product_id: productId, quantity });

export const checkoutCart = async () => {
  return apiRequest('post', '/marketplace/cart/checkout/');
};

// params go in the 4th arg (axios config) — the 3rd is the request body, which
// a GET ignores. Pass { role: 'buyer' } for purchases, { role: 'seller' } for
// sales; omitting role returns both.
export const fetchOrders = async (params = {}) => {
  return apiRequest('get', '/marketplace/orders/', null, { params });
};

export const fetchOrderById = async (id) => {
  return apiRequest('get', `/marketplace/orders/${id}/`);
};

export const processPayment = async (paymentData) => {
  return apiRequest('post', '/marketplace/payments/', paymentData);
};

// Direct-pay fulfilment: the seller confirms they received the buyer's payment
// for their own lines. This is what commits stock — there is no payment webhook.
export const confirmOrderPayment = async (orderId) => {
  return apiRequest('post', `/marketplace/orders/${orderId}/confirm-payment/`);
};

// `onProgress(fraction)` follows the upload — the photos are most of it.
export const createProduct = async (formData, { onProgress } = {}) => {
  try {
    if (formData.price) formData.price = parseFloat(formData.price);
    if (formData.quantity) formData.quantity = parseInt(formData.quantity);
    const token = await getAuthToken();
    const response = await axios.post(`${API_URL}/marketplace/products/`, formData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'multipart/form-data',
      },
      timeout: 120000, // photos on a slow connection take a while
      onUploadProgress: onProgress
        ? (e) => { if (e.total) onProgress(Math.min(1, e.loaded / e.total)); }
        : undefined,
    });
    return response.data;
  } catch (error) {
    console.warn('Product creation error:', error);
    if (error.response) {
      // The request was made and the server responded with a status code
      console.warn('Response data:', error.response.data);
      console.warn('Response status:', error.response.status);
      console.warn('Response headers:', error.response.headers);
      throw error.response.data;
    } else if (error.request) {
      // The request was made but no response was received
      console.warn('Request:', error.request);
      throw new Error('No response received from server');
    } else {
      // Something happened in setting up the request
      console.warn('Error message:', error.message);
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

// The caller's single wishlist (user is a OneToOne server-side), as one object.
export const fetchWishlist = async () => {
  return apiRequest('get', '/marketplace/wishlist/my_wishlist/');
};

// Takes the numeric product id — the endpoint looks up by pk, not slug.
export const addToWishlist = async (productId) => {
  return apiRequest('post', '/marketplace/wishlist/add_product/', {
    product_id: productId,
  });
};

export const removeFromWishlist = async (productId) => {
  return apiRequest('post', '/marketplace/wishlist/remove_product/', {
    product_id: productId,
  });
};

export const fetchProductReviews = async (slug) => {
  return apiRequest('get', `/marketplace/products/${slug}/reviews/`);
};




// Enhanced liveevent endpoints with comprehensive debugging
// Utility function for consistent logging
const apiLog = (message, data = null, level = 'log') => {
  const logMessage = `[LiveEventsAPI] ${message}`;
  const logData = data ? JSON.stringify(data, null, 2) : '';
  
  switch(level) {
    case 'error':
      console.warn(logMessage, logData);
      break;
    case 'warn':
      console.warn(logMessage, logData);
      break;
    default:
      console.log(logMessage, logData);
  }
};

// services/api.js
// ── Live broadcasting (LiveKit) ──────────────────────────────────────────────
export const createBroadcast = (kind, title) =>
  apiRequest('post', '/live/broadcasts/', { kind, title });
// Followers held and needed per kind: the Go Live screen says what is
// missing before anyone sets up a broadcast.
export const fetchLiveEligibility = () =>
  apiRequest('get', '/live/broadcasts/eligibility/');
export const fetchBroadcasts = () =>
  apiRequest('get', '/live/broadcasts/');
export const fetchBroadcastToken = (id) =>
  apiRequest('get', `/live/broadcasts/${id}/token/`);
export const endBroadcast = (id) =>
  apiRequest('post', `/live/broadcasts/${id}/end/`);
// Flush a batch of ❤️ reactions to the persisted like tally.
export const reactBroadcast = (id, count = 1) =>
  apiRequest('post', `/live/broadcasts/${id}/react/`, { count });
// Persist the on-screen graphic (or clear it). Pass null to clear.
export const setBroadcastOverlay = (id, graphic) =>
  apiRequest('post', `/live/broadcasts/${id}/overlay/`,
    graphic
      ? { style: graphic.style, title: graphic.title, sub: graphic.sub, x: graphic.x ?? null, y: graphic.y ?? null }
      : { clear: true });
// Host or super admin: delete a broadcast record (tears down a live room first).
export const deleteBroadcast = (id) =>
  apiRequest('delete', `/live/broadcasts/${id}/`);
export const requestCohost = (id) =>
  apiRequest('post', `/live/broadcasts/${id}/request-cohost/`);
export const fetchCohostRequests = (id) =>
  apiRequest('get', `/live/broadcasts/${id}/cohost-requests/`);
export const approveCohost = (id, requestId) =>
  apiRequest('post', `/live/broadcasts/${id}/approve-cohost/`, { request_id: requestId });
export const rejectCohost = (id, requestId) =>
  apiRequest('post', `/live/broadcasts/${id}/reject-cohost/`, { request_id: requestId });
export const fetchCohostToken = (id) =>
  apiRequest('get', `/live/broadcasts/${id}/cohost-token/`);
export const moderateBroadcast = (id, userId) =>
  apiRequest('post', `/live/broadcasts/${id}/moderate/`, { user_id: userId });

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
// Media (avatar) is uploaded to R2 separately; this now sends plain JSON with
// the picture as a URL string (no more multipart file upload).
export const updateProfile = (fields) =>
  apiRequest('patch', '/profiles/update_me/', fields);

// JSON-only profile patch for simple scalar fields (e.g. the is_public privacy
// toggle in Settings) — avoids the multipart path used for image uploads.
export const updateProfileFields = (fields) =>
  apiRequest('patch', '/profiles/update_me/', fields);

// ── Password reset ────────────────────────────────────────────────────────────
export const forgotPassword = (email) =>
  apiRequest('post', '/auth/forgot-password/', { email });

// "This wasn't me", from the new-sign-in notice: every other device signed
// out (this one kept, with its notifications) and the admins told.
export const reportNotMe = async () => {
  const [refresh, device_token] = await Promise.all([
    SecureStore.getItemAsync('refreshToken').catch(() => null), thisDeviceToken(),
  ]);
  return apiRequest('post', '/auth/not-me/', { refresh, device_token });
};

// Can't get in at all: a recovery case for the admins.
export const requestAccountRecovery = (account, contactEmail, details) =>
  apiRequest('post', '/auth/recovery-request/', { account, contact_email: contactEmail, details });

export const resetPassword = (email, code, new_password) =>
  apiRequest('post', '/auth/reset-password/', { email, code, new_password });

// Authenticated password change (signed-in user; no email code). Sends the
// current refresh token so this device stays signed in while other sessions are
// revoked server-side.
// This phone's push token (services/pushNotifications.js keeps it): sent when
// other sessions are signed out, so this phone keeps its notifications and
// the signed-out phones stop getting them.
const thisDeviceToken = () => AsyncStorage.getItem('expoPushToken').catch(() => null);

export const changePassword = async (current_password, new_password) => {
  const [refresh, device_token] = await Promise.all([
    SecureStore.getItemAsync('refreshToken').catch(() => null), thisDeviceToken(),
  ]);
  return apiRequest('post', '/auth/change-password/', { current_password, new_password, refresh, device_token });
};

// ── Sessions / security ──────────────────────────────────────────────────────
// The refresh token rides in a header, never the URL: a URL is written into
// every access log between here and the server.
export const fetchSessions = async () => {
  const refresh = await SecureStore.getItemAsync('refreshToken').catch(() => null);
  return apiRequest('get', '/auth/sessions/', null, refresh ? { headers: { 'X-Refresh-Token': refresh } } : {});
};

export const revokeSession = (id) =>
  apiRequest('post', '/auth/sessions/revoke/', { id });

export const revokeOtherSessions = async () => {
  const [refresh, device_token] = await Promise.all([
    SecureStore.getItemAsync('refreshToken').catch(() => null), thisDeviceToken(),
  ]);
  return apiRequest('post', '/auth/sessions/revoke-others/', { refresh, device_token });
};

export const exportMyData = () =>
  apiRequest('get', '/auth/export-data/');

// A push to my own devices, to see that notifications arrive: → { devices }.
export const sendTestPush = () => apiRequest('post', '/auth/test-push/', {});

// Reversible self-deactivation (password required). Logging back in reactivates.
export const deactivateAccount = (password) =>
  apiRequest('post', '/auth/deactivate/', { password });

// Permanently delete the signed-in user's account (password required).
export const deleteAccount = (password) =>
  apiRequest('post', '/auth/delete-account/', { password });

// ── Notification preferences ────────────────────────────────────────────────
export const fetchNotificationPreferences = () =>
  apiRequest('get', '/notification-preferences/');

export const updateNotificationPreferences = (fields) =>
  apiRequest('patch', '/notification-preferences/', fields);

// ── Post insights + view tracking ────────────────────────────────────────────
export const markPostViewed = (postId) =>
  apiRequest('post', `/social-posts/${postId}/viewed/`);

// Batched view reporting — one request per scroll session instead of one per
// post. Best-effort: callers ignore failures. ids: [postId, ...].
export const markPostsViewed = (postIds) =>
  apiRequest('post', '/social-posts/mark_viewed/', { post_ids: postIds });

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
// One emoji per viewer per story (changeable); null takes it back.
export const reactToStory = (id, emoji) => (emoji
  ? apiRequest('post', `/stories/${id}/react/`, { emoji })
  : apiRequest('delete', `/stories/${id}/react/`));
// Your own story: who watched, newest first, with their reaction.
export const fetchStoryViewers = (id) => apiRequest('get', `/stories/${id}/viewers/`);

// ── Reports ───────────────────────────────────────────────────────────────────
export const reportContent = (contentType, objectId, reason, description = '') =>
  apiRequest('post', '/reports/', { content_type: contentType, object_id: objectId, reason, description });

// Pin a post to the top of your own profile grid (at most 3), or unpin it.
export const pinPost = (postId, pinned) =>
  apiRequest('post', `/social-posts/${postId}/pin/`, typeof pinned === 'boolean' ? { pinned } : {});

// "Not interested" — hide a post and demote similar content in the ranked feed.
export const markNotInterested = (postId) =>
  apiRequest('post', `/social-posts/${postId}/not_interested/`, {});

// Batched watch-time (dwell) events → sharpen personalization. Best-effort:
// callers ignore failures. events: [{ post_id, dwell_ms }].
export const logWatchEvents = (events) =>
  apiRequest('post', '/social-posts/watch/', { events });

// Cheap "anything newer?" probe for the feed poll — returns { latest_id } only.
export const fetchLatestPostId = (feed = null) =>
  apiRequest('get', '/social-posts/latest/', null, { params: feed ? { feed } : {} });

// ── Wallpapers (admin-managed app backgrounds) ───────────────────────────────
// Read is public so a cold start never races the token refresh; writes need the
// `manage_wallpapers` capability server-side.
export const fetchWallpapers = () => apiRequest('get', '/wallpapers/');

// Admin library view — includes deactivated ones.
export const fetchAllWallpapers = () =>
  apiRequest('get', '/wallpapers/', null, { params: { all: 1 } });

export const createWallpaper = (image, title = '', scope = 'general') =>
  apiRequest('post', '/wallpapers/', { image, title, scope });

export const updateWallpaper = (id, fields) =>
  apiRequest('patch', `/wallpapers/${id}/`, fields);

export const deleteWallpaper = (id) => apiRequest('delete', `/wallpapers/${id}/`);

export const reorderWallpapers = (items) =>
  apiRequest('post', '/wallpapers/reorder/', { items });

// ── R2 presigned upload ───────────────────────────────────────────────────────
// Returns { upload_url, key, public_url, content_type, expires_in }; the app
// PUTs the raw bytes to upload_url and stores public_url as the media ref.
export const getR2UploadTicket = (type, contentType, filename) =>
  apiRequest('post', '/upload/r2-sign/', {
    type,
    content_type: contentType,
    ...(filename ? { filename } : {}),
  });

// ── Direct Messaging ──────────────────────────────────────────────────────────
// Returns the paginated response { results, next, ... } so the inbox can
// load more. Page 1 is the freshest conversations (ordered by recent activity).
// `folder`: 'primary' | 'requests' | 'archived'; `q`: a name or words.
export const fetchConversations = async ({ folder, q } = {}) =>
  apiRequest('get', '/conversations/', null, {
    params: { page_size: 20, ...(folder && folder !== 'primary' ? { folder } : {}), ...(q ? { q } : {}) },
  });

// Follow a paginated `next` link (preserves path + query) for infinite scroll.
export const fetchConversationsByUrl = async (nextUrl) => {
  if (!nextUrl) return null;
  const [base, qs] = nextUrl.split('?');
  const path = base.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');
  const params = {};
  (qs || '').split('&').forEach((kv) => {
    if (!kv) return;
    const [k, v] = kv.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  });
  return apiRequest('get', path, null, { params });
};

export const getOrCreateConversation = (userId) =>
  apiRequest('post', '/conversations/', { user_id: userId });

// Without `after`: returns the most recent messages (array).
// With `after` (a message id): returns { messages: [...newer], read_ids: [...] }
// so polling doesn't re-download the whole list (and its base64 attachments).
export const fetchMessages = (conversationId, after) =>
  apiRequest('get', `/conversations/${conversationId}/messages/`, null,
    after ? { params: { after } } : {});

// Scroll-up history: the page of older messages immediately before `beforeId`.
export const fetchOlderMessages = (conversationId, beforeId) =>
  apiRequest('get', `/conversations/${conversationId}/messages/`, null,
    { params: { before: beforeId } });

// payload: { content?, message_type?, attachment?, file_name?, duration? }
export const sendMessage = (conversationId, payload) =>
  apiRequest('post', `/conversations/${conversationId}/send_message/`,
    typeof payload === 'string' ? { content: payload } : payload);

export const markConversationRead = (conversationId) =>
  apiRequest('post', `/conversations/${conversationId}/mark_read/`);

export const fetchUnreadMessageCount = () =>
  apiRequest('get', '/conversations/unread_count/');

// A chat's words, searched (the 50 newest that match).
export const searchMessages = (conversationId, q) =>
  apiRequest('get', `/conversations/${conversationId}/messages/`, null, { params: { q } });

// Within 15 minutes, by its sender; text only.
export const editMessage = (conversationId, messageId, content) =>
  apiRequest('patch', `/conversations/${conversationId}/messages/${messageId}/`, { content });

// scope: 'everyone' (the sender, within 48 hours) | 'me'
export const deleteMessage = (conversationId, messageId, scope) =>
  apiRequest('post', `/conversations/${conversationId}/messages/${messageId}/delete/`, { scope });

// Same emoji again takes it back; another replaces it.
export const reactToMessage = (conversationId, messageId, emoji) =>
  apiRequest('post', `/conversations/${conversationId}/messages/${messageId}/react/`, { emoji });

// My side of a chat: { accepted?, muted?, archived?, clear? }
export const setConversationState = (conversationId, changes) =>
  apiRequest('post', `/conversations/${conversationId}/state/`, changes);

// { online, last_seen }
export const fetchPresence = (conversationId) =>
  apiRequest('get', `/conversations/${conversationId}/presence/`);

// ── Admin / moderation panel (gated server-side by IsModerator/IsSuperAdmin) ──
export const fetchAdminDashboard = () =>
  apiRequest('get', '/admin/dashboard/');

// ── Two-step sign-in for admins (/admin/security/) ───────────────────────────
// Who I am as an admin, read fresh: { is_admin, capabilities, two_factor_enabled,
// session_valid, ... } — a 403 means not an admin (any more).
export const fetchAdminSecurity = () => apiRequest('get', '/admin/security/status/');
// A new authenticator secret: { secret, otpauth_url }.
export const startAdminTwoFactor = () => apiRequest('post', '/admin/security/setup/', {});
// The first code: { backup_codes, admin_session, expires_at }.
export const confirmAdminTwoFactor = (code) => apiRequest('post', '/admin/security/confirm/', { code });
// A code or a backup code: { admin_session, expires_at } (or refreshed).
export const verifyAdminCode = ({ code, backupCode } = {}) =>
  apiRequest('post', '/admin/security/verify/', backupCode ? { backup_code: backupCode } : { code });
export const endAdminSession = () => apiRequest('post', '/admin/security/logout/', {});
export const resetAdminTwoFactor = (userId) => apiRequest('post', `/admin/users/${userId}/reset_two_factor/`, {});
export const verifyAdminLog = () => apiRequest('get', '/admin/logs/verify/');

// ── Admin tools (phase 3) ────────────────────────────────────────────────────
const only = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null));
// The quiz's written questions: filters { language, difficulty, state, q }.
export const fetchQuizBank = (filters = {}) => apiRequest('get', '/admin/quiz-bank/', null, { params: only(filters) });
export const saveQuizQuestion = (question) => (question.id
  ? apiRequest('patch', `/admin/quiz-bank/${question.id}/`, question)
  : apiRequest('post', '/admin/quiz-bank/', question));
export const retireQuizQuestion = (id) => apiRequest('delete', `/admin/quiz-bank/${id}/`);
export const activateQuizQuestion = (id) => apiRequest('post', `/admin/quiz-bank/${id}/activate/`, {});
// Claude drafts questions on a passage; they arrive switched off, for review.
export const draftQuizQuestions = (body) => apiRequest('post', '/admin/quiz-bank/draft/', body);
export const rejectQuizDraft = (id) => apiRequest('post', `/admin/quiz-bank/${id}/reject/`, {});
// The day's quiz with its answers; rebuild it while nobody has played it.
export const fetchAdminDailyQuiz = (params = {}) => apiRequest('get', '/admin/quiz-daily/', null, { params: only(params) });
export const rebuildAdminDailyQuiz = (body = {}) => apiRequest('post', '/admin/quiz-daily/', body);
// Players' reports on questions, and what was done about them.
export const fetchQuizReports = (status = 'open') => apiRequest('get', '/admin/quiz-reports/', null, { params: { status } });
export const resolveQuizReport = (id, status, retire = false) =>
  apiRequest('post', `/admin/quiz-reports/${id}/resolve/`, { status, retire });
// How each kind of question is answered, and runs too good to be honest.
export const fetchAdminQuizStats = () => apiRequest('get', '/admin/quiz-stats/');
// Battles still open, and ending one.
export const fetchAdminBattles = () => apiRequest('get', '/admin/quiz-battles/');
export const endAdminBattle = (code) => apiRequest('post', `/admin/quiz-battles/${code}/end/`, {});
// The story journey's packs.
export const fetchStoryPacksAdmin = () => apiRequest('get', '/admin/story-packs/');
export const saveStoryPack = (pack) => (pack.id
  ? apiRequest('patch', `/admin/story-packs/${pack.id}/`, pack)
  : apiRequest('post', '/admin/story-packs/', pack));
// The word puzzle's themes.
export const fetchPuzzleThemesAdmin = () => apiRequest('get', '/admin/puzzle-themes/');
export const savePuzzleTheme = (theme) => (theme.id
  ? apiRequest('patch', `/admin/puzzle-themes/${theme.id}/`, theme)
  : apiRequest('post', '/admin/puzzle-themes/', theme));
export const reorderPuzzleThemes = (ids) => apiRequest('post', '/admin/puzzle-themes/reorder/', { ids });
// The verified tick: kind 'artist' | 'seller' | 'service' | 'organization'.
export const fetchVerifyList = (kind, filters = {}) =>
  apiRequest('get', '/admin/verify/', null, { params: only({ kind, ...filters }) });
export const setVerified = (kind, id, verified, reason = '') =>
  apiRequest('post', '/admin/verify/set/', { kind, id, verified, reason });

// ── Admin phase 4 ────────────────────────────────────────────────────────────
// Maintenance and the parts of the app switched off: { maintenance: {on, message}, features: {...} }.
export const fetchAppSettings = () => apiRequest('get', '/admin/app-settings/');
export const saveAppSettings = (changes) => apiRequest('patch', '/admin/app-settings/', changes);
// Broadcasts: audience 'all' | 'active' | 'sellers' | 'artists' | 'admins'.
export const fetchAdminBroadcasts = () => apiRequest('get', '/admin/broadcasts/');
export const previewBroadcast = (audience) => apiRequest('post', '/admin/broadcasts/preview/', { audience });
export const sendBroadcast = (title, message, audience) =>
  apiRequest('post', '/admin/broadcasts/', { title, message, audience });
// One account as moderation sees it.
export const fetchUserHistory = (id) => apiRequest('get', `/admin/users/${id}/history/`);
// Activity, sales and games over time; csv: the same as a file's text.
export const fetchAdminInsights = (days = 30) => apiRequest('get', '/admin/insights/', null, { params: { days } });
export const fetchAdminInsightsCsv = (days = 30) =>
  apiRequest('get', '/admin/insights/', null, { params: { days, export: 'csv' }, responseType: 'text' });

// Follow a paginated `next` link (preserves path + query) for the admin
// queues' infinite scroll. Shared by every admin list screen.
export const fetchAdminByUrl = (nextUrl) => {
  if (!nextUrl) return Promise.resolve(null);
  const [base, qs] = nextUrl.split('?');
  const path = base.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');
  const params = {};
  (qs || '').split('&').forEach((kv) => {
    if (!kv) return;
    const [k, v] = kv.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  });
  return apiRequest('get', path, null, { params });
};

// Everything the Pulse dashboard draws (rings, trend, reasons, hours, mix, most followed).
export const fetchAdminPulse = (days = 14) => apiRequest('get', '/admin/pulse/', null, { params: { days } });
export const fetchAdminAnalytics = (days = 14) =>
  apiRequest('get', '/admin/analytics/', null, { params: { days } });

// Admin: music - listening, charts/processing health, genres, Editor's picks.
export const fetchAdminMusic = (days = 14) => apiRequest('get', '/admin/music/', null, { params: { days } });
// id null: add {name}, or set the whole order {order: [ids]}; id: rename {name}.
export const saveMusicGenre = (id, body) => apiRequest('post', id ? `/admin/music/genres/${id}/` : '/admin/music/genres/', body);
export const saveMusicPicks = (ids) => apiRequest('post', '/admin/music/picks/', { tracks: ids });

// order 'priority': the most reported first.
export const fetchAdminReports = (status = '', order = '') =>
  apiRequest('get', '/admin/reports/', null, { params: { ...(status ? { status } : {}), ...(order ? { order } : {}) } });

export const resolveReport = (id) =>
  apiRequest('post', `/admin/reports/${id}/resolve/`);

export const dismissReport = (id) =>
  apiRequest('post', `/admin/reports/${id}/dismiss/`);

export const removeReportTarget = (id, reason = '') =>
  apiRequest('post', `/admin/reports/${id}/remove_target/`, { reason });

export const assignReport = (id) =>
  apiRequest('post', `/admin/reports/${id}/assign/`);

export const bulkReports = (ids, action) =>
  apiRequest('post', '/admin/reports/bulk/', { ids, action });

export const bulkContent = (type, ids, action, reason = '', removalReason = '') =>
  apiRequest('post', '/admin/content/bulk/', {
    type, ids, action, reason, ...(removalReason ? { removal_reason: removalReason } : {}),
  });

export const addReportNote = (id, note) =>
  apiRequest('post', `/admin/reports/${id}/add_note/`, { note });

// filters: { action, actor, target_type, target_id, since, until } (any of them)
export const fetchAdminLogs = (filters = {}) => {
  const params = typeof filters === 'string' ? (filters ? { action: filters } : {}) : filters;
  return apiRequest('get', '/admin/logs/', null, {
    params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null)),
  });
};

// Appeals — user-facing
export const submitAppeal = (message) =>
  apiRequest('post', '/appeals/', { message });

export const fetchMyAppeal = () =>
  apiRequest('get', '/appeals/mine/');

// Appeals — admin
export const fetchAdminAppeals = (status = 'pending') =>
  apiRequest('get', '/admin/appeals/', null, { params: status ? { status } : {} });

export const approveAppeal = (id, notes = '') =>
  apiRequest('post', `/admin/appeals/${id}/approve/`, { notes });

export const rejectAppeal = (id, notes = '') =>
  apiRequest('post', `/admin/appeals/${id}/reject/`, { notes });

// status: '' | 'admins' | 'suspended' | 'banned' | 'warned'
export const fetchAdminUsers = (q = '', role = '', status = '') =>
  apiRequest('get', '/admin/users/', null, {
    params: { ...(q ? { q } : {}), ...(role ? { role } : {}), ...(status ? { status } : {}) },
  });

export const suspendUser = (id, reason = '', days = 0) =>
  apiRequest('post', `/admin/users/${id}/suspend/`, { reason, days });

export const unsuspendUser = (id) =>
  apiRequest('post', `/admin/users/${id}/unsuspend/`);

// Clear what a profile says (bio, name, link, location, photo) — moderation.
export const clearUserProfile = (id, reason = '', fields = null) =>
  apiRequest('post', `/admin/users/${id}/clear-profile/`, { reason, ...(fields ? { fields } : {}) });

export const warnUser = (id, reason = '') =>
  apiRequest('post', `/admin/users/${id}/warn/`, { reason });

// days: a ban that ends by itself (0 or none: for good).
export const banUser = (id, reason = '', days = 0) =>
  apiRequest('post', `/admin/users/${id}/ban/`, { reason, days });

// Everything of one account taken down at once — and that same set restored.
export const takedownAllUser = (id, reason) =>
  apiRequest('post', `/admin/users/${id}/takedown-all/`, { reason });
export const restoreAllUser = (id) =>
  apiRequest('post', `/admin/users/${id}/restore-all/`, {});
// Signed out on every device, notifications stopped.
export const signOutUser = (id, reason) =>
  apiRequest('post', `/admin/users/${id}/sign-out/`, { reason });
export const fetchUserDevices = (id) => apiRequest('get', `/admin/users/${id}/devices/`);

// How the server is doing (admin Monitor).
export const fetchAdminMonitor = () => apiRequest('get', '/admin/monitor/');

// ── The Security Centre (admin) ──────────────────────────────────────────────
export const fetchSecurityCentre = () => apiRequest('get', '/admin/security-centre/');
export const fetchLoginAttempts = ({ user, ip } = {}) => apiRequest('get', `/admin/security-centre/attempts/?${
  user ? `user=${encodeURIComponent(user)}` : `ip=${encodeURIComponent(ip || '')}`}`);
export const blockNetwork = (network, reason, hours = 0) =>
  apiRequest('post', '/admin/security-centre/block/', { network, reason, hours });
export const unblockNetwork = (network) => apiRequest('post', '/admin/security-centre/unblock/', { network });
export const resolveSecurityEvent = (id) => apiRequest('post', '/admin/security-centre/resolve/', { id });
export const setSecurityLockdown = (changes) => apiRequest('post', '/admin/security-centre/lockdown/', changes);
export const lockAccount = (userId, reason, hours = 24) =>
  apiRequest('post', '/admin/security-centre/lock-account/', { user_id: userId, reason, hours });
export const unlockAccount = (userId) =>
  apiRequest('post', '/admin/security-centre/unlock-account/', { user_id: userId });
// Account recovery (admin).
export const fetchRecoveryCases = (status = 'open') =>
  apiRequest('get', `/admin/security-centre/recovery/?status=${encodeURIComponent(status)}`);
export const closeRecoveryCase = (id, status, note = '') =>
  apiRequest('post', '/admin/security-centre/recovery-close/', { id, status, note });
export const changeAccountEmail = (userId, email, reason) =>
  apiRequest('post', '/admin/security-centre/change-email/', { user_id: userId, email, reason });
export const sendPasswordReset = (userId) =>
  apiRequest('post', '/admin/security-centre/send-reset/', { user_id: userId });
export const forcePasswordReset = (userId, reason) =>
  apiRequest('post', '/admin/security-centre/force-reset/', { user_id: userId, reason });

export const unbanUser = (id) =>
  apiRequest('post', `/admin/users/${id}/unban/`);

export const setUserSuperAdmin = (id, isSuper) =>
  apiRequest('post', `/admin/users/${id}/set_role/`, { super_admin: isSuper });

export const assignUserRole = (id, roleId) =>
  apiRequest('post', `/admin/users/${id}/set_role/`, { role_id: roleId });

// Roles (super-admin only)
export const fetchRoles = () =>
  apiRequest('get', '/admin/roles/');

export const fetchCapabilities = () =>
  apiRequest('get', '/admin/roles/capabilities/');

export const createRole = (payload) =>
  apiRequest('post', '/admin/roles/', payload);

export const updateRole = (id, payload) =>
  apiRequest('patch', `/admin/roles/${id}/`, payload);

export const deleteRole = (id) =>
  apiRequest('delete', `/admin/roles/${id}/`);

export const fetchAdminContent = (type = 'post', q = '', removed = '') =>
  apiRequest('get', '/admin/content/', null, {
    params: { type, ...(q ? { q } : {}), ...(removed ? { removed } : {}) },
  });

export const removeContent = (type, id, reason = '', removalReason = '') =>
  apiRequest('post', '/admin/content/remove/', {
    type, id, reason, ...(removalReason ? { removal_reason: removalReason } : {}),
  });

export const restoreContent = (type, id) =>
  apiRequest('post', '/admin/content/restore/', { type, id });

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
  startQuizSession,
  fetchQuizSession,
  answerQuizSession,
  finishQuizSession,
  fetchQuizBests,
  fetchDailyQuiz,
  submitDailyQuiz,
  reportQuizQuestion,
  fetchQuizStories,
  fetchOfflinePack,
  fetchQuizLeaderboard,
  fetchQuizHistory,
  fetchQuizStats,
  fetchPuzzleLevel,
  fetchNextPuzzle,
  fetchDailyPuzzle,
  fetchPuzzleThemes,
  fetchPuzzleLevels,
  fetchPuzzle,
  fetchPuzzleVersus,
  fetchPuzzleDailyBoard,
  fetchPuzzleMeaning,
  buyNow,
  claimPuzzleWord,
  buyPuzzleHint,
  buyPuzzleLetter,
  fetchCoinWallet,
  fetchWeatherPlace,
  saveWeatherPlace,
  clearWeatherPlace,
  fetchDailyVerse,
  fetchCommunityCategories,
  createCommunityCategory,
  deleteCommunityCategory,
  fetchCommunities,
  fetchCommunitiesByUrl,
  fetchGroups,
  fetchGroupsByUrl,
  fetchGroupDetails,
  createGroup,
  createCommunity,
  updateCommunity,
  requestJoinGroup,
  fetchGroupPosts,
  fetchGroupJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  fetchGroupMembers,
  removeGroupMember,
  setGroupAdmin,
  setGroupPostingPolicy,
  searchGroupUsers,
  addGroupMember,
  getGroupInviteLink,
  joinGroupByCode,
  fetchNotices,
  createNotice,
  deleteNotice,
  createAdminNote,
  fetchAdminNotes,
  markAdminNoteRead,
  deleteAdminNote,
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
  fetchProductReviews,
  removeFromCart,
  updateCartItem,
  processPayment,
  confirmOrderPayment,
  createProduct,
  updateProduct,
  deleteProduct
};






































// ── Music discovery ──────────────────────────────────────────────────────────
// One track (full payload) — the song page opened from a notification.
export const fetchTrack = (trackId) => apiRequest('get', `/tracks/${trackId}/`);
// Picked for the viewer from likes; each row carries `reason`
// (fans_also_like / from_artist / popular).
export const fetchForYouTracks = () => apiRequest('get', '/tracks/for_you/');
// "More like this" for one track.
export const fetchSimilarTracks = (trackId) => apiRequest('get', `/tracks/${trackId}/similar/`);
// Listens (see services/playReporter): a batch of play events.
export const postPlays = (events) => apiRequest('post', '/tracks/plays/', { events });
// Recently played, most recent first, each track once.
export const fetchRecentTracks = (limit = 20) => apiRequest('get', '/tracks/recent/', null, { params: { limit } });

// ── Single & Searching (advent-backend songs/views/singles.py) ──────────────
// { eligible, blockers, ready_on, profile } — blockers are codes:
// email_not_verified, suspended, account_too_new, banned.
export const fetchSinglesMe = () => apiRequest('get', '/singles/me/');
// Join: { agree_rules: true, first_name, birth_date, gender, country, baptised, ... }.
export const createSinglesProfile = (data) => apiRequest('post', '/singles/me/', data);
// Birth date and gender can't change; everything else can.
export const updateSinglesProfile = (data) => apiRequest('patch', '/singles/me/', data);
export const leaveSingles = () => apiRequest('delete', '/singles/me/');
export const submitSinglesProfile = () => apiRequest('post', '/singles/me/submit/');
export const pauseSinglesProfile = (paused) => apiRequest('post', '/singles/me/pause/', { paused });
// formData with `image`; it waits for review before others see it.
export const addSinglesPhoto = (formData) => apiRequest('post', '/singles/me/photos/', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
export const removeSinglesPhoto = (id) => apiRequest('delete', `/singles/me/photos/${id}/`);
export const orderSinglesPhotos = (ids) => apiRequest('post', '/singles/me/photos/order/', { ids });

// The reviewers' queue (review_singles). state: waiting | approved | rejected | banned | all.
export const fetchSinglesQueue = (state = 'waiting', page = 1) =>
  apiRequest('get', '/admin/singles/', null, { params: { state, page } });
export const reviewSinglesProfile = (id, decision, reason = '', photos = {}) =>
  apiRequest('post', `/admin/singles/${id}/review/`, { decision, reason, photos });
export const banFromSingles = (id, reason) => apiRequest('post', `/admin/singles/${id}/ban/`, { reason });
export const unbanFromSingles = (id, reason) => apiRequest('post', `/admin/singles/${id}/unban/`, { reason });
// Discover: ?min_age&max_age&country&baptised&language&looking_for → { results, left_today }.
export const fetchSinglesDiscover = (filters = {}) => apiRequest('get', '/singles/discover/', null, { params: filters });
export const fetchSinglesProfile = (id) => apiRequest('get', `/singles/profiles/${id}/`);
// kind: interested | pass → { matched, match, left_today }.
export const answerSingles = (id, kind) => apiRequest('post', `/singles/profiles/${id}/interest/`, { kind });
export const fetchSinglesMatches = () => apiRequest('get', '/singles/matches/');
export const unmatchSingles = (matchId) => apiRequest('post', `/singles/matches/${matchId}/unmatch/`);
// reason: fake | scam | inappropriate | harassment | underage | married | other.
export const reportSingles = (id, reason, description = '', block = false) =>
  apiRequest('post', `/singles/profiles/${id}/report/`, { reason, description, block });
export const blockSingles = (id) => apiRequest('post', `/singles/profiles/${id}/block/`);
// A verse by reference ("Philippians 4:13", up to five verses) → { ref, text, version }.
export const lookupVerse = (ref) => apiRequest('get', '/bible/lookup/', null, { params: { ref } });

// ── Single & Searching: the hub (phases 6-11) ───────────────────────────────
export const fetchSinglesHub = (mode = 'foryou') => apiRequest('get', '/singles/hub/', null, { params: { mode } });
export const browseSingles = (mode = 'foryou', page = 1, filters = {}) =>
  apiRequest('get', '/singles/browse/', null, { params: { mode, page, ...filters } });
export const fetchSinglesLikes = () => apiRequest('get', '/singles/likes/');
export const saveSinglesAnswers = (answers) => apiRequest('put', '/singles/me/answers/', { answers });
export const fetchIcebreakers = (matchId) => apiRequest('get', `/singles/matches/${matchId}/icebreakers/`);
export const askIcebreaker = (matchId, key) => apiRequest('post', `/singles/matches/${matchId}/icebreakers/`, { key });
export const answerIcebreaker = (id, answer) => apiRequest('post', `/singles/icebreakers/${id}/answer/`, { answer });
export const fetchSinglesTopics = () => apiRequest('get', '/singles/topics/');
export const askSinglesTopic = (body) => apiRequest('post', '/singles/topics/', { body });
export const fetchSinglesTopic = (id) => apiRequest('get', `/singles/topics/${id}/`);
export const replySinglesTopic = (id, body) => apiRequest('post', `/singles/topics/${id}/replies/`, { body });
export const heartSinglesTopic = (id) => apiRequest('post', `/singles/topics/${id}/heart/`);
export const fetchSinglesGatherings = () => apiRequest('get', '/singles/gatherings/');
export const suggestSinglesGathering = (data) => apiRequest('post', '/singles/gatherings/', data);
export const rsvpSinglesGathering = (id) => apiRequest('post', `/singles/gatherings/${id}/rsvp/`);
export const fetchSinglesRooms = () => apiRequest('get', '/singles/rooms/');
export const startSinglesRoom = (title) => apiRequest('post', '/live/broadcasts/', { kind: 'meet', title, singles_only: true });
export const fetchSinglesStories = () => apiRequest('get', '/singles/stories/');
export const tellSinglesStory = (matchId, title, body) => apiRequest('post', `/singles/matches/${matchId}/story/`, { title, body });
export const agreeSinglesStory = (id) => apiRequest('post', `/singles/stories/${id}/consent/`);
export const withdrawSinglesStory = (id) => apiRequest('delete', `/singles/stories/${id}/consent/`);
export const fetchSinglesVerify = () => apiRequest('get', '/singles/me/verify/');
export const sendSinglesSelfie = (formData) => apiRequest('post', '/singles/me/verify/', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
// Reviewers.
export const fetchSinglesStats = () => apiRequest('get', '/admin/singles-stats/');

// Events & Tickets, as Skylink's staff (manage_tickets). The server passes
// each call to the ticketing server's staff API as this admin; see
// songs/views/admin_tickets.py. 503 `ticketing_unavailable` = not connected.
export const fetchAdminTicketStats = () => apiRequest('get', '/admin/tickets/stats/');
// review: pending | approved | rejected | unsubmitted (none = all, newest first)
export const fetchAdminTicketEvents = (params = {}) => apiRequest('get', '/admin/tickets/events/', null, { params });
export const fetchAdminTicketEvent = (id) => apiRequest('get', `/admin/tickets/events/${id}/`);
// action: approve | reject ({ note })
export const adminTicketEventAction = (id, action, body = {}) =>
  apiRequest('post', `/admin/tickets/events/${id}/${action}/`, body);
// status: pending | submitted | active | rejected
export const fetchAdminTills = (params = {}) => apiRequest('get', '/admin/tickets/tills/', null, { params });
export const fetchAdminTill = (id) => apiRequest('get', `/admin/tickets/tills/${id}/`);
// action: submit | test ({ phone }) | activate | reject ({ note })
export const adminTillAction = (id, action, body = {}) =>
  apiRequest('post', `/admin/tickets/tills/${id}/${action}/`, body);
// Organisers locked out: search, then send-reset | reset-code | sign-out.
export const fetchAdminTicketOrganisers = (params = {}) =>
  apiRequest('get', '/admin/tickets/organisers/', null, { params });
export const fetchAdminTicketOrganiser = (id) => apiRequest('get', `/admin/tickets/organisers/${id}/`);
export const adminTicketOrganiserAction = (id, action) =>
  apiRequest('post', `/admin/tickets/organisers/${id}/${action}/`, {});
export const fetchSinglesReviewList = (kind) => apiRequest('get', `/admin/singles-${kind}/`);
export const decideSinglesItem = (kind, id, decision, reason = '') =>
  apiRequest('post', `/admin/singles-${kind}/${id}/decide/`, { decision, reason });
// Every Single & Searching chat, open or ended (the server filters them).
export const fetchSinglesChats = () => apiRequest('get', '/conversations/', null, { params: { singles: 1, page_size: 100 } });
