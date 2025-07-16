
// // import React, { useState, useEffect } from "react";
// // import { 
// //   View, 
// //   Text, 
// //   FlatList, 
// //   StyleSheet, 
// //   ActivityIndicator, 
// //   TouchableOpacity 
// // } from "react-native";
// // import { useFocusEffect } from '@react-navigation/native';
// // import { fetchTracks } from "../services/api";
// // import TrackItem from "./TrackItem";
// // import SearchBar from "./SearchBar";
// // import { MaterialIcons } from '@expo/vector-icons';
// // import { useNavigation } from '@react-navigation/native';

// // const TrackList = () => {
// //   const [tracks, setTracks] = useState([]);
// //   const [filteredTracks, setFilteredTracks] = useState([]);
// //   const [loading, setLoading] = useState(true);
// //   const [error, setError] = useState(null);
// //   const navigation = useNavigation();

// //   const loadTracks = async () => {
// //     try {
// //       const data = await fetchTracks();
// //       const sortedTracks = [...data].sort((a, b) => 
// //         new Date(b.created_at) - new Date(a.created_at)
// //       );
// //       setTracks(sortedTracks);
// //       setFilteredTracks(sortedTracks);
// //       setError(null);
// //     } catch (err) {
// //       setError(err.message || "Failed to load tracks. Please check your connection.");
// //     } finally {
// //       setLoading(false);
// //     }
// //   };

// //   useFocusEffect(
// //     React.useCallback(() => {
// //       loadTracks();
// //       return () => {}; // Optional cleanup
// //     }, [])
// //   );
// //   const handleNewTrack = (newTrack) => {
// //     setTracks(prev => [newTrack, ...prev]);
// //     setFilteredTracks(prev => [newTrack, ...prev]);
// //   };

// //   const handleSearch = (searchTerm) => {
// //     if (searchTerm) {
// //       const filtered = tracks.filter((track) =>
// //         track.title.toLowerCase().includes(searchTerm.toLowerCase())
// //       );
// //       setFilteredTracks(filtered);
// //     } else {
// //       setFilteredTracks(tracks);
// //     }
// //   };

// //   if (loading) {
// //     return (
// //       <View style={styles.center}>
// //         <ActivityIndicator size="large" color="#007BFF" />
// //         <Text>Loading tracks...</Text>
// //       </View>
// //     );
// //   }

// //   if (error) {
// //     return (
// //       <View style={styles.center}>
// //         <Text style={styles.error}>{error}</Text>
// //         <Button title="Retry" onPress={loadTracks} />
// //       </View>
// //     );
// //   }

// //   return (
// //     <View style={styles.container}>
// //       <SearchBar onSearch={handleSearch} />
// //       <TouchableOpacity
// //         style={styles.topFab}
// //         onPress={() => navigation.navigate('UploadTrack', { onUploadSuccess: handleNewTrack })}
// //       >
// //         <MaterialIcons name="add" size={28} color="white" />
// //       </TouchableOpacity>
// //       <FlatList
// //         data={filteredTracks}
// //         keyExtractor={(item) => item.id.toString()}
// //         renderItem={({ item }) => (
// //           <TrackItem 
// //             track={item}
// //             onDelete={(deletedId) => {
// //               setTracks(prev => prev.filter(t => t.id !== deletedId));
// //               setFilteredTracks(prev => prev.filter(t => t.id !== deletedId));
// //             }}
// //           />
// //         )}
// //         contentContainerStyle={styles.trackList}
// //       />
// //     </View>
// //   );
// // };

// // const styles = StyleSheet.create({
// //   container: {
// //     flex: 1,
// //     backgroundColor: '#f5f5f5',
// //   },
// //   center: {
// //     flex: 1,
// //     justifyContent: 'center',
// //     alignItems: 'center',
// //   },
// //   error: {
// //     color: 'red',
// //     marginBottom: 10,
// //   },
// //   trackList: {
// //     paddingHorizontal: 10,
// //   },
// //   topFab: {
// //     position: 'absolute',
// //     right: 20,
// //     bottom: 20,
// //     backgroundColor: '#1DB954',
// //     width: 56,
// //     height: 56,
// //     borderRadius: 28,
// //     justifyContent: 'center',
// //     alignItems: 'center',
// //     zIndex: 1,
// //     elevation: 4,
// //   },
// // });

// // export default TrackList;

