// // // src/components/Playlist.js
// // import React, { useEffect, useState } from 'react';
// // import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
// // import { fetchPlaylists } from '../services/api';
// // import FavoritesPage from './FavoritesPage';

// // const Playlist = () => {
// //     const [playlists, setPlaylists] = useState([]);
// //     const [loading, setLoading] = useState(true);

// //     useEffect(() => {
// //         const fetchPlaylistData = async () => {
// //             const data = await fetchPlaylists();
// //             setPlaylists(data);
// //             setLoading(false);
// //         };
// //         fetchPlaylistData();
// //     }, []);

// //     if (loading) {
// //         return (
// //             <View style={styles.loadingContainer}>
// //                 <ActivityIndicator size="large" color="#007bff" />
// //                 <Text style={styles.loadingText}>Loading playlists...</Text>
// //             </View>
// //         );
// //     }

// //     return (
// //         <View style={styles.container}>
// //             <Text style={styles.header}>
// //                 WHEN YOU ADD SONGS TO YOUR FAVORITE THEY BECOME PART OF YOUR PLAYLIST
// //             </Text>
// //             <FlatList
// //                 data={playlists}
// //                 keyExtractor={(playlist) => playlist.id.toString()}
// //                 renderItem={({ item }) => (
// //                     <View style={styles.playlistItem}>
// //                         <Text style={styles.playlistName}>{item.name}</Text>
// //                         <Text style={styles.playlistCreator}>Created by: {item.user.username}</Text>
// //                     </View>
// //                 )}
// //             />
// //             <FavoritesPage />
// //         </View>
// //     );
// // };

// // const styles = StyleSheet.create({
// //     container: {
// //         flex: 1,
// //         padding: 20,
// //         backgroundColor: '#f9f9f9',
// //     },
// //     loadingContainer: {
// //         flex: 1,
// //         justifyContent: 'center',
// //         alignItems: 'center',
// //         backgroundColor: '#f9f9f9',
// //     },
// //     loadingText: {
// //         marginTop: 10,
// //         fontSize: 18,
// //     },
// //     header: {
// //         fontSize: 24,
// //         fontWeight: 'bold',
// //         textAlign: 'center',
// //         marginBottom: 20,
// //     },
// //     playlistItem: {
// //         marginBottom: 15,
// //         padding: 15,
// //         borderWidth: 1,
// //         borderColor: '#ccc',
// //         borderRadius: 8,
// //         backgroundColor: '#fff',
// //     },
// //     playlistName: {
// //         fontSize: 20,
// //         fontWeight: 'bold',
// //     },
// //     playlistCreator: {
// //         fontSize: 16,
// //         color: '#666',
// //     },
// // });

// // export default Playlist;






// // import React, { useEffect, useState } from 'react';
// // import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
// // import { fetchPlaylists } from '../services/api';
// // import FavoritesPage from './FavoritesPage';

// // const Playlist = () => {
// //     const [playlists, setPlaylists] = useState([]);
// //     const [loading, setLoading] = useState(true);

// //     useEffect(() => {
// //         const fetchPlaylistData = async () => {
// //             try {
// //                 const data = await fetchPlaylists();
// //                 setPlaylists(data);
// //             } catch (error) {
// //                 console.error('Error fetching playlists:', error);
// //             } finally {
// //                 setLoading(false);
// //             }
// //         };
// //         fetchPlaylistData();
// //     }, []);

// //     if (loading) {
// //         return (
// //             <View style={styles.loadingContainer}>
// //                 <ActivityIndicator size="large" color="#007bff" />
// //                 <Text style={styles.loadingText}>Loading playlists...</Text>
// //             </View>
// //         );
// //     }

// //     return (
// //         <View style={styles.container}>
// //             <Text style={styles.header}>
// //                 Add songs to your favorites to create a playlist 🎵
// //             </Text>
// //             {playlists.length === 0 ? (
// //                 <Text style={styles.emptyText}>No playlists available</Text>
// //             ) : (
// //                 <FlatList
// //                     data={playlists}
// //                     keyExtractor={(playlist) => playlist.id.toString()}
// //                     renderItem={({ item }) => (
// //                         <View style={styles.playlistItem}>
// //                             <Text style={styles.playlistName}>{item.name}</Text>
// //                             <Text style={styles.playlistCreator}>🎶 Created by: {item.user.username}</Text>
// //                         </View>
// //                     )}
// //                 />
// //             )}
// //             <FavoritesPage />
// //         </View>
// //     );
// // };

