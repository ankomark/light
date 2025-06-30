import React, { useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Dimensions,StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import NotificationsBell from './NotificationsBell';
import { API_URL } from '../services/api';
const { width, height } = Dimensions.get('window');
import HamburgerMenu from '../components/HamburgerMenu';
import { SafeAreaView } from 'react-native-safe-area-context';


// const BASE_URL = 'http://192.168.1.126:8000/api';

const Header = () => {
    const navigation = useNavigation();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [profile, setProfile] = useState(null);

    useEffect(() => {
        const checkAuth = async () => {
            const token = await AsyncStorage.getItem('accessToken');
            setIsAuthenticated(!!token);
        };
        checkAuth();
    }, []);

    useEffect(() => {
        const checkProfile = async () => {
            try {
                const token = await AsyncStorage.getItem('accessToken');
                if (!token) return;

                const response = await axios.get(`${API_URL}/profiles/has_profile/`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });

                if (!response.data.profile_exists) {
                    navigation.navigate('CreateProfile');
                } else {
                    const profileResponse = await axios.get(`${API_URL}/profiles/me/`, {
                        headers: { Authorization: `Bearer ${token}` },
                      });
                    setProfile(profileResponse.data);
                }
            } catch (error) {
                console.error('Error checking profile:', error);
            }
        };

        if (isAuthenticated) checkProfile();
    }, [isAuthenticated, navigation]);

    const handleLogout = async () => {
        await AsyncStorage.removeItem('accessToken');
        await AsyncStorage.removeItem('refreshToken');
        setIsAuthenticated(false);
        navigation.navigate('Home');
    };

    return (
        <SafeAreaView edges={['top']} style={styles.safeArea}>
             <StatusBar backgroundColor="#102E50" barStyle="light-content" />
        
        <View style={styles.header}>
            {/* Top Row: Logo and Title */}
            <View style={styles.topRow}>
                <Image 
                    source={require('../assets/logo.png')} 
                    style={styles.logo} 
                />
                <Text style={styles.title}>ADVENT LIGHT</Text>
                <View style={styles.menuContainer}>
                    <HamburgerMenu />
                </View>
                

            </View>

            {/* Bottom Row: Navigation Links */}
            <View style={styles.bottomRow}>
                <TouchableOpacity onPress={() => navigation.navigate('Home')}>
                    <Ionicons name="home" size={width * 0.06} color="#FFF" />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => navigation.navigate('Music')}>
                    <MaterialIcons name="music-note" size={24} color="white" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => navigation.navigate('bible')}>
    <Ionicons name="book-outline" size={24} color="white" />
</TouchableOpacity>

                <NotificationsBell navigation={navigation} />

                <TouchableOpacity onPress={() => navigation.navigate('Hymns')}>
  <MaterialCommunityIcons name="piano" size={24} color="white" />
</TouchableOpacity>

                {isAuthenticated ? (
                    <>
                        <TouchableOpacity 
                            onPress={handleLogout} 
                            style={styles.logoutButton}
                        >
                            <Text style={styles.logoutButtonText}>Log Out</Text>
                        </TouchableOpacity>

                        {profile?.picture ? (
                            <Image
                                source={{ uri: profile.picture }}
                                style={styles.profilePicture}
                            />
                        ) : (
                            <View style={styles.profilePicturePlaceholder}>
                                <Ionicons 
                                    name="person" 
                                    size={width * 0.06} 
                                    color="#fff" 
                                />
                            </View>
                        )}
                    </>
                ) : (
                    <>
                        <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
                            <Text style={styles.navLink}>Sign Up</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                            <Text style={styles.navLink}>Log In</Text>
                        </TouchableOpacity>
                    </>
                )}
            </View>
        </View>
       </SafeAreaView> 
    );
};

const styles = StyleSheet.create({
      safeArea: {
        backgroundColor: '#102E50',
        borderBottomLeftRadius: 25,
        borderBottomRightRadius: 25,
    },
   
    header: {
        backgroundColor: '#102E50',
        paddingHorizontal: width * 0.03,
        paddingBottom: width * 0.03,
        // borderBottomLeftRadius: 15,
        // borderBottomRightRadius: 15,
       
        
   
    },
     menuContainer: {
        
        
        position: 'absolute', 
        right: width * 0.03, // Slight padding from the edge
        top: '40%', // Centers vertically (adjust as needed)
        transform: [{ translateY: -12 }], // Fine-tune vertical alignment
        zIndex: 10, // Ensures it stays above other elements


    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        marginBottom: height * 0.02,
    },
    logo: {
        height: width * 0.08,
        width: width * 0.08,
        borderRadius: width * 0.04,
        marginRight: width * 0.02,
    },
    title: {
        fontSize: width * 0.05,
        fontWeight:'900',
        color: 'orange',
        alignItems: 'center',
        justifyContent:'center',
        textAlign:'center',
        marginLeft:'20%',
        fontStyle:'italic',
        
        
    },
    bottomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
    },
    navLink: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: width * 0.035,
    },
    profilePicture: {
        width: width * 0.08,
        height: width * 0.08,
        borderRadius: width * 0.04,
    },
    profilePicturePlaceholder: {
        width: width * 0.08,
        height: width * 0.08,
        borderRadius: width * 0.04,
        backgroundColor: '#ccc',
        justifyContent: 'center',
        alignItems: 'center',
    },
    logoutButton: {
        // borderWidth: 1,
        // borderColor: 'red',
        borderRadius: 5,
        padding: width * 0.01,
    },
    logoutButtonText: {
        color: '#FFF',
        fontSize: width * 0.035,
    },
});

export default Header;