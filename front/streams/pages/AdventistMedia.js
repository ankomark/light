import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@AdventistMedia:stations';

const AdventistMedia = () => {
  // Initial list of Adventist media stations
  const [stations, setStations] = useState([]);
  const [newStation, setNewStation] = useState({ name: '', type: 'TV', url: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load stations from storage on component mount
  useEffect(() => {
    const loadStations = async () => {
      try {
        const savedStations = await AsyncStorage.getItem(STORAGE_KEY);
        if (savedStations !== null) {
          setStations(JSON.parse(savedStations));
        } else {
          // Load default stations if nothing is saved
          const defaultStations = [
            { id: '1', name: 'Hope Channel TV', type: 'TV', url: 'https://www.hopetv.org' },
            { id: '2', name: '3ABN', type: 'TV', url: 'https://www.3abn.org' },
            { id: '3', name: 'LLBN', type: 'TV', url: 'https://www.llbn.tv' },
            { id: '4', name: 'Adventist World Radio', type: 'Radio', url: 'https://www.awr.org' },
            { id: '5', name: 'Voice of Prophecy', type: 'Radio', url: 'https://www.voiceofprophecy.com' },
            { id: '6', name: 'Faith FM', type: 'Radio', url: 'https://www.faithfm.com.au' },
            { id: '7', name: 'Adventist Review Podcast', type: 'Podcast', url: 'https://www.adventistreview.org/podcasts' },
            { id: '8', name: 'Amazing Facts', type: 'Podcast', url: 'https://www.amazingfacts.org/media-library/podcasts' },
          ];
          setStations(defaultStations);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(defaultStations));
        }
      } catch (error) {
        Alert.alert('Error', 'Failed to load stations');
      } finally {
        setIsLoading(false);
      }
    };

    loadStations();
  }, []);

  // Save stations to storage whenever they change
  useEffect(() => {
    const saveStations = async () => {
      if (!isLoading) {
        try {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stations));
        } catch (error) {
          Alert.alert('Error', 'Failed to save stations');
        }
      }
    };

    saveStations();
  }, [stations, isLoading]);

  const addStation = async () => {
    if (!newStation.name.trim() || !newStation.url.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    try {
      // Validate URL format
      if (!newStation.url.match(/^https?:\/\//i)) {
        Alert.alert('Error', 'Please enter a valid URL starting with http:// or https://');
        return;
      }

      const stationToAdd = {
        id: Math.random().toString(),
        name: newStation.name.trim(),
        type: newStation.type,
        url: newStation.url.trim(),
      };

      setStations(prev => [...prev, stationToAdd]);
      setNewStation({ name: '', type: 'TV', url: '' });
      setShowAddForm(false);
      
      Alert.alert('Success', 'Station added successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to add station');
    }
  };

  const renderItem = ({ item }) => (
    <View style={styles.stationCard}>
      <View style={styles.stationHeader}>
        <Text style={styles.stationName}>{item.name}</Text>
        <View style={[styles.typeBadge, { 
          backgroundColor: item.type === 'TV' ? '#3498db' : 
                          item.type === 'Radio' ? '#e74c3c' : '#2ecc71' 
        }]}>
          <Text style={styles.typeText}>{item.type}</Text>
        </View>
      </View>
      <Text style={styles.stationUrl}>{item.url}</Text>
      <TouchableOpacity 
        style={styles.visitButton}
        onPress={() => Linking.openURL(item.url).catch(err => Alert.alert('Error', 'Could not open URL'))}
      >
        <Text style={styles.visitButtonText}>Visit Website</Text>
      </TouchableOpacity>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3498db" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Adventist Media Stations</Text>
      
      <FlatList
        data={stations}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No stations found</Text>
        }
      />

      {showAddForm ? (
        <View style={styles.addForm}>
          <TextInput
            style={styles.input}
            placeholder="Station Name"
            placeholderTextColor="#999"
            value={newStation.name}
            onChangeText={text => setNewStation({...newStation, name: text})}
          />
          <TextInput
            style={styles.input}
            placeholder="Website URL (include http:// or https://)"
            placeholderTextColor="#999"
            value={newStation.url}
            onChangeText={text => setNewStation({...newStation, url: text})}
            keyboardType="url"
            autoCapitalize="none"
          />
          <View style={styles.typeSelector}>
            <TouchableOpacity 
              style={[styles.typeOption, newStation.type === 'TV' && styles.selectedType]}
              onPress={() => setNewStation({...newStation, type: 'TV'})}
            >
              <Text>TV</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.typeOption, newStation.type === 'Radio' && styles.selectedType]}
              onPress={() => setNewStation({...newStation, type: 'Radio'})}
            >
              <Text>Radio</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.typeOption, newStation.type === 'Podcast' && styles.selectedType]}
              onPress={() => setNewStation({...newStation, type: 'Podcast'})}
            >
              <Text>Podcast</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.formButtons}>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowAddForm(false)}>
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addButton} onPress={addStation}>
              <Text style={styles.buttonText}>Add Station</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.addButton} onPress={() => setShowAddForm(true)}>
          <MaterialIcons name="add" size={24} color="white" />
          <Text style={styles.buttonText}>Add a Station</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#e0f7fa',
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e0f7fa',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#006064',
    marginBottom: 20,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  listContainer: {
    paddingBottom: 20,
  },
  emptyText: {
    textAlign: 'center',
    color: '#7f8c8d',
    marginTop: 20,
    fontSize: 16,
  },
  stationCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  stationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  stationName: {
    fontSize: 19,
    fontWeight: '700',
    color: '#37474f',
    flex: 1,
  },
  typeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginLeft: 10,
  },
  typeText: {
    color: 'white',
    fontSize: 13,
    fontWeight: 'bold',
  },
  stationUrl: {
    color: '#607d8b',
    marginBottom: 12,
    fontStyle: 'italic',
  },
  visitButton: {
    backgroundColor: '#00897b',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 6,
  },
  visitButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  addButton: {
    backgroundColor: '#6a1b9a',
    padding: 14,
    borderRadius: 30,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    alignSelf: 'center',
    paddingHorizontal: 24,
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 10,
  },
  addForm: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 20,
    marginTop: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    color: '#2c3e50',
    backgroundColor: '#f1f8e9',
  },
  typeSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  typeOption: {
    padding: 10,
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 4,
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },
  selectedType: {
    backgroundColor: '#d1c4e9',
    borderColor: '#7e57c2',
  },
  formButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    backgroundColor: '#f44336',
    padding: 12,
    borderRadius: 8,
    flex: 1,
    marginRight: 10,
    alignItems: 'center',
  },
});


export default AdventistMedia;