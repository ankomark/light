// src/components/SearchBar.jsx
import React, { useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';

const SearchBar = ({ onSearch }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const handleChange = (text) => {
        setSearchTerm(text); // Update the state with the new text
        onSearch(text); // Notify the parent of the search term change
    };

    return (
        <View style={styles.container}>
            <TextInput
                style={styles.input}
                placeholder="Search for tracks..."
                value={searchTerm}
                onChangeText={handleChange} // Use onChangeText for text input changes
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        padding: 6,
        backgroundColor: '#f8f8f8',
        borderBottomWidth: 1,
        borderBottomColor: '#ccc',
        color:'black',
        marginTop:-25,
        marginBottom:1,
        alignItems: 'center',
        elevation: 3,
        borderRadius: 15,
    },
    input: {
        // height: 30,
        // borderColor: '#ccc',
        // borderWidth: 1,
        // borderRadius: 8,
        // paddingHorizontal: 10,
        fontSize: 10,
        color: '#333',
    },
});

export default SearchBar;