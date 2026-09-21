
import React, { useState, useRef, useCallback, useEffect } from "react";
import { 
  View, 
  Text, 
  FlatList, 
  StyleSheet, 
  ActivityIndicator, 
  TouchableOpacity,
  RefreshControl 
} from "react-native";
import { Image } from 'expo-image';
import { useFocusEffect , useNavigation } from '@react-navigation/native';
import { fetchTracks, fetchShuffledTracks } from "../services/api";
import TrackItem from "./TrackItem";
import SearchBar from "./SearchBar";
import { TrackListSkeleton } from './SkeletonLoader';
import { MaterialIcons, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { usePlayer } from '../context/PlayerContext';
import { useAuth } from '../context/useAuth';
import { peekCache, readCache, writeCache, userKey } from '../utils/screenCache';
import { useContentWidth, FONT_SCALE } from '../utils/layout';
import { colors } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

// The library changes slowly — new uploads, not per-second churn — so an
// hour-old first page is a perfectly good thing to open on while we revalidate.
const TRACKS_MAX_AGE_MS = 60 * 60 * 1000;

const TrackList = () => {
  const { t } = useI18n();
  const { currentUser } = useAuth();
  // Same centered column the feed uses. On a phone this is the full width and
  // nothing changes; on a tablet the library stops stretching a 60px cover and
  // a title across 800px of empty row.
  const { sideMargin } = useContentWidth({ gutter: 0 });
  const cacheKey = userKey(currentUser?.id, 'tracks');
  // Open on the last page-one we saw instead of a centered spinner. Same rule
  // as the feed: `loading` means "nothing to show", not "a request is running".
  const [tracks, setTracks] = useState(() => peekCache(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => (peekCache(cacheKey) ?? []).length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const navigation = useNavigation();
  const { playQueue } = usePlayer();

  // The active search term drives server-side filtering. A ref mirrors it so
  // loadMore / focus reloads read the latest value without stale closures.
  const searchRef = useRef('');
  const debounceRef = useRef(null);
  const lastFetchRef = useRef(0);   // throttle auto-reload on tab focus

  // Mirrors `tracks` for callbacks that must not change identity when a page is
  // appended — buildQueue used to depend on `tracks`, so every "load more"
  // rebuilt each row's onPlay prop and re-rendered the whole visible list.
  const tracksRef = useRef(tracks);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  // Minimal playable shape for the queue (mini-player reads these fields).
  const buildQueue = useCallback(
    () => tracksRef.current.map(t => ({
      id: t.id,
      title: t.title,
      album: t.album,
      artist: t.artist,
      cover_image: t.cover_image,
      audio_file: t.audio_file,
      // Not the lyrics themselves — NowPlaying fetches them for the track being
      // played, so a queue is a list of pointers rather than a pile of text.
      has_lyrics: t.has_lyrics,
    })),
    []
  );

  // Shuffle spans the whole library, not just the tracks scrolled into view:
  // one request pulls a capped random sample from the server, then the player
  // shuffles + plays it (streaming one track at a time). Falls back to the
  // loaded tracks if the request fails.
  const shuffleAll = useCallback(async () => {
    if (shuffling) return;
    setShuffling(true);
    try {
      const sample = await fetchShuffledTracks(200, searchRef.current);
      if (sample.length) playQueue(sample, 0, { shuffle: true });
      else if (tracks.length) playQueue(buildQueue(), 0, { shuffle: true });
    } catch {
      if (tracks.length) playQueue(buildQueue(), 0, { shuffle: true });
    } finally {
      setShuffling(false);
    }
  }, [shuffling, playQueue, buildQueue, tracks.length]);

  // Warm the cover art for a batch so rows paint with artwork already decoded
  // rather than filling in one by one as the user scrolls.
  const prefetchCovers = useCallback((list) => {
    const urls = list.map(tr => tr.cover_image).filter(Boolean);
    if (urls.length) Image.prefetch(urls).catch(() => {});
  }, []);

  // Cold start: fill from disk. Guarded on emptiness so it can never overwrite
  // rows already on screen or a response that has already landed.
  useEffect(() => {
    let cancelled = false;
    readCache(cacheKey, TRACKS_MAX_AGE_MS).then((cached) => {
      if (cancelled || !Array.isArray(cached) || !cached.length) return;
      setTracks((prev) => (prev.length ? prev : cached));
      setLoading(false);
      prefetchCovers(cached);
    });
    return () => { cancelled = true; };
  }, [cacheKey, prefetchCovers]);

  const loadTracks = useCallback(async (search = searchRef.current) => {
    try {
      setRefreshing(true);
      setError(null);
      const response = await fetchTracks(1, search);
      // Media URLs are absolute (R2) and served as-is; no client rewriting.
      const results = response?.results ?? [];
      setTracks(results);
      setPage(1);
      setHasMore(!!response?.next);
      lastFetchRef.current = Date.now();
      prefetchCovers(results);
      // Page one of the unfiltered library is what this screen opens on next
      // time; a search result is not.
      if (!search && results.length) writeCache(cacheKey, results);
    } catch (err) {
      setError(err.response?.data?.message || err.message || t('music.loadTracksFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t, cacheKey, prefetchCovers]);

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
      prefetchCovers(more);
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page, prefetchCovers]);

  // Reload on focus, but throttled — don't refetch the whole list on every tab
  // switch (only when it's been a while, or the list is empty).
  useFocusEffect(
    useCallback(() => {
      if (tracksRef.current.length === 0 || Date.now() - lastFetchRef.current > 120000) {
        loadTracks(searchRef.current);
      }
    }, [loadTracks])
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

  const handleDelete = useCallback((deletedId) => {
    setTracks(prev => prev.filter(tr => tr.id !== deletedId));
  }, []);

  // Play from this row's position in the current queue. Stable, so it doesn't
  // re-create every row's props — it reads the queue through tracksRef.
  const handlePlay = useCallback((index) => {
    playQueue(buildQueue(), index);
  }, [playQueue, buildQueue]);

  // Stable identities: an inline renderItem is a new function every render, so
  // React.memo on TrackItem could never hold and the whole visible list
  // re-rendered on any state change (a like, a page append, a search keystroke).
  const renderItem = useCallback(({ item, index }) => (
    <TrackItem
      track={item}
      index={index}
      onPlay={handlePlay}
      onDelete={handleDelete}
      onRefresh={loadTracks}
    />
  ), [handlePlay, handleDelete, loadTracks]);

  const keyExtractor = useCallback((item) => item.id.toString(), []);

  // A hard error with nothing to fall back on still gets the retry screen; if
  // we have cached rows we keep showing them and let pull-to-refresh retry,
  // because usable stale rows beat an error page.
  if (error && !refreshing && tracks.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => loadTracks()}
        >
          <Text style={styles.retryText}>{t('feed.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SearchBar onSearch={handleSearch} />

      <View style={[styles.queueBar, { marginHorizontal: sideMargin }]}>
        {tracks.length > 0 && (
          <>
            <TouchableOpacity
              style={styles.queueBtn}
              onPress={() => playQueue(buildQueue(), 0, { shuffle: false })}
              activeOpacity={0.85}
            >
              <Ionicons name="play" size={16} color="white" />
              <Text style={styles.queueBtnText} maxFontSizeMultiplier={FONT_SCALE.chrome}>{t('music.playAll')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.queueBtn, styles.shuffleBtn]}
              onPress={shuffleAll}
              disabled={shuffling}
              activeOpacity={0.85}
            >
              {shuffling ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="shuffle" size={16} color={colors.primary} />
              )}
              <Text style={styles.shuffleBtnText} maxFontSizeMultiplier={FONT_SCALE.chrome}>{t('music.shuffle')}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          style={[styles.queueBtn, styles.playlistsBtn]}
          onPress={() => navigation.navigate('Playlists')}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons name="playlist-music" size={16} color={colors.primary} />
          <Text style={styles.shuffleBtnText} maxFontSizeMultiplier={FONT_SCALE.chrome}>{t('playlist.title')}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={tracks}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={[styles.trackList, { paddingHorizontal: sideMargin }]}
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
          // First load with nothing cached: skeleton rows, not a blank screen —
          // the list fills in place instead of appearing all at once.
          loading
            ? <TrackListSkeleton count={8} />
            : (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {searchRef.current ? `No tracks match "${searchRef.current}"` : 'No tracks found'}
                </Text>
              </View>
            )
        }
        // No getItemLayout on purpose: the row's height is composed from theme
        // spacing tokens, so any hardcoded constant here would silently
        // misplace rows the day a token changes. Larger batches + clipping give
        // the scroll win without that trap.
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={11}
        removeClippedSubviews
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