// src/components/FavoritesPage.js
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { getFavoriteTracks } from '../services/api';
import TrackItem from './TrackItem';

const FavoritesPage = () => {
    const [favoriteTracks, setFavoriteTracks] = useState([]);

    useEffect(() => {
        const fetchFavorites = async () => {
            try {
                const data = await getFavoriteTracks();
                setFavoriteTracks(data);
            } catch (error) {
                console.error('Error fetching favorite tracks:', error);
            }
        };

        fetchFavorites();
    }, []); // Run only once when the page loads

    return (
        <View style={styles.container}>
            <Text style={styles.header}>My Favorite Tracks</Text>
            {favoriteTracks.length > 0 ? (
                <FlatList
                    data={favoriteTracks}
                    keyExtractor={(track) => track.id.toString()}
                    renderItem={({ item }) => <TrackItem track={item} />}
                />
            ) : (
                <Text style={styles.noFavorites}>No favorite tracks yet!</Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        backgroundColor: '#f9f9f9',
    },
    header: {
        fontSize: 24,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 20,
    },
    noFavorites: {
        textAlign: 'center',
        fontSize: 18,
        color: '#666',
    },
});

export default FavoritesPage;
