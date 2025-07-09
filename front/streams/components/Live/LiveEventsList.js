import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  StyleSheet, 
  Image, 
  TouchableOpacity, 
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Alert
} from 'react-native';
import { useAuth } from '../../context/useAuth';
import { fetchLiveEvents } from '../../services/api';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;
const CACHE_KEY = 'cached_live_events_list';

const formatDistanceToNow = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`;
  return `${Math.floor(seconds/86400)}d ago`;
};

const LiveEventsList = ({ navigation, route }) => {
  const { currentUser } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const isFocused = useIsFocused();

  const fetchEvents = useCallback(async (pageNum = 1, refresh = false) => {
    try {
      setLoading(true);
      
      const params = {
        page: pageNum,
        page_size: 10,
        is_active: 'true'
      };
      
      const response = await fetchLiveEvents(params);
      const newEvents = response.results || [];
      
      if (refresh) {
        setEvents(newEvents);
      } else {
        setEvents(prev => [...prev, ...newEvents]);
      }
      
      setHasMore(response.next !== null);
      
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to load events');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) {
      fetchEvents();
    }
  }, [isFocused, fetchEvents]);

  useEffect(() => {
    if (route.params?.newEvent) {
      setEvents(prev => [route.params.newEvent, ...prev]);
      navigation.setParams({ newEvent: null });
    }
  }, [route.params?.newEvent]);

  const handleRefresh = () => {
    setRefreshing(true);
    setPage(1);
    fetchEvents(1, true);
  };

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      setPage(prev => prev + 1);
      fetchEvents(page + 1);
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.eventCard}
      onPress={() => navigation.navigate('LiveEventPlayer', { event: item })}
    >
      <Image 
        source={{ uri: item.thumbnail }} 
        style={styles.thumbnail}
      />
      <View style={styles.badge}>
        <Icon 
          name={item.is_live ? "access-point" : "access-point-off"} 
          size={14} 
          color="white" 
        />
        <Text style={styles.badgeText}>
          {item.is_live ? 'LIVE' : formatDistanceToNow(item.end_time || item.start_time)}
        </Text>
      </View>
      <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
      <View style={styles.userInfo}>
        <Image 
          source={{ uri: item.user?.profile?.picture }} 
          style={styles.avatar}
        />
        <Text style={styles.username}>{item.user?.username}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={events}
        renderItem={renderItem}
        keyExtractor={item => item.id.toString()}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="video-off" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No live events found</Text>
          </View>
        }
        ListFooterComponent={
          loading && events.length > 0 ? (
            <ActivityIndicator style={styles.loader} />
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  eventCard: {
    width: CARD_WIDTH,
    backgroundColor: 'white',
    borderRadius: 8,
    overflow: 'hidden',
    elevation: 2,
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 16/9,
  },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    marginLeft: 4,
  },
  title: {
    padding: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    paddingTop: 0,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  username: {
    fontSize: 12,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
  loader: {
    marginVertical: 20,
  },
});

export default LiveEventsList;