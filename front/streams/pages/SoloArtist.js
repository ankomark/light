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
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { 
  fetchSoloArtists, 
  fetchMySoloArtistProfile,
  createSoloArtist, 
  updateSoloArtist, 
  deleteSoloArtist,
  toggleSoloArtistActive
} from '../services/api';
import { useAuth } from '../context/auth';

const { height } = Dimensions.get('window');

const GENRE_CHOICES = {
  gospel: 'Gospel',
  contemporary: 'Contemporary Christian',
  worship: 'Worship',
  other: 'Other'
};

const SoloArtists = () => {
  const { currentUser, isLoading: authLoading } = useAuth();
  const [artists, setArtists] = useState([]);
  const [filteredArtists, setFilteredArtists] = useState([]);
  const [newArtist, setNewArtist] = useState({
    stage_name: '',
    bio: '',
    location: '',
    contact_phone: '',
    contact_email: '',
    whatsapp_number: '',
    genre: 'gospel',
    social_media_links: { facebook: '', twitter: '', instagram: '' },
    youtube_link: ''
  });
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [profileImage, setProfileImage] = useState(null);
  const [coverImage, setCoverImage] = useState(null);
  const [editingArtist, setEditingArtist] = useState(null);
  const [myProfile, setMyProfile] = useState(null);

  // Log currentUser for debugging
  useEffect(() => {
    console.log('Current User:', currentUser);
  }, [currentUser]);

  // Load artists from API
  useEffect(() => {
    const loadArtists = async () => {
      if (authLoading) return;
      try {
        setIsLoading(true);
        const response = await fetchSoloArtists();
        console.log('fetchSoloArtists Response:', response);
        const normalizedArtists = response.map(artist => ({
          ...artist,
          user: typeof artist.user === 'object' ? (artist.user?.id || artist.user?.user_id || artist.user) : artist.user,
          is_active: artist.is_active ?? true
        }));
        console.log('Normalized Artists:', normalizedArtists);
        setArtists(normalizedArtists);
        setFilteredArtists(normalizedArtists);
        
        if (currentUser) {
          try {
            const myProfileResponse = await fetchMySoloArtistProfile();
            const normalizedProfile = {
              ...myProfileResponse,
              user: typeof myProfileResponse.user === 'object' ? (myProfileResponse.user?.id || myProfileResponse.user?.user_id || myProfileResponse.user) : myProfileResponse.user
            };
            console.log('My Profile:', normalizedProfile);
            setMyProfile(normalizedProfile);
          } catch (error) {
            console.log('No profile found for user:', error);
            setMyProfile(null);
          }
        }
      } catch (error) {
        Alert.alert('Error', 'Failed to load solo artists');
        console.error('fetchSoloArtists Error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadArtists();
  }, [authLoading, currentUser]);

  // Filter artists
  useEffect(() => {
    let results = artists;
    
    if (searchTerm) {
      results = results.filter(artist => 
        artist.stage_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        artist.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
        GENRE_CHOICES[artist.genre]?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    setFilteredArtists(results);
  }, [searchTerm, artists]);

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

  const handleAddArtist = async () => {
    if (!newArtist.stage_name.trim() || !newArtist.location.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      const formData = new FormData();
      
      formData.append('stage_name', newArtist.stage_name);
      formData.append('bio', newArtist.bio || '');
      formData.append('location', newArtist.location);
      formData.append('contact_phone', newArtist.contact_phone || '');
      formData.append('contact_email', newArtist.contact_email || '');
      formData.append('whatsapp_number', newArtist.whatsapp_number || '');
      formData.append('genre', newArtist.genre);
      formData.append('social_media_links', JSON.stringify(newArtist.social_media_links));
      formData.append('youtube_link', newArtist.youtube_link || '');
      
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

      if (editingArtist) {
        await updateSoloArtist(editingArtist.id, formData);
        Alert.alert('Success', 'Profile updated successfully!');
      } else {
        await createSoloArtist(formData);
        Alert.alert('Success', 'Profile created successfully!');
      }

      const response = await fetchSoloArtists();
      const normalizedArtists = response.map(artist => ({
        ...artist,
        user: typeof artist.user === 'object' ? (artist.user?.id || artist.user?.user_id || artist.user) : artist.user
      }));
      setArtists(normalizedArtists);
      setFilteredArtists(normalizedArtists);
      
      if (currentUser) {
        try {
          const myProfileResponse = await fetchMySoloArtistProfile();
          setMyProfile({
            ...myProfileResponse,
            user: typeof myProfileResponse.user === 'object' ? (myProfileResponse.user?.id || myProfileResponse.user?.user_id || myProfileResponse.user) : myProfileResponse.user
          });
        } catch (error) {
          setMyProfile(null);
        }
      }
      
      setNewArtist({
        stage_name: '',
        bio: '',
        location: '',
        contact_phone: '',
        contact_email: '',
        whatsapp_number: '',
        genre: 'gospel',
        social_media_links: { facebook: '', twitter: '', instagram: '' },
        youtube_link: ''
      });
      setProfileImage(null);
      setCoverImage(null);
      setEditingArtist(null);
      setShowAddForm(false);
    } catch (error) {
      Alert.alert('Error', error.message || 'Failed to save profile');
      console.error('handleAddArtist Error:', error);
    }
  };

  const handleToggleActive = async (artist) => {
    try {
      console.log('Toggling active status for artist:', artist.id, 'Current is_active:', artist.is_active);
      await toggleSoloArtistActive(artist.id);
      const response = await fetchSoloArtists();
      const normalizedArtists = response.map(a => ({
        ...a,
        user: typeof a.user === 'object' ? (a.user?.id || a.user?.user_id || a.user) : a.user
      }));
      setArtists(normalizedArtists);
      setFilteredArtists(normalizedArtists);
      if (currentUser) {
        try {
          const myProfileResponse = await fetchMySoloArtistProfile();
          setMyProfile({
            ...myProfileResponse,
            user: typeof myProfileResponse.user === 'object' ? (myProfileResponse.user?.id || myProfileResponse.user?.user_id || myProfileResponse.user) : myProfileResponse.user
          });
        } catch (error) {
          setMyProfile(null);
        }
      }
      Alert.alert('Success', 'Active status updated!');
    } catch (error) {
      console.error('handleToggleActive Error:', error);
      Alert.alert('Error', error.message || 'Failed to toggle active status');
    }
  };

  const handleEditArtist = (artist) => {
    setEditingArtist(artist);
    setNewArtist({
      stage_name: artist.stage_name,
      bio: artist.bio || '',
      location: artist.location,
      contact_phone: artist.contact_phone || '',
      contact_email: artist.contact_email || '',
      whatsapp_number: artist.whatsapp_number || '',
      genre: artist.genre,
      social_media_links: artist.social_media_links || { facebook: '', twitter: '', instagram: '' },
      youtube_link: artist.youtube_link || ''
    });
    setProfileImage(artist.profile_image_url || null);
    setCoverImage(artist.cover_image_url || null);
    setShowAddForm(true);
  };

  const handleDeleteArtist = async (id) => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete your profile?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              await deleteSoloArtist(id);
              const response = await fetchSoloArtists();
              const normalizedArtists = response.map(artist => ({
                ...artist,
                user: typeof artist.user === 'object' ? (artist.user?.id || artist.user?.user_id || artist.user) : artist.user
              }));
              setArtists(normalizedArtists);
              setFilteredArtists(normalizedArtists);
              setMyProfile(null);
              Alert.alert('Success', 'Profile deleted successfully!');
            } catch (error) {
              Alert.alert('Error', error.message || 'Failed to delete profile');
              console.error('handleDeleteArtist Error:', error);
            }
          },
          style: 'destructive',
        },
      ],
      { cancelable: true }
    );
  };

  const openLink = (url) => {
    if (url) {
      Linking.openURL(url).catch(err => {
        Alert.alert('Error', 'Failed to open link');
      });
    }
  };

  const ArtistActions = ({ artist, currentUser }) => {
    const creatorId = typeof artist.user === 'object' ? (artist.user?.id || artist.user?.user_id || artist.user) : artist.user;
    const currentUserId = currentUser?.id || currentUser?.user_id;
    const isCreator = currentUserId && creatorId && (
      String(creatorId) === String(currentUserId)
    );
    console.log('ArtistActions - Artist user:', creatorId, 'Current user:', currentUserId, 'isCreator:', isCreator);

    if (!isCreator) return null;

    return (
      <View style={styles.artistActions}>
        <TouchableOpacity 
          onPress={() => handleEditArtist(artist)}
          style={styles.actionButton}
        >
          <MaterialIcons name="edit" size={20} color="#006064" />
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => handleDeleteArtist(artist.id)}
          style={styles.actionButton}
        >
          <MaterialIcons name="delete" size={20} color="#e53935" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderItem = ({ item }) => {
    const creatorId = typeof item.user === 'object' ? (item.user?.id || item.user?.user_id || item.user) : item.user;
    const currentUserId = currentUser?.id || currentUser?.user_id;
    const isCreator = currentUserId && creatorId && (
      String(creatorId) === String(currentUserId)
    );
    const isMyProfile = myProfile && myProfile.id === item.id;
    console.log('renderItem - Item:', {
      id: item.id,
      stage_name: item.stage_name,
      user: item.user,
      is_active: item.is_active,
      whatsapp_number: item.whatsapp_number,
      youtube_link: item.youtube_link,
      social_media_links: item.social_media_links,
      isCreator,
      isMyProfile
    });

    return (
      <View style={styles.artistCard}>
        <View style={styles.artistHeader}>
          {item.profile_image_url && (
            <Image 
              source={{ uri: item.profile_image_url }} 
              style={styles.profileImage}
            />
          )}
          <View style={styles.artistHeaderInfo}>
            <Text style={styles.artistName}>{item.stage_name}</Text>
            <Text style={styles.artistGenre}>{GENRE_CHOICES[item.genre]}</Text>
            {item.is_verified && (
              <View style={styles.verifiedBadge}>
                <MaterialIcons name="verified" size={16} color="#4CAF50" />
                <Text style={styles.verifiedText}>Verified Artist</Text>
              </View>
            )}
          </View>
          <ArtistActions artist={item} currentUser={currentUser} />
        </View>
        
        {item.cover_image_url && (
          <Image 
            source={{ uri: item.cover_image_url }} 
            style={styles.coverImage}
            resizeMode="cover"
          />
        )}
        
        {item.bio && (
          <Text style={styles.description}>{item.bio}</Text>
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
          
          <View style={styles.detailRow}>
            <MaterialIcons name="chat" size={16} color="#555" />
            <Text style={styles.detailText}>
              WhatsApp: {item.whatsapp_number || 'Not provided'}
            </Text>
          </View>
          
          <View style={styles.detailRow}>
            <MaterialIcons name="play-circle" size={16} color="#e53935" />
            <Text style={styles.detailText}>
              YouTube: {item.youtube_link ? (
                <Text style={styles.linkText} onPress={() => openLink(item.youtube_link)}>
                  Visit Channel
                </Text>
              ) : 'Not provided'}
            </Text>
          </View>
          
          <View style={styles.socialMediaContainer}>
            <Text style={styles.socialMediaTitle}>Social Media:</Text>
            {Object.entries(item.social_media_links || { facebook: '', twitter: '', instagram: '' }).map(([platform, url]) => (
              <View key={platform} style={styles.socialMediaLink}>
                <Text style={styles.socialMediaText}>
                  {platform.charAt(0).toUpperCase() + platform.slice(1)}: {url ? (
                    <Text style={styles.linkText} onPress={() => openLink(url)}>
                      Visit
                    </Text>
                  ) : 'Not provided'}
                </Text>
              </View>
            ))}
          </View>
          
          <View style={styles.metaContainer}>
            <View style={styles.statusContainer}>
              <Text style={styles.metaText}>
                Status: {item.is_active ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>
          
          {isCreator && (
            <View style={styles.creatorControls}>
              <TouchableOpacity 
                style={[
                  styles.activeToggleButton,
                  item.is_active ? styles.activeButton : styles.inactiveButton
                ]}
                onPress={() => handleToggleActive(item)}
              >
                <MaterialIcons 
                  name={item.is_active ? 'done' : 'close'} 
                  size={24} 
                  color="#ffffff"
                />
                <Text style={styles.activeToggleText}>
                  {item.is_active ? 'Active' : 'Inactive'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          
          {/* Debug Section */}
          <View style={styles.debugContainer}>
            <Text style={styles.debugText}>Debug Info:</Text>
            <Text style={styles.debugText}>isCreator: {String(isCreator)}</Text>
            <Text style={styles.debugText}>is_active: {String(item.is_active)}</Text>
            <Text style={styles.debugText}>WhatsApp: {JSON.stringify(item.whatsapp_number)}</Text>
            <Text style={styles.debugText}>YouTube: {JSON.stringify(item.youtube_link)}</Text>
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
                {editingArtist ? 'Edit Profile' : 'Create Artist Profile'}
              </Text>
              <TouchableOpacity 
                onPress={() => {
                  setShowAddForm(false);
                  setEditingArtist(null);
                  setNewArtist({
                    stage_name: '',
                    bio: '',
                    location: '',
                    contact_phone: '',
                    contact_email: '',
                    whatsapp_number: '',
                    genre: 'gospel',
                    social_media_links: { facebook: '', twitter: '', instagram: '' },
                    youtube_link: ''
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
              placeholder="Stage Name *"
              value={newArtist.stage_name}
              onChangeText={text => setNewArtist({...newArtist, stage_name: text})}
            />
            
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Bio"
              value={newArtist.bio}
              onChangeText={text => setNewArtist({...newArtist, bio: text})}
              multiline
              numberOfLines={4}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Location *"
              value={newArtist.location}
              onChangeText={text => setNewArtist({...newArtist, location: text})}
            />
            
            <TextInput
              style={styles.input}
              placeholder="Contact Phone"
              value={newArtist.contact_phone}
              onChangeText={text => setNewArtist({...newArtist, contact_phone: text})}
              keyboardType="phone-pad"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Contact Email"
              value={newArtist.contact_email}
              onChangeText={text => setNewArtist({...newArtist, contact_email: text})}
              keyboardType="email-address"
            />
            
            <TextInput
              style={styles.input}
              placeholder="WhatsApp Number"
              value={newArtist.whatsapp_number}
              onChangeText={text => setNewArtist({...newArtist, whatsapp_number: text})}
              keyboardType="phone-pad"
            />
            
            <Text style={styles.label}>Genre:</Text>
            <View style={styles.genreOptions}>
              {Object.entries(GENRE_CHOICES).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[
                    styles.genreOption,
                    newArtist.genre === value && styles.selectedGenreOption
                  ]}
                  onPress={() => setNewArtist({...newArtist, genre: value})}
                >
                  <Text style={newArtist.genre === value ? styles.selectedGenreText : styles.genreText}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            <Text style={styles.label}>YouTube Link (optional):</Text>
            <TextInput
              style={styles.input}
              placeholder="YouTube Link"
              value={newArtist.youtube_link}
              onChangeText={text => setNewArtist({...newArtist, youtube_link: text})}
            />
            
            <Text style={styles.label}>Social Media Links (optional):</Text>
            <TextInput
              style={styles.input}
              placeholder="Facebook URL"
              value={newArtist.social_media_links.facebook}
              onChangeText={text => setNewArtist({
                ...newArtist,
                social_media_links: { ...newArtist.social_media_links, facebook: text }
              })}
            />
            <TextInput
              style={styles.input}
              placeholder="Twitter URL"
              value={newArtist.social_media_links.twitter}
              onChangeText={text => setNewArtist({
                ...newArtist,
                social_media_links: { ...newArtist.social_media_links, twitter: text }
              })}
            />
            <TextInput
              style={styles.input}
              placeholder="Instagram URL"
              value={newArtist.social_media_links.instagram}
              onChangeText={text => setNewArtist({
                ...newArtist,
                social_media_links: { ...newArtist.social_media_links, instagram: text }
              })}
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
              />
            )}
            
            <View style={styles.formButtons}>
              <TouchableOpacity 
                style={styles.submitButton} 
                onPress={handleAddArtist}
              >
                <Text style={styles.buttonText}>
                  {editingArtist ? 'Update Profile' : 'Create Profile'}
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
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#006064" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Solo Artists</Text>
      
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <MaterialIcons name="search" size={20} color="#555" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search artists..."
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
      
      {myProfile && (
        <View style={styles.myProfileContainer}>
          <Text style={styles.myProfileTitle}>My Profile</Text>
          <FlatList
            data={[myProfile]}
            renderItem={renderItem}
            keyExtractor={item => item.id.toString()}
            contentContainerStyle={styles.myProfileList}
          />
        </View>
      )}
      
      <Text style={styles.sectionTitle}>All Artists</Text>
      <FlatList
        data={filteredArtists.filter(artist => !myProfile || artist.id !== myProfile.id)}
        renderItem={renderItem}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No artists found</Text>
        }
      />

      {currentUser && !myProfile && (
        <TouchableOpacity 
          style={styles.addButton} 
          onPress={() => setShowAddForm(true)}
        >
          <MaterialIcons name="add" size={24} color="#ffffff" />
          <Text style={styles.buttonText}>Create Artist Profile</Text>
        </TouchableOpacity>
      )}

      {renderAddForm()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#e0f7fa',
    padding: 16,
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
    backgroundColor: '#ffffff',
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
  myProfileContainer: {
    marginBottom: 20,
  },
  myProfileTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#006064',
    marginBottom: 10,
  },
  myProfileList: {
    paddingBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#006064',
    marginBottom: 10,
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
  artistCard: {
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
  artistHeader: {
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
  artistHeaderInfo: {
    flex: 1,
  },
  artistName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#006064',
  },
  artistGenre: {
    fontSize: 14,
    color: '#555',
    marginTop: 4,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  verifiedText: {
    fontSize: 12,
    color: '#4CAF50',
    marginLeft: 4,
  },
  artistActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    padding: 8,
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
    marginBottom: 10,
  },
  detailText: {
    color: '#555',
    marginLeft: 8,
    fontSize: 14,
  },
  linkText: {
    color: '#006064',
    textDecorationLine: 'underline',
  },
  socialMediaContainer: {
    marginBottom: 10,
  },
  socialMediaTitle: {
    fontWeight: 'bold',
    color: '#555',
    marginBottom: 8,
  },
  socialMediaLink: {
    paddingVertical: 4,
  },
  socialMediaText: {
    color: '#006064',
    fontSize: 14,
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
    fontSize: 14,
    marginRight: 8,
  },
  creatorControls: {
    marginTop: 12,
  },
  activeToggleButton: {
    backgroundColor: '#006064',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeButton: {
    backgroundColor: '#4CAF50',
  },
  inactiveButton: {
    backgroundColor: '#f44336',
  },
  activeToggleText: {
    color: '#ffffff',
    fontSize: 16,
    marginLeft: 8,
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
    color: '#ffffff',
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
    height: height * 0.8,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
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
    backgroundColor: '#f5f7fa',
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
    marginBottom: 20,
  },
  genreOption: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#006064',
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  selectedGenreOption: {
    backgroundColor: '#006064',
  },
  genreText: {
    color: '#006064',
    fontSize: 12,
  },
  selectedGenreText: {
    color: '#ffffff',
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
    marginBottom: 12,
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
  debugContainer: {
    backgroundColor: '#ffeeee',
    padding: 10,
    marginTop: 10,
    borderRadius: 8,
  },
  debugText: {
    color: '#333',
    fontSize: 12,
  },
});

export default SoloArtists;