// import React, { useState, useEffect } from "react";
// import { 
//   View, 
//   Text, 
//   FlatList, 
//   StyleSheet, 
//   ActivityIndicator, 
//   TouchableOpacity,
//   RefreshControl 
// } from "react-native";
// import { useFocusEffect } from '@react-navigation/native';
// import { fetchTracks } from "../services/api";
// import TrackItem from "./TrackItem";
// import SearchBar from "./SearchBar";
// import { MaterialIcons } from '@expo/vector-icons';
// import { useNavigation } from '@react-navigation/native';

// const TrackList = () => {
//   const [tracks, setTracks] = useState([]);
//   const [filteredTracks, setFilteredTracks] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);
//   const [refreshing, setRefreshing] = useState(false);
//   const navigation = useNavigation();

//   // Cloudinary transformations for optimized media
//   const getOptimizedCoverUrl = (url) => {
//     if (!url) return null;
//     if (url.includes('res.cloudinary.com')) {
//       // Apply Cloudinary transformations for thumbnails
//       return url.replace('/upload/', '/upload/w_300,h_300,c_fill,q_auto,f_auto/');
//     }
//     return url;
//   };

//   const loadTracks = async () => {
//     try {
//       setRefreshing(true);
//       const data = await fetchTracks();
      
//       // Process tracks with Cloudinary optimizations
//       const processedTracks = data.map(track => ({
//         ...track,
//         cover_image: getOptimizedCoverUrl(track.cover_image),
//         // Add audio file optimization if needed
//         audio_file: track.audio_file?.includes('cloudinary') 
//           ? track.audio_file.replace('/upload/', '/upload/q_auto/')
//           : track.audio_file
//       }));

//       const sortedTracks = [...processedTracks].sort((a, b) => 
//         new Date(b.created_at) - new Date(a.created_at)
//       );
      
//       setTracks(sortedTracks);
//       setFilteredTracks(sortedTracks);
//       setError(null);
//     } catch (err) {
//       console.error('Failed to load tracks:', err);
//       setError(err.message || "Failed to load tracks. Please check your connection.");
//     } finally {
//       setLoading(false);
//       setRefreshing(false);
//     }
//   };

//   useFocusEffect(
//     React.useCallback(() => {
//       let isActive = true;
      
//       const loadData = async () => {
//         if (isActive) {
//           await loadTracks();
//         }
//       };
      
//       loadData();
      
//       return () => {
//         isActive = false;
//       };
//     }, [])
//   );

//   const handleNewTrack = (newTrack) => {
//     // Apply Cloudinary optimizations to new track
//     const optimizedTrack = {
//       ...newTrack,
//       cover_image: getOptimizedCoverUrl(newTrack.cover_image)
//     };
    
//     setTracks(prev => [optimizedTrack, ...prev]);
//     setFilteredTracks(prev => [optimizedTrack, ...prev]);
//   };

//   const handleSearch = (searchTerm) => {
//     if (searchTerm) {
//       const filtered = tracks.filter((track) =>
//         track.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
//         (track.album && track.album.toLowerCase().includes(searchTerm.toLowerCase()))
//       );
//       setFilteredTracks(filtered);
//     } else {
//       setFilteredTracks(tracks);
//     }
//   };

//   const handleRefresh = () => {
//     loadTracks();
//   };

//   if (loading && !refreshing) {
//     return (
//       <View style={styles.center}>
//         <ActivityIndicator size="large" color="#1DB954" />
//         <Text style={styles.loadingText}>Loading tracks...</Text>
//       </View>
//     );
//   }

//   if (error && !refreshing) {
//     return (
//       <View style={styles.center}>
//         <Text style={styles.error}>{error}</Text>
//         <TouchableOpacity 
//           style={styles.retryButton}
//           onPress={loadTracks}
//         >
//           <Text style={styles.retryText}>Retry</Text>
//         </TouchableOpacity>
//       </View>
//     );
//   }

//   return (
//     <View style={styles.container}>
//       <SearchBar onSearch={handleSearch} />
      
