import React, { useState, useRef } from 'react';
import {
  SafeAreaView,
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Keyboard,
  Platform
} from 'react-native';
import { MaterialIcons, FontAwesome } from '@expo/vector-icons';

const GroupPostInputBar = ({ onSubmit, onAttachPress }) => {
  const [content, setContent] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);

  const handleSubmit = () => {
    if (content.trim()) {
      onSubmit(content);
      setContent('');
    }
    Keyboard.dismiss();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={styles.container}>
        <TouchableOpacity 
          style={styles.attachButton} 
          onPress={onAttachPress}
        >
          <View style={styles.buttonIcon}>
            <FontAwesome name="paperclip" size={20} color="#4F46E5" />
          </View>
        </TouchableOpacity>
        
        <TextInput
          ref={inputRef}
          style={[styles.input, isFocused && styles.inputFocused]}
          placeholder="What's on your mind?"
          placeholderTextColor="#9CA3AF"
          value={content}
          onChangeText={setContent}
          multiline
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        
        <TouchableOpacity
          style={styles.sendButton}
          onPress={handleSubmit}
          disabled={!content.trim()}
        >
          <View style={styles.buttonIcon}>
            <MaterialIcons 
              name="send" 
              size={20} 
              color={content.trim() ? "#4F46E5" : "#9CA3AF"} 
            />
          </View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'white',
    paddingBottom: Platform.select({
      ios: 0,
      android: 8
    }),
  },
  input: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    maxHeight: 120,
    textAlignVertical: 'top',
    marginHorizontal: 8,
  },
  inputFocused: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#4F46E5',
  },
  attachButton: {
    padding: 4,
  },
  sendButton: {
    padding: 4,
  },
  buttonIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
});

export default GroupPostInputBar;