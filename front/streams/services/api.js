import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { extractYoutubeId } from '../utils/youtubeUtils';
// Base URL configuration
export const API_BASE = 'https://light-backend-production.up.railway.app';
// const DEBUG = process.env.NODE_ENV === 'development';
// export const API_BASE = DEBUG ? 'http://192.168.1.126:8000' : 'https://light-backend-production.up.railway.app';

// Add timeout and error handling:
axios.defaults.timeout = 30000;
axios.defaults.headers.common['Content-Type'] = 'application/json';
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
      timeout: 60000,
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

export const fetchProducts = async (params = {}) => {
  try {
    const response = await axios.get(`${API_URL}/marketplace/products/`, { params });
    console.log('Raw FetchProducts response:', response.data);
    const products = response.data.map(product => {
      // Directly use backend's numeric price_value and currency code
      const price = parseFloat(product.price);
      const quantity = parseInt(product.quantity);
      
      return {
        ...product,
        price: isNaN(price) ? 0 : price,
        quantity: isNaN(quantity) ? 0 : quantity,
        currency: product.currency || 'USD',
        is_owner: product.is_owner || false,
      };
    });
    
    return products;
  } catch (error) {
    console.error('Error fetching products:', error);
    
    if (error.response) {
      let errorMessage = 'Failed to fetch products from server';
      if (error.response.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.response.data?.detail) {
        errorMessage = error.response.data.detail;
      }
      throw new Error(errorMessage);
    } 
    
    if (error.request) {
      throw new Error('No response received from server. Check network or server status.');
    }
    
    throw new Error('Unexpected error occurred while fetching products');
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





































