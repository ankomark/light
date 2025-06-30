
import React, { useEffect, useState } from 'react';
import { View, Text, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { fetchProfile } from '../services/api';

const Profile = () => {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchUserProfile = async () => {
            try {
                const data = await fetchProfile(); // Fetch authenticated user's profile
                setProfile(data);
            } catch (error) {
                if (error.response?.status === 401) {
                    console.error('Unauthorized: Please log in again.');
                } else {
                    console.error('Error fetching profile:', error);
                }
            } finally {
                setLoading(false);
            }
        };

        fetchUserProfile();
    }, []);

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color="#007bff" />
                <Text>Loading profile...</Text>
            </View>
        );
    }

    if (!profile) {
        return (
            <View style={styles.centered}>
                <Text>No profile found. Please create one.</Text>
            </View>
        );
    }

    return (
        <View style={styles.profileContainer}>
            <View style={styles.profileCard}>
                <Text style={styles.profileTitle}>{profile.user.username}'s Profile</Text>
                <Image
                    source={{ uri: profile.picture }}
                    style={styles.profilePicture}
                />
                <Text style={styles.profileInfo}>Bio: {profile.bio || 'Not provided'}</Text>
                <Text style={styles.profileInfo}>Birth Date: {profile.birth_date || 'Not provided'}</Text>
                <Text style={styles.profileInfo}>Location: {profile.location || 'Not provided'}</Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    profileContainer: {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        padding: 20,
        backgroundColor: '#f8f9fa',
    },
    profileCard: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
        margin: 10,
        padding: 20,
        width: 300,
        alignItems: 'center',
        transition: 'transform 0.2s',
    },
    profileCardHover: {
        transform: [{ scale: 1.05 }],
    },
    profilePicture: {
        width: 100,
        height: 100,
        borderRadius: 50,
        marginBottom: 15,
    },
    profileTitle: {
        color: '#007bff',
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 10,
    },
    profileInfo: {
        color: '#555',
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 5,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
});

export default Profile;