//       <FlatList
//         data={filteredTracks}
//         keyExtractor={(item) => item.id.toString()}
//         renderItem={({ item }) => (
//           <TrackItem 
//             track={item}
//             onDelete={(deletedId) => {
//               setTracks(prev => prev.filter(t => t.id !== deletedId));
//               setFilteredTracks(prev => prev.filter(t => t.id !== deletedId));
//             }}
//           />
//         )}
//         contentContainerStyle={styles.trackList}
//         refreshControl={
//           <RefreshControl
//             refreshing={refreshing}
//             onRefresh={handleRefresh}
//             colors={['#1DB954']}
//             tintColor="#1DB954"
//           />
//         }
//         ListEmptyComponent={
//           <View style={styles.emptyContainer}>
//             <Text style={styles.emptyText}>No tracks found</Text>
//           </View>
//         }
//       />
      
//       <TouchableOpacity
//         style={styles.fab}
//         onPress={() => navigation.navigate('UploadTrack', { onUploadSuccess: handleNewTrack })}
//       >
//         <MaterialIcons name="add" size={28} color="white" />
//       </TouchableOpacity>
//     </View>
//   );
// };

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//     backgroundColor: '#121212', // Dark mode friendly
//   },
//   center: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: '#121212',
//   },
//   loadingText: {
//     color: '#ffffff',
//     marginTop: 10,
//   },
//   error: {
//     color: '#ff4d4d',
//     marginBottom: 20,
//     textAlign: 'center',
//     paddingHorizontal: 20,
//   },
//   trackList: {
//     paddingBottom: 80, // Space for FAB
//   },
//   fab: {
//     position: 'absolute',
//     right: 20,
//     bottom: 20,
//     backgroundColor: '#1DB954',
//     width: 56,
//     height: 56,
//     borderRadius: 28,
//     justifyContent: 'center',
//     alignItems: 'center',
//     zIndex: 1,
//     elevation: 4,
//     shadowColor: '#000',
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.3,
//     shadowRadius: 3,
//   },
//   retryButton: {
//     backgroundColor: '#1DB954',
//     paddingVertical: 10,
//     paddingHorizontal: 20,
//     borderRadius: 20,
//     marginTop: 10,
//   },
//   retryText: {
//     color: 'white',
//     fontWeight: 'bold',
//   },
//   emptyContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     paddingTop: 100,
//   },
//   emptyText: {
//     color: '#888',
//     fontSize: 16,
//   },
// });

// export default TrackList;


import React, { useState, useEffect, useCallback } from "react";
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
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

const TrackList = () => {
  const [tracks, setTracks] = useState([]);
  const [filteredTracks, setFilteredTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation();

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

  const loadTracks = useCallback(async () => {
    try {
      setRefreshing(true);
      const data = await fetchTracks();
      
      // Process tracks with optimized media URLs
      const processedTracks = data.map(track => ({
        ...track,
        cover_image: getOptimizedMediaUrl(track.cover_image, 'image'),
        audio_file: getOptimizedMediaUrl(track.audio_file, 'audio')
      }));

      // Sort by creation date (newest first)
      const sortedTracks = [...processedTracks].sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
      
      setTracks(sortedTracks);
      setFilteredTracks(sortedTracks);
      setError(null);
    } catch (err) {
      console.error('Failed to load tracks:', err);
      setError(err.response?.data?.message || err.message || "Failed to load tracks");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getOptimizedMediaUrl]);

  // Load data on focus and initial mount
  useFocusEffect(
    useCallback(() => {
      loadTracks();
    }, [loadTracks])
  );

  const handleNewTrack = useCallback((newTrack) => {
    const optimizedTrack = {
      ...newTrack,
      cover_image: getOptimizedMediaUrl(newTrack.cover_image, 'image'),
      audio_file: getOptimizedMediaUrl(newTrack.audio_file, 'audio')
    };
    
    setTracks(prev => [optimizedTrack, ...prev]);
    setFilteredTracks(prev => [optimizedTrack, ...prev]);
  }, [getOptimizedMediaUrl]);

  const handleSearch = useCallback((searchTerm) => {
    if (!searchTerm) {
      setFilteredTracks(tracks);
      return;
    }
    
    const filtered = tracks.filter((track) =>
      track.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (track.album && track.album.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    setFilteredTracks(filtered);
  }, [tracks]);

  const handleRefresh = useCallback(() => {
    loadTracks();
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
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No tracks found</Text>
          </View>
        }
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={5}
      />
      
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('UploadTrack', { onUploadSuccess: handleNewTrack })}
      >
        <MaterialIcons name="add" size={28} color="white" />
      </TouchableOpacity>
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
  trackList: {
    paddingBottom: 20,
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
    bottom: 20,
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