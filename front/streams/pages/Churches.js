import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  StyleSheet, 
  TouchableOpacity, 
  TextInput, 
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
  Dimensions,
  Image
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { fetchChurches, createChurch, updateChurch, deleteChurch } from '../services/api';
import { useAuth } from '../context/useAuth';
const DEFAULT_PROFILE_IMAGE = 'https://via.placeholder.com/150';

const { height } = Dimensions.get('window');

const Churches = () => {
  const { currentUser } = useAuth();
  const [churches, setChurches] = useState([]);
  const [filteredChurches, setFilteredChurches] = useState([]);
  const [newChurch, setNewChurch] = useState({
    name: '',
    continent: '',
    country: '',
    county: '',
    conference: '',
    district: '',
    location: '',
    members: '',
    pastor: '',
    contact: ''
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterValues, setFilterValues] = useState({
    continent: '',
    country: '',
    conference: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [image, setImage] = useState(null);
  const [editingChurch, setEditingChurch] = useState(null);

  // Load churches from API
  useEffect(() => {
    const loadChurches = async () => {
      try {
        setIsLoading(true);
        const response = await fetchChurches();
        setChurches(response);
        setFilteredChurches(response);
      } catch (error) {
        Alert.alert('Error', 'Failed to load churches');
      } finally {
        setIsLoading(false);
      }
    };

    loadChurches();
  }, []);

  // Filter churches based on search term and filters
  useEffect(() => {
    let results = churches;
    
    if (searchTerm) {
      results = results.filter(church => 
        church.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        church.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
        church.pastor?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (filterValues.continent) {
      results = results.filter(church => 
        church.continent.toLowerCase() === filterValues.continent.toLowerCase()
      );
    }
    
    if (filterValues.country) {
      results = results.filter(church => 
        church.country.toLowerCase() === filterValues.country.toLowerCase()
      );
    }
    
    if (filterValues.conference) {
      results = results.filter(church => 
        church.conference.toLowerCase() === filterValues.conference.toLowerCase()
      );
    }
    
    setFilteredChurches(results);
  }, [searchTerm, filterValues, churches]);

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 1,
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
    }
  };

  const handleAddChurch = async () => {
    if (!newChurch.name.trim() || !newChurch.country.trim() || !newChurch.conference.trim()) {
      Alert.alert('Error', 'Please fill in all required fields (Name, Country, Conference)');
      return;
    }

    try {
      const formData = new FormData();
      
      // Add all church fields
      Object.keys(newChurch).forEach(key => {
        if (newChurch[key]) {
          formData.append(key, newChurch[key]);
        }
      });
      
      // Add image if selected
      if (image) {
        const uriParts = image.split('.');
        const fileType = uriParts[uriParts.length - 1];
        
        formData.append('image', {
          uri: image,
          name: `photo.${fileType}`,
          type: `image/${fileType}`,
        });
      }

      if (editingChurch) {
        await updateChurch(editingChurch.id, formData);
        Alert.alert('Success', 'Church updated successfully!');
      } else {
        await createChurch(formData);
        Alert.alert('Success', 'Church added successfully!');
      }

      // Refresh churches
      const response = await fetchChurches();
      setChurches(response);
      setFilteredChurches(response);
      
      // Reset form
      setNewChurch({
        name: '',
        continent: '',
        country: '',
        county: '',
        conference: '',
        district: '',
        location: '',
        members: '',
        pastor: '',
        contact: ''
      });
      setImage(null);
      setEditingChurch(null);
      setShowAddForm(false);
    } catch (error) {
      Alert.alert('Error', error.message || 'You can only edit churches you created');
    }
  };

  const handleEditChurch = (church) => {
    setEditingChurch(church);
    setNewChurch({
      name: church.name,
      continent: church.continent,
      country: church.country,
      county: church.county,
      conference: church.conference,
      district: church.district,
      location: church.location,
      members: church.members.toString(),
      pastor: church.pastor,
      contact: church.contact
    });
    setImage(church.image);
    setShowAddForm(true);
  };

  const handleDeleteChurch = async (id) => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this church?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              await deleteChurch(id);
              const response = await fetchChurches();
              setChurches(response);
              setFilteredChurches(response);
              Alert.alert('Success', 'Church deleted successfully!');
            } catch (error) {
              Alert.alert('Error', 'You can only delete churches you created');
            }
          },
          style: 'destructive',
        },
      ],
      { cancelable: true }
    );
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterValues({
      continent: '',
      country: '',
      conference: ''
    });
  };

  // NEW: Church actions component
  const ChurchActions = ({ church }) => {
    const isCreator = currentUser && (
      church.created_by?.id === currentUser.id || 
      church.created_by === currentUser.id
    );
    
    if (!isCreator) return null;
    
    return (
      <View style={styles.churchActions}>
        <TouchableOpacity onPress={() => handleEditChurch(church)}>
          <MaterialIcons name="edit" size={20} color="#006064" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDeleteChurch(church.id)}>
          <MaterialIcons name="delete" size={20} color="#e53935" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderItem = ({ item }) => {
    // Get creator info directly from church data
    const creatorName = item.created_by_username || 'Unknown';
    const creatorImage = item.created_by_picture 
        ? { uri: item.created_by_picture }
        : { uri: DEFAULT_PROFILE_IMAGE };

    return (
      <View style={styles.churchCard}>
        <View style={styles.churchHeader}>
          <View style={styles.userInfo}>
            <Image 
              source={creatorImage} 
              style={styles.profileImage}
              defaultSource={{ uri: DEFAULT_PROFILE_IMAGE }}
              onError={() => console.log('Error loading profile image')}
            />
            <View>
              <Text style={styles.username}>{creatorName}</Text>
            </View>
          </View>
          <ChurchActions church={item} />
        </View>
        
        <Text style={styles.churchName}>{item.name}</Text>
        
        {item.image && (
          <Image 
            source={{ uri: item.image }} 
            style={styles.churchImage}
            resizeMode="cover"
          />
        )}
        
        <View style={styles.churchDetails}>
          <View style={styles.detailRow}>
            <MaterialIcons name="location-on" size={16} color="#555" />
            <Text style={styles.detailText}>{item.location}, {item.district}</Text>
          </View>
          
          <View style={styles.detailRow}>
            <MaterialIcons name="people" size={16} color="#555" />
            <Text style={styles.detailText}>{item.members} members</Text>
          </View>
          
          {item.pastor && (
            <View style={styles.detailRow}>
              <MaterialIcons name="account-circle" size={16} color="#555" />
              <Text style={styles.detailText}>Pastor: {item.pastor}</Text>
            </View>
          )}
          
          {item.contact && (
            <View style={styles.detailRow}>
              <MaterialIcons name="phone" size={16} color="#555" />
              <Text style={styles.detailText}>{item.contact}</Text>
            </View>
          )}
          
          <View style={styles.metaContainer}>
            <Text style={styles.metaText}>{item.conference}</Text>
            <Text style={styles.metaText}>{item.country}</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderAddForm = () => (
    <Modal
      visible={showAddForm}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowAddForm(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <ScrollView style={styles.addForm}>
            <View style={styles.formHeader}>
              <Text style={styles.formTitle}>
                {editingChurch ? 'Edit Church' : 'Add New Church'}
              </Text>
              <TouchableOpacity 
                onPress={() => {
                  setShowAddForm(false);
                  setEditingChurch(null);
                  setNewChurch({
                    name: '',
                    continent: '',
                    country: '',
                    county: '',
                    conference: '',
                    district: '',
                    location: '',
                    members: '',
                    pastor: '',
                    contact: ''
                  });
                  setImage(null);
                }}
                style={styles.closeButton}
              >
                <MaterialIcons name="close" size={24} color="#555" />
              </TouchableOpacity>
            </View>
            
            <TextInput
              style={styles.input}
              placeholder="Church Name *"
              value={newChurch.name}
              onChangeText={text => setNewChurch({...newChurch, name: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Continent"
              value={newChurch.continent}
              onChangeText={text => setNewChurch({...newChurch, continent: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Country *"
              value={newChurch.country}
              onChangeText={text => setNewChurch({...newChurch, country: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="County/State"
              value={newChurch.county}
              onChangeText={text => setNewChurch({...newChurch, county: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Conference *"
              value={newChurch.conference}
              onChangeText={text => setNewChurch({...newChurch, conference: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="District"
              value={newChurch.district}
              onChangeText={text => setNewChurch({...newChurch, district: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Physical Location"
              value={newChurch.location}
              onChangeText={text => setNewChurch({...newChurch, location: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Number of Members"
              value={newChurch.members}
              onChangeText={text => setNewChurch({...newChurch, members: text})}
              keyboardType="numeric"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Pastor's Name"
              value={newChurch.pastor}
              onChangeText={text => setNewChurch({...newChurch, pastor: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Contact Phone"
              value={newChurch.contact}
              onChangeText={text => setNewChurch({...newChurch, contact: text})}
              keyboardType="phone-pad"
            />
            
            <TouchableOpacity style={styles.imagePicker} onPress={pickImage}>
              <MaterialIcons name="add-a-photo" size={24} color="#006064" />
              <Text style={styles.imagePickerText}>
                {image ? 'Change Image' : 'Add Church Image'}
              </Text>
            </TouchableOpacity>
            
            {image && (
              <Image 
                source={{ uri: image }} 
                style={styles.previewImage}
                resizeMode="cover"
              />
            )}
            
            <View style={styles.formButtons}>
              <TouchableOpacity 
                style={styles.submitButton} 
                onPress={handleAddChurch}
              >
                <Text style={styles.buttonText}>
                  {editingChurch ? 'Update Church' : 'Add Church'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#006064" />
      </View>
    );
  }

  // Get unique values for filter dropdowns
  const continents = [...new Set(churches.map(church => church.continent))];
  const countries = [...new Set(churches.map(church => church.country))];
  const conferences = [...new Set(churches.map(church => church.conference))];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Seventh-day Adventist Churches</Text>
      
      {/* Search and Filter Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <MaterialIcons name="search" size={20} color="#555" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search churches..."
            value={searchTerm}
            onChangeText={setSearchTerm}
          />
          {searchTerm ? (
            <TouchableOpacity onPress={() => setSearchTerm('')}>
              <MaterialIcons name="close" size={20} color="#555" />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity 
          style={styles.filterButton}
          onPress={() => setShowFilters(!showFilters)}
        >
          <MaterialIcons name="filter-list" size={24} color="#006064" />
        </TouchableOpacity>
      </View>
      
      {/* Filters Panel */}
      {showFilters && (
        <View style={styles.filtersPanel}>
          <Text style={styles.filterTitle}>Filter By:</Text>
          
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Continent:</Text>
            <View style={styles.filterOptions}>
              <TouchableOpacity 
                style={[
                  styles.filterOption, 
                  !filterValues.continent && styles.filterOptionSelected
                ]}
                onPress={() => setFilterValues({...filterValues, continent: ''})}
              >
                <Text style={!filterValues.continent ? styles.filterOptionTextSelected : styles.filterOptionText}>
                  All
                </Text>
              </TouchableOpacity>
              {continents.map(continent => (
                <TouchableOpacity 
                  key={continent}
                  style={[
                    styles.filterOption, 
                    filterValues.continent === continent && styles.filterOptionSelected
                  ]}
                  onPress={() => setFilterValues({...filterValues, continent})}
                >
                  <Text style={filterValues.continent === continent ? styles.filterOptionTextSelected : styles.filterOptionText}>
                    {continent}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Country:</Text>
            <View style={styles.filterOptions}>
              <TouchableOpacity 
                style={[
                  styles.filterOption, 
                  !filterValues.country && styles.filterOptionSelected
                ]}
                onPress={() => setFilterValues({...filterValues, country: ''})}
              >
                <Text style={!filterValues.country ? styles.filterOptionTextSelected : styles.filterOptionText}>
                  All
                </Text>
              </TouchableOpacity>
              {countries.map(country => (
                <TouchableOpacity 
                  key={country}
                  style={[
                    styles.filterOption, 
                    filterValues.country === country && styles.filterOptionSelected
                  ]}
                  onPress={() => setFilterValues({...filterValues, country})}
                >
                  <Text style={filterValues.country === country ? styles.filterOptionTextSelected : styles.filterOptionText}>
                    {country}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Conference:</Text>
            <View style={styles.filterOptions}>
              <TouchableOpacity 
                style={[
                  styles.filterOption, 
                  !filterValues.conference && styles.filterOptionSelected
                ]}
                onPress={() => setFilterValues({...filterValues, conference: ''})}
              >
                <Text style={!filterValues.conference ? styles.filterOptionTextSelected : styles.filterOptionText}>
                  All
                </Text>
              </TouchableOpacity>
              {conferences.map(conference => (
                <TouchableOpacity 
                  key={conference}
                  style={[
                    styles.filterOption, 
                    filterValues.conference === conference && styles.filterOptionSelected
                  ]}
                  onPress={() => setFilterValues({...filterValues, conference})}
                >
                  <Text style={filterValues.conference === conference ? styles.filterOptionTextSelected : styles.filterOptionText}>
                    {conference}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          
          <TouchableOpacity 
            style={styles.clearFiltersButton}
            onPress={clearFilters}
          >
            <Text style={styles.clearFiltersText}>Clear All Filters</Text>
          </TouchableOpacity>
        </View>
      )}
      
      <FlatList
        data={filteredChurches}
        renderItem={renderItem}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No churches found matching your criteria</Text>
        }
      />

      {currentUser && (
        <TouchableOpacity 
          style={styles.addButton} 
          onPress={() => setShowAddForm(true)}
        >
          <MaterialIcons name="add" size={24} color="white" />
          <Text style={styles.buttonText}>Add Your Church</Text>
        </TouchableOpacity>
      )}

      {renderAddForm()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#102E50',
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
    marginBottom: 2,
    marginTop:15,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.1)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
    textDecorationLine: 'underline',
    fontStyle:'italic',
    color:'orange'
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop:0,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  filterButton: {
    marginLeft: 10,
    padding: 8,
  },
  filtersPanel: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  filterTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#006064',
    marginBottom: 12,
  },
  filterGroup: {
    marginBottom: 16,
  },
  filterLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
  },
  filterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  filterOption: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#b2ebf2',
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: 'white',
  },
  filterOptionSelected: {
    backgroundColor: '#006064',
    borderColor: '#006064',
  },
  filterOptionText: {
    color: '#555',
  },
  filterOptionTextSelected: {
    color: 'white',
  },
  clearFiltersButton: {
    alignSelf: 'flex-end',
    padding: 8,
  },
  clearFiltersText: {
    color: '#e53935',
    fontWeight: '600',
  },
  listContainer: {
    paddingBottom: 20,
  },
  emptyText: {
    textAlign: 'center',
    color: '#555',
    marginTop: 20,
    fontSize: 16,
  },
  churchCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  churchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: '#eee', // Fallback color if image fails to load
  },
  username: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#006064',
  },
  churchName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#006064',
    marginBottom: 10,
  },
  churchActions: {
    flexDirection: 'row',
    gap: 10,
  },
  churchImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginVertical: 10,
  },
  churchDetails: {
    marginLeft: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailText: {
    color: '#555',
    marginLeft: 8,
    fontSize: 15,
  },
  metaContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  metaText: {
    color: '#777',
    fontSize: 13,
    fontStyle: 'italic',
  },
  addButton: {
    backgroundColor: '#006064',
    padding: 14,
    borderRadius: 30,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    height: height * 0.7,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 15,
  },
  formHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#006064',
  },
  closeButton: {
    padding: 5,
  },
  addForm: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: '#b2ebf2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#f5fdff',
    color: '#006064',
  },
  formButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  submitButton: {
    backgroundColor: '#006064',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
    flex: 1,
  },
  imagePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#e0f7fa',
    borderRadius: 8,
    marginBottom: 10,
  },
  imagePickerText: {
    marginLeft: 8,
    color: '#006064',
  },
  previewImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 10,
  },
});

export default Churches;