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
import { fetchAudiostudios, createAudiostudio, updateAudiostudio, deleteAudiostudio } from '../services/api';
import { useAuth } from '../context/useAuth';

const { height } = Dimensions.get('window');

const Audiostudios = () => {
  const { currentUser } = useAuth();
  const [audiostudios, setAudiostudios] = useState([]);
  const [filteredAudiostudios, setFilteredAudiostudios] = useState([]);
  const [newAudiostudio, setNewAudiostudio] = useState({
    name: '',
    location: '',
    contact_phone: '',
    contact_email: '',
    services: '',
    equipment: '',
    hourly_rate: ''
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [image, setImage] = useState(null);
  const [editingAudiostudio, setEditingAudiostudio] = useState(null);

  useEffect(() => {
    const loadAudiostudios = async () => {
      try {
        setIsLoading(true);
        const response = await fetchAudiostudios();
        setAudiostudios(response);
        setFilteredAudiostudios(response);
      } catch (error) {
        Alert.alert('Error', 'Failed to load audio studios');
      } finally {
        setIsLoading(false);
      }
    };

    loadAudiostudios();
  }, []);

  useEffect(() => {
    let results = audiostudios;
    
    if (searchTerm) {
      results = results.filter(studio => 
        studio.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        studio.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
        studio.services?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    setFilteredAudiostudios(results);
  }, [searchTerm, audiostudios]);

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

  const handleAddAudiostudio = async () => {
    if (!newAudiostudio.name.trim() || !newAudiostudio.location.trim()) {
      Alert.alert('Error', 'Please fill in all required fields (Name, Location)');
      return;
    }

    try {
      const formData = new FormData();
      
      Object.keys(newAudiostudio).forEach(key => {
        if (newAudiostudio[key]) {
          formData.append(key, newAudiostudio[key]);
        }
      });
      
      if (image) {
        const uriParts = image.split('.');
        const fileType = uriParts[uriParts.length - 1];
        
        formData.append('image', {
          uri: image,
          name: `photo.${fileType}`,
          type: `image/${fileType}`,
        });
      }

      if (editingAudiostudio) {
        await updateAudiostudio(editingAudiostudio.id, formData);
        Alert.alert('Success', 'Audio studio updated successfully!');
      } else {
        await createAudiostudio(formData);
        Alert.alert('Success', 'Audio studio added successfully!');
      }

      const response = await fetchAudiostudios();
      setAudiostudios(response);
      setFilteredAudiostudios(response);
      
      setNewAudiostudio({
        name: '',
        location: '',
        contact_phone: '',
        contact_email: '',
        services: '',
        equipment: '',
        hourly_rate: ''
      });
      setImage(null);
      setEditingAudiostudio(null);
      setShowAddForm(false);
    } catch (error) {
      Alert.alert('Error', error.message || 'You can only edit audio studios you created');
    }
  };

  const handleEditAudiostudio = (studio) => {
    setEditingAudiostudio(studio);
    setNewAudiostudio({
      name: studio.name,
      location: studio.location,
      contact_phone: studio.contact_phone,
      contact_email: studio.contact_email,
      services: studio.services,
      equipment: studio.equipment,
      hourly_rate: studio.hourly_rate?.toString() || ''
    });
    setImage(studio.image);
    setShowAddForm(true);
  };

  const handleDeleteAudiostudio = async (id) => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this audio studio?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              await deleteAudiostudio(id);
              const response = await fetchAudiostudios();
              setAudiostudios(response);
              setFilteredAudiostudios(response);
              Alert.alert('Success', 'Audio studio deleted successfully!');
            } catch (error) {
              Alert.alert('Error', 'You can only delete audio studios you created');
            }
          },
          style: 'destructive',
        },
      ],
      { cancelable: true }
    );
  };

  const AudiostudioActions = ({ audiostudio }) => {
    const isCreator = currentUser && (
      audiostudio.created_by?.id === currentUser.id || 
      audiostudio.created_by === currentUser.id
    );
    
    if (!isCreator) return null;
    
    return (
      <View style={styles.audiostudioActions}>
        <TouchableOpacity onPress={() => handleEditAudiostudio(audiostudio)}>
          <MaterialIcons name="edit" size={20} color="#006064" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDeleteAudiostudio(audiostudio.id)}>
          <MaterialIcons name="delete" size={20} color="#e53935" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderItem = ({ item }) => {
    const creatorName = item.created_by_username || 'Unknown';
    const creatorImage = item.created_by_picture 
        ? { uri: item.created_by_picture }
        : { uri: 'https://via.placeholder.com/150' };

    return (
      <View style={styles.audiostudioCard}>
        <View style={styles.audiostudioHeader}>
          <View style={styles.userInfo}>
            <Image 
              source={creatorImage} 
              style={styles.profileImage}
              onError={() => console.log('Error loading profile image')}
            />
            <View>
              <Text style={styles.username}>{creatorName}</Text>
            </View>
          </View>
          <AudiostudioActions audiostudio={item} />
        </View>
        
        <Text style={styles.audiostudioName}>{item.name}</Text>
        
        {item.image && (
          <Image 
            source={{ uri: item.image }} 
            style={styles.audiostudioImage}
            resizeMode="cover"
          />
        )}
        
        <View style={styles.audiostudioDetails}>
          <View style={styles.detailRow}>
            <MaterialIcons name="location-on" size={16} color="#555" />
            <Text style={styles.detailText}>{item.location}</Text>
          </View>
          
          {item.services && (
            <View style={styles.detailRow}>
              <MaterialIcons name="music-note" size={16} color="#555" />
              <Text style={styles.detailText}>{item.services}</Text>
            </View>
          )}
          
          {item.contact_phone && (
            <View style={styles.detailRow}>
              <MaterialIcons name="phone" size={16} color="#555" />
              <Text style={styles.detailText}>{item.contact_phone}</Text>
            </View>
          )}
          
          {item.contact_email && (
            <View style={styles.detailRow}>
              <MaterialIcons name="email" size={16} color="#555" />
              <Text style={styles.detailText}>{item.contact_email}</Text>
            </View>
          )}
          
          {item.hourly_rate && (
            <View style={styles.detailRow}>
              <MaterialIcons name="attach-money" size={16} color="#555" />
              <Text style={styles.detailText}>${item.hourly_rate}/hour</Text>
            </View>
          )}
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
                {editingAudiostudio ? 'Edit Audio Studio' : 'Add New Audio Studio'}
              </Text>
              <TouchableOpacity 
                onPress={() => {
                  setShowAddForm(false);
                  setEditingAudiostudio(null);
                  setNewAudiostudio({
                    name: '',
                    location: '',
                    contact_phone: '',
                    contact_email: '',
                    services: '',
                    equipment: '',
                    hourly_rate: ''
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
              placeholder="Studio Name *"
              value={newAudiostudio.name}
              onChangeText={text => setNewAudiostudio({...newAudiostudio, name: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Location *"
              value={newAudiostudio.location}
              onChangeText={text => setNewAudiostudio({...newAudiostudio, location: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Phone Number"
              value={newAudiostudio.contact_phone}
              onChangeText={text => setNewAudiostudio({...newAudiostudio, contact_phone: text})}
              keyboardType="phone-pad"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Email"
              value={newAudiostudio.contact_email}
              onChangeText={text => setNewAudiostudio({...newAudiostudio, contact_email: text})}
              keyboardType="email-address"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Services Offered"
              value={newAudiostudio.services}
              onChangeText={text => setNewAudiostudio({...newAudiostudio, services: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Equipment Available"
              value={newAudiostudio.equipment}
              onChangeText={text => setNewAudiostudio({...newAudiostudio, equipment: text})}
              multiline
            />
            
            <TextInput
              style={styles.input}
              placeholder="Hourly Rate (USD)"
              value={newAudiostudio.hourly_rate}
              onChangeText={text => setNewAudiostudio({...newAudiostudio, hourly_rate: text})}
              keyboardType="numeric"
            />
            
            <TouchableOpacity style={styles.imagePicker} onPress={pickImage}>
              <MaterialIcons name="add-a-photo" size={24} color="#006064" />
              <Text style={styles.imagePickerText}>
                {image ? 'Change Image' : 'Add Studio Image'}
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
                onPress={handleAddAudiostudio}
              >
                <Text style={styles.buttonText}>
                  {editingAudiostudio ? 'Update Studio' : 'Add Studio'}
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Audio Recording Studios</Text>
      
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <MaterialIcons name="search" size={20} color="#555" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search audio studios..."
            value={searchTerm}
            onChangeText={setSearchTerm}
          />
          {searchTerm ? (
            <TouchableOpacity onPress={() => setSearchTerm('')}>
              <MaterialIcons name="close" size={20} color="#555" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      
      <FlatList
        data={filteredAudiostudios}
        renderItem={renderItem}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No audio studios found matching your criteria</Text>
        }
      />

      {currentUser && (
        <TouchableOpacity 
          style={styles.addButton} 
          onPress={() => setShowAddForm(true)}
        >
          <MaterialIcons name="add" size={24} color="white" />
          <Text style={styles.buttonText}>Add Audio Studio</Text>
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
  listContainer: {
    paddingBottom: 20,
  },
  emptyText: {
    textAlign: 'center',
    color: '#555',
    marginTop: 20,
    fontSize: 16,
  },
  videostudioCard: {
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
  videostudioHeader: {
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
    backgroundColor: '#eee',
  },
  username: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#006064',
  },
  videostudioName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#006064',
    marginBottom: 10,
  },
  videostudioActions: {
    flexDirection: 'row',
    gap: 10,
  },
  videostudioImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginVertical: 10,
  },
  videostudioDetails: {
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
export default Audiostudios