import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Base URL configuration
export const API_BASE = 'http://192.168.1.126:8000';
export const API_URL = `${API_BASE}/api`;

// Token management utilities
const storeTokens = async (access, refresh) => {
  await AsyncStorage.multiSet([
    ['accessToken', access],
    ['refreshToken', refresh]
  ]);
};

const clearTokens = async () => {
  await AsyncStorage.multiRemove(['accessToken', 'refreshToken']);
};


const getAuthToken = async () => {
  try {
    const token = await AsyncStorage.getItem('accessToken');
    if (!token) {
      await clearTokens();
      throw new Error('No authentication token found');
    }
    return token;
  } catch (error) {
    await clearTokens();
    throw error;
  }
};


// Enhanced refresh token flow with retry
const refreshAuthToken = async (retryCount = 0) => {
  try {
    const refreshToken = await AsyncStorage.getItem('refreshToken');
    if (!refreshToken) {
      await clearTokens();
      throw new Error('Session expired - please login again');
    }

    const response = await axios.post(`${API_URL}/auth/token/refresh/`, {
      refresh: refreshToken
    }, {
      timeout: 10000
    });

    if (!response.data?.access) {
      throw new Error('Invalid token refresh response');
    }

    await storeTokens(response.data.access, refreshToken);
    return response.data.access;
  } catch (error) {
    if (retryCount < 1) {
      return refreshAuthToken(retryCount + 1);
    }
    await clearTokens();
    throw error;
  }
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

const apiRequest = async (method, endpoint, data = null, options = {}) => {
  try {
    const response = await axios({
      method,
      url: `${API_URL}${endpoint}`,
      data,
      timeout: 30000,
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      }
    });
    return response.data;
  } catch (error) {
    console.error(`API Error [${method} ${endpoint}]:`, error.response?.data || error.message);
    
    // Handle specific error cases
     if (error.response?.status === 401 || error.message.includes('token')) {
      await clearTokens();
      throw new Error('Session expired - please login again');
    }
    
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout - please check your connection');
    }
    
    throw error.response?.data || error;
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
export const fetchTracks = async () => {
  return apiRequest('get', '/tracks/');
};

export const createTrack = async (formData) => {
  return apiRequest('post', '/tracks/upload/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

// Social endpoints
export const fetchSocialPosts = async () => {
  return apiRequest('get', '/social-posts/');
};


export const createSocialPost = async (formData) => {
  try {
    // Ensure FormData is properly constructed
    console.log("FormData contents:");
    for (let [key, value] of formData.entries()) {
      console.log(key, value);
    }

    const response = await axios.post(`${API_URL}/social-posts/`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'Authorization': `Bearer ${await getAuthToken()}`
      },
      timeout: 30000
    });
    
    return response.data;
  } catch (error) {
    console.error('Post creation error:', error.response?.data || error.message);
    throw error.response?.data || { message: 'Failed to create post' };
  }
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

  
  export const favoriteTrack = async (trackId) => {
    return apiRequest('post', `/tracks/${trackId}/favorite/`);
  };
  
  // Comment Endpoints
  export const fetchPostComments = async (postId) => {
    return apiRequest('get', `/social-posts/${postId}/comments/`);
  };
  
  export const fetchTrackComments = async (trackId) => {
    return apiRequest('get', `/tracks/${trackId}/comments/`);
  };
  
  // Notification Endpoints
  export const fetchUnreadNotificationCount = async () => {
    return apiRequest('get', '/notifications/unread_count/');
  };
// Notification endpoints
export const fetchNotifications = async () => {
  return apiRequest('get', '/notifications/');
};

export const markNotificationAsRead = async (notificationId) => {
  return apiRequest('post', `/notifications/${notificationId}/mark_as_read/`);
};
export const fetchSocialPostComments = async (postId) => {
  return await apiRequest('get', `/social-posts/${postId}/comments/`);
};

// nitaona
export const fetchComments = async (trackId) => {  // Renamed from fetchTrackComments
  return apiRequest('get', `/tracks/${trackId}/comments/`);
};

export const postComment = async (trackId, content) => {
  return apiRequest('post', `/tracks/${trackId}/comments/`, { content });
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
  return apiRequest('get', `/churches/?${queryString}`);
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
// ==================== VIDEO STUDIOS ====================
export const fetchVideoStudios = async (params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  return apiRequest('get', `/video-studios/?${queryString}`);
};

export const fetchVideoStudioById = async (id) => {
  return apiRequest('get', `/video-studios/${id}/`);
};

export const fetchMyVideoStudios = async () => {
  return apiRequest('get', '/video-studios/my_videostudios/');
};

export const createVideoStudio = async (formData) => {
  return apiRequest('post', '/video-studios/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

export const updateVideoStudio = async (id, formData) => {
  return apiRequest('patch', `/video-studios/${id}/`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
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
  return apiRequest('get', `/choirs/?${queryString}`);
};

export const fetchChoirById = async (id) => {
  return apiRequest('get', `/choirs/${id}/`);
};

export const fetchMyChoirs = async () => {
  return apiRequest('get', '/choirs/my_choirs/');
};

export const createChoir = async (formData) => {
  return apiRequest('post', '/choirs/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

export const updateChoir = async (id, formData) => {
  return apiRequest('patch', `/choirs/${id}/`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

export const deleteChoir = async (id) => {
  return apiRequest('delete', `/choirs/${id}/`);
};

export const addChoirMember = async (choirId, userId) => {
  return apiRequest('post', `/choirs/${choirId}/add_member/`, { user_id: userId });
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
      return data;
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

// export const requestJoinGroup = async (slug, message = "") => {
//   const formData = new FormData();
//   formData.append('message', message);
  
//   return apiRequest('post', `/groups/${slug}/request-join/`, formData, {
//     headers: {
//       'Content-Type': 'multipart/form-data'
//     }
//   });
// };
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



export const fetchGroupPosts = async (slug) => {
  return apiRequest('get', `/groups/${slug}/posts/`);
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
export const fetchGroupJoinRequests = async (slug) => {
  return apiRequest('get', `/groups/${slug}/join-requests/`);
};

export const approveJoinRequest = async (requestId) => {
  return apiRequest('post', `/group-join-requests/${requestId}/approve/`);
};

export const rejectJoinRequest = async (requestId) => {
  return apiRequest('post', `/group-join-requests/${requestId}/reject/`);
};

export const fetchGroupMembers = async (slug) => {
  return apiRequest('get', `/groups/${slug}/members/`);
};

// ... other exports
export const createGroupPost = async (content, groupSlug, attachments = []) => {
  const formData = new FormData();
  formData.append('content', content || '');
  
  // Handle attachments properly
  attachments.forEach((attachment) => {
    formData.append('attachments', {
      uri: attachment.uri,
      type: attachment.mimeType || getMimeType(attachment.type),
      name: attachment.name || `attachment_${Date.now()}.${getFileExtension(attachment.type)}`,
    });
  });

  return apiRequest('post', `/groups/${groupSlug}/posts/`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};
// export const checkGroupMembership = async (groupSlug) => {
//   try {
//     const response = await apiRequest('get', `/groups/${groupSlug}/check-membership/`);
//     return response;
//   } catch (error) {
//     console.error('Failed to check group membership:', error);
//     throw error;
//   }
// };
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

// Helper functions for file types
const getMimeType = (type) => {
  switch (type) {
    case 'image': return 'image/jpeg';
    case 'video': return 'video/mp4';
    case 'audio': return 'audio/m4a';
    case 'document': return 'application/octet-stream';
    default: return 'application/octet-stream';
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
  favoriteTrack,
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
  addChoirMember,
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
};