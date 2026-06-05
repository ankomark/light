import React, { useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Dimensions, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/useAuth';  // Import useAuth
import NotificationsBell from './NotificationsBell';
import HamburgerMenu from '../components/HamburgerMenu';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

const Header = () => {
    const navigation = useNavigation();
    const {
        currentUser,
        isAuthenticated,
        isLoading,
        updateUser
    } = useAuth();  // Use the auth hook

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

                    <TouchableOpacity onPress={() => navigation.navigate('Explore')}>
                        <Ionicons name="search-outline" size={24} color="white" />
                    </TouchableOpacity>
                    
                    <TouchableOpacity onPress={() => navigation.navigate('bible')}>
                        <Ionicons name="book-outline" size={24} color="white" />
                    </TouchableOpacity>

                    <NotificationsBell navigation={navigation} />

                    <TouchableOpacity onPress={() => navigation.navigate('Hymns')}>
                        <MaterialCommunityIcons name="piano" size={24} color="white" />
                    </TouchableOpacity>

                    {isAuthenticated ? (
                        <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
                            <Image
                                source={{ uri: currentUser?.profile_picture }}
                                style={styles.profilePicture}
                                defaultSource={require('../assets/avatar-placeholder.jpg')}
                                onError={() => {}}
                            />
                        </TouchableOpacity>
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
    },
    header: {
        backgroundColor: '#102E50',
        paddingHorizontal: 15,
        paddingBottom: 10,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
    },
    logo: {
        width: 70,
        height: 40,
        resizeMode: 'contain',
     
    },
    title: {
        color: 'orange',
        fontSize: 20,
        fontWeight: 'bold',
        marginLeft: 10,
    },
    menuContainer: {
        marginLeft: 'auto',
    },
    bottomRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        paddingTop: 10,
    },
    profilePicture: {
        width: 35,
        height: 35,
        borderRadius: 17.5,
        borderWidth: 1,
        borderColor: 'white',
    },
    logoutButton: {
        paddingHorizontal: 10,
    },
    logoutButtonText: {
        color: 'white',
        fontWeight: 'bold',
    },
    navLink: {
        color: 'white',
        fontWeight: 'bold',
        paddingHorizontal: 10,
    },
});

export default Header;