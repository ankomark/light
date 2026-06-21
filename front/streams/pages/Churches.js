import React, { useState, useEffect, useCallback } from 'react';
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
  Image,
  RefreshControl,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { fetchChurches, createChurch, updateChurch, deleteChurch } from '../services/api';
import { useAuth } from '../context/useAuth';
const DEFAULT_PROFILE_IMAGE = require('../assets/user-placeholder.png');

const Churches = () => {
  const { currentUser } = useAuth();
  const [churches, setChurches] = useState([]);
  const [filteredChurches, setFilteredChurches] = useState([]);
  const [newChurch, setNewChurch] = useState({
    name: '',
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
    country: '',
    conference: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [image, setImage] = useState(null);
  const [editingChurch, setEditingChurch] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Load churches from API (reused by initial load, pull-to-refresh, and mutations)
  const loadChurches = useCallback(async () => {
    try {
      const response = await fetchChurches({ page_size: 100 });
      const list = Array.isArray(response) ? response : [];
      setChurches(list);
      setFilteredChurches(list);
      return list;
    } catch (error) {
      Alert.alert('Error', 'Failed to load churches');
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await loadChurches();
      setIsLoading(false);
    })();
  }, [loadChurches]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadChurches();
    setRefreshing(false);
  }, [loadChurches]);

  // Filter churches based on search term and filters
  useEffect(() => {
    let results = churches;
    const term = searchTerm.trim().toLowerCase();

    if (term) {
      results = results.filter(church =>
        church.name?.toLowerCase().includes(term) ||
        church.location?.toLowerCase().includes(term) ||
        church.pastor?.toLowerCase().includes(term)
      );
    }

    if (filterValues.country) {
      results = results.filter(church =>
        church.country?.toLowerCase() === filterValues.country.toLowerCase()
      );
    }

    if (filterValues.conference) {
      results = results.filter(church =>
        church.conference?.toLowerCase() === filterValues.conference.toLowerCase()
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
      
      // Only upload a newly picked local image. When editing, `image` may hold
      // the existing remote URL, which must not be re-sent as a file.
      if (image && !/^https?:\/\//.test(image)) {
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
      await loadChurches();

      // Reset form
      setNewChurch({
        name: '',
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
      name: church.name || '',
      country: church.country || '',
      county: church.county || '',
      conference: church.conference || '',
      district: church.district || '',
      location: church.location || '',
      members: church.members != null ? church.members.toString() : '',
      pastor: church.pastor || '',
      contact: church.contact || ''
    });
    setImage(church.image || null);
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
              await loadChurches();
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
        : DEFAULT_PROFILE_IMAGE;
    const locationText = [item.location, item.district].filter(Boolean).join(', ');

    return (
      <View style={styles.churchCard}>
        <View style={styles.churchHeader}>
          <View style={styles.userInfo}>
            <Image
              source={creatorImage}
              style={styles.profileImage}
              defaultSource={DEFAULT_PROFILE_IMAGE}
            />
            <View>
              <Text style={styles.username}>{creatorName}</Text>
              <Text style={styles.byline}>Added this church</Text>
            </View>
          </View>
          <ChurchActions church={item} />
        </View>

        {item.image ? (
          <Image
            source={{ uri: item.image }}
            style={styles.churchImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.churchImage, styles.churchImagePlaceholder]}>
            <MaterialIcons name="church" size={44} color="#9fb3c8" />
          </View>
        )}

        <View style={styles.nameRow}>
          <MaterialIcons name="church" size={20} color="#006064" />
          <Text style={styles.churchName} numberOfLines={2}>{item.name}</Text>
        </View>

        <View style={styles.churchDetails}>
          {locationText ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="location-on" size={16} color="#00838f" />
              <Text style={styles.detailText}>{locationText}</Text>
            </View>
          ) : null}

          <View style={styles.detailRow}>
            <MaterialIcons name="people" size={16} color="#00838f" />
            <Text style={styles.detailText}>
              {Number(item.members || 0).toLocaleString()} members
            </Text>
          </View>

          {item.pastor ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="account-circle" size={16} color="#00838f" />
              <Text style={styles.detailText}>Pastor {item.pastor}</Text>
            </View>
          ) : null}

          {item.contact ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="phone" size={16} color="#00838f" />
              <Text style={styles.detailText}>{item.contact}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.metaContainer}>
          {item.conference ? (
            <View style={styles.chip}>
              <MaterialIcons name="account-balance" size={13} color="#006064" />
              <Text style={styles.chipText}>{item.conference}</Text>
            </View>
          ) : null}
          {item.country ? (
            <View style={styles.chip}>
              <MaterialIcons name="public" size={13} color="#006064" />
              <Text style={styles.chipText}>{item.country}</Text>
            </View>
          ) : null}
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
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalContainer}>
          <ScrollView
            style={styles.addForm}
            contentContainerStyle={styles.addFormContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
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
      </KeyboardAvoidingView>
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
  const countries = [...new Set(churches.map(church => church.country).filter(Boolean))];
  const conferences = [...new Set(churches.map(church => church.conference).filter(Boolean))];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Seventh-day Adventist Churches</Text>
      <Text style={styles.subtitle}>
        {filteredChurches.length} {filteredChurches.length === 1 ? 'church' : 'churches'}
      </Text>

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
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#fff"
            colors={['#006064']}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialIcons name="church" size={56} color="#3d567a" />
            <Text style={styles.emptyText}>No churches found</Text>
            <Text style={styles.emptySubtext}>
              {searchTerm || filterValues.country || filterValues.conference
                ? 'Try adjusting your search or filters'
                : 'Be the first to add a church'}
            </Text>
          </View>
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
    backgroundColor: '#0A1628',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
    letterSpacing: 0.3,
    color: '#FFA726',
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    color: '#cdd9e5',
    marginTop: 2,
    marginBottom: 10,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
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
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    textAlign: 'center',
    color: '#E0E1DD',
    marginTop: 14,
    fontSize: 17,
    fontWeight: '600',
  },
  emptySubtext: {
    textAlign: 'center',
    color: '#90a4c4',
    marginTop: 4,
    fontSize: 14,
  },
  churchCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  churchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginRight: 10,
    backgroundColor: '#eee',
    borderWidth: 2,
    borderColor: '#e0f2f4',
  },
  username: {
    fontWeight: '700',
    fontSize: 15,
    color: '#0b3d52',
  },
  byline: {
    fontSize: 12,
    color: '#90a4ae',
    marginTop: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  churchName: {
    flex: 1,
    fontSize: 19,
    fontWeight: '700',
    color: '#006064',
  },
  churchActions: {
    flexDirection: 'row',
    gap: 14,
  },
  churchImage: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    marginBottom: 12,
  },
  churchImagePlaceholder: {
    backgroundColor: '#eef3f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  churchDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailText: {
    color: '#455a64',
    marginLeft: 8,
    fontSize: 14.5,
    flex: 1,
  },
  metaContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eef2f4',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#e0f7fa',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  chipText: {
    color: '#006064',
    fontSize: 12.5,
    fontWeight: '600',
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
    // Percentage maxHeight (not a fixed pixel height) so the sheet shrinks to
    // the space left above the keyboard instead of clipping the top fields.
    maxHeight: '90%',
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
  addFormContent: {
    paddingBottom: 24,
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