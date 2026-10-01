// A new product. Photos are made smaller on the phone before they go up
// (about 1280 wide, JPEG) — a phone photo is several megabytes, and on mobile
// data that was most of the wait — and the upload shows how far it has got.
// What is typed is kept as a draft, so leaving the form loses nothing, and
// the contact and payment details come filled in from the seller's profile.
//
// Dark, in sections (photos, details, contact, payment), and the category is
// picked from the marketplace's list, never typed (CategoryPicker).
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
  ActivityIndicator,
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
import { MARKET_CATEGORIES } from '../../utils/categoryIcons';
import CategoryPicker from './CategoryPicker';
import { FormSection, Field, FormInput, Choices, formStyles } from './FormParts';
import { formTheme as F } from './formTheme';

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
// A draft from before the list may hold a typed category: it must be chosen again.
const isListed = (name) => MARKET_CATEGORIES.includes(name);
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
        // A category typed before there was a list is chosen again.
        const category = isListed(draft.formData.category) ? draft.formData.category : '';
        setFormData((f) => ({ ...f, ...draft.formData, category }));
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

  const conditionOptions = ['NEW', 'USED', 'REFURBISHED'].map((v) => ({ value: v, label: t(`market.condition.${v}`) }));
  const whatsappBad = !!formData.whatsapp_number && !validateWhatsAppNumber(formData.whatsapp_number);
  const optional = t('market.form2.optional');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      testID="add-product"
    >
      {/* Photos first: what a buyer looks at before anything else. */}
      <FormSection icon="camera" title={t('market.form2.photos')} hint={t('market.form2.photosHint')}>
        <View style={styles.photos}>
          {images.map((uri, index) => (
            <View key={`${index}-${uri}`} style={styles.photo}>
              <Image source={{ uri }} style={styles.photoImage} contentFit="cover" transition={120} />
              {index === 0 && (
                <View style={styles.coverTag}>
                  <Text style={styles.coverText}>{t('market.form2.cover')}</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.photoRemove}
                onPress={() => removeImage(index)}
                hitSlop={6}
                accessibilityLabel={t('common.remove')}
                testID={`add-remove-${index}`}
              >
                <Icon name="times" size={12} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
          {images.length < 5 && (
            <TouchableOpacity style={styles.addPhoto} onPress={pickImage} testID="add-photo">
              <Icon name="plus" size={20} color={F.accent} />
              <Text style={styles.addPhotoText}>{t('market.form2.addPhoto')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </FormSection>

      <FormSection icon="tag" title={t('market.form2.details')}>
        <Field label={t('market.form2.title')}>
          <FormInput
            placeholder={t('market.form2.titlePh')}
            value={formData.title}
            onChangeText={(text) => handleChange('title', text)}
            maxLength={200}
            testID="add-title"
          />
        </Field>
        <Field label={t('market.form2.description')}>
          <FormInput
            placeholder={t('market.form2.descriptionPh')}
            value={formData.description}
            onChangeText={(text) => handleChange('description', text)}
            multiline
            testID="add-description"
          />
        </Field>

        <View style={styles.pair}>
          <Field label={t('market.form2.price')} style={styles.pairWide}>
            <View style={styles.priceRow}>
              <TouchableOpacity style={styles.currency} onPress={handleCurrencyChange} testID="add-currency">
                <Text style={styles.currencyText}>{getCurrencySymbol()}</Text>
                <Icon name="caret-down" size={12} color={F.muted} />
              </TouchableOpacity>
              <FormInput
                style={styles.priceInput}
                placeholder="0.00"
                value={formData.price_value}
                onChangeText={(text) => handleChange('price_value', text)}
                keyboardType="decimal-pad"
                testID="add-price"
              />
            </View>
          </Field>
          <Field label={t('market.form2.quantity')} style={styles.pairNarrow}>
            <FormInput
              value={formData.quantity}
              onChangeText={(text) => handleChange('quantity', text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              testID="add-quantity"
            />
          </Field>
        </View>

        <Field label={t('market.form2.condition')}>
          <Choices
            options={conditionOptions}
            value={formData.condition}
            onChange={(v) => handleChange('condition', v)}
            testIDPrefix="add-condition"
          />
        </Field>

        <Field label={t('market.form2.category')} note={t('market.form2.categoryHint')}>
          <CategoryPicker value={formData.category} onChange={(v) => handleChange('category', v)} />
        </Field>
      </FormSection>

      <FormSection icon="phone" title={t('market.form2.contact')} hint={t('market.form2.contactHint')}>
        <Field label={t('market.form2.whatsapp')} error={whatsappBad ? t('market.form.whatsappFormat') : null}>
          <FormInput
            ref={whatsappInputRef}
            invalid={whatsappBad}
            placeholder="+254712345678"
            value={formData.whatsapp_number}
            onChangeText={handleWhatsAppNumberChange}
            keyboardType="phone-pad"
            maxLength={13}
            testID="add-whatsapp"
          />
        </Field>
        <Field label={t('market.form2.phone')} note={optional}>
          <FormInput
            placeholder="0712345678"
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

      <FormSection icon="money" title={t('market.form2.payment')} hint={t('market.form.payHowNote')}>
        <Field label={t('market.form2.mpesa')}>
          <FormInput
            placeholder="0712345678"
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
        <View style={styles.saveRow}>
          <Text style={styles.saveLabel}>{t('market.form.saveDetails')}</Text>
          <Switch
            value={saveDefault}
            onValueChange={setSaveDefault}
            trackColor={{ false: F.border, true: F.accent }}
            thumbColor="#fff"
            testID="save-details"
          />
        </View>
      </FormSection>

      <FormSection icon="music" title={t('market.form2.extra')}>
        <TouchableOpacity
          style={styles.trackLink}
          onPress={() => navigation.navigate('SelectTrack', { onSelect: setTrack })}
          testID="add-track"
        >
          <Icon name={track ? 'check-circle' : 'link'} size={15} color={track ? F.ok : F.accent} />
          <Text style={styles.trackText} numberOfLines={1}>
            {track ? t('market.form.linkedTrack', { title: track.title }) : t('market.form.linkTrack')}
          </Text>
        </TouchableOpacity>
      </FormSection>

      <TouchableOpacity
        style={[formStyles.submit, loading && formStyles.submitBusy]}
        onPress={handleSubmit}
        disabled={loading}
        testID="add-submit"
      >
        {loading ? <ActivityIndicator color={F.onAccent} /> : <Icon name="check" size={16} color={F.onAccent} />}
        <Text style={formStyles.submitText}>
          {loading
            ? (progress != null && progress < 1
              ? t('market.form.uploading', { n: Math.round(progress * 100) })
              : t('market.form.creating'))
            : t('market.form.create')}
        </Text>
      </TouchableOpacity>
      {progress != null && (
        <View style={formStyles.progressTrack} testID="upload-progress">
          <View style={[formStyles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
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
                testID={`currency-${c.code}`}
              >
                <Text style={[styles.pickerRowText, currency === c.code && styles.pickerRowTextActive]}>{c.label}</Text>
                {currency === c.code && <Icon name="check" size={16} color={F.onAccent} />}
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
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 14, paddingBottom: 40 },

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
  priceRow: { flexDirection: 'row' },
  currency: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12,
    backgroundColor: '#1C2E49', borderWidth: 1, borderColor: F.border, borderRightWidth: 0,
    borderTopLeftRadius: 12, borderBottomLeftRadius: 12,
  },
  currencyText: { color: F.accent, fontSize: 15, fontWeight: '800' },
  priceInput: { flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },

  saveRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: F.border,
  },
  saveLabel: { flex: 1, fontSize: 13.5, color: F.label, lineHeight: 19 },

  trackLink: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14,
    padding: 14, borderRadius: 12, backgroundColor: F.field, borderWidth: 1, borderColor: F.border,
  },
  trackText: { flex: 1, color: F.text, fontSize: 14.5, fontWeight: '600' },

  pickerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  pickerCard: {
    width: '100%', maxWidth: 340, backgroundColor: '#0F1C30', borderRadius: 18, padding: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: F.cardBorder,
  },
  pickerTitle: { fontSize: 16, fontWeight: '800', color: F.text, textAlign: 'center', marginBottom: 8 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12, marginTop: 6, backgroundColor: F.field,
  },
  pickerRowActive: { backgroundColor: F.accent },
  pickerRowText: { fontSize: 15, color: F.text, fontWeight: '700' },
  pickerRowTextActive: { color: F.onAccent },
  pickerCancel: { paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  pickerCancelText: { fontSize: 15, color: F.muted, fontWeight: '700' },
});

export default AddProduct;
