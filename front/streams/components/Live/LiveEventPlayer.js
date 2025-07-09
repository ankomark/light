import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Image, 
  TouchableOpacity, 
  ActivityIndicator,
  Linking,
  Share,
  Alert
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useAuth } from '../../context/useAuth';
import { endLiveEvent, incrementViewerCount } from '../../services/api';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';

const LiveEventPlayer = ({ route, navigation }) => {
  const { event: initialEvent } = route.params;
  const { currentUser } = useAuth();
  const [event, setEvent] = useState(initialEvent);
  const [loading, setLoading] = useState(true);
  const [isEnding, setIsEnding] = useState(false);

  const isOwner = currentUser?.id === event.user.id;

  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;
      
      const updateViewerCount = async () => {
        try {
          const updatedEvent = await incrementViewerCount(event.id);
          if (isActive) {
            setEvent(prev => ({ ...prev, viewers_count: updatedEvent.viewers_count }));
          }
        } catch (error) {
          console.error('Error updating viewer count:', error);
        }
      };
      
      if (event.is_live) {
        updateViewerCount();
      }
      
      return () => {
        isActive = false;
      };
    }, [event.id, event.is_live])
  );

  const handleEndEvent = async () => {
    setIsEnding(true);
    try {
      const updatedEvent = await endLiveEvent(event.id);
      setEvent(updatedEvent);
      Alert.alert('Success', 'Live event ended successfully');
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to end event');
    } finally {
      setIsEnding(false);
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Watch "${event.title}" live: ${event.youtube_url}`,
        title: event.title,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to share event');
    }
  };

  const handleOpenInYouTube = () => {
    Linking.openURL(event.youtube_url).catch(() => {
      Alert.alert('Error', 'Failed to open YouTube');
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.playerContainer}>
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#6200ee" />
          </View>
        )}
        <WebView
          source={{ uri: `https://www.youtube.com/embed/${extractYoutubeId(event.youtube_url)}` }}
          style={styles.webview}
          allowsFullscreenVideo
          onLoad={() => setLoading(false)}
          onError={() => {
            Alert.alert(
              'Error', 
              'Failed to load stream. Open in YouTube instead?',
              [
                { text: 'Cancel' },
                { text: 'Open', onPress: handleOpenInYouTube },
              ]
            );
          }}
        />
      </View>

      <View style={styles.infoContainer}>
        <Text style={styles.title}>{event.title}</Text>
        {event.description && (
          <Text style={styles.description}>{event.description}</Text>
        )}
        
        <View style={styles.metaContainer}>
          <View style={styles.userInfo}>
            <Image 
              source={{ uri: event.user.profile?.picture }} 
              style={styles.avatar}
            />
            <Text style={styles.username}>{event.user.username}</Text>
          </View>
          
          <View style={styles.viewerCount}>
            <Icon name="account" size={16} color="#666" />
            <Text style={styles.viewerCountText}>{event.viewers_count}</Text>
          </View>
        </View>

        <View style={styles.actionsContainer}>
          <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
            <Icon name="share-variant" size={24} color="#6200ee" />
            <Text style={styles.actionText}>Share</Text>
          </TouchableOpacity>
          
          {isOwner && event.is_live && (
            <TouchableOpacity 
              style={[styles.actionButton, styles.endButton]}
              onPress={handleEndEvent}
              disabled={isEnding}
            >
              {isEnding ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <Icon name="stop" size={24} color="white" />
                  <Text style={[styles.actionText, styles.endButtonText]}>End</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  playerContainer: {
    aspectRatio: 16/9,
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  infoContainer: {
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  description: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
  },
  metaContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 8,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
  },
  viewerCount: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewerCountText: {
    marginLeft: 4,
    fontSize: 16,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
  },
  actionButton: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 8,
    backgroundColor: '#f0f0f0',
  },
  actionText: {
    marginTop: 4,
    fontSize: 14,
  },
  endButton: {
    backgroundColor: '#ff4444',
  },
  endButtonText: {
    color: 'white',
  },
});

export default LiveEventPlayer;