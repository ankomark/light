import React from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAccessToken } from '../services/api';

const ProtectedRoute = ({ children }) => {
  const navigation = useNavigation();

  const checkAuthentication = async () => {
    const token = await getAccessToken().catch(() => null);
    if (!token) {
      navigation.navigate('Login'); // Redirect to Login if not authenticated
    }
  };

  React.useEffect(() => {
    checkAuthentication();
  }, []);

  return <>{children}</>; // Render children if authenticated
};

export default ProtectedRoute;