// // const styles = StyleSheet.create({
// //     container: {
// //         flex: 1,
// //         paddingHorizontal: 20,
// //         paddingTop: 20,
// //         backgroundColor: '#121212', // Dark mode background
// //     },
// //     loadingContainer: {
// //         flex: 1,
// //         justifyContent: 'center',
// //         alignItems: 'center',
// //         backgroundColor: '#121212',
// //     },
// //     loadingText: {
// //         marginTop: 10,
// //         fontSize: 18,
// //         color: '#fff',
// //     },
// //     header: {
// //         fontSize: 22,
// //         fontWeight: 'bold',
// //         textAlign: 'center',
// //         marginBottom: 20,
// //         color: '#fff',
// //     },
// //     emptyText: {
// //         fontSize: 18,
// //         textAlign: 'center',
// //         color: '#ccc',
// //         marginTop: 20,
// //     },
// //     playlistItem: {
// //         marginBottom: 15,
// //         padding: 15,
// //         borderRadius: 10,
// //         backgroundColor: '#1e1e1e', // Darker gray card
// //         shadowColor: '#000',
// //         shadowOffset: { width: 0, height: 2 },
// //         shadowOpacity: 0.2,
// //         shadowRadius: 4,
// //         elevation: 5,
// //     },
// //     playlistName: {
// //         fontSize: 20,
// //         fontWeight: 'bold',
// //         color: '#fff',
// //     },
// //     playlistCreator: {
// //         fontSize: 16,
// //         color: '#bbb',
// //         marginTop: 5,
// //     },
// // });

// // export default Playlist;

// // src/components/Playlist.js
// import React, { useEffect, useState } from 'react';
// import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
// import { fetchPlaylists } from '../services/api';
// import FavoritesPage from './FavoritesPage';

// const Playlist = () => {
//     const [playlists, setPlaylists] = useState([]);
//     const [loading, setLoading] = useState(true);

//     useEffect(() => {
//         const fetchPlaylistData = async () => {
//             const data = await fetchPlaylists();
//             setPlaylists(data);
//             setLoading(false);
//         };
//         fetchPlaylistData();
//     }, []);

//     if (loading) {
//         return (
//             <View style={styles.loadingContainer}>
//                 <ActivityIndicator size="large" color="#007bff" />
//                 <Text style={styles.loadingText}>Loading playlists...</Text>
//             </View>
//         );
//     }

//     return (
//         <View style={styles.container}>
//             {/* <Text style={styles.header}>
//                 WHEN YOU ADD SONGS TO YOUR FAVORITE, THEY BECOME PART OF YOUR PLAYLIST
//             </Text> */}
//             {/* <FlatList
//                 data={playlists}
//                 keyExtractor={(playlist) => playlist.id.toString()}
//                 renderItem={({ item }) => (
//                     <View style={styles.playlistItem}>
//                         <Text style={styles.playlistName}>{item.name}</Text>
//                         <Text style={styles.playlistCreator}>Created by: {item.user.username}</Text>
//                     </View>
//                 )}
//             /> */}
//             <FavoritesPage />
//         </View>
//     );
// };

// const styles = StyleSheet.create({
//     container: {
//         flex: 1,
//         padding: 20,
//         backgroundColor: '#f9f9f9',
//     },
//     loadingContainer: {
//         flex: 1,
//         justifyContent: 'center',
//         alignItems: 'center',
//         backgroundColor: '#f9f9f9',
//     },
//     loadingText: {
//         marginTop: 10,
//         fontSize: 18,
//         color: '#555',
//     },
//     header: {
//         fontSize: 10,
//         fontWeight: 'bold',
//         textAlign: 'center',
//         marginBottom: 2,
//         color: '#333',
//         paddingHorizontal: 10,
//         lineHeight: 30,
//     },
//     playlistItem: {
//         marginBottom: 15,
//         padding: 20,
//         borderWidth: 1,
//         borderColor: '#e0e0e0',
//         borderRadius: 10,
//         backgroundColor: '#fff',
//         shadowColor: '#000',
//         shadowOffset: { width: 0, height: 2 },
//         shadowOpacity: 0.1,
//         shadowRadius: 4,
//         elevation: 3,
//     },
//     playlistName: {
//         fontSize: 18,
//         fontWeight: 'bold',
//         color: '#007bff',
//         marginBottom: 5,
//     },
//     playlistCreator: {
//         fontSize: 14,
//         color: '#777',
//     },
// });

// export default Playlist;