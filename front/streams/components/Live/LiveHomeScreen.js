import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Alert
} from 'react-native';
import { useAuth } from '../../context/useAuth';
import { fetchLiveEvents } from '../../services/api';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useIsFocused } from '@react-navigation/native';

const LiveHomeScreen = ({ navigation, route }) => {
  // State management
  const { currentUser } = useAuth();
  const [state, setState] = useState({
    events: [],
    loading: true,
    refreshing: false,
    error: null
  });
  const isFocused = useIsFocused();

  // Memoized data fetcher
  const fetchData = useCallback(async (options = {}) => {
    try {
      setState(prev => ({
        ...prev,
        loading: !options.skipLoading,
        refreshing: !!options.forceRefresh,
        error: null
      }));

      const params = {
        is_active: 'true',
        ...options
      };

      const response = await fetchLiveEvents(params);
      
      if (!response?.results) {
        throw new Error('Invalid API response structure');
      }

      const processedEvents = response.results.map(event => ({
        ...event,
        thumbnail: event.thumbnail || getYoutubeThumbnail(event.youtube_url),
        is_live: event.is_live ?? true,
        viewers_count: event.viewers_count || 0
      }));

      setState(prev => ({
        ...prev,
        events: options.forceRefresh ? processedEvents : [...prev.events, ...processedEvents],
        loading: false,
        refreshing: false
      }));

    } catch (error) {
      console.error('Fetch error:', error);
      setState(prev => ({
        ...prev,
        error: error.message,
        loading: false,
        refreshing: false
      }));
    }
  }, []);

  // Event handlers
  const handleRefresh = useCallback(() => {
    fetchData({ forceRefresh: true, skipLoading: true });
  }, [fetchData]);

  const handleCreateEvent = useCallback(() => {
    navigation.navigate('LiveEventForm');
  }, [navigation]);

  const handleEventPress = useCallback((event) => {
    navigation.navigate('LiveEventPlayer', { event });
  }, [navigation]);

  // Effects
  useEffect(() => {
    if (isFocused) {
      fetchData({ initialLoad: true });
    }
  }, [isFocused, fetchData]);

  useEffect(() => {
    if (route.params?.newEvent) {
      setState(prev => ({
        ...prev,
        events: [route.params.newEvent, ...prev.events]
      }));
      navigation.setParams({ newEvent: null });
    }
  }, [route.params?.newEvent]);

  // Helper functions
  const getYoutubeThumbnail = (url) => {
    const videoId = extractYoutubeId(url);
    return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
  };

  const extractYoutubeId = (url) => {
    if (!url) return null;
    const patterns = [
      /youtube\.com\/live\/([^"&?\/\s]{11})/,
      /youtube\.com\/watch\?v=([^"&?\/\s]{11})/,
      /youtu\.be\/([^"&?\/\s]{11})/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match?.[1]) return match[1];
    }
    return null;
  };

  const formatTime = (dateString) => {
    try {
      const diff = (Date.now() - new Date(dateString)) / 1000;
      if (diff < 60) return 'Just now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    } catch {
      return '';
    }
  };

  // Render functions
  const renderEventCard = ({ item }) => (
    <EventCard 
      event={item}
      onPress={() => handleEventPress(item)}
    />
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Icon name="video-off" size={48} color="#ccc" />
      <Text style={styles.emptyText}>No live events found</Text>
      <TouchableOpacity 
        style={styles.createButton}
        onPress={handleCreateEvent}
      >
        <Text style={styles.createButtonText}>Go Live</Text>
      </TouchableOpacity>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.errorContainer}>
      <Icon name="alert-circle" size={48} color="#ff4444" />
      <Text style={styles.errorText}>{state.error}</Text>
      <TouchableOpacity 
        style={styles.retryButton}
        onPress={handleRefresh}
      >
        <Text style={styles.retryButtonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );

  // Main render
  if (state.error && !state.events.length) {
    return renderErrorState();
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Live Events</Text>
        <TouchableOpacity onPress={handleCreateEvent}>
          <Icon name="plus" size={24} color="#6200ee" />
        </TouchableOpacity>
      </View>

      {state.loading && !state.events.length ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6200ee" />
        </View>
      ) : (
        <FlatList
          data={state.events}
          renderItem={renderEventCard}
          keyExtractor={item => item.id.toString()}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.eventsContainer}
          refreshControl={
            <RefreshControl
              refreshing={state.refreshing}
              onRefresh={handleRefresh}
              colors={['#6200ee']}
            />
          }
          ListEmptyComponent={renderEmptyState()}
        />
      )}
    </View>
  );
};

// Sub-component for better organization
const EventCard = React.memo(({ event, onPress }) => (
  <TouchableOpacity style={styles.eventCard} onPress={onPress}>
    <View style={styles.thumbnailContainer}>
      <Image
        source={{ uri: event.thumbnail }}
        style={styles.thumbnail}
        defaultSource={require('../../assets/placeholder-video.jpg')}
      />
      <View style={[
        styles.statusBadge,
        event.is_live ? styles.liveBadge : styles.endedBadge
      ]}>
        <Icon
          name={event.is_live ? "access-point" : "access-point-off"}
          size={12}
          color="white"
        />
        <Text style={styles.statusText}>
          {event.is_live ? 'LIVE' : 'ENDED'}
        </Text>
      </View>
      <View style={styles.viewersCount}>
        <Icon name="account-eye" size={12} color="white" />
        <Text style={styles.viewersCountText}>{event.viewers_count}</Text>
      </View>
    </View>
    <View style={styles.eventInfo}>
      <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
      <View style={styles.creatorInfo}>
        <Image
          source={{ uri: event.user?.profile?.picture }}
          style={styles.avatar}
          defaultSource={require('../../assets/placeholder-avatar.jpg')}
        />
        <Text style={styles.username}>{event.user?.username || 'Unknown'}</Text>
      </View>
    </View>
  </TouchableOpacity>
));

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'white'
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold'
  },
  eventsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16
  },
  eventCard: {
    width: 280,
    marginRight: 16,
    backgroundColor: 'white',
    borderRadius: 8,
    overflow: 'hidden',
    elevation: 2
  },
  thumbnailContainer: {
    height: 160,
    position: 'relative'
  },
  thumbnail: {
    width: '100%',
    height: '100%'
  },
  statusBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4
  },
  liveBadge: {
    backgroundColor: '#ff0000'
  },
  endedBadge: {
    backgroundColor: '#666'
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    marginLeft: 4
  },
  viewersCount: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4
  },
  viewersCountText: {
    color: 'white',
    fontSize: 12,
    marginLeft: 4
  },
  eventInfo: {
    padding: 12
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8
  },
  creatorInfo: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8
  },
  username: {
    fontSize: 14,
    color: '#666'
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40
  },
  emptyText: {
    fontSize: 16,
    color: '#888',
    marginTop: 16,
    marginBottom: 24
  },
  createButton: {
    backgroundColor: '#6200ee',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 6
  },
  createButtonText: {
    color: 'white',
    fontWeight: '600'
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40
  },
  errorText: {
    fontSize: 16,
    color: '#ff4444',
    marginVertical: 16,
    textAlign: 'center'
  },
  retryButton: {
    backgroundColor: '#6200ee',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 6
  },
  retryButtonText: {
    color: 'white',
    fontWeight: '600'
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  }
});

export default LiveHomeScreen;