import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAllVerses } from '../utils/hymnUtils';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

const HymnDetail = ({ route }) => {
    const navigation = useNavigation();
  const { hymn, section } = route.params;
  const [isFavorite, setIsFavorite] = useState(hymn.Favorited === 1);

  const toggleFavorite = () => {
    setIsFavorite(!isFavorite);
    // Here you would update your JSON data or state management
  };

  const renderVerse = (verse) => {
    if (!verse.text || verse.text.trim() === '') return null;
    
    return (
      <View key={`verse-${verse.number}`} style={styles.hymnDetailVerseContainer}>
        <Text style={styles.hymnDetailVerseNumber}>Verse {verse.number}</Text>
        {verse.text.split('\n').map((line, i) => (
          <Text key={`line-${i}`} style={styles.hymnDetailVerseText}>
            {line}
          </Text>
        ))}
      </View>
    );
  };

  const verses = getAllVerses(hymn);

  return (
    <SafeAreaView style={styles.safeArea}>

    <ScrollView style={styles.hymnDetailContainer}>
       <TouchableOpacity 
        onPress={() => navigation.goBack()}
        style={styles.hymnDetailBackButton}
      >
        <Ionicons name="arrow-back" size={28} color="#F0F6FC" />
      </TouchableOpacity>
      {/* Section info header */}
      {section && (
        <View style={styles.hymnDetailSectionHeader}>
          <Text style={styles.hymnDetailSectionTitle}>{section.title}</Text>
          <Text style={styles.hymnDetailSectionDescription}>{section.description}</Text>
        </View>
      )}

      <View style={styles.hymnDetailHeader}>
        <View style={styles.hymnDetailHymnHeader}>
          <Text style={styles.hymnDetailHymnNumber}>Hymn #{hymn.Number}</Text>
          <Text style={styles.hymnDetailTitle}>{hymn.Title}</Text>
        </View>
        <TouchableOpacity onPress={toggleFavorite} style={styles.hymnDetailFavoriteButton}>
          <Ionicons 
            name={isFavorite ? "heart" : "heart-outline"} 
            size={28} 
            color={isFavorite ? "#e74c3c" : "#aaa"} 
          />
        </TouchableOpacity>
      </View>

      {hymn.Refrain && (
        <View style={styles.hymnDetailRefrainContainer}>
          <View style={styles.hymnDetailRefrainLabelContainer}>
            <Ionicons name="musical-notes" size={20} color="#8e44ad" />
            <Text style={styles.hymnDetailRefrainLabel}>Refrain</Text>
          </View>
          <View style={styles.hymnDetailRefrainTextContainer}>
            {hymn.Refrain.split('\n').map((line, i) => (
              <Text key={`refrain-${i}`} style={styles.hymnDetailRefrainText}>
                {line}
              </Text>
            ))}
          </View>
        </View>
      )}

      {verses.map(renderVerse)}
    </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
     safeArea: {
  flex: 1,
  backgroundColor: 'aliceblue',//our container bg
},
  hymnDetailContainer: {
    flex: 1,
    backgroundColor: '#0D1117', // dark background
  },
   hymnDetailBackButton: {
    position: 'absolute',
    top: 20,
    left: 20,
    zIndex: 10,
    padding: 10,
  },

  hymnDetailSectionHeader: {
    padding: 20,
    backgroundColor: '#4D6530',//ant blue
    borderBottomWidth: 1,
    borderBottomColor: '#30363D',
  },
  hymnDetailSectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  hymnDetailSectionDescription: {
    fontSize: 14,
    color: '#C9D1D9',
    marginTop: 6,
    textAlign: 'center',
  },
  hymnDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#21262D',
  },
  hymnDetailHymnHeader: {
    flex: 1,
  },
  hymnDetailHymnNumber: {
    fontSize: 16,
    color: '#8B949E',
    marginBottom: 5,
  },
  hymnDetailTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#F0F6FC',
    lineHeight: 32,
  },
  hymnDetailFavoriteButton: {
    padding: 5,
    marginLeft: 10,
  },
  hymnDetailRefrainContainer: {
    backgroundColor: '#2E2B50',
    borderRadius: 10,
    marginHorizontal: 20,
    marginTop: 15,
    padding: 16,
    borderLeftWidth: 5,
    borderLeftColor: '#A970FF', // purple accent
  },
  hymnDetailRefrainLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  hymnDetailRefrainLabel: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#A970FF',
    fontStyle: 'italic',
  },
  hymnDetailRefrainTextContainer: {
    paddingLeft: 26,
  },
  hymnDetailRefrainText: {
    fontSize: 16,
    lineHeight: 26,
    color: '#D2D6DC',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  hymnDetailVerseContainer: {
    marginHorizontal: 20,
    marginBottom: 25,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#21262D',
  },
  hymnDetailVerseNumber: {
    fontWeight: 'bold',
    color: '#58A6FF', // light blue accent
    marginBottom: 8,
    fontSize: 16,
  },
  hymnDetailVerseText: {
    fontSize: 16,
    lineHeight: 26,
    color: '#C9D1D9',
  },
});

export default HymnDetail;