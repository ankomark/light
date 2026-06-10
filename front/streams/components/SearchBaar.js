import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius } from '../constants/theme';

/**
 * Clean, always-visible search field: leading search icon, themed pill, a focus
 * highlight, and a clear (×) button once there's text.
 */
const SearchBaar = ({ onSearch, placeholder = 'Search...' }) => {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const handleChange = (text) => {
    setQuery(text);
    onSearch?.(text);
  };

  const clear = () => {
    setQuery('');
    onSearch?.('');
  };

  return (
    <View style={[styles.container, focused && styles.containerFocused]}>
      <Feather name="search" size={18} color={focused ? colors.primary : colors.textMuted} />
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        value={query}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        selectionColor={colors.primary}
      />
      {query.length > 0 && (
        <TouchableOpacity onPress={clear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x-circle" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  containerFocused: {
    borderColor: colors.primary,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
});

export default SearchBaar;
