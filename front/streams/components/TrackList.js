
import React, { useState, useRef, useCallback } from "react";
import { 
  View, 
  Text, 
  FlatList, 
  StyleSheet, 
  ActivityIndicator, 
  TouchableOpacity,
  RefreshControl 
} from "react-native";
import { useFocusEffect } from '@react-navigation/native';
import { fetchTracks } from "../services/api";
import TrackItem from "./TrackItem";
import SearchBar from "./SearchBar";
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { usePlayer } from '../context/PlayerContext';
import { colors } from '../constants/theme';

const TrackList = () => {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation();
  const { playQueue } = usePlayer();

  // The active search term drives server-side filtering. A ref mirrors it so
  // loadMore / focus reloads read the latest value without stale closures.
  const searchRef = useRef('');
  const debounceRef = useRef(null);

  // Minimal playable shape for the queue (mini-player reads these fields).
  const buildQueue = useCallback(
    () => tracks.map(t => ({
      id: t.id,
      title: t.title,
      album: t.album,
      artist: t.artist,
      cover_image: t.cover_image,
      audio_file: t.audio_file,
    })),
    [tracks]
  );

  // Memoized Cloudinary transformation function
  const getOptimizedMediaUrl = useCallback((url, type = 'image') => {
    if (!url) return null;
    
    if (url.includes('res.cloudinary.com')) {
      const transformations = {
        image: 'w_300,h_300,c_fill,q_auto,f_auto',
        audio: 'q_auto',
        profile: 'w_50,h_50,c_fill,q_auto'
      };
      return url.replace('/upload/', `/upload/${transformations[type]}/`);
    }
    return url;
  }, []);

  const processTrack = useCallback((track) => ({
    ...track,
    cover_image: getOptimizedMediaUrl(track.cover_image, 'image'),
    audio_file: getOptimizedMediaUrl(track.audio_file, 'audio'),
  }), [getOptimizedMediaUrl]);

  const loadTracks = useCallback(async (search = searchRef.current) => {
    try {
      setRefreshing(true);
      setError(null);
      const response = await fetchTracks(1, search);
      const results = (response?.results ?? []).map(processTrack);
      setTracks(results);
      setPage(1);
      setHasMore(!!response?.next);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load tracks');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [processTrack]);

  const loadMoreTracks = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const response = await fetchTracks(nextPage, searchRef.current);
      const more = (response?.results ?? []).map(processTrack);
      setTracks(prev => [...prev, ...more]);
      setPage(nextPage);
      setHasMore(!!response?.next);
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page, processTrack]);

  // Load data on focus and initial mount (preserving any active search).
  useFocusEffect(
    useCallback(() => {
      loadTracks(searchRef.current);
    }, [loadTracks])
  );

  const handleNewTrack = useCallback((newTrack) => {
    const optimizedTrack = {
      ...newTrack,
      cover_image: getOptimizedMediaUrl(newTrack.cover_image, 'image'),
      audio_file: getOptimizedMediaUrl(newTrack.audio_file, 'audio')
    };

    setTracks(prev => [optimizedTrack, ...prev]);
  }, [getOptimizedMediaUrl]);

  // Server-side search: debounce keystrokes so we hit the API once the user
  // pauses, then reload page 1 with the new term.
  const handleSearch = useCallback((searchTerm) => {
    const term = (searchTerm ?? '').trim();
    searchRef.current = term;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadTracks(term), 350);
  }, [loadTracks]);

  const handleRefresh = useCallback(() => {
    loadTracks(searchRef.current);
  }, [loadTracks]);

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1DB954" />
        <Text style={styles.loadingText}>Loading tracks...</Text>
      </View>
    );
  }

  if (error && !refreshing) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity 
          style={styles.retryButton}
          onPress={loadTracks}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SearchBar onSearch={handleSearch} />

      {tracks.length > 0 && (
        <View style={styles.queueBar}>
          <TouchableOpacity
            style={styles.queueBtn}
            onPress={() => playQueue(buildQueue(), 0, { shuffle: false })}
            activeOpacity={0.85}
          >
            <Ionicons name="play" size={16} color="white" />
            <Text style={styles.queueBtnText}>Play all</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.queueBtn, styles.shuffleBtn]}
            onPress={() => playQueue(buildQueue(), 0, { shuffle: true })}
            activeOpacity={0.85}
          >
            <Ionicons name="shuffle" size={16} color={colors.primary} />
            <Text style={styles.shuffleBtnText}>Shuffle</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item, index }) => (
          <TrackItem
            track={item}
            onPlay={() => playQueue(buildQueue(), index)}
            onDelete={(deletedId) => {
              setTracks(prev => prev.filter(t => t.id !== deletedId));
            }}
            onRefresh={loadTracks}
          />
        )}
        contentContainerStyle={styles.trackList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={['#1DB954']}
            tintColor="#1DB954"
          />
        }
        onEndReached={loadMoreTracks}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore
            ? <ActivityIndicator size="small" color="#1DB954" style={{ marginVertical: 12 }} />
            : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {searchRef.current ? `No tracks match "${searchRef.current}"` : 'No tracks found'}
            </Text>
          </View>
        }
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={5}
      />
      
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('UploadTrack')}
      >
        <MaterialIcons name="add" size={28} color="white" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#06245fff',
    borderRadius:15
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  error: {
    color: '#ff3333',
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#1DB954',
    padding: 10,
    borderRadius: 5,
  },
  retryText: {
    color: 'white',
    fontWeight: 'bold',
  },
  queueBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
  },
  queueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  queueBtnText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 13,
  },
  shuffleBtn: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  shuffleBtnText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },
  trackList: {
    paddingTop: 6,
    paddingBottom: 110,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 96,
    backgroundColor: '#1DB954',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    zIndex: 1,
  },
});

export default TrackList;