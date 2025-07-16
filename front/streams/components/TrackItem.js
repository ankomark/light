import React, { useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Alert, ActivityIndicator  } from 'react-native';
import PlayControls from './PlayControls';
import Likes from './LikeButton';
import Comments from './Comments';
import { MaterialIcons, FontAwesome } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_URL } from '../services/api';
import { useNavigation } from '@react-navigation/native';

const DEFAULT_PROFILE_IMAGE = 'https://via.placeholder.com/50';

// Cloudinary URL transformation helper
const getOptimizedUrl = (url, type = 'image') => {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  
  const transformations = {
    image: 'w_300,h_300,c_fill,q_auto,f_auto',
    audio: 'q_auto',
    profile: 'w_50,h_50,c_fill,q_auto'
  };
  
  return url.replace('/upload/', `/upload/${transformations[type]}/`);
};

const TrackItem = ({ track, currentUserId, onDelete, onRefresh }) => {
    const [isFavorite, setIsFavorite] = useState(false);
    const [artistProfile, setArtistProfile] = useState(null);
    const isOwner = track.is_owner;
    const navigation = useNavigation();
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState(null);

    // Apply Cloudinary optimizations
    const optimizedCover = getOptimizedUrl(track.cover_image, 'image');
    const optimizedAudio = getOptimizedUrl(track.audio_file, 'audio');
    const optimizedProfile = artistProfile?.picture 
      ? getOptimizedUrl(artistProfile.picture, 'profile') 
      : DEFAULT_PROFILE_IMAGE;

    useEffect(() => {
        const fetchArtistProfile = async () => {
          try {
            const token = await AsyncStorage.getItem('accessToken');
            if (!token) return;
            const response = await axios.get(
              `${API_URL}/profiles/by_user/${track.artist.id}/`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            setArtistProfile(response.data);
          } catch (error) {
            if (error.response?.status !== 404) console.error(error);
            setArtistProfile({ picture: DEFAULT_PROFILE_IMAGE });
          }
        };
    
        if (track?.artist?.id) {
          fetchArtistProfile();
        }
      }, [track.artist.id]);

    useEffect(() => {
        const fetchFavoriteStatus = async () => {
            try {
                const favoriteTracks = await getFavoriteTracks();
                setIsFavorite(favoriteTracks.some(fav => fav.id === track.id));
            } catch (error) {
                console.error('Error fetching favorite status:', error);
            }
        };
        fetchFavoriteStatus();
    }, [track.id]);
    
    const handleDelete = async () => {
        Alert.alert(
            "Delete Track",
            "Are you sure you want to delete this track?",
            [
                {
                    text: "Cancel",
                    style: "cancel"
                },
                { 
                    text: "Delete", 
                    onPress: async () => {
                        try {
                            const token = await AsyncStorage.getItem('accessToken');
                            await axios.delete(`${API_URL}/tracks/${track.id}/`, {
                                headers: { Authorization: `Bearer ${token}` }
                            });
                            onDelete(track.id);
                            Alert.alert("Success", "Track deleted successfully");
                        } catch (error) {
                            Alert.alert("Error", "Failed to delete track");
                        }
                    },
                    style: "destructive"
                }
            ]
        );
    };

    const handleDownload = async () => {
        if (!track.audio_file) {
            Alert.alert("Error", "Track file is missing!");
            return;
        }

        try {
            setIsDownloading(true);
            setDownloadProgress(0);
            setDownloadError(null);
            
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status !== 'granted') {
                throw new Error("Storage access is required to save the track.");
            }

            // Create a safe filename and directory
            const safeTrackId = track.id.toString().replace(/[^a-zA-Z0-9]/g, '_');
            const fileExtension = 'mp3'; // Force MP3 extension for consistency
            const fileName = `track_${safeTrackId}.${fileExtension}`;
            const downloadDir = `${FileSystem.documentDirectory}downloads/`;
            const fileUri = `${downloadDir}${fileName}`;

            // Ensure download directory exists
            await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true });

            const downloadResumable = FileSystem.createDownloadResumable(
                optimizedAudio,
                fileUri,
                {},
                (downloadProgress) => {
                    const progress = (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100;
                    setDownloadProgress(progress);
                }
            );

            const { uri } = await downloadResumable.downloadAsync();
            const asset = await MediaLibrary.createAssetAsync(uri);

            try {
                await MediaLibrary.createAlbumAsync("Music Downloads", asset, false);
            } catch (albumError) {
                console.warn('Album creation failed, saving to default location:', albumError);
            }

            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(uri);
            }
            
            Alert.alert("Success", "Track downloaded successfully");
        } catch (error) {
            console.error('Download error:', error);
            setDownloadError(error.message);
            Alert.alert(
                "Download Failed", 
                error.message || "An unexpected error occurred",
                [
                    { text: "OK", onPress: () => {} },
                    { text: "Retry", onPress: handleDownload }
                ]
            );
        } finally {
            setIsDownloading(false);
        }
    };

    const toggleFavorite = async (trackId) => {
        try {
            const newFavoriteStatus = !isFavorite;
            await updateFavoriteTrack(trackId, newFavoriteStatus);
            return { favorite: newFavoriteStatus };
        } catch (error) {
            console.error('Failed to toggle favorite:', error);
            throw error;
        }
    };

    const updateFavoriteTrack = async (trackId, isFavorite) => {
        try {
            let favoriteTracks = await getFavoriteTracks();
            if (isFavorite) {
                favoriteTracks.push({ id: trackId });
            } else {
                favoriteTracks = favoriteTracks.filter(track => track.id !== trackId);
            }
            await saveFavoriteTracks(favoriteTracks);
        } catch (error) {
            console.error('Error updating favorite tracks:', error);
            throw error;
        }
    };

    const getFavoriteTracks = async () => {
        return JSON.parse(await AsyncStorage.getItem('favoriteTracks')) || [];
    };

    const saveFavoriteTracks = async (tracks) => {
        await AsyncStorage.setItem('favoriteTracks', JSON.stringify(tracks));
    };

    
    const handleEdit = () => {
        navigation.navigate('EditTrack', { track, onRefresh });
      };

    const handleToggleFavorite = async () => {
        try {
            const result = await toggleFavorite(track.id);
            setIsFavorite(result.favorite);
        } catch (error) {
            console.error('Failed to toggle favorite:', error);
        }
    };


return (
        <View style={styles.trackItem}>
            {/* Header Section */}
            <View style={styles.header}>
                <View style={styles.artistContainer}>
                    <Image 
                        source={{ uri: optimizedProfile }} 
                        style={styles.artistImage} 
                    />
                    <Text style={styles.artistText}>{track.artist.username}</Text>
                </View>
                
                {isOwner && (
                    <View style={styles.ownerActions}>
                        <TouchableOpacity 
                            style={styles.editButton} 
                            onPress={() => navigation.navigate('EditTrack', { track, onRefresh })}
                        >
                            <MaterialIcons name="edit" size={20} color="white" />
                        </TouchableOpacity>
                        <TouchableOpacity 
                            style={styles.deleteButton} 
                            onPress={handleDelete}
                        >
                            <MaterialIcons name="delete" size={20} color="white" />
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            {/* Cover Image with Cloudinary optimizations */}
            <Image 
                source={{ uri: optimizedCover }} 
                style={styles.trackCover} 
            />

            {/* Track Title */}
            <Text style={styles.trackTitle}>{track.title}</Text>

            {/* Play Controls - passes optimized audio URL */}
            <PlayControls track={{ ...track, audio_file: optimizedAudio }} />

            {/* Bottom Actions */}
            <View style={styles.bottomSection}>
                <Likes trackId={track.id} initialLikes={track.likes_count} />
                <Comments trackId={track.id} />
                
                {isDownloading ? (
                    <View style={styles.downloadProgressContainer}>
                        <ActivityIndicator size="small" color="#1DB954" />
                        <Text style={styles.downloadProgressText}>
                            {Math.round(downloadProgress)}%
                        </Text>
                    </View>
                ) : (
                    <TouchableOpacity 
                        style={styles.downloadButton} 
                        onPress={handleDownload}
                        disabled={isDownloading}
                    >
                        <MaterialIcons 
                            name={downloadError ? "error" : "download"} 
                            size={20} 
                            color={downloadError ? '#ff3333' : 'white'} 
                        />
                    </TouchableOpacity>
                )}
                
                <TouchableOpacity 
                    style={styles.favoriteButton} 
                    onPress={handleToggleFavorite}
                >
                    <FontAwesome 
                        name="heart" 
                        size={20} 
                        color={isFavorite ? 'red' : 'gray'} 
                    />
                </TouchableOpacity>
            </View>
            
            {downloadError && (
                <Text style={styles.errorText}>
                    Download failed: {downloadError}
                </Text>
            )}
        </View>
    );
};
const styles = StyleSheet.create({
    trackItem: {
      
        borderRadius: 10,
        padding: 29,
        marginVertical: 10,
        backgroundColor: '#0c2756',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        paddingHorizontal: 10,
        marginBottom: 10,
    },
    ownerActions: {
        flexDirection: 'row',
        gap: 10,
    },
    artistContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    trackCover: {
        width: '100%',
        height: 200,
        borderRadius: 8,
        marginBottom: 6,
    },
    trackTitle: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    artistContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
      },
      artistImage: {
        width: 38,
        height: 35,
        borderRadius: 16,
        marginRight: 8,
      },
    artistText: {
        fontSize: 14,
        color: 'white',
        marginBottom: 8,
    },
    bottomSection: {
        // display:'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        marginTop: 8,
        paddingHorizontal: 10,
    },
    downloadButton: {
        padding: 10,
        borderRadius: 5,
        marginLeft: 10,
    },
    favoriteButton: {
        padding: 10,
        borderRadius: 5,
        marginLeft: 10,
    },
    editButton: {
        // backgroundColor: '#4CAF50',
        padding: 8,
        borderRadius: 5,
        // marginLeft: 10, 
    },
    deleteButton: {
        // backgroundColor: '#f44336',
        padding: 8,
        borderRadius: 5,
        // marginLeft: 10,
    },
    downloadProgressContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        borderRadius: 5,
        marginLeft: 10,
        minWidth: 60,
    },
    downloadProgressText: {
        color: 'white',
        fontSize: 12,
        marginLeft: 5,
    },
    errorText: {
        color: '#ff3333',
        fontSize: 12,
        marginTop: 5,
        textAlign: 'center',
    },
});

export default TrackItem;