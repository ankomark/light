
import React, { useState, useEffect } from "react";
import { 
  View, 
  Text, 
  FlatList, 
  StyleSheet, 
  ActivityIndicator, 
  TouchableOpacity 
} from "react-native";
import { useFocusEffect } from '@react-navigation/native';
import { fetchTracks } from "../services/api";
import TrackItem from "./TrackItem";
import SearchBar from "./SearchBar";
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

const TrackList = () => {
  const [tracks, setTracks] = useState([]);
  const [filteredTracks, setFilteredTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigation = useNavigation();

  const loadTracks = async () => {
    try {
      const data = await fetchTracks();
      const sortedTracks = [...data].sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
      setTracks(sortedTracks);
      setFilteredTracks(sortedTracks);
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load tracks. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      loadTracks();
      return () => {}; // Optional cleanup
    }, [])
  );
  const handleNewTrack = (newTrack) => {
    setTracks(prev => [newTrack, ...prev]);
    setFilteredTracks(prev => [newTrack, ...prev]);
  };

  const handleSearch = (searchTerm) => {
    if (searchTerm) {
      const filtered = tracks.filter((track) =>
        track.title.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredTracks(filtered);
    } else {
      setFilteredTracks(tracks);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007BFF" />
        <Text>Loading tracks...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Button title="Retry" onPress={loadTracks} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SearchBar onSearch={handleSearch} />
      <TouchableOpacity
        style={styles.topFab}
        onPress={() => navigation.navigate('UploadTrack', { onUploadSuccess: handleNewTrack })}
      >
        <MaterialIcons name="add" size={28} color="white" />
      </TouchableOpacity>
      <FlatList
        data={filteredTracks}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TrackItem 
            track={item}
            onDelete={(deletedId) => {
              setTracks(prev => prev.filter(t => t.id !== deletedId));
              setFilteredTracks(prev => prev.filter(t => t.id !== deletedId));
            }}
          />
        )}
        contentContainerStyle={styles.trackList}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  error: {
    color: 'red',
    marginBottom: 10,
  },
  trackList: {
    paddingHorizontal: 10,
  },
  topFab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    backgroundColor: '#1DB954',
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
    elevation: 4,
  },
});

export default TrackList;