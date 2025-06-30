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
  fetchChoirs, 
  fetchMyChoirs,
  createChoir, 
  updateChoir, 
  deleteChoir,
  addChoirMember,
  toggleChoirActive, // Correct import
  updateChoirMembers // Correct import
} from '../services/api';
import { useAuth } from '../context/useAuth';

const { height } = Dimensions.get('window');

const GENRE_CHOICES = {
  gospel: 'Gospel',
  contemporary: 'Contemporary Christian',
  traditional: 'Traditional Hymns',
  mixed: 'Mixed Repertoire'
};

const Choirs = () => {
  const { currentUser, isLoading: authLoading } = useAuth();
  const [choirs, setChoirs] = useState([]);
  const [filteredChoirs, setFilteredChoirs] = useState([]);
  const [editingMembersCount, setEditingMembersCount] = useState(false);
  const [tempMembersCount, setTempMembersCount] = useState('');
  const [newChoir, setNewChoir] = useState({
    name: '',
    description: '',
    church: '',
    location: '',
    contact_phone: '',
    contact_email: '',
    genre: 'gospel',
    members_count: 0,
    youtube_link: '',
    founded_date: ''
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [profileImage, setProfileImage] = useState(null);
  const [coverImage, setCoverImage] = useState(null);
  const [editingChoir, setEditingChoir] = useState(null);
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [newMemberId, setNewMemberId] = useState('');

  // Load choirs from API
  useEffect(() => {
    const loadChoirs = async () => {
      if (authLoading) return;
      try {
        setIsLoading(true);
        const response = await fetchChoirs();
        console.log('fetchChoirs Response:', response); // Debug API response
        setChoirs(response);
        setFilteredChoirs(response);
      } catch (error) {
        Alert.alert('Error', 'Failed to load choirs');
        console.error('fetchChoirs Error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadChoirs();
  }, [authLoading]);

  // Filter choirs
  useEffect(() => {
    let results = choirs;
    
    if (searchTerm) {
      results = results.filter(choir => 
        choir.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        choir.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
        GENRE_CHOICES[choir.genre]?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    setFilteredChoirs(results);
  }, [searchTerm, choirs]);

  const pickProfileImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled) {
      setProfileImage(result.assets[0].uri);
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

  const handleAddChoir = async () => {
    if (!newChoir.name.trim() || !newChoir.location.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      const formData = new FormData();
      
      formData.append('name', newChoir.name);
      formData.append('description', newChoir.description || '');
      formData.append('location', newChoir.location);
      formData.append('contact_phone', newChoir.contact_phone || '');
      formData.append('contact_email', newChoir.contact_email || '');
      formData.append('genre', newChoir.genre);
      formData.append('youtube_link', newChoir.youtube_link || '');
      formData.append('founded_date', newChoir.founded_date || '');
      
      if (profileImage) {
        const uriParts = profileImage.split('.');
        const fileType = uriParts[uriParts.length - 1];
        formData.append('profile_image', {
          uri: profileImage,
          name: `profile.${fileType}`,
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

      if (editingChoir) {
        await updateChoir(editingChoir.id, formData);
        Alert.alert('Success', 'Choir updated successfully!');
      } else {
        await createChoir(formData);
        Alert.alert('Success', 'Choir added successfully!');
      }

      const response = await fetchChoirs();
      setChoirs(response);
      setFilteredChoirs(response);
      
      setNewChoir({
        name: '',
        description: '',
        church: '',
        location: '',
        contact_phone: '',
        contact_email: '',
        genre: 'gospel',
        members_count: 0,
        youtube_link: '',
        founded_date: ''
      });
      setProfileImage(null);
      setCoverImage(null);
      setEditingChoir(null);
      setShowAddForm(false);
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to add choir');
      console.error('handleAddChoir Error:', error);
    }
  };

  const handleStartEditMembersCount = (choir) => {
    setTempMembersCount(choir.members_count.toString());
    setEditingChoir(choir);
    setEditingMembersCount(true);
  };

  const handleSaveMembersCount = async () => {
    if (!tempMembersCount || isNaN(tempMembersCount)) {
      Alert.alert('Error', 'Please enter a valid number');
      return;
    }

    try {
      await updateChoirMembers(editingChoir.id, parseInt(tempMembersCount));
      const response = await fetchChoirs();
      setChoirs(response);
      setFilteredChoirs(response);
      setEditingMembersCount(false);
      setEditingChoir(null);
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to update members count');
    }
  };

  const handleToggleActive = async (choir) => {
    try {
      console.log('Toggling active status for choir:', choir.id); // Debug API call
      await toggleChoirActive(choir.id); // Use correct function name
      const response = await fetchChoirs();
      setChoirs(response);
      setFilteredChoirs(response);
    } catch (error) {
      console.error('handleToggleActive Error:', error);
      Alert.alert('Error', error.message || 'Failed to toggle active status');
    }
  };

  const handleEditChoir = (choir) => {
    setEditingChoir(choir);
    setNewChoir({
      name: choir.name,
      description: choir.description || '',
      church: choir.church || '',
      location: choir.location,
      contact_phone: choir.contact_phone || '',
      contact_email: choir.contact_email || '',
      genre: choir.genre,
      members_count: choir.members_count || 0,
      youtube_link: choir.youtube_link || '',
      founded_date: choir.founded_date || ''
    });
    setProfileImage(choir.profile_image_url || null);
    setCoverImage(choir.cover_image_url || null);
    setShowAddForm(true);
  };

  const handleDeleteChoir = async (id) => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this choir?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              await deleteChoir(id);
              const response = await fetchChoirs();
              setChoirs(response);
              setFilteredChoirs(response);
              Alert.alert('Success', 'Choir deleted successfully!');
            } catch (error) {
              Alert.alert('Error', error.message || 'Failed to delete choir');
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

  const handleAddMember = async (choirId) => {
    if (!newMemberId.trim()) {
      Alert.alert('Error', 'Please enter a valid user ID');
      return;
    }

    try {
      await addChoirMember(choirId, newMemberId);
      Alert.alert('Success', 'Member added successfully!');
      const response = await fetchChoirs();
      setChoirs(response);
      setFilteredChoirs(response);
      setNewMemberId('');
      setShowMemberForm(false);
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to add member');
    }
  };

  const ChoirActions = ({ choir, currentUser }) => {
    const creatorId = choir.created_by?.id || choir.created_by || choir.creator_id;
    const isCreator = currentUser && creatorId && (
      creatorId === currentUser.id || 
      creatorId === currentUser.user_id
    );

    if (!isCreator) return null;

    return (
      <View style={styles.choirActions}>
        <TouchableOpacity 
          onPress={() => handleEditChoir(choir)}
          style={styles.actionButton}
        >
          <MaterialIcons name="edit" size={20} color="#006064" />
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => handleDeleteChoir(choir.id)}
          style={styles.actionButton}
        >
          <MaterialIcons name="delete" size={20} color="#e53935" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderItem = ({ item }) => {
    const creatorId = item.created_by?.id || item.created_by || item.creator_id;
    const isCreator = currentUser && creatorId && (
      creatorId === currentUser.id || 
      creatorId === currentUser.user_id
    );

    // console.log('renderItem - currentUser:', currentUser); // Debug
    // console.log('renderItem - item.created_by:', item.created_by);
    // console.log('renderItem - creatorId:', creatorId);
    // console.log('renderItem - isCreator:', isCreator);
    // console.log('renderItem - item.is_active:', item.is_active);

    return (
      <View style={styles.choirCard}>
        <View style={styles.choirHeader}>
          {item.profile_image_url && (
            <Image 
              source={{ uri: item.profile_image_url }} 
              style={styles.profileImage}
            />
          )}
          <View style={styles.choirHeaderInfo}>
            <Text style={styles.choirName}>{item.name}</Text>
            <Text style={styles.choirGenre}>{GENRE_CHOICES[item.genre]}</Text>
            <Text style={styles.choirMembers}>{item.members_count} members</Text>
          </View>
          <ChoirActions choir={item} currentUser={currentUser} />
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
          
          {item.contact_email && (
            <View style={styles.detailRow}>
              <MaterialIcons name="email" size={16} color="#555" />
              <Text style={styles.detailText}>{item.contact_email}</Text>
            </View>
          )}
          
          {item.founded_date && (
            <View style={styles.detailRow}>
              <MaterialIcons name="event" size={16} color="#555" />
              <Text style={styles.detailText}>Founded: {new Date(item.founded_date).toLocaleDateString()}</Text>
            </View>
          )}
          
          {item.youtube_link && (
            <TouchableOpacity 
              style={styles.youtubeButton}
              onPress={() => openYoutubeLink(item.youtube_link)}
            >
              <MaterialIcons name="play-circle" size={26} color="#e53935" />
              <Text style={styles.youtubeText}>Visit our YouTube channel</Text>
            </TouchableOpacity>
          )}
          
          <View style={styles.metaContainer}>
            <View style={styles.statusContainer}>
              <Text style={styles.metaText}>
                {item.is_active ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>
          
          {isCreator && (
            <View style={styles.creatorControls}>
              {editingMembersCount && editingChoir?.id === item.id ? (
                <View style={styles.editMembersContainer}>
                  <TextInput
                    style={styles.membersInput}
                    value={tempMembersCount}
                    onChangeText={setTempMembersCount}
                    keyboardType="numeric"
                    placeholder="Enter member count"
                  />
                  <View style={styles.editMembersButtonRow}>
                    <TouchableOpacity 
                      style={styles.saveButton}
                      onPress={handleSaveMembersCount}
                    >
                      <MaterialIcons name="check" size={20} color="white" />
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.cancelButton}
                      onPress={() => setEditingMembersCount(false)}
                    >
                      <MaterialIcons name="close" size={20} color="white" />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity 
                  style={styles.editMembersButton}
                  onPress={() => handleStartEditMembersCount(item)}
                >
                  <Text style={styles.editMembersText}>
                    <MaterialIcons name="edit" size={16} color="#006064" /> 
                    Members: {item.members_count}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity 
                style={[
                  styles.activeToggleButton,
                  item.is_active ? styles.activeButton : styles.inactiveButton
                ]}
                onPress={() => handleToggleActive(item)}
              >
                <MaterialIcons 
                  name={item.is_active ? "toggle-on" : "toggle-off"} 
                  size={24} 
                  color="white" 
                />
                <Text style={styles.activeToggleText}>
                  {item.is_active ? ' Active' : ' Inactive'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.addMemberButton}
                onPress={() => {
                  setShowMemberForm(true);
                  setEditingChoir(item);
                }}
              >
                <MaterialIcons name="person-add" size={16} color="white" />
                <Text style={styles.addMemberText}> Add Member</Text>
              </TouchableOpacity>
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
                {editingChoir ? 'Edit Choir' : 'Add New Choir'}
              </Text>
              <TouchableOpacity 
                onPress={() => {
                  setShowAddForm(false);
                  setEditingChoir(null);
                  setNewChoir({
                    name: '',
                    description: '',
                    church: '',
                    location: '',
                    contact_phone: '',
                    contact_email: '',
                    genre: 'gospel',
                    members_count: 0,
                    youtube_link: '',
                    founded_date: ''
                  });
                  setProfileImage(null);
                  setCoverImage(null);
                }}
                style={styles.closeButton}
              >
                <MaterialIcons name="close" size={24} color="#555" />
              </TouchableOpacity>
            </View>
            
            <TextInput
              style={styles.input}
              placeholder="Choir Name *"
              value={newChoir.name}
              onChangeText={text => setNewChoir({...newChoir, name: text})}
            />
            
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Description"
              value={newChoir.description}
              onChangeText={text => setNewChoir({...newChoir, description: text})}
              multiline
              numberOfLines={4}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Location *"
              value={newChoir.location}
              onChangeText={text => setNewChoir({...newChoir, location: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Contact Phone"
              value={newChoir.contact_phone}
              onChangeText={text => setNewChoir({...newChoir, contact_phone: text})}
              keyboardType="phone-pad"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Contact Email"
              value={newChoir.contact_email}
              onChangeText={text => setNewChoir({...newChoir, contact_email: text})}
              keyboardType="email-address"
            />
            
            <Text style={styles.label}>Genre:</Text>
            <View style={styles.genreOptions}>
              {Object.entries(GENRE_CHOICES).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[
                    styles.genreOption,
                    newChoir.genre === value && styles.genreOptionSelected
                  ]}
                  onPress={() => setNewChoir({...newChoir, genre: value})}
                >
                  <Text style={newChoir.genre === value ? styles.genreOptionTextSelected : styles.genreOptionText}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            <TextInput
              style={styles.input}
              placeholder="YouTube Link (optional)"
              value={newChoir.youtube_link}
              onChangeText={text => setNewChoir({...newChoir, youtube_link: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Founded Date (YYYY-MM-DD)"
              value={newChoir.founded_date}
              onChangeText={text => setNewChoir({...newChoir, founded_date: text})}
            />
            
            <TouchableOpacity style={styles.imagePicker} onPress={pickProfileImage}>
              <MaterialIcons name="add-a-photo" size={24} color="#006064" />
              <Text style={styles.imagePickerText}>
                {profileImage ? 'Change Profile Image' : 'Add Profile Image'}
              </Text>
            </TouchableOpacity>
            
            {profileImage && (
              <Image 
                source={{ uri: profileImage }} 
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
                onPress={handleAddChoir}
              >
                <Text style={styles.buttonText}>
                  {editingChoir ? 'Update Choir' : 'Add Choir'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  const renderMemberForm = () => (
    <Modal
      visible={showMemberForm}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowMemberForm(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContainer, { height: height * 0.4 }]}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Add Member to Choir</Text>
            <TouchableOpacity 
              onPress={() => setShowMemberForm(false)}
              style={styles.closeButton}
            >
              <MaterialIcons name="close" size={24} color="#555" />
            </TouchableOpacity>
          </View>
          
          <TextInput
            style={styles.input}
            placeholder="User ID *"
            value={newMemberId}
            onChangeText={setNewMemberId}
            keyboardType="numeric"
          />
          
          <View style={styles.formButtons}>
            <TouchableOpacity 
              style={styles.submitButton} 
              onPress={() => handleAddMember(editingChoir.id)}
            >
              <Text style={styles.buttonText}>Add Member</Text>
            </TouchableOpacity>
          </View>
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
      <Text style={styles.title}>Choirs</Text>
      
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <MaterialIcons name="search" size={20} color="#555" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search choirs..."
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
        data={filteredChoirs}
        renderItem={renderItem}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No choirs found</Text>
        }
      />

      {currentUser && (
        <TouchableOpacity 
          style={styles.addButton} 
          onPress={() => setShowAddForm(true)}
        >
          <MaterialIcons name="add" size={24} color="white" />
          <Text style={styles.buttonText}>Add Your Choir</Text>
        </TouchableOpacity>
      )}

      {renderAddForm()}
      {renderMemberForm()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'grey',
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
    marginTop: 15,
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
  choirCard: {
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
  choirHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  profileImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 12,
  },
  choirHeaderInfo: {
    flex: 1,
  },
  choirName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#006064',
  },
  choirGenre: {
    fontSize: 14,
    color: '#555',
    marginTop: 4,
  },
  choirMembers: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  choirActions: {
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
  addMemberButton: {
    backgroundColor: '#006064',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  addMemberText: {
    color: 'white',
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
    height: '70%',
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
  genreOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  genreOption: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#b2ebf2',
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: 'white',
  },
  genreOptionSelected: {
    backgroundColor: '#006064',
    borderColor: '#006064',
  },
  genreOptionText: {
    color: '#555',
    fontSize: 12,
  },
  genreOptionTextSelected: {
    color: 'white',
    fontSize: 12,
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
  creatorControls: {
    marginTop: 10,
  },
  editMembersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  membersInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#b2ebf2',
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#f5fdff',
  },
  saveButton: {
    marginLeft: 8,
    backgroundColor: '#4CAF50',
    padding: 8,
    borderRadius: 8,
  },
  cancelButton: {
    marginLeft: 8,
    backgroundColor: '#f44336',
    padding: 8,
    borderRadius: 8,
  },
  editMembersButton: {
    backgroundColor: '#e0f7fa',
    padding: 8,
    borderRadius: 8,
    marginBottom: 10,
  },
  editMembersText: {
    color: '#006064',
    textAlign: 'center',
  },
  activeToggleButton: {
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  activeButton: {
    backgroundColor: '#4CAF50',
  },
  inactiveButton: {
    backgroundColor: '#f44336',
  },
  activeToggleText: {
    color: 'white',
  },
});

export default Choirs;