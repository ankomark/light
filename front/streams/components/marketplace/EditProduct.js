// Editing a product: the same dark form as adding one (FormParts), the
// category picked from the marketplace's list (CategoryPicker).
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import KeyboardLift from '../tickets/KeyboardLift';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { fetchProductById, updateProduct } from '../../services/api';
import { compressImage } from '../../services/imageProcessing';
import { productError } from './AddProduct';
import { useI18n } from '../../context/I18nContext';
import { useAuth } from '../../context/useAuth';
import CategoryPicker from './CategoryPicker';
import { FormSection, Field, FormInput, Choices, formStyles } from './FormParts';
import { formTheme as F } from './formTheme';

const EditProduct = () => {
  const { t } = useI18n();
  // The field being typed in stays above the keyboard (KeyboardLift).
  const kbScroll = useRef(null);
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
    whatsapp_number: '',
    contact_number: '',
    location: '',
    mpesa_number: '',
    till_number: '',
    bank_details: '',
    payment_instructions: '',
  });
  const [existingImages, setExistingImages] = useState([]);
  const [newImages, setNewImages] = useState([]);
  const [removedImages, setRemovedImages] = useState([]);
  const [track, setTrack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
  if (!currentUser || !currentUser.id) return;

  const loadData = async () => {
    try {
      setLoading(true);

      const product = await fetchProductById(slug);

      if (!product) throw new Error('Product data is empty');

      const sellerId =
        product?.seller?.id ||
        product?.seller?.profile?.user_id ||
        product?.seller;

      const currentUserId = currentUser.id;

      if (!sellerId || sellerId !== currentUserId) {
        throw new Error(t('market.form.notYours'));
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
        whatsapp_number: product.whatsapp_number || '',
        contact_number: product.contact_number || '',
        location: product.location || '',
        mpesa_number: product.mpesa_number || '',
        till_number: product.till_number || '',
        bank_details: product.bank_details || '',
        payment_instructions: product.payment_instructions || '',
      });

      setExistingImages(product.images || []);
      if (product.track) setTrack(product.track);

    } catch (error) {
      console.warn('Error loading product:', error?.message);
      Alert.alert(t('common.error'), t('market.form.loadFailed'));   // in words, never the raw error
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  loadData();
  // By id: a new user object for the same person must not reload the form
  // (and throw away what has been typed).
}, [slug, currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleChange = (name, value) => {
    setFormData({
      ...formData,
      [name]: value
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

    // The picked photo is result.assets[0] — result.uri is gone from the
    // picker, and every new photo used to go up as `undefined`.
    const asset = !result.canceled && result.assets?.[0];
    if (!asset) return;
    let uri = asset.uri;
    try {
      // Smaller before it goes anywhere (as on the add form).
      uri = (await compressImage(uri, { maxWidth: 1280, sourceWidth: asset.width, quality: 0.75 })).uri;
    } catch {
      // The original will do.
    }
    setNewImages((prev) => [...prev, uri]);
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
      Alert.alert(t('common.error'), t('market.form.fillRequired'));
      return;
    }

    // existingImages already has the removed ones taken out.
    if (existingImages.length + newImages.length === 0) {
      Alert.alert(t('common.error'), t('market.form.needKeepImage'));
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
      data.append('whatsapp_number', formData.whatsapp_number);
      data.append('contact_number', formData.contact_number);
      data.append('location', formData.location);
      data.append('mpesa_number', formData.mpesa_number);
      data.append('till_number', formData.till_number);
      data.append('bank_details', formData.bank_details);
      data.append('payment_instructions', formData.payment_instructions);
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
      Alert.alert(t('market.success'), t('market.form.updated'));
      navigation.goBack();
    } catch (error) {
      console.warn('Error updating product:', error?.message);
      Alert.alert(t('common.error'), productError(error, t('market.form.updateFailed')));
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={F.accent} />
      </View>
    );
  }

  const conditionOptions = ['NEW', 'USED', 'REFURBISHED'].map((v) => ({ value: v, label: t(`market.condition.${v}`) }));
  const optional = t('market.form2.optional');
  const photoCount = existingImages.length + newImages.length;

  return (
<KeyboardLift scrollRef={kbScroll}>
    <ScrollView
      ref={kbScroll}
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      testID="edit-product"
    >
      <FormSection icon="camera" title={t('market.form2.photos')} hint={t('market.form2.photosHint')}>
        <View style={styles.photos}>
          {existingImages.map((image, index) => (
            <View key={image.id} style={styles.photo}>
              <Image source={{ uri: image.image_url }} style={styles.photoImage} contentFit="cover" transition={120} />
              {index === 0 && (
                <View style={styles.coverTag}><Text style={styles.coverText}>{t('market.form2.cover')}</Text></View>
              )}
              <TouchableOpacity
                style={styles.photoRemove}
                onPress={() => removeExistingImage(image.id)}
                hitSlop={6}
                accessibilityLabel={t('common.remove')}
                testID={`edit-remove-${image.id}`}
              >
                <Icon name="times" size={12} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
          {newImages.map((uri, index) => (
            <View key={`new-${index}`} style={styles.photo}>
              <Image source={{ uri }} style={styles.photoImage} contentFit="cover" transition={120} />
              {existingImages.length === 0 && index === 0 && (
                <View style={styles.coverTag}><Text style={styles.coverText}>{t('market.form2.cover')}</Text></View>
              )}
              <TouchableOpacity
                style={styles.photoRemove}
                onPress={() => removeNewImage(index)}
                hitSlop={6}
                accessibilityLabel={t('common.remove')}
              >
                <Icon name="times" size={12} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
          {photoCount < 5 && (
            <TouchableOpacity style={styles.addPhoto} onPress={pickImage} testID="edit-add-photo">
              <Icon name="plus" size={20} color={F.accent} />
              <Text style={styles.addPhotoText}>{t('market.form2.addPhoto')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </FormSection>

      <FormSection icon="tag" title={t('market.form2.details')}>
        <Field label={t('market.form2.title')}>
          <FormInput
            value={formData.title}
            onChangeText={(text) => handleChange('title', text)}
            maxLength={200}
          />
        </Field>
        <Field label={t('market.form2.description')}>
          <FormInput
            value={formData.description}
            onChangeText={(text) => handleChange('description', text)}
            multiline
          />
        </Field>
        <View style={styles.pair}>
          <Field label={t('market.form2.price')} style={styles.pairWide}>
            <FormInput
              value={formData.price}
              onChangeText={(text) => handleChange('price', text)}
              keyboardType="decimal-pad"
            />
          </Field>
          <Field label={t('market.form2.quantity')} style={styles.pairNarrow}>
            <FormInput
              value={formData.quantity}
              onChangeText={(text) => handleChange('quantity', text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
            />
          </Field>
        </View>
        <Field label={t('market.form2.condition')}>
          <Choices
            options={conditionOptions}
            value={formData.condition}
            onChange={(v) => handleChange('condition', v)}
            testIDPrefix="edit-condition"
          />
        </Field>
        <Field label={t('market.form2.category')} note={t('market.form2.categoryHint')}>
          <CategoryPicker value={formData.category} onChange={(v) => handleChange('category', v)} />
        </Field>
      </FormSection>

      <FormSection icon="phone" title={t('market.form2.contact')} hint={t('market.form2.contactHint')}>
        <Field label={t('market.form2.whatsapp')}>
          <FormInput
            placeholder="+254712345678"
            value={formData.whatsapp_number}
            onChangeText={(text) => handleChange('whatsapp_number', text)}
            keyboardType="phone-pad"
          />
        </Field>
        <Field label={t('market.form2.phone')} note={optional}>
          <FormInput
            value={formData.contact_number}
            onChangeText={(text) => handleChange('contact_number', text)}
            keyboardType="phone-pad"
          />
        </Field>
        <Field label={t('market.form2.location')} note={optional}>
          <FormInput
            placeholder={t('market.form2.locationPh')}
            value={formData.location}
            onChangeText={(text) => handleChange('location', text)}
          />
        </Field>
      </FormSection>

      <FormSection icon="money" title={t('market.form2.payment')} hint={t('market.form.howBuyersPay')}>
        <Field label={t('market.form2.mpesa')}>
          <FormInput
            value={formData.mpesa_number}
            onChangeText={(text) => handleChange('mpesa_number', text)}
            keyboardType="phone-pad"
          />
        </Field>
        <Field label={t('market.form2.till')} note={optional}>
          <FormInput
            value={formData.till_number}
            onChangeText={(text) => handleChange('till_number', text)}
            keyboardType="numbers-and-punctuation"
          />
        </Field>
        <Field label={t('market.form2.bank')} note={optional}>
          <FormInput
            value={formData.bank_details}
            onChangeText={(text) => handleChange('bank_details', text)}
          />
        </Field>
        <Field label={t('market.form2.otherPay')} note={optional}>
          <FormInput
            value={formData.payment_instructions}
            onChangeText={(text) => handleChange('payment_instructions', text)}
            multiline
          />
        </Field>
      </FormSection>

      <FormSection icon="music" title={t('market.form2.extra')}>
        <TouchableOpacity
          style={styles.trackLink}
          onPress={() => navigation.navigate('SelectTrack', { currentTrack: track, onSelect: setTrack })}
        >
          <Icon name={track ? 'check-circle' : 'link'} size={15} color={track ? F.ok : F.accent} />
          <Text style={styles.trackText} numberOfLines={1}>
            {track ? t('market.form.linkedTrack', { title: track.title }) : t('market.form.linkTrack')}
          </Text>
        </TouchableOpacity>
      </FormSection>

      <TouchableOpacity
        style={[formStyles.submit, updating && formStyles.submitBusy]}
        onPress={handleSubmit}
        testID="edit-save"
        disabled={updating}
      >
        {updating ? <ActivityIndicator color={F.onAccent} /> : <Icon name="check" size={16} color={F.onAccent} />}
        <Text style={formStyles.submitText}>{t('market.form.update')}</Text>
      </TouchableOpacity>
    </ScrollView>
    </KeyboardLift>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 14, paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  photo: { width: 92, height: 92 },
  photoImage: { width: '100%', height: '100%', borderRadius: 12, backgroundColor: F.field },
  coverTag: {
    position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6, backgroundColor: F.accent,
  },
  coverText: { color: F.onAccent, fontSize: 10, fontWeight: '800' },
  photoRemove: {
    position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12,
    backgroundColor: F.danger, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#0A1628',
  },
  addPhoto: {
    width: 92, height: 92, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,196,107,0.55)',
    backgroundColor: 'rgba(255,196,107,0.06)',
  },
  addPhotoText: { color: F.accent, fontSize: 11.5, fontWeight: '700' },

  pair: { flexDirection: 'row', gap: 10 },
  pairWide: { flex: 1.6 },
  pairNarrow: { flex: 1 },

  trackLink: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14,
    padding: 14, borderRadius: 12, backgroundColor: F.field, borderWidth: 1, borderColor: F.border,
  },
  trackText: { flex: 1, color: F.text, fontSize: 14.5, fontWeight: '600' },
});

export default EditProduct;
