// A new product. Photos are made smaller on the phone before they go up
// (about 1280 wide, JPEG) — a phone photo is several megabytes, and on mobile
// data that was most of the wait — and the upload shows how far it has got.
// What is typed is kept as a draft, so leaving the form loses nothing, and
// the contact and payment details come filled in from the seller's profile.
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Modal,
  Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { createProduct, fetchSellerProfile, saveSellerProfile } from '../../services/api';
import { compressImage } from '../../services/imageProcessing';
import { readCache, writeCache, dropCache, userKey } from '../../utils/screenCache';
import { useAuth } from '../../context/useAuth';
import { useI18n } from '../../context/I18nContext';

const CURRENCIES = [
  { code: 'KES', label: 'KES (Ksh)' },
  { code: 'USD', label: 'USD ($)' },
  { code: 'EUR', label: 'EUR (€)' },
  { code: 'GBP', label: 'GBP (£)' },
  { code: 'NGN', label: 'NGN (₦)' },
];

// Contact and payment details: filled from the seller's profile, saved back to it.
const SELLER_FIELDS = [
  'whatsapp_number', 'contact_number', 'location', 'mpesa_number', 'till_number',
  'bank_details', 'payment_instructions',
];
const PHOTO_WIDTH = 1280;
const PHOTO_QUALITY = 0.75;

/** What the server said was wrong, whichever way the error arrived. */
export const productError = (error, fallback) => {
  const body = error?.response?.data
    || (error && typeof error === 'object' && !(error instanceof Error) ? error : null);
  if (body && typeof body === 'object') {
    const text = Object.values(body).flat().filter((v) => typeof v === 'string').join('\n');
    if (text) return text;
  }
  return fallback;
};

const AddProduct = () => {
  const { t } = useI18n();
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
    whatsapp_number: '',
    contact_number: '',
    location: '',
    mpesa_number: '',
    till_number: '',
    bank_details: '',
    payment_instructions: '',
  });
  const [currency, setCurrency] = useState('USD');
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [track, setTrack] = useState(null);
  const [progress, setProgress] = useState(null);
  const [saveDefault, setSaveDefault] = useState(true);
  const whatsappInputRef = useRef(null);
  const draftKey = userKey(currentUser?.id, 'market:draft:add');
  const restored = useRef(false);

  // Open on the draft left last time, else fill the seller's saved details.
  useEffect(() => {
    let live = true;
    (async () => {
      const draft = await readCache(draftKey, 14 * 24 * 60 * 60 * 1000);
      if (!live) return;
      if (draft?.formData) {
        setFormData((f) => ({ ...f, ...draft.formData }));
        if (draft.currency) setCurrency(draft.currency);
        if (draft.images?.length) setImages(draft.images);
      }
      restored.current = true;
      try {
        const profile = await fetchSellerProfile();
        if (!live || !profile) return;
        setFormData((f) => {
          const next = { ...f };
          SELLER_FIELDS.forEach((k) => { if (!next[k] && profile[k]) next[k] = profile[k]; });
          return next;
        });
      } catch {
        // No profile yet, or offline: the fields are simply empty.
      }
    })();
    return () => { live = false; };
  }, [draftKey]);

  // Keep the draft as it is typed.
  useEffect(() => {
    if (!restored.current) return undefined;
    const timer = setTimeout(() => writeCache(draftKey, { formData, currency, images }), 600);
    return () => clearTimeout(timer);
  }, [formData, currency, images, draftKey]);

  const handleChange = (name, value) => {
    setFormData({
      ...formData,
      [name]: value,
    });
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('chat.permissionRequired'), t('market.form.permissionPhotos'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1,
    });

    if (!result.canceled && result.assets) {
      const asset = result.assets[0];
      let uri = asset.uri;
      try {
        // Smaller before it goes anywhere: a phone photo is megabytes.
        uri = (await compressImage(uri, {
          maxWidth: PHOTO_WIDTH, sourceWidth: asset.width, quality: PHOTO_QUALITY,
        })).uri;
      } catch {
        const fileInfo = await FileSystem.getInfoAsync(uri);
        if (fileInfo.size > 5 * 1024 * 1024) {
          Alert.alert(t('common.error'), t('market.form.imageTooLarge'));
          return;
        }
      }
      setImages((prev) => [...prev, uri]);
    }
  };

  const removeImage = (index) => {
    const newImages = [...images];
    newImages.splice(index, 1);
    setImages(newImages);
  };

  // A custom picker — Android's Alert renders at most 3 buttons, so the five
  // currencies + Cancel can't live in an Alert.
  const handleCurrencyChange = () => setCurrencyOpen(true);

  const validateWhatsAppNumber = (number) => {
    if (!number) return true; // Optional field
    return number.startsWith('+254') && number.length === 13;
  };

  const handleSubmit = async () => {
    if (!formData.title || !formData.description || !formData.price_value) {
      Alert.alert(t('common.error'), t('market.form.fillRequired'));
      return;
    }

    if (images.length === 0) {
      Alert.alert(t('common.error'), t('market.form.needImage'));
      return;
    }

    if (!formData.category.trim()) {
      Alert.alert(t('common.error'), t('market.form.needCategory'));
      return;
    }

    if (formData.whatsapp_number && !validateWhatsAppNumber(formData.whatsapp_number)) {
      Alert.alert(
        t('market.form.invalidWhatsappTitle'),
        t('market.form.invalidWhatsappBody'),
        [
          {
            text: 'OK',
            onPress: () => whatsappInputRef.current?.focus()
          }
        ]
      );
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
      // Said outright: a multipart form that leaves a true/false field out
      // used to save the product as not for sale.
      data.append('is_available', 'true');
      data.append('whatsapp_number', formData.whatsapp_number);
      data.append('contact_number', formData.contact_number);
      data.append('location', formData.location);
      data.append('mpesa_number', formData.mpesa_number);
      data.append('till_number', formData.till_number);
      data.append('bank_details', formData.bank_details);
      data.append('payment_instructions', formData.payment_instructions);

      if (track) {
        data.append('track', track.id.toString());
      }

      // The files themselves, not base64 text a third bigger.
      images.forEach((uri, i) => {
        data.append('images', { uri, name: `product_image_${i}.jpg`, type: 'image/jpeg' });
      });

      setProgress(0);
      await createProduct(data, { onProgress: setProgress });
      dropCache(draftKey);
      if (saveDefault) {
        const details = {};
        SELLER_FIELDS.forEach((k) => { details[k] = formData[k] || ''; });
        saveSellerProfile(details).catch(() => {});
      }
      Alert.alert(t('market.success'), t('market.form.created'));
      navigation.goBack();
    } catch (error) {
      // An Error (not the server's field errors) means no answer came back.
      Alert.alert(t('common.error'), error instanceof Error && !error.response
        ? t('market.form.noResponse')
        : productError(error, t('market.form.createFailed')));
    } finally {
      setLoading(false);
      setProgress(null);
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

  const handleWhatsAppNumberChange = (text) => {
    // Auto-format +254 if user starts with 254
    if (text.length === 3 && text === '254') {
      text = '+254';
    }
    // Ensure it starts with +
    if (text.length === 1 && text !== '+') {
      text = '+' + text;
    }
    // Only allow numbers after +
    if (/^\+[0-9]*$/.test(text) || text === '') {
      handleChange('whatsapp_number', text);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.sectionTitle}>{t('market.form.productInfo')}</Text>

      <TextInput
        style={styles.input}
        placeholderTextColor="#888"
        placeholder={t('market.form.title')}
        value={formData.title}
        onChangeText={(text) => handleChange('title', text)}
      />

      <TextInput
        style={[styles.input, styles.textArea]}
        placeholderTextColor="#888"
        placeholder={t('market.form.description')}
        value={formData.description}
        onChangeText={(text) => handleChange('description', text)}
        multiline
        numberOfLines={4}
      />

      <View style={styles.row}>
        <View style={styles.priceInputContainer}>
          <TextInput
            style={[styles.input, styles.priceInput]}
            placeholderTextColor="#888"
            placeholder={t('market.form.price')}
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
          placeholderTextColor="#888"
          placeholder={t('market.form.quantity')}
          value={formData.quantity}
          onChangeText={(text) => handleChange('quantity', text)}
          keyboardType="numeric"
        />
      </View>

      <TextInput
        style={styles.input}
        placeholderTextColor="#888"
        placeholder={t('market.form.category')}
        value={formData.category}
        onChangeText={(text) => handleChange('category', text)}
      />

      <Text style={styles.sectionTitle}>{t('market.form.contactInfo')}</Text>

      <View>
        <TextInput
          ref={whatsappInputRef}
          style={[
            styles.input,
            formData.whatsapp_number && !validateWhatsAppNumber(formData.whatsapp_number)
              ? styles.invalidInput
              : null
          ]}
          placeholderTextColor="#888"
          placeholder={t('market.form.whatsapp')}
          value={formData.whatsapp_number}
          onChangeText={handleWhatsAppNumberChange}
          keyboardType="phone-pad"
          maxLength={13}
        />
        {formData.whatsapp_number && !validateWhatsAppNumber(formData.whatsapp_number) && (
          <Text style={styles.errorText}>{t('market.form.whatsappFormat')}</Text>
        )}
      </View>

      <TextInput
        style={styles.input}
        placeholderTextColor="#888"
        placeholder={t('market.form.contactNumber')}
        value={formData.contact_number}
        onChangeText={(text) => handleChange('contact_number', text)}
        keyboardType="phone-pad"
      />

      <TextInput
        style={styles.input}
        placeholderTextColor="#888"
        placeholder={t('market.form.location')}
        value={formData.location}
        onChangeText={(text) => handleChange('location', text)}
      />

      <Text style={styles.sectionTitle}>{t('market.form.paymentDetails')}</Text>
      <Text style={styles.subtitle}>{t('market.form.payHowNote')}</Text>

      <TextInput
        style={styles.input}
        placeholderTextColor="#888"
        placeholder={t('market.form.mpesa')}
        value={formData.mpesa_number}
        onChangeText={(text) => handleChange('mpesa_number', text)}
        keyboardType="phone-pad"
      />

      <TextInput
        style={styles.input}
        placeholderTextColor="#888"
        placeholder={t('market.form.tillNumber')}
        value={formData.till_number}
        onChangeText={(text) => handleChange('till_number', text)}
        keyboardType="numbers-and-punctuation"
      />

      <TextInput
        style={styles.input}
        placeholderTextColor="#888"
        placeholder={t('market.form.bankDetails')}
        value={formData.bank_details}
        onChangeText={(text) => handleChange('bank_details', text)}
      />

      <TextInput
        style={[styles.input, styles.textArea]}
        placeholderTextColor="#888"
        placeholder={t('market.form.otherInstructions')}
        value={formData.payment_instructions}
        onChangeText={(text) => handleChange('payment_instructions', text)}
        multiline
        numberOfLines={3}
      />

      <View style={styles.saveRow}>
        <Text style={styles.saveLabel}>{t('market.form.saveDetails')}</Text>
        <Switch value={saveDefault} onValueChange={setSaveDefault} testID="save-details" />
      </View>

      <Text style={styles.sectionTitle}>{t('market.form.productImages')}</Text>
      <Text style={styles.subtitle}>{t('market.form.imagesHint')}</Text>

      <View style={styles.imageContainer}>
        {images.map((uri, index) => (
          <View key={index} style={styles.imageWrapper}>
            <Image source={{ uri }} style={styles.image} contentFit="cover" transition={120} />
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

      <Text style={styles.sectionTitle}>{t('market.form.additionalInfo')}</Text>

      <View style={styles.radioGroup}>
        <Text style={styles.radioLabel}>{t('market.form.condition')}</Text>
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
          {track ? t('market.form.linkedTrack', { title: track.title }) : t('market.form.linkTrack')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.submitButton, loading && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={loading}
      >
        <Text style={styles.submitButtonText}>
          {loading
            ? (progress != null && progress < 1
              ? t('market.form.uploading', { n: Math.round(progress * 100) })
              : t('market.form.creating'))
            : t('market.form.create')}
        </Text>
      </TouchableOpacity>
      {progress != null && (
        <View style={styles.progressTrack} testID="upload-progress">
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      )}

      {/* Currency picker (Android-safe; replaces a >3-button Alert) */}
      <Modal visible={currencyOpen} transparent animationType="fade" onRequestClose={() => setCurrencyOpen(false)}>
        <TouchableOpacity style={styles.pickerBackdrop} activeOpacity={1} onPress={() => setCurrencyOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>{t('market.form.selectCurrency')}</Text>
            {CURRENCIES.map((c) => (
              <TouchableOpacity
                key={c.code}
                style={[styles.pickerRow, currency === c.code && styles.pickerRowActive]}
                onPress={() => { setCurrency(c.code); setCurrencyOpen(false); }}
              >
                <Text style={styles.pickerRowText}>{c.label}</Text>
                {currency === c.code && <Icon name="check" size={16} color="#2e7d32" />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setCurrencyOpen(false)}>
              <Text style={styles.pickerCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  saveRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 4, marginBottom: 8,
  },
  saveLabel: { flex: 1, fontSize: 14, color: '#333', marginRight: 12 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#e6e6e6', marginTop: 10, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: '#1D478B' },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  contentContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    margin: 12,
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
    color: '#111', // explicit dark text so it's never white-on-light in dark mode
  },
  invalidInput: {
    borderColor: '#FF6347',
    borderWidth: 1,
    backgroundColor: '#FFF0F0',
  },
  errorText: {
    color: '#FF6347',
    fontSize: 12,
    marginTop: -8,
    marginBottom: 12,
    marginLeft: 4,
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
  pickerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  pickerCard: {
    width: '100%', maxWidth: 340, backgroundColor: '#fff',
    borderRadius: 14, padding: 16,
  },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: '#111', textAlign: 'center', marginBottom: 8 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10, marginTop: 4,
    backgroundColor: '#f5f5f5',
  },
  pickerRowActive: { backgroundColor: '#e8f5e9' },
  pickerRowText: { fontSize: 15, color: '#222', fontWeight: '600' },
  pickerCancel: { paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  pickerCancelText: { fontSize: 15, color: '#888', fontWeight: '700' },
});

export default AddProduct;