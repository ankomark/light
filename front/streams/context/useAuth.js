import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_URL } from '../services/api';

export const useAuth = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = await AsyncStorage.getItem('accessToken');
        setIsAuthenticated(!!token);
        
        if (token) {
          const response = await axios.get(`${API_URL}/profiles/me/`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          console.log('useAuth - /profiles/me/ Response:', response.data);
          setCurrentUser({
            ...response.data,
            id: response.data.user_id || response.data.id || null, // Handle both
          });
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
        const response = await axios.get(`${API_URL}/profiles/me/`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log('useAuth - updateUser Response:', response.data);
        setCurrentUser({
          ...response.data,
          id: response.data.user_id || response.data.id || null,
        });
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
    updateUser
  };
};