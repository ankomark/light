import React from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import AdventistMedia from '../pages/AdventistMedia';
import Header from '../components/Header';

const MediaScreen = ({ navigation }) => {
  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="#102E50" barStyle="light-content" />
      <Header navigation={navigation} />
      <AdventistMedia />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
});

export default MediaScreen;