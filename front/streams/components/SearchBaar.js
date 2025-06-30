// components/SearchBar.js
import React, { useState, useRef } from 'react';
import { Animated, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

const SearchBaar = ({ onSearch }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const widthAnim = useRef(new Animated.Value(40)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const toggleSearch = () => {
    Animated.parallel([
      Animated.timing(widthAnim, {
        toValue: isExpanded ? 40 : 200,
        duration: 300,
        useNativeDriver: false,
      }),
      Animated.timing(opacityAnim, {
        toValue: isExpanded ? 0 : 1,
        duration: 200,
        useNativeDriver: false,
      })
    ]).start(() => {
      if (isExpanded) {
        setQuery('');
        onSearch('');
      }
      setIsExpanded(!isExpanded);
    });
  };

  return (
    <Animated.View style={[styles.container, { width: widthAnim }]}>
      <Animated.View style={{ flex: 1, opacity: opacityAnim }}>
        <TextInput
          style={styles.input}
          placeholder="Search posts..."
          placeholderTextColor="aliceblue"
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            onSearch(text);
          }}
          autoFocus={true}
        />
      </Animated.View>
      <TouchableOpacity onPress={toggleSearch}>
        <Feather 
          name={isExpanded ? "x" : "search"} 
          size={24} 
          color="white" 
        />
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 40,
    backgroundColor: '#1DA1F2',
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
    color: 'aliceblue',
    position: 'absolute',  // Add this
    top: 0,               // Add this
    right: 300,             // Add this
    zIndex: 1000,          // Add this
    left:2,
    
  },
  input: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
    color: 'aliceblue',
    paddingVertical: 0,
  },
});

export default SearchBaar;