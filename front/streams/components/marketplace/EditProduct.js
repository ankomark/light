import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TextInput, 
  TouchableOpacity, 
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { fetchProductById, updateProduct, fetchProductCategories } from '../../services/api';
import { useAuth } from '../../context/useAuth';

// Constants
const COLORS = {
  primary: '#1D478B',
  secondary: '#2E8B57',
  error: '#FF6347',
  warning: '#FFA500',
  gray: '#888',
  lightGray: '#f5f5f5',
  white: '#fff',
  black: '#333'
};

const DEFAULT_IMAGE = 'https://via.placeholder.com/120';

const EditProduct = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { slug } = route.params;
  const { currentUser } = useAuth();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    quantity: '',
    condition: 'NEW',
    category: '',
    is_digital: false,
  });
  const [categories, setCategories] = useState([]);
  const [existingImages, setExistingImages] = useState([]);
  const [newImages, setNewImages] = useState([]);
  const [removedImages, setRemovedImages] = useState([]);
  const [track, setTrack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
  if (!currentUser || !currentUser.id) {
    console.log('Waiting for currentUser to be loaded...');
    return;
  }

  const loadData = async () => {
    try {
      setLoading(true);

      const [product, categoriesData] = await Promise.all([
        fetchProductById(slug),
        fetchProductCategories()
      ]);

      console.log('✅ Product data:', product);
      console.log('✅ Current user:', currentUser);

      if (!product) {
        throw new Error('Product data is empty');
      }

      // Extract seller ID from product
      const sellerId =
        product?.seller?.id ||
        product?.seller?.profile?.user_id ||
        product?.seller;

      const currentUserId = currentUser.id;

      console.log('🔎 Seller ID:', sellerId, '| Current User ID:', currentUserId);

      if (!sellerId || sellerId !== currentUserId) {
        throw new Error(`You can only edit your own products. Seller ID: ${sellerId}, Your ID: ${currentUserId}`);
      }

      // Populate form data
      setFormData({
        title: product.title || '',
        description: product.description || '',
        price: product.price?.toString() || '',
        quantity: product.quantity?.toString() || '',
        condition: product.condition || 'NEW',
        category: product.category?.name || product.category || '',
        is_digital: product.is_digital || false,
      });

      setCategories(categoriesData || []);
      setExistingImages(product.images || []);
      if (product.track) setTrack(product.track);

    } catch (error) {
      console.error('❌ Error loading product:', error);
      Alert.alert('Error', error.message || 'Failed to load product details');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  loadData();
}, [slug, currentUser]);


  const handleChange = (name, value) => {
    setFormData({
      ...formData,
      [name]: value
    });
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'We need camera roll permissions to upload images');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled) {
      setNewImages([...newImages, result.uri]);
    }
  };

  const removeExistingImage = (imageId) => {
    setRemovedImages([...removedImages, imageId]);
    setExistingImages(existingImages.filter(img => img.id !== imageId));
  };

  const removeNewImage = (index) => {
    const updatedImages = [...newImages];
    updatedImages.splice(index, 1);
    setNewImages(updatedImages);
  };

  const handleSubmit = async () => {
    if (!formData.title || !formData.description || !formData.price) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (existingImages.length + newImages.length - removedImages.length === 0) {
      Alert.alert('Error', 'Please keep at least one product image');
      return;
    }

    try {
      setUpdating(true);
      const data = new FormData();
      
      // Append basic fields
      data.append('title', formData.title);
      data.append('description', formData.description);
      data.append('price', parseFloat(formData.price));
      data.append('quantity', parseInt(formData.quantity || 0));
      data.append('condition', formData.condition);
      if (formData.category) data.append('category', formData.category);
      data.append('is_digital', formData.is_digital.toString());
      if (track) data.append('track', track.id);

      // Append new images
      newImages.forEach((uri, index) => {
        data.append('images', {
          uri,
          name: `product_image_${index}.jpg`,
          type: 'image/jpeg'
        });
      });

      // Append removed image IDs
      removedImages.forEach(id => {
        data.append('remove_images', id);
      });

      await updateProduct(slug, data);
      Alert.alert('Success', 'Product updated successfully');
      navigation.goBack();
    } catch (error) {
      console.error('Error updating product:', error);
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update product');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.sectionTitle}>Product Information</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Product Title*"
        value={formData.title}
        onChangeText={(text) => handleChange('title', text)}
      />
      
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Description*"
        value={formData.description}
        onChangeText={(text) => handleChange('description', text)}
        multiline
        numberOfLines={4}
      />
      
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.halfInput]}
          placeholder="Price*"
          value={formData.price}
          onChangeText={(text) => handleChange('price', text)}
          keyboardType="numeric"
        />
        
        <TextInput
          style={[styles.input, styles.halfInput]}
          placeholder="Quantity"
          value={formData.quantity}
          onChangeText={(text) => handleChange('quantity', text)}
          keyboardType="numeric"
        />
      </View>

      <TextInput
        style={styles.input}
        placeholder="Category*"
        value={formData.category}
        onChangeText={(text) => handleChange('category', text)}
      />

      <Text style={styles.sectionTitle}>Product Images*</Text>
      <Text style={styles.subtitle}>Keep at least one image</Text>
      
      <View style={styles.imageContainer}>
        {existingImages.map((image) => (
          <View key={image.id} style={styles.imageWrapper}>
            <Image 
              source={{ uri: image.image_url }} 
              style={styles.image}
            />
            <TouchableOpacity 
              style={styles.removeImageButton}
              onPress={() => removeExistingImage(image.id)}
            >
              <Icon name="times" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        
        {newImages.map((uri, index) => (
          <View key={`new-${index}`} style={styles.imageWrapper}>
            <Image 
              source={{ uri }} 
              style={styles.image}
            />
            <TouchableOpacity 
              style={styles.removeImageButton}
              onPress={() => removeNewImage(index)}
            >
              <Icon name="times" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}
        
        {(existingImages.length + newImages.length) < 5 && (
          <TouchableOpacity 
            style={styles.addImageButton} 
            onPress={pickImage}
          >
            <Icon name="plus" size={24} color={COLORS.gray} />
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.sectionTitle}>Additional Information</Text>
      
      <View style={styles.radioGroup}>
        <Text style={styles.radioLabel}>Condition:</Text>
        <View style={styles.radioOptions}>
          {['NEW', 'USED', 'REFURBISHED'].map((option) => (
            <TouchableOpacity
              key={option}
              style={styles.radioOption}
              onPress={() => handleChange('condition', option)}
            >
              <View style={styles.radioCircle}>
                {formData.condition === option && <View style={styles.radioDot} />}
              </View>
              <Text style={styles.radioText}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity 
        style={styles.linkButton}
        onPress={() => navigation.navigate('SelectTrack', { 
          currentTrack: track,
          onSelect: setTrack 
        })}
      >
        <Text style={styles.linkButtonText}>
          {track ? `Linked Track: ${track.title}` : 'Link to a Track (Optional)'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.submitButton}
        onPress={handleSubmit}
        disabled={updating}
      >
        {updating ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.submitButtonText}>Update Product</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
  },
  contentContainer: {
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
    color: COLORS.black,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.gray,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  halfInput: {
    width: '48%',
  },
  imageContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  imageWrapper: {
    width: 100,
    height: 100,
    marginRight: 8,
    marginBottom: 8,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  removeImageButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: COLORS.error,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addImageButton: {
    width: 100,
    height: 100,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioGroup: {
    marginBottom: 16,
  },
  radioLabel: {
    fontSize: 16,
    marginBottom: 8,
    color: COLORS.black,
  },
  radioOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.primary,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
  },
  radioText: {
    fontSize: 14,
  },
  linkButton: {
    padding: 12,
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    marginBottom: 16,
  },
  linkButtonText: {
    color: COLORS.primary,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitButtonText: {
    color: COLORS.white,
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default EditProduct;