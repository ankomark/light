// import { useState, useEffect } from 'react';
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import axios from 'axios';
// import { API_URL } from '../services/api';

// const DEFAULT_PROFILE_IMAGE = 'https://via.placeholder.com/150';

// export const useAuth = () => {
//   const [currentUser, setCurrentUser] = useState(null);
//   const [isAuthenticated, setIsAuthenticated] = useState(false);
//   const [isLoading, setIsLoading] = useState(true);

//   // Helper function to process profile picture URL
//   const processProfilePicture = (picture, size = 200) => {
//     if (!picture) return DEFAULT_PROFILE_IMAGE;
    
//     if (typeof picture === 'string') {
//       // Handle Cloudinary URLs
//       if (picture.includes('cloudinary')) {
//         return picture.replace('/upload/', `/upload/w_${size},h_${size},c_fill/`);
//       }
//       // Handle Cloudinary public_ids
//       return `https://res.cloudinary.com/YOUR_CLOUD_NAME/image/upload/w_${size},h_${size},c_fill/${picture}`;
//     }
    
//     // Handle Cloudinary resource objects
//     if (picture?.secure_url) return picture.secure_url;
//     if (picture?.url) return picture.url;
    
//     return DEFAULT_PROFILE_IMAGE;
//   };

//   const fetchUserProfile = async (token) => {
//     try {
//       const response = await axios.get(`${API_URL}/profiles/me/`, {
//         headers: { Authorization: `Bearer ${token}` },
//       });
      
//       return {
//         ...response.data,
//         id: response.data.user_id,
//         profile_picture: processProfilePicture(response.data.picture || response.data.picture_url),
//         username: response.data.user?.username || response.data.username
//       };
//     } catch (error) {
//       console.error('Error fetching profile:', error);
//       return null;
//     }
//   };

//   useEffect(() => {
//     const checkAuth = async () => {
//       try {
//         const token = await AsyncStorage.getItem('accessToken');
//         setIsAuthenticated(!!token);
        
//         if (token) {
//           const userData = await fetchUserProfile(token);
//           setCurrentUser(userData);
//         }
//       } catch (error) {
//         console.error('Error checking authentication:', error);
//         setCurrentUser(null);
//         setIsAuthenticated(false);
//       } finally {
//         setIsLoading(false);
//       }
//     };

//     checkAuth();
//   }, []);

//   const updateUser = async () => {
//     try {
//       const token = await AsyncStorage.getItem('accessToken');
//       if (token) {
//         const userData = await fetchUserProfile(token);
//         setCurrentUser(userData);
//       }
//     } catch (error) {
//       console.error('Error updating user data:', error);
//     }
//   };

//   const logout = async () => {
//     await AsyncStorage.removeItem('accessToken');
//     await AsyncStorage.removeItem('refreshToken');
//     setCurrentUser(null);
//     setIsAuthenticated(false);
//   };

//   return { 
//     currentUser, 
//     isAuthenticated, 
//     isLoading, 
//     logout,
//     updateUser,
//     processProfilePicture // Optionally expose if needed elsewhere
//   };
// };

// context/useAuth.js
import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_URL } from '../services/api';

const DEFAULT_PROFILE_IMAGE = 'https://via.placeholder.com/150';

export const useAuth = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const processProfilePicture = (picture, size = 200) => {
    if (!picture) return DEFAULT_PROFILE_IMAGE;
    
    if (typeof picture === 'string') {
      if (picture.includes('cloudinary')) {
        return picture.replace('/upload/', `/upload/w_${size},h_${size},c_fill/`);
      }
      return `https://res.cloudinary.com/YOUR_CLOUD_NAME/image/upload/w_${size},h_${size},c_fill/${picture}`;
    }
    
    if (picture?.secure_url) return picture.secure_url;
    if (picture?.url) return picture.url;
    
    return DEFAULT_PROFILE_IMAGE;
  };

  const fetchUserProfile = async (token) => {
    try {
      const response = await axios.get(`${API_URL}/profiles/me/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      return {
        ...response.data,
        id: response.data.user_id,
        profile_picture: processProfilePicture(response.data.picture || response.data.picture_url),
        username: response.data.user?.username || response.data.username
      };
    } catch (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
  };

  const checkAuthStatus = async () => {
    try {
      const accessToken = await AsyncStorage.getItem('accessToken');
      const refreshToken = await AsyncStorage.getItem('refreshToken');
      
      if (!accessToken || !refreshToken) {
        setIsAuthenticated(false);
        setCurrentUser(null);
        return;
      }

      // Verify if access token is still valid
      try {
        const userData = await fetchUserProfile(accessToken);
        setCurrentUser(userData);
        setIsAuthenticated(true);
      } catch (error) {
        // If access token is invalid, try to refresh it
        if (error.response?.status === 401) {
          try {
            const response = await axios.post(`${API_URL}/auth/token/refresh/`, {
              refresh: refreshToken
            });
            
            await AsyncStorage.setItem('accessToken', response.data.access);
            const userData = await fetchUserProfile(response.data.access);
            setCurrentUser(userData);
            setIsAuthenticated(true);
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

  const clearAuthData = async () => {
    await AsyncStorage.multiRemove(['accessToken', 'refreshToken']);
    setCurrentUser(null);
    setIsAuthenticated(false);
  };

  // context/useAuth.js
const login = async (username, password) => {
  try {
    const response = await axios.post(`${API_URL}/auth/token/`, { username, password });
    
    // Validate the response contains tokens
    if (!response.data?.access || !response.data?.refresh) {
      throw new Error('Invalid response from server - missing tokens');
    }

    // Store tokens securely
    await AsyncStorage.multiSet([
      ['accessToken', response.data.access],
      ['refreshToken', response.data.refresh]
    ]);

    // Fetch user profile
    const userData = await fetchUserProfile(response.data.access);
    setCurrentUser(userData);
    setIsAuthenticated(true);
    
    return true; // Login success
  } catch (error) {
    console.error('Login failed:', error);
    await clearAuthData(); // Clear any partial auth data
    throw error; // Re-throw to handle in the login page
  }
};;

  const logout = async () => {
    await clearAuthData();
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  return { 
    currentUser, 
    isAuthenticated, 
    isLoading, 
    login,
    logout,
    updateUser: fetchUserProfile,
    processProfilePicture
  };
};