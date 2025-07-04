import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity, 
  TextInput,
  ActivityIndicator
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { fetchTracks } from '../../services/api';

const SelectTrack = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { onSelect, currentTrack } = route.params;
  const [tracks, setTracks] = useState([]);
  const [filteredTracks, setFilteredTracks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTracks = async () => {
      try {
        const tracksData = await fetchTracks();
        setTracks(tracksData);
        setFilteredTracks(tracksData);
      } catch (error) {
        console.error('Error loading tracks:', error);
        Alert.alert('Error', 'Failed to load tracks');
      } finally {
        setLoading(false);
      }
    };

    loadTracks();
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredTracks(tracks);
    } else {
      const filtered = tracks.filter(track =>
        track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        track.artist.username.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredTracks(filtered);
    }
  }, [searchQuery, tracks]);

  const handleSelect = (track) => {
    onSelect(track);
    navigation.goBack();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1D478B" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search tracks..."
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      {currentTrack && (
        <TouchableOpacity 
          style={styles.currentTrack}
          onPress={() => handleSelect(null)}
        >
          <Text style={styles.currentTrackText}>
            Remove current track link
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={filteredTracks}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={styles.trackItem}
            onPress={() => handleSelect(item)}
          >
            <Text style={styles.trackTitle}>{item.title}</Text>
            <Text style={styles.trackArtist}>{item.artist.username}</Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No tracks found</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
  },
  currentTrack: {
    backgroundColor: '#f0f7ff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1D478B',
  },
  currentTrackText: {
    color: '#1D478B',
    textAlign: 'center',
    fontWeight: '500',
  },
  listContent: {
    paddingBottom: 16,
  },
  trackItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  trackTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  trackArtist: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#888',
  },
});

export default SelectTrack;