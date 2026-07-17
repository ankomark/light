
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
import { useFocusEffect , useNavigation } from '@react-navigation/native';
import { fetchTracks } from "../services/api";
import TrackItem from "./TrackItem";
import SearchBar from "./SearchBar";
import { MaterialIcons, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

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
  const lastFetchRef = useRef(0);   // throttle auto-reload on tab focus

  // Minimal playable shape for the queue (mini-player reads these fields).
  const buildQueue = useCallback(
    () => tracks.map(t => ({
      id: t.id,
      title: t.title,
      album: t.album,
      artist: t.artist,
      cover_image: t.cover_image,
      audio_file: t.audio_file,
      lyrics: t.lyrics,
    })),
    [tracks]
  );

  const loadTracks = useCallback(async (search = searchRef.current) => {
    try {
      setRefreshing(true);
      setError(null);
      const response = await fetchTracks(1, search);
      // Media URLs are absolute (R2) and served as-is; no client rewriting.
      setTracks(response?.results ?? []);
      setPage(1);
      setHasMore(!!response?.next);
      lastFetchRef.current = Date.now();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load tracks');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMoreTracks = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const response = await fetchTracks(nextPage, searchRef.current);
      const more = response?.results ?? [];
      setTracks(prev => [...prev, ...more]);
      setPage(nextPage);
      setHasMore(!!response?.next);
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page]);

  // Reload on focus, but throttled — don't refetch the whole list on every tab
  // switch (only when it's been a while, or the list is empty).
  useFocusEffect(
    useCallback(() => {
      if (tracks.length === 0 || Date.now() - lastFetchRef.current > 120000) {
        loadTracks(searchRef.current);
      }
    }, [loadTracks, tracks.length])
  );

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
        <ActivityIndicator size="large" color={colors.primary} />
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
          onPress={() => loadTracks()}
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SearchBar onSearch={handleSearch} />

      <View style={styles.queueBar}>
        {tracks.length > 0 && (
          <>
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
          </>
        )}
        <TouchableOpacity
          style={[styles.queueBtn, styles.playlistsBtn]}
          onPress={() => navigation.navigate('Playlists')}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons name="playlist-music" size={16} color={colors.primary} />
          <Text style={styles.shuffleBtnText}>Playlists</Text>
        </TouchableOpacity>
      </View>

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
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        onEndReached={loadMoreTracks}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore
            ? <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 12 }} />
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
    // Transparent so a parent wallpaper shows through; where there's none, the
    // dark scene bg (same colors.bg) shows, so other usages look unchanged.
    backgroundColor: 'transparent',
    borderRadius: 15,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    color: colors.textSecondary,
  },
  error: {
    color: colors.error,
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.primary,
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
  playlistsBtn: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: colors.primary,
    marginLeft: 'auto', // push to the right edge
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
    color: colors.textMuted,
    fontSize: 16,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 96,
    backgroundColor: colors.primary,
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