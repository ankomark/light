// src/components/SearchBar.jsx
import React, { useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../constants/theme';

const SearchBar = ({ onSearch }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const handleChange = (text) => {
        setSearchTerm(text);
        onSearch(text);
    };

    return (
        <View style={styles.container}>
            <Ionicons name="search" size={16} color={colors.placeholder} style={styles.icon} />
            <TextInput
                style={styles.input}
                placeholder="Search tracks"
                placeholderTextColor={colors.placeholder}
                value={searchTerm}
                onChangeText={handleChange}
                returnKeyType="search"
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.inputBg,
        borderWidth: 1,
        borderColor: colors.border,
        height: 34,
        paddingHorizontal: spacing.sm,
        marginHorizontal: spacing.sm,
        marginTop: spacing.xs,
        marginBottom: spacing.xs,
        borderRadius: radius.full,
    },
    icon: {
        marginRight: spacing.xs,
    },
    input: {
        flex: 1,
        fontSize: 13,
        color: colors.textPrimary,
        padding: 0,
    },
});

export default SearchBar;
