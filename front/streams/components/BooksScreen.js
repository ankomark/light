// import React, { useState, useEffect } from 'react';
// import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, SafeAreaView } from 'react-native';
// import axios from 'axios';

// const BooksScreen = ({ route, navigation }) => {
//   const { version } = route.params || { version: 'en-kjv' }; // Fallback to a default version
//   const [books, setBooks] = useState([]);
//   const [loading, setLoading] = useState(true);

//   useEffect(() => {
//     fetchBooks();
//   }, [version]); // Re-fetch books when the version changes

//   const fetchBooks = async () => {
//     try {
//       // Fetch the list of books for the specified version
//       const response = await axios.get(
//         `https://cdn.jsdelivr.net/gh/wldeh/bible-api/bibles/${version}/books.json`
//       );
//       console.log('API Response:', response.data); // Debugging
//       setBooks(response.data);
//     } catch (error) {
//       console.error('Error fetching books:', error);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const renderItem = ({ item }) => (
//     <TouchableOpacity
//       style={styles.item}
//       onPress={() => navigation.navigate('Chapters', { version, book: item.name })}
//     >
//       <Text style={styles.title}>{item.name}</Text>
//       <Text style={styles.description}>{item.description}</Text>
//     </TouchableOpacity>
//   );

//   if (loading) {
//     return (
//       <SafeAreaView style={styles.loadingContainer}>
//         <ActivityIndicator size="large" color="#0000ff" />
//       </SafeAreaView>
//     );
//   }

//   return (
//     <SafeAreaView style={styles.safeAreaContainer}>
//       <View style={styles.container}>
//         <FlatList
//           data={books}
//           renderItem={renderItem}
//           keyExtractor={(item) => item.name} // Use the book name as the key
//         />
//       </View>
//     </SafeAreaView>
//   );
// };

// // Define styles
// const styles = StyleSheet.create({
//   safeAreaContainer: {
//     flex: 1,
//     backgroundColor: '#f5f5f5',
//   },
//   container: {
//     flex: 1,
//     padding: 16,
//     backgroundColor: 'black',
//   },
//   item: {
//     backgroundColor: '#fff',
//     padding: 20,
//     marginVertical: 8,
//     borderRadius: 8,
//     shadowColor: '#000',
//     shadowOffset: { width: 0, height: 2 },
//     shadowOpacity: 0.1,
//     shadowRadius: 4,
//     elevation: 2,
//   },
//   title: {
//     fontSize: 18,
//     fontWeight: 'bold',
//     color: '#333',
//   },
//   description: {
//     fontSize: 14,
//     color: '#666',
//     marginTop: 4,
//   },
//   loadingContainer: {
//     flex: 1,
//     justifyContent: 'center',
//     alignItems: 'center',
//     backgroundColor: '#f5f5f5',
//   },
// });

// export default BooksScreen;