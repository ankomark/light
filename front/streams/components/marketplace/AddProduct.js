import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { createProduct } from '../../services/api';
import { useAuth } from '../../context/useAuth';

const AddProduct = () => {
  const navigation = useNavigation();
  const { currentUser } = useAuth();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price_value: '',
    quantity: '1',
    condition: 'NEW',
    category: '',
    is_digital: false,
  });
  const [currency, setCurrency] = useState('USD');
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [track, setTrack] = useState(null);

  const handleChange = (name, value) => {
    setFormData({
      ...formData,
      [name]: value,
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

    if (!result.canceled && result.assets) {
      const uri = result.assets[0].uri;
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (fileInfo.size > 5 * 1024 * 1024) {
        Alert.alert('Error', 'Image size must be less than 5MB');
        return;
      }
      setImages([...images, uri]);
    }
  };

  const removeImage = (index) => {
    const newImages = [...images];
    newImages.splice(index, 1);
    setImages(newImages);
  };

  const handleCurrencyChange = () => {
    Alert.alert(
      'Select Currency',
      'Choose your product currency',
      [
        { text: 'KES (Ksh)', onPress: () => setCurrency('KES') },
        { text: 'USD ($)', onPress: () => setCurrency('USD') },
        { text: 'EUR (€)', onPress: () => setCurrency('EUR') },
        { text: 'GBP (£)', onPress: () => setCurrency('GBP') },
        { text: 'NGN (₦)', onPress: () => setCurrency('NGN') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleSubmit = async () => {
    if (!formData.title || !formData.description || !formData.price_value) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (images.length === 0) {
      Alert.alert('Error', 'Please add at least one product image');
      return;
    }

    if (!formData.category.trim()) {
      Alert.alert('Error', 'Please enter a category name');
      return;
    }

    try {
      setLoading(true);

      const data = new FormData();
      data.append('title', formData.title);
      data.append('description', formData.description);
      data.append('price', parseFloat(formData.price_value).toString());
      data.append('currency', currency);
      data.append('quantity', parseInt(formData.quantity).toString());
      data.append('condition', formData.condition);
      data.append('category', formData.category.trim());
      data.append('is_digital', formData.is_digital.toString());
      
      if (track) {
        data.append('track', track.id.toString());
      }

      for (let i = 0; i < images.length; i++) {
        const uri = images[i];
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        data.append('images', {
          uri: `data:image/jpeg;base64,${base64}`,
          name: `product_image_${i}.jpg`,
          type: 'image/jpeg',
        });
      }

      const response = await createProduct(data);
      Alert.alert('Success', 'Product created successfully');
      navigation.goBack();
    } catch (error) {
      console.error('Error creating product:', error);
      let errorMessage = 'Failed to create product';
      if (error.response) {
        errorMessage = Object.values(error.response.data).flat().join('\n');
      } else if (error.request) {
        errorMessage = 'No response from server. Check network or server status.';
      }
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const getCurrencySymbol = () => {
    const symbols = {
      KES: 'Ksh',
      USD: '$',
      EUR: '€',
      GBP: '£',
      NGN: '₦',
    };
    return symbols[currency] || currency;
  };

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
        <View style={styles.priceInputContainer}>
          <TextInput
            style={[styles.input, styles.priceInput]}
            placeholder="Price*"
            value={formData.price_value}
            onChangeText={(text) => handleChange('price_value', text)}
            keyboardType="numeric"
          />
          <TouchableOpacity 
            style={styles.currencyButton}
            onPress={handleCurrencyChange}
          >
            <Text style={styles.currencyText}>{getCurrencySymbol()}</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={[styles.input, styles.quantityInput]}
          placeholder="Quantity"
          value={formData.quantity}
          onChangeText={(text) => handleChange('quantity', text)}
          keyboardType="numeric"
        />
      </View>

      <TextInput
        style={styles.input}
        placeholder="Category (e.g., Clothes)*"
        value={formData.category}
        onChangeText={(text) => handleChange('category', text)}
      />

      <Text style={styles.sectionTitle}>Product Images*</Text>
      <Text style={styles.subtitle}>Add at least one image (max 5)</Text>

      <View style={styles.imageContainer}>
        {images.map((uri, index) => (
          <View key={index} style={styles.imageWrapper}>
            <Image source={{ uri }} style={styles.image} />
            <TouchableOpacity
              style={styles.removeImageButton}
              onPress={() => removeImage(index)}
            >
              <Icon name="times" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        ))}

        {images.length < 5 && (
          <TouchableOpacity style={styles.addImageButton} onPress={pickImage}>
            <Icon name="plus" size={24} color="#888" />
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
        onPress={() => navigation.navigate('SelectTrack', { onSelect: setTrack })}
      >
        <Text style={styles.linkButtonText}>
          {track ? `Linked Track: ${track.title}` : 'Link to a Track (Optional)'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.submitButton, loading && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={loading}
      >
        <Text style={styles.submitButtonText}>
          {loading ? 'Creating Product...' : 'Create Product'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
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
  priceInputContainer: {
    flexDirection: 'row',
    width: '48%',
  },
  priceInput: {
    flex: 1,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    marginBottom: 0,
  },
  currencyButton: {
    width: 50,
    backgroundColor: '#e9ecef',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderColor: '#ced4da',
  },
  currencyText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#495057',
  },
  quantityInput: {
    width: '48%',
  },
  imageContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  imageWrapper: {
    width: 80,
    height: 80,
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
    top: -8,
    right: -8,
    backgroundColor: '#FF6347',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addImageButton: {
    width: 80,
    height: 80,
    borderWidth: 1,
    borderColor: '#ddd',
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
    color: '#555',
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
    borderColor: '#888',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1D478B',
  },
  radioText: {
    fontSize: 14,
    color: '#333',
  },
  linkButton: {
    backgroundColor: '#f0f7ff',
    borderWidth: 1,
    borderColor: '#1D478B',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  linkButtonText: {
    color: '#1D478B',
    fontSize: 16,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: '#1D478B',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 32,
  },
  submitButtonDisabled: {
    backgroundColor: '#a0c4ff',
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default AddProduct;