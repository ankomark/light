// src/components/SearchBar.jsx
import React, { useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';

const SearchBar = ({ onSearch }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const handleChange = (text) => {
        setSearchTerm(text);
        onSearch(text);
    };

    return (
        <View style={styles.container}>
            <TextInput
                style={styles.input}
                placeholder="Search for tracks..."
                placeholderTextColor="#888"
                value={searchTerm}
                onChangeText={handleChange}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#fff',
        paddingVertical: 4,
        paddingHorizontal: 16,
        marginHorizontal: 20,
        marginTop: 6,
        marginBottom: 8,
        borderRadius: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    input: {
        fontSize: 12,
        color: '#000',
    },
});

export default SearchBar;
