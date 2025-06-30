import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  TouchableOpacity, 
  StyleSheet, 
  TextInput,
  Keyboard,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import hymnsData from '../assets/hymns.json';
import { getVerse, getSectionInfo } from '../utils/hymnUtils';
import { SafeAreaView } from 'react-native-safe-area-context';


const HymnList = ({ navigation }) => {
  const [hymns, setHymns] = useState([]);
  const [sections, setSections] = useState([]);
  const [activeSection, setActiveSection] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [filteredHymns, setFilteredHymns] = useState([]);

  useEffect(() => {
    // Load hymns data
    setHymns(hymnsData.hymns);
    
    // Create sections
    setSections(hymnsData.sections || []);
    
    // Initial filtered hymns (all hymns)
    setFilteredHymns(hymnsData.hymns);
  }, []);

  // Filter hymns based on section and search query
  useEffect(() => {
    setIsSearching(true);
    
    let results = hymns;
    
    // Apply section filter
    if (activeSection) {
      results = results.filter(hymn => hymn.Section === activeSection);
    }
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      results = results.filter(hymn => {
        // 1. Check hymn number (converted to string)
        if (hymn.Number.toString().includes(query)) return true;
        
        // 2. Check title
        if (hymn.Title.toLowerCase().includes(query)) return true;
        
        // 3. Check refrain
        if (hymn.Refrain && hymn.Refrain.toLowerCase().includes(query)) return true;
        
        // 4. Check verses
        for (let i = 1; i <= 7; i++) {
          const verse = getVerse(hymn, i);
          if (verse && verse.toLowerCase().includes(query)) return true;
        }
        
        // 5. Check section name
        const section = getSectionInfo(sections, hymn.Section);
        if (section.title.toLowerCase().includes(query)) return true;
        
        return false;
      });
    }
    
    setFilteredHymns(results);
    setIsSearching(false);
  }, [hymns, sections, activeSection, searchQuery]);

  const currentSection = sections.find(s => s.id === activeSection);

  const renderHymnItem = ({ item }) => {
    // Get preview text from refrain or first verse
    const previewText = item.Refrain 
      ? item.Refrain.split('\n')[0]
      : getVerse(item, 1)?.split('\n')[0] || '';

    // Highlight number if it matches search
    const numberText = item.Number.toString();
    const isNumberMatch = searchQuery && numberText.includes(searchQuery);
    
    return (
      <TouchableOpacity 
        style={styles.hymnItem}
        onPress={() => {
          Keyboard.dismiss();
          navigation.navigate('HymnDetail', { 
            hymn: item,
            section: getSectionInfo(sections, item.Section) 
          });
        }}
      >
        <Text style={[
          styles.hymnNumber,
          isNumberMatch && styles.highlightedNumber
        ]}>
          {item.Number}.
        </Text>
        <View style={styles.hymnContent}>
          <Text style={styles.hymnTitle}>{item.Title}</Text>
          <Text style={styles.hymnSection}>
            {getSectionInfo(sections, item.Section).title}
          </Text>
          {previewText ? (
            <Text style={styles.hymnPreview} numberOfLines={1}>
              {previewText}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const clearSearch = () => {
    setSearchQuery('');
    Keyboard.dismiss();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by number, title, or lyrics..."
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          autoCapitalize="none"
          keyboardType="number-pad"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={clearSearch} style={styles.searchClear}>
            <Ionicons name="close-circle" size={22} color="#888" />
          </TouchableOpacity>
        ) : (
          <View style={styles.searchIcon}>
            <Ionicons name="search" size={20} color="#888" />
          </View>
        )}
      </View>

      {/* Search Results Info */}
      {searchQuery && (
        <View style={styles.resultsInfo}>
          <Text style={styles.resultsText}>
            {filteredHymns.length} {filteredHymns.length === 1 ? 'hymn' : 'hymns'} found for "{searchQuery}"
          </Text>
        </View>
      )}

      {/* Section header */}
      {currentSection && !searchQuery && (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{currentSection.title}</Text>
          <Text style={styles.sectionDescription}>{currentSection.description}</Text>
        </View>
      )}

      {/* Sections filter */}
      {!searchQuery && (
        <FlatList
          horizontal
          data={sections}
          keyExtractor={item => item.id.toString()}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.sectionButton,
                activeSection === item.id && styles.activeSection
              ]}
              onPress={() => {
                setActiveSection(activeSection === item.id ? null : item.id);
                Keyboard.dismiss();
              }}
            >
              <Text style={[
                styles.sectionText,
                activeSection === item.id && styles.activeSectionText
              ]}>
                {item.title}
              </Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.sectionsContainer}
          showsHorizontalScrollIndicator={false}
        />
      )}

      {/* Loading indicator */}
      {isSearching && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#1D478B" />
        </View>
      )}

      {/* Hymns list */}
      {!isSearching && (
        <FlatList
          data={filteredHymns}
          keyExtractor={item => item._id.toString()}
          renderItem={renderHymnItem}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="musical-notes" size={40} color="#ccc" />
              <Text style={styles.emptyText}>No hymns found</Text>
              <Text style={styles.emptySubtext}>Try a different search term</Text>
            </View>
          }
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
    safeArea: {
  flex: 1,
 backgroundColor:'#7C807F',
},
  container: {
    flex: 1,
    backgroundColor: '#1f2937',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F1F1F',
    borderRadius: 12,
    marginTop: 10,
    marginHorizontal: 20,
    paddingHorizontal: 12,
    height: 50,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
    height: '100%',
  },
  searchIcon: {
    marginLeft: 8,
  },
  searchClear: {
    padding: 5,
  },
  resultsInfo: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  resultsText: {
    color: '#aaa',
    fontStyle: 'italic',
  },
  sectionHeader: {
    padding: 16,
    backgroundColor: 'E5BC57',
    borderBottomWidth: 1,
    borderBottomColor: '#2C2C2C',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F8F8F8',
  },
  sectionDescription: {
    fontSize: 14,
    color: '#aaa',
    marginTop: 4,
  },
  sectionsContainer: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#121212',
  },
  sectionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 10,
    borderRadius: 20,
    backgroundColor: '#2A2A2A',
  },
  activeSection: {
    backgroundColor: '#1D478B',
  },
  sectionText: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '500',
  },
  activeSectionText: {
    color: '#fff',
  },
  listContainer: {
    paddingBottom: 20,
    paddingHorizontal: 10,
  },
  hymnItem: {
    flexDirection: 'row',
    padding: 16,
    marginVertical: 6,
    marginHorizontal: 8,
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  hymnNumber: {
    fontWeight: 'bold',
    marginRight: 12,
    color: '#61dafb',
    width: 36,
    fontSize: 16,
    textAlign: 'right',
  },
  highlightedNumber: {
    color: '#fff',
    backgroundColor: '#1D478B',
    borderRadius: 4,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  hymnContent: {
    flex: 1,
  },
  hymnTitle: {
    fontWeight: '600',
    fontSize: 16,
    color: '#fff',
    marginBottom: 4,
  },
  hymnSection: {
    fontSize: 13,
    color: '#bbb',
    marginBottom: 4,
    fontStyle: 'italic',
  },
  hymnPreview: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 18,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    color: '#bbb',
    marginTop: 15,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#888',
    marginTop: 5,
  }
});


export default HymnList;