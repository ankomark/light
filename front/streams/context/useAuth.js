import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_URL } from '../services/api';

const DEFAULT_PROFILE_IMAGE = 'https://via.placeholder.com/150';

export const useAuth = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Helper function to process profile picture URL
  const processProfilePicture = (picture, size = 200) => {
    if (!picture) return DEFAULT_PROFILE_IMAGE;
    
    if (typeof picture === 'string') {
      // Handle Cloudinary URLs
      if (picture.includes('cloudinary')) {
        return picture.replace('/upload/', `/upload/w_${size},h_${size},c_fill/`);
      }
      // Handle Cloudinary public_ids
      return `https://res.cloudinary.com/YOUR_CLOUD_NAME/image/upload/w_${size},h_${size},c_fill/${picture}`;
    }
    
    // Handle Cloudinary resource objects
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

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = await AsyncStorage.getItem('accessToken');
        setIsAuthenticated(!!token);
        
        if (token) {
          const userData = await fetchUserProfile(token);
          setCurrentUser(userData);
        }
      } catch (error) {
        console.error('Error checking authentication:', error);
        setCurrentUser(null);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const updateUser = async () => {
    try {
      const token = await AsyncStorage.getItem('accessToken');
      if (token) {
        const userData = await fetchUserProfile(token);
        setCurrentUser(userData);
      }
    } catch (error) {
      console.error('Error updating user data:', error);
    }
  };

  const logout = async () => {
    await AsyncStorage.removeItem('accessToken');
    await AsyncStorage.removeItem('refreshToken');
    setCurrentUser(null);
    setIsAuthenticated(false);
  };

  return { 
    currentUser, 
    isAuthenticated, 
    isLoading, 
    logout,
    updateUser,
    processProfilePicture // Optionally expose if needed elsewhere
  };
};