import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import axios from 'axios';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../services/api';
import { useAuth } from '../context/useAuth';

const LoginPage = () => {
    const [formData, setFormData] = useState({ username: '', password: '' });
    const [error, setError] = useState('');
    const navigation = useNavigation();
    const { login } = useAuth();

    const handleChange = (name, value) => {
        setFormData({ ...formData, [name]: value });
    };

    const handleSubmit = async () => {
        try {
            // 1. Login to get tokens
            const response = await axios.post(`${API_URL}/auth/token/`, formData);
            const { access, refresh } = response.data;
            
            // 2. Save tokens
            await AsyncStorage.setItem('accessToken', access);
            await AsyncStorage.setItem('refreshToken', refresh);
            
            // 3. Check profile status
            try {
                const profileRes = await axios.get(`${API_URL}/profiles/me/`, {
                    headers: { Authorization: `Bearer ${access}` }
                });
                
                // 4. Navigate based on profile existence
                navigation.navigate(profileRes.data ? 'Home' : 'CreateProfile');
                
            } catch (profileError) {
                // Handle 404 (profile doesn't exist)
                if (profileError.response?.status === 404) {
                    navigation.navigate('CreateProfile');
                } else {
                    // Handle other errors
                    console.error('Profile check error:', profileError);
                    setError('Error checking profile status');
                    Alert.alert('Error', 'Failed to check profile status');
                }
            }
            
        } catch (error) {
            setError('Invalid username or password');
            Alert.alert('Login Failed', 'Invalid username or password');
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Log In</Text>
            <View style={styles.form}>
                <TextInput
                    style={styles.input}
                    placeholder="Username"
                    autoCompleteType="username"
                    value={formData.username}
                    onChangeText={(text) => handleChange('username', text)}
                    required
                />
                <TextInput
                    style={styles.input}
                    placeholder="Password"
                    autoCompleteType="password"
                    secureTextEntry={true}
                    value={formData.password}
                    onChangeText={(text) => handleChange('password', text)}
                    required
                />
                <TouchableOpacity style={styles.button} onPress={handleSubmit}>
                    <Text style={styles.buttonText}>Log In</Text>
                </TouchableOpacity>
            </View>
            {error && <Text style={styles.error}>{error}</Text>}
        </View>
    );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  form: {
    width: '100%',
  },
  input: {
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    backgroundColor: '#fff',
    marginBottom: 15,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  error: {
    color: 'red',
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
});

export default LoginPage;