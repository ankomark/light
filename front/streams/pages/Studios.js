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
  Image,
  Linking
} from 'react-native';
import { MaterialIcons, FontAwesome } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { 
  fetchVideoStudios, 
  createVideoStudio, 
  updateVideoStudio, 
  deleteVideoStudio 
} from '../services/api';
import { useAuth } from '../context/useAuth';

const { height } = Dimensions.get('window');

const SERVICE_TYPES = {
  music_video: 'Music Video Production',
  audio: 'Audio Recording',
  documentary: 'Documentary Production',
  live_event: 'Live Event Coverage',
  editing: 'Video Editing',
  other: 'Other Video Services'
};

const CURRENCY_SYMBOLS = {
  'USD': '$',
  'EUR': '€',
  'GBP': '£',
  'KES': 'KSh',
  'NGN': '₦',
  'GHS': 'GH₵',
  'ZAR': 'R',
  'TZS': 'TSh',
  'UGX': 'USh'
};

const Studios = () => {
  const { currentUser, isLoading: authLoading } = useAuth();
  const [studios, setStudios] = useState([]);
  const [filteredStudios, setFilteredStudios] = useState([]);
  const [newStudio, setNewStudio] = useState({
    name: '',
    description: '',
    location: '',
    contact_phone: '',
    contact_email: '',
    whatsapp_number: '',
    service_types: [],
    youtube_link: '',
    service_rates: '',
    rate_description: '',
    currency: 'USD'
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [logo, setLogo] = useState(null);
  const [coverImage, setCoverImage] = useState(null);
  const [editingStudio, setEditingStudio] = useState(null);
  const [showAllServices, setShowAllServices] = useState(false);
  const [expandedServices, setExpandedServices] = useState({}); // New state for card services

  // Load studios from API
  useEffect(() => {
    const loadStudios = async () => {
      if (authLoading) return;
      try {
        setIsLoading(true);
        const response = await fetchVideoStudios();
        // console.log('fetchVideoStudios Response:', response);
        const studiosWithServiceTypes = response.map(studio => ({
          ...studio,
          service_types: Array.isArray(studio.service_types) ? studio.service_types : [],
          whatsapp_number: studio.whatsapp_number || '' // Ensure whatsapp_number is string
        }));
        setStudios(studiosWithServiceTypes);
        setFilteredStudios(studiosWithServiceTypes);
      } catch (error) {
        Alert.alert('Error', 'Failed to load video studios');
        console.error('fetchVideoStudios Error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadStudios();
  }, [authLoading]);

  // Filter studios
  useEffect(() => {
    let results = studios;
    
    if (searchTerm) {
      results = results.filter(studio => 
        studio.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        studio.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
        studio.service_types.some(type => 
          SERVICE_TYPES[type]?.toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }
    
    setFilteredStudios(results);
  }, [searchTerm, studios]);

  const pickLogo = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled) {
      setLogo(result.assets[0].uri);
    }
  };

  const pickCoverImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 1,
    });

    if (!result.canceled) {
      setCoverImage(result.assets[0].uri);
    }
  };

  const handleServiceTypeToggle = (serviceType) => {
    setNewStudio(prev => {
      const newServiceTypes = prev.service_types.includes(serviceType)
        ? prev.service_types.filter(type => type !== serviceType)
        : [...prev.service_types, serviceType];
      
      return {
        ...prev,
        service_types: newServiceTypes
      };
    });
  };

  const handleAddStudio = async () => {
    if (!newStudio.name.trim() || !newStudio.location.trim() || newStudio.service_types.length === 0) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      const formData = new FormData();
      
      // Explicitly include all fields
      formData.append('name', newStudio.name);
      formData.append('description', newStudio.description || '');
      formData.append('location', newStudio.location);
      formData.append('contact_phone', newStudio.contact_phone || '');
      formData.append('contact_email', newStudio.contact_email || '');
      formData.append('whatsapp_number', newStudio.whatsapp_number || ''); // Always include
      formData.append('youtube_link', newStudio.youtube_link || '');
      formData.append('service_rates', newStudio.service_rates || '');
      formData.append('rate_description', newStudio.rate_description || '');
      formData.append('currency', newStudio.currency || 'USD');
      
      newStudio.service_types.forEach(service => {
        formData.append('service_types[]', service);
      });
      
      if (logo) {
        const uriParts = logo.split('.');
        const fileType = uriParts[uriParts.length - 1];
        formData.append('logo', {
          uri: logo,
          name: `logo.${fileType}`,
          type: `image/${fileType}`,
        });
      }
      
      if (coverImage) {
        const uriParts = coverImage.split('.');
        const fileType = uriParts[uriParts.length - 1];
        formData.append('cover_image', {
          uri: coverImage,
          name: `cover.${fileType}`,
          type: `image/${fileType}`,
        });
      }

      if (editingStudio) {
        await updateVideoStudio(editingStudio.id, formData);
        Alert.alert('Success', 'Studio updated successfully!');
      } else {
        await createVideoStudio(formData);
        Alert.alert('Success', 'Studio added successfully!');
      }

      const response = await fetchVideoStudios();
      const studiosWithServiceTypes = response.map(studio => ({
        ...studio,
        service_types: Array.isArray(studio.service_types) ? studio.service_types : [],
        whatsapp_number: studio.whatsapp_number || ''
      }));
      setStudios(studiosWithServiceTypes);
      setFilteredStudios(studiosWithServiceTypes);
      
      setNewStudio({
        name: '',
        description: '',
        location: '',
        contact_phone: '',
        contact_email: '',
        whatsapp_number: '',
        service_types: [],
        youtube_link: '',
        service_rates: '',
        rate_description: '',
        currency: 'USD'
      });
      setLogo(null);
      setCoverImage(null);
      setEditingStudio(null);
      setShowAddForm(false);
      setShowAllServices(false);
      setExpandedServices({});
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to add studio');
      console.error('handleAddStudio Error:', error);
    }
  };

  const handleEditStudio = (studio) => {
    setEditingStudio(studio);
    setNewStudio({
      name: studio.name,
      description: studio.description || '',
      location: studio.location,
      contact_phone: studio.contact_phone || '',
      contact_email: studio.contact_email || '',
      whatsapp_number: studio.whatsapp_number || '',
      service_types: Array.isArray(studio.service_types) ? studio.service_types : [],
      youtube_link: studio.youtube_link || '',
      service_rates: studio.service_rates ? studio.service_rates.toString() : '',
      rate_description: studio.rate_description || '',
      currency: studio.currency || 'USD'
    });
    setLogo(studio.logo_url || null);
    setCoverImage(studio.cover_image_url || null);
    setShowAddForm(true);
    setShowAllServices(false);
  };

  const handleDeleteStudio = async (id) => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this studio?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              await deleteVideoStudio(id);
              const response = await fetchVideoStudios();
              const studiosWithServiceTypes = response.map(studio => ({
                ...studio,
                service_types: Array.isArray(studio.service_types) ? studio.service_types : [],
                whatsapp_number: studio.whatsapp_number || ''
              }));
              setStudios(studiosWithServiceTypes);
              setFilteredStudios(studiosWithServiceTypes);
              setExpandedServices({});
              Alert.alert('Success', 'Studio deleted successfully!');
            } catch (error) {
              Alert.alert('Error', error.message || 'Failed to delete studio');
            }
          },
          style: 'destructive',
        },
      ],
      { cancelable: true }
    );
  };

  const openYoutubeLink = (url) => {
    if (url) {
      Linking.openURL(url).catch(err => {
        Alert.alert('Error', 'Failed to open YouTube link');
      });
    }
  };

  const openWhatsApp = (phone) => {
    if (phone) {
      const cleanedPhone = phone.replace(/\D/g, '');
      const whatsappUrl = `https://wa.me/${cleanedPhone}`;
      Linking.openURL(whatsappUrl).catch(err => {
        Alert.alert('Error', 'Failed to open WhatsApp. Ensure the number is registered with WhatsApp.');
      });
    } else {
      Alert.alert('Error', 'No WhatsApp number provided.');
    }
  };

  const toggleServices = (studioId) => {
    setExpandedServices(prev => ({
      ...prev,
      [studioId]: !prev[studioId]
    }));
  };

  const StudioActions = ({ studio }) => {
    const { currentUser } = useAuth();
    const creatorId = studio.created_by?.id || studio.created_by || studio.creator_id;

    // console.log('StudioActions - currentUser:', currentUser);
    // console.log('StudioActions - creatorId:', creatorId);
    // console.log('StudioActions - currentUser.id:', currentUser?.id);
    
    const isCreator = currentUser && creatorId && (
      creatorId === currentUser.id || 
      creatorId === currentUser.user_id
    );

    // console.log('StudioActions - isCreator:', isCreator);

    if (!isCreator) return null;

    return (
      <View style={styles.studioActions}>
        <TouchableOpacity 
          onPress={() => handleEditStudio(studio)}
          style={styles.actionButton}
        >
          <MaterialIcons name="edit" size={20} color="#006064" />
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => handleDeleteStudio(studio.id)}
          style={styles.actionButton}
        >
          <MaterialIcons name="delete" size={20} color="#e53935" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderItem = ({ item }) => {
     const creatorName = item.created_by_username || 
                     (item.created_by?.username) || 
                     'Unknown';
  const creatorImage = item.created_by_picture 
    ? { uri: item.created_by_picture }
    : (item.created_by?.profile?.picture 
        ? { uri: item.created_by.profile.picture } 
        : null);
  const isExpanded = expandedServices[item.id];

  return (
    <View style={styles.studioCard}>
      <View style={styles.studioHeader}>
        {item.logo_url && (
          <Image 
            source={{ uri: item.logo_url }} 
            style={styles.logoImage}
          />
        )}
        <View style={styles.studioHeaderInfo}>
          <Text style={styles.studioName}>{item.name}</Text>
          <View style={styles.serviceTypesContainer}>
            {(isExpanded ? item.service_types : item.service_types.slice(0, 1)).map(type => (
              <Text key={type} style={styles.serviceType}>
                {SERVICE_TYPES[type] || type}
              </Text>
            ))}
          </View>
          {item.service_types.length > 1 && (
            <TouchableOpacity 
              style={styles.showMoreButton}
              onPress={() => toggleServices(item.id)}
            >
              <Text style={styles.showMoreText}>
                {isExpanded ? 'Show Less' : `+${item.service_types.length - 1} More`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <StudioActions studio={item} />
      </View>
        
        {item.cover_image_url && (
          <Image 
            source={{ uri: item.cover_image_url }} 
            style={styles.coverImage}
            resizeMode="cover"
          />
        )}
        
        {item.description && (
          <Text style={styles.description}>{item.description}</Text>
        )}
        
        <View style={styles.details}>
          <View style={styles.detailRow}>
            <MaterialIcons name="location-on" size={16} color="#555" />
            <Text style={styles.detailText}>{item.location}</Text>
          </View>
          
          {item.contact_phone && (
            <View style={styles.detailRow}>
              <MaterialIcons name="phone" size={16} color="#555" />
              <Text style={styles.detailText}>{item.contact_phone}</Text>
            </View>
          )}
          
          <TouchableOpacity 
            style={styles.detailRow}
            onPress={() => openWhatsApp(item.whatsapp_number)}
          >
            <FontAwesome name="whatsapp" size={16} color="#25D366" />
            <Text style={[styles.detailText, styles.whatsappText]}>
              {item.whatsapp_number ? item.whatsapp_number : 'Not provided'}
            </Text>
          </TouchableOpacity>
          
          {item.contact_email && (
            <View style={styles.detailRow}>
              <MaterialIcons name="email" size={16} color="#555" />
              <Text style={styles.detailText}>{item.contact_email}</Text>
            </View>
          )}
          
          {(item.service_rates || item.rate_description) && (
            <View style={styles.ratesContainer}>
              {item.service_rates && (
                <Text style={styles.ratesText}>
                  {CURRENCY_SYMBOLS[item.currency] || item.currency} {item.service_rates}
                </Text>
              )}
              {item.rate_description && (
                <Text style={styles.rateDescription}>{item.rate_description}</Text>
              )}
            </View>
          )}
          
          {item.youtube_link && (
            <TouchableOpacity 
              style={styles.youtubeButton}
              onPress={() => openYoutubeLink(item.youtube_link)}
            >
              <MaterialIcons name="play-circle" size={26} color="#e53935" />
              <Text style={styles.youtubeText}>Visit our youtube channel</Text>
            </TouchableOpacity>
          )}
          
          <View style={styles.metaContainer}>
            <View style={styles.statusContainer}>
              <Text style={styles.metaText}>
                {item.is_verified && (
                  <MaterialIcons name="verified" size={14} color="#4CAF50" />
                )}
                {item.is_verified ? ' Verified Studio' : ' Unverified Studio'}
              </Text>
            </View>
            
            <View style={styles.creatorContainer}>
              {creatorImage && (
                <Image 
                  source={creatorImage} 
                  style={styles.creatorImage}
                />
              )}
              <Text style={styles.creatorName}>{creatorName}</Text>
            </View>
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
                {editingStudio ? 'Edit Studio' : 'Add New Studio'}
              </Text>
              <TouchableOpacity 
                onPress={() => {
                  setShowAddForm(false);
                  setEditingStudio(null);
                  setNewStudio({
                    name: '',
                    description: '',
                    location: '',
                    contact_phone: '',
                    contact_email: '',
                    whatsapp_number: '',
                    service_types: [],
                    youtube_link: '',
                    service_rates: '',
                    rate_description: '',
                    currency: 'USD'
                  });
                  setLogo(null);
                  setCoverImage(null);
                  setShowAllServices(false);
                }}
                style={styles.closeButton}
              >
                <MaterialIcons name="close" size={24} color="#555" />
              </TouchableOpacity>
            </View>
            
            <TextInput
              style={styles.input}
              placeholder="Studio Name *"
              value={newStudio.name}
              onChangeText={text => setNewStudio({...newStudio, name: text})}
            />
            
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Description"
              value={newStudio.description}
              onChangeText={text => setNewStudio({...newStudio, description: text})}
              multiline
              numberOfLines={4}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Location *"
              value={newStudio.location}
              onChangeText={text => setNewStudio({...newStudio, location: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Contact Phone"
              value={newStudio.contact_phone}
              onChangeText={text => setNewStudio({...newStudio, contact_phone: text})}
              keyboardType="phone-pad"
            />
            
            <TextInput
              style={styles.input}
              placeholder="WhatsApp Number"
              value={newStudio.whatsapp_number}
              onChangeText={text => setNewStudio({...newStudio, whatsapp_number: text})}
              keyboardType="phone-pad"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Contact Email"
              value={newStudio.contact_email}
              onChangeText={text => setNewStudio({...newStudio, contact_email: text})}
              keyboardType="email-address"
            />
            
            <Text style={styles.label}>Service Types *:</Text>
            <View style={styles.serviceTypeOptions}>
              {Object.entries(SERVICE_TYPES).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[
                    styles.serviceTypeOption,
                    newStudio.service_types.includes(value) && styles.serviceTypeOptionSelected
                  ]}
                  onPress={() => handleServiceTypeToggle(value)}
                >
                  <Text style={newStudio.service_types.includes(value) ? styles.serviceTypeOptionTextSelected : styles.serviceTypeOptionText}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            <TouchableOpacity 
              style={styles.showMoreButton}
              onPress={() => setShowAllServices(!showAllServices)}
            >
              <Text style={styles.showMoreText}>
                {showAllServices ? 'Hide Services' : 'Show Selected Services'}
              </Text>
              <MaterialIcons 
                name={showAllServices ? 'expand-less' : 'expand-more'} 
                size={20} 
                color="#006064" 
              />
            </TouchableOpacity>
            
            {showAllServices && (
              <View style={styles.selectedServicesContainer}>
                <Text style={styles.label}>Selected Services:</Text>
                {newStudio.service_types.length > 0 ? (
                  newStudio.service_types.map(type => (
                    <Text key={type} style={styles.selectedService}>
                      {SERVICE_TYPES[type] || type}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.noServicesText}>No services selected</Text>
                )}
              </View>
            )}
            
            <TextInput
              style={styles.input}
              placeholder="YouTube Link (optional)"
              value={newStudio.youtube_link}
              onChangeText={text => setNewStudio({...newStudio, youtube_link: text})}
            />
            
            <View style={styles.rateInputContainer}>
              <View style={styles.currencyPicker}>
                <Text style={styles.label}>Currency:</Text>
                <View style={styles.currencyOptions}>
                  {Object.keys(CURRENCY_SYMBOLS).map(currency => (
                    <TouchableOpacity
                      key={currency}
                      style={[
                        styles.currencyOption,
                        newStudio.currency === currency && styles.currencyOptionSelected
                      ]}
                      onPress={() => setNewStudio({...newStudio, currency})}
                    >
                      <Text style={newStudio.currency === currency ? styles.currencyOptionTextSelected : styles.currencyOptionText}>
                        {currency}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              
              <TextInput
                style={[styles.input, styles.rateInput]}
                placeholder="Service Rates (optional)"
                value={newStudio.service_rates}
                onChangeText={text => setNewStudio({...newStudio, service_rates: text})}
                keyboardType="numeric"
              />
            </View>
            
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Rate Description (e.g., 'Starting from...', 'Per hour/day...')"
              value={newStudio.rate_description}
              onChangeText={text => setNewStudio({...newStudio, rate_description: text})}
              multiline
              numberOfLines={3}
            />
            
            <TouchableOpacity style={styles.imagePicker} onPress={pickLogo}>
              <MaterialIcons name="add-a-photo" size={24} color="#006064" />
              <Text style={styles.imagePickerText}>
                {logo ? 'Change Logo' : 'Add Studio Logo'}
              </Text>
            </TouchableOpacity>
            
            {logo && (
              <Image 
                source={{ uri: logo }} 
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}
            
            <TouchableOpacity style={styles.imagePicker} onPress={pickCoverImage}>
              <MaterialIcons name="add-a-photo" size={24} color="#006064" />
              <Text style={styles.imagePickerText}>
                {coverImage ? 'Change Cover Image' : 'Add Cover Image'}
              </Text>
            </TouchableOpacity>
            
            {coverImage && (
              <Image 
                source={{ uri: coverImage }} 
                style={styles.previewImage}
                resizeMode="cover"
              />
            )}
            
            <View style={styles.formButtons}>
              <TouchableOpacity 
                style={styles.submitButton} 
                onPress={handleAddStudio}
              >
                <Text style={styles.buttonText}>
                  {editingStudio ? 'Update Studio' : 'Add Studio'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  if (authLoading || isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#006064" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Production Studios</Text>
      
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <MaterialIcons name="search" size={20} color="#555" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search studios..."
            value={searchTerm}
            onChangeText={setSearchTerm}
          />
          {searchTerm && (
            <TouchableOpacity onPress={() => setSearchTerm('')}>
              <MaterialIcons name="close" size={20} color="#555" />
            </TouchableOpacity>
          )}
        </View>
      </View>
      
      <FlatList
        data={filteredStudios}
        renderItem={renderItem}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No studios found</Text>
        }
      />

      {currentUser && (
        <TouchableOpacity 
          style={styles.addButton} 
          onPress={() => setShowAddForm(true)}
        >
          <MaterialIcons name="add" size={24} color="white" />
          <Text style={styles.buttonText}>Add Your Studio</Text>
        </TouchableOpacity>
      )}

      {renderAddForm()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e0f7fa',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop : 15,
    marginBottom: 16,
    color: '#006064',
    textAlign: 'center',
  },
  searchContainer: {
    marginBottom: 16,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
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
  listContainer: {
    paddingBottom: 20,
  },
  emptyText: {
    textAlign: 'center',
    color: '#777',
    marginTop: 20,
    fontSize: 16,
  },
  studioCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  studioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  logoImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  studioHeaderInfo: {
    flex: 1,
  },
  studioName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#006064',
  },
  serviceTypesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    marginBottom: 4,
  },
  serviceType: {
    fontSize: 12,
    color: '#555',
    backgroundColor: '#e0f7fa',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
    marginBottom: 6,
  },
  studioActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    padding: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
  },
  coverImage: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    marginBottom: 12,
  },
  description: {
    color: '#555',
    marginBottom: 12,
    fontSize: 14,
    lineHeight: 20,
  },
  details: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailText: {
    color: '#555',
    marginLeft: 8,
    fontSize: 14,
  },
  whatsappText: {
    color: '#25D366',
    fontWeight: '500',
  },
  ratesContainer: {
    marginVertical: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  ratesText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#006064',
  },
  rateDescription: {
    color: '#666',
    fontSize: 14,
    marginTop: 4,
  },
  youtubeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  youtubeText: {
    color: '#e53935',
    marginLeft: 8,
    fontWeight: '500',
  },
  metaContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    color: '#777',
    fontSize: 12,
    marginRight: 8,
  },
  creatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  creatorImage: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 8,
  },
  creatorName: {
    fontSize: 12,
    color: '#555',
    fontWeight: '500',
  },
  addButton: {
    backgroundColor: '#006064',
    padding: 14,
    borderRadius: 8,
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
    padding: 16,
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
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  label: {
    color: '#555',
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  serviceTypeOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  serviceTypeOption: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#b2ebf2',
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: 'white',
  },
  serviceTypeOptionSelected: {
    backgroundColor: '#006064',
    borderColor: '#006064',
  },
  serviceTypeOptionText: {
    color: '#555',
    fontSize: 12,
  },
  serviceTypeOptionTextSelected: {
    color: 'white',
    fontSize: 12,
  },
  showMoreButton: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    padding: 4,
    backgroundColor: '#e0f7fa',
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 8,
    justifyContent: 'space-between',
  },
  showMoreText: {
    color: '#006064',
    fontSize: 14,
    fontWeight: '500',
  },
  selectedServicesContainer: {
    marginBottom: 12,
    padding: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  selectedService: {
    fontSize: 14,
    color: '#555',
    marginBottom: 4,
  },
  noServicesText: {
    fontSize: 14,
    color: '#777',
    fontStyle: 'italic',
  },
  rateInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  currencyPicker: {
    marginRight: 12,
  },
  currencyOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  currencyOption: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b2ebf2',
    marginRight: 6,
    marginBottom: 6,
    backgroundColor: 'white',
  },
  currencyOptionSelected: {
    backgroundColor: '#006064',
    borderColor: '#006064',
  },
  currencyOptionText: {
    color: '#555',
    fontSize: 12,
  },
  currencyOptionTextSelected: {
    color: 'white',
    fontSize: 12,
  },
  rateInput: {
    flex: 1,
  },
  formButtons: {
    marginTop: 20,
  },
  submitButton: {
    backgroundColor: '#006064',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
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
    height: 150,
    borderRadius: 8,
    marginBottom: 12,
  },
});

export default Studios;