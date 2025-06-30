import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Animated,
  TextInput,
  SafeAreaView,
  Dimensions, // Import Dimensions
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import axios from 'axios';

// Get the screen width
const screenWidth = Dimensions.get('window').width;

// SearchBar Component
const SearchBar = ({ onSearch }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const widthAnim = useRef(new Animated.Value(40)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const toggleSearch = () => {
    Animated.parallel([
      Animated.timing(widthAnim, {
        toValue: isExpanded ? 40 : screenWidth * 0.8, // 80% of screen width
        duration: 300,
        useNativeDriver: false,
      }),
      Animated.timing(opacityAnim, {
        toValue: isExpanded ? 0 : 1,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start(() => {
      if (isExpanded) {
        setQuery('');
        onSearch('');
      }
      setIsExpanded(!isExpanded);
    });
  };

  return (
    <Animated.View style={[styles.searchContainer, { width: widthAnim }]}>
      <Animated.View style={{ flex: 1, opacity: opacityAnim }}>
        <TextInput
          style={styles.input}
          placeholder="Search versions..."
          placeholderTextColor="white"
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            onSearch(text);
          }}
          autoFocus={true}
        />
      </Animated.View>
      <TouchableOpacity onPress={toggleSearch}>
        <Feather name={isExpanded ? 'x' : 'search'} size={24} color="white" />
      </TouchableOpacity>
    </Animated.View>
  );
};

// BookScreen Component
const BookScreen = ({ route, navigation }) => {
  const { version } = route.params || { version: 'en-kjv' };
  const [versions, setVersions] = useState([]);
  const [filteredVersions, setFilteredVersions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVersions();
  }, []);

  const fetchVersions = async () => {
    try {
      const response = await axios.get(
        `https://cdn.jsdelivr.net/gh/wldeh/bible-api/bibles/bibles.json`
      );
      console.log('API Response:', response.data); // Debugging

      // Transform the API response to match the expected structure
      const formattedVersions = response.data.map((item) => ({
        id: item.id,
        name: item.version, // Use the 'version' field as the name
        description: item.description,
        language: item.language.name,
      }));

      setVersions(formattedVersions);
      setFilteredVersions(formattedVersions); // Initialize filtered versions
    } catch (error) {
      console.error('Error fetching versions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (query) => {
    const filtered = versions.filter(
      (item) =>
        item.name.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase()) ||
        item.language.toLowerCase().includes(query.toLowerCase())
    );
    setFilteredVersions(filtered);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
    style={styles.item}
    onPress={() => navigation.navigate('Books', { version: item.id })} // Pass the version ID
  >
    <Text style={styles.title}>{item.name}</Text>
    <Text style={styles.description}>{item.description}</Text>
    <Text style={styles.language}>Language: {item.language}</Text>
  </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeAreaContainer}>
      <View style={styles.container}>
        <SearchBar onSearch={handleSearch} />
        <FlatList
          data={filteredVersions}
          renderItem={renderItem}
          keyExtractor={(item) => item.id} // Use the 'id' field as the key
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeAreaContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: 'black',
  },
  searchContainer: {
    height: 40,
    backgroundColor: '#1DA1F2',
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    shadowColor: 'gray',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
    marginBottom: 16,
    marginTop:25,
    // alignSelf: 'center', // Center the search bar horizontally
  },
  input: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
    color: 'white',
    paddingVertical: 0,
  },
  item: {
    backgroundColor: '#fff',
    padding: 20,
    marginVertical: 8,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  language: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
});

export default BookScreen;