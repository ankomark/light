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
  Modal,
  RefreshControl,
  Platform
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import * as ImagePicker from 'expo-image-picker';
import { fetchChurches, fetchChurchesByUrl, createChurch, updateChurch, deleteChurch } from '../services/api';
import { useAuth } from '../context/useAuth';
import RotatingBackground from '../components/RotatingBackground';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';
import { useI18n } from '../context/I18nContext';
const DEFAULT_PROFILE_IMAGE = require('../assets/user-placeholder.png');

// Labeled dark input used across the luxury Add/Edit Church form.
const Field = ({ label, value, onChangeText, placeholder, keyboardType }) => (
  <>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      style={styles.fieldInput}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.placeholder}
      keyboardType={keyboardType}
      autoCapitalize={keyboardType === 'numeric' || keyboardType === 'phone-pad' ? 'none' : 'words'}
      autoCorrect={false}
    />
  </>
);

const Churches = ({ navigation }) => {
  const { t } = useI18n();
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
  const [actionsOpenId, setActionsOpenId] = useState(null); // card whose edit/delete is revealed
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState(null);

  // Load churches from API (reused by initial load, pull-to-refresh, and mutations)
  const loadChurches = useCallback(async () => {
    try {
      const response = await fetchChurches();  // page 1
      const list = response?.results ?? (Array.isArray(response) ? response : []);
      setChurches(list);
      setNextUrl(response?.next ?? null);
      return list;
    } catch (error) {
      Alert.alert(t('common.error'), t('churches.loadFailed'));
      return null;
    }
  }, [t]);

  // Infinite scroll: append the next page (filteredChurches re-derives from
  // `churches`, so newly loaded rows flow into the visible list + search).
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextUrl) return;
    setLoadingMore(true);
    try {
      const res = await fetchChurchesByUrl(nextUrl);
      setChurches(prev => [...prev, ...(res?.results ?? [])]);
      setNextUrl(res?.next ?? null);
    } catch {
      // silent — pull-to-refresh recovers
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextUrl]);

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
      Alert.alert(t('common.error'), t('churches.requiredFields'));
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
        Alert.alert(t('market.success'), t('churches.updatedOk'));
      } else {
        await createChurch(formData);
        Alert.alert(t('market.success'), t('churches.addedOk'));
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
      Alert.alert(t('common.error'), error.message || t('choirs.editOwnOnly'));
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
      t('churches.deleteTitle'),
      t('churches.deleteConfirm'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('common.delete'),
          onPress: async () => {
            try {
              await deleteChurch(id);
              await loadChurches();
              Alert.alert(t('market.success'), t('churches.deletedOk'));
            } catch (error) {
              Alert.alert(t('common.error'), t('churches.deleteOwnOnly'));
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

    // Collapsed by default: just a "…" — the icons appear only after a tap.
    if (actionsOpenId !== church.id) {
      return (
        <TouchableOpacity onPress={() => setActionsOpenId(church.id)} hitSlop={10} style={styles.moreBtn}>
          <MaterialIcons name="more-horiz" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      );
    }

    return (
      <View style={styles.churchActions}>
        <TouchableOpacity onPress={() => { setActionsOpenId(null); handleEditChurch(church); }}>
          <MaterialIcons name="edit" size={20} color={colors.accent} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setActionsOpenId(null); handleDeleteChurch(church.id); }}>
          <MaterialIcons name="delete" size={20} color={colors.error} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setActionsOpenId(null)} hitSlop={10}>
          <MaterialIcons name="close" size={18} color={colors.textMuted} />
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
              placeholder={DEFAULT_PROFILE_IMAGE}
              contentFit="cover"
              transition={150}
            />
            <View>
              <Text style={styles.username}>{creatorName}</Text>
              <Text style={styles.byline}>{t('churches.added')}</Text>
            </View>
          </View>
          <ChurchActions church={item} />
        </View>

        {item.image ? (
          <Image
            source={{ uri: item.image }}
            style={styles.churchImage}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={[styles.churchImage, styles.churchImagePlaceholder]}>
            <MaterialIcons name="church" size={30} color={colors.textMuted} />
          </View>
        )}

        <View style={styles.nameRow}>
          <MaterialIcons name="church" size={16} color={colors.accent} />
          <Text style={styles.churchName} numberOfLines={1}>{item.name}</Text>
        </View>

        <View style={styles.churchDetails}>
          {locationText ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="location-on" size={14} color={colors.accent} />
              <Text style={styles.detailText}>{locationText}</Text>
            </View>
          ) : null}

          <View style={styles.detailRow}>
            <MaterialIcons name="people" size={14} color={colors.accent} />
            <Text style={styles.detailText}>
              {Number(item.members || 0).toLocaleString()} members
            </Text>
          </View>

          {item.pastor ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="account-circle" size={14} color={colors.accent} />
              <Text style={styles.detailText}>Pastor {item.pastor}</Text>
            </View>
          ) : null}

          {item.contact ? (
            <View style={styles.detailRow}>
              <MaterialIcons name="phone" size={14} color={colors.accent} />
              <Text style={styles.detailText}>{item.contact}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.metaContainer}>
          {item.conference ? (
            <View style={styles.chip}>
              <MaterialIcons name="account-balance" size={13} color={colors.accent} />
              <Text style={styles.chipText}>{item.conference}</Text>
            </View>
          ) : null}
          {item.country ? (
            <View style={styles.chip}>
              <MaterialIcons name="public" size={13} color={colors.accent} />
              <Text style={styles.chipText}>{item.country}</Text>
            </View>
          ) : null}
        </View>

        {/* Community entry point */}
        <TouchableOpacity
          style={styles.communityBtn}
          onPress={() => navigation.navigate('ChurchCommunity', { church: item, churchId: item.id })}
          activeOpacity={0.9}
        >
          <MaterialIcons name="forum" size={16} color="#0A1628" />
          <Text style={styles.communityBtnText}>{t('dir.openCommunity')}</Text>
          <MaterialIcons name="chevron-right" size={18} color="#0A1628" style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
      </View>
    );
  };

  const closeForm = () => {
    setShowAddForm(false);
    setEditingChurch(null);
    setNewChurch({ name: '', country: '', county: '', conference: '', district: '', location: '', members: '', pastor: '', contact: '' });
    setImage(null);
  };

  const renderAddForm = () => (
    <Modal
      visible={showAddForm}
      animationType="slide"
      onRequestClose={closeForm}
      statusBarTranslucent
    >
      <View style={styles.formRoot}>
        {/* Same rotating wallpaper the choir community/screens use. */}
        <RotatingBackground intervalMs={45000} scrimColor="rgba(10,22,40,0.8)" />
        <SafeAreaView style={styles.formSafe} edges={['top']}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={closeForm} style={styles.topIconBtn} hitSlop={10}>
              <MaterialIcons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.topTitle}>{editingChurch ? t('churches.editTitle') : t('churches.newTitle')}</Text>
            <View style={styles.topIconBtn} />
          </View>

          <KeyboardAwareScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              showsVerticalScrollIndicator={false}
              enableOnAndroid
              enableResetScrollToCoords={false}
              extraScrollHeight={Platform.OS === 'ios' ? 24 : 90}
            >
              <TouchableOpacity style={styles.coverPicker} onPress={pickImage} activeOpacity={0.85}>
                {image ? (
                  <Image source={{ uri: image }} style={styles.coverPreview} contentFit="cover" transition={150} />
                ) : (
                  <View style={styles.coverPlaceholder}>
                    <MaterialIcons name="add-a-photo" size={26} color={colors.accent} />
                    <Text style={styles.coverHint}>{editingChurch ? t('churches.changeImage') : t('churches.addImage')}</Text>
                  </View>
                )}
              </TouchableOpacity>

              <Field label={t('churches.nameLabel')} value={newChurch.name} onChangeText={(v) => setNewChurch({ ...newChurch, name: v })} placeholder={t('churches.namePlaceholder')} />
              <Field label={t('churches.countryLabel')} value={newChurch.country} onChangeText={(v) => setNewChurch({ ...newChurch, country: v })} placeholder={t('churches.countryPlaceholder')} />
              <Field label={t('churches.countyLabel')} value={newChurch.county} onChangeText={(v) => setNewChurch({ ...newChurch, county: v })} placeholder={t('churches.optional')} />
              <Field label={t('churches.conferenceLabel')} value={newChurch.conference} onChangeText={(v) => setNewChurch({ ...newChurch, conference: v })} placeholder={t('churches.conferencePlaceholder')} />
              <Field label={t('churches.districtLabel')} value={newChurch.district} onChangeText={(v) => setNewChurch({ ...newChurch, district: v })} placeholder={t('churches.optional')} />
              <Field label={t('churches.locationLabel')} value={newChurch.location} onChangeText={(v) => setNewChurch({ ...newChurch, location: v })} placeholder={t('churches.townPlaceholder')} />
              <Field label={t('churches.membersLabel')} value={newChurch.members} onChangeText={(v) => setNewChurch({ ...newChurch, members: v })} placeholder={t('churches.membersPlaceholder')} keyboardType="numeric" />
              <Field label={t('churches.pastorLabel')} value={newChurch.pastor} onChangeText={(v) => setNewChurch({ ...newChurch, pastor: v })} placeholder={t('churches.optional')} />
              <Field label={t('churches.contactLabel')} value={newChurch.contact} onChangeText={(v) => setNewChurch({ ...newChurch, contact: v })} placeholder={t('dir.phonePlaceholder')} keyboardType="phone-pad" />

              <View style={{ height: spacing.xl }} />
            </KeyboardAwareScrollView>

          <View style={styles.saveBar}>
            <TouchableOpacity style={[styles.saveBtn, styles.cancelBtn]} onPress={closeForm}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, styles.submitBtn]} onPress={handleAddChurch}>
              <Text style={styles.submitText}>{editingChurch ? t('churches.saveChanges') : t('churches.addChurch')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  // Get unique values for filter dropdowns
  const countries = [...new Set(churches.map(church => church.country).filter(Boolean))];
  const conferences = [...new Set(churches.map(church => church.conference).filter(Boolean))];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('churches.title')}</Text>
      <Text style={styles.subtitle}>
        {filteredChurches.length} {filteredChurches.length === 1 ? 'church' : 'churches'}
      </Text>

      {/* Search and Filter Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <MaterialIcons name="search" size={18} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('churches.searchPlaceholder')}
            placeholderTextColor={colors.placeholder}
            value={searchTerm}
            onChangeText={setSearchTerm}
          />
          {searchTerm ? (
            <TouchableOpacity onPress={() => setSearchTerm('')}>
              <MaterialIcons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity 
          style={styles.filterButton}
          onPress={() => setShowFilters(!showFilters)}
        >
          <MaterialIcons name="filter-list" size={20} color={colors.accent} />
        </TouchableOpacity>
      </View>
      
      {/* Filters Panel */}
      {showFilters && (
        <View style={styles.filtersPanel}>
          <Text style={styles.filterTitle}>{t('churches.filterBy')}</Text>

          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>{t('churches.country')}</Text>
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
            <Text style={styles.filterLabel}>{t('churches.conference')}</Text>
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
            <Text style={styles.clearFiltersText}>{t('churches.clearFilters')}</Text>
          </TouchableOpacity>
        </View>
      )}
      
      <FlatList
        data={filteredChurches}
        renderItem={renderItem}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore
            ? <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 16 }} />
            : null
        }
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
            <MaterialIcons name="church" size={56} color={colors.textMuted} />
            <Text style={styles.emptyText}>{t('churches.none')}</Text>
            <Text style={styles.emptySubtext}>
              {searchTerm || filterValues.country || filterValues.conference
                ? t('churches.adjustSearch')
                : t('churches.beFirst')}
            </Text>
          </View>
        }
      />

      {currentUser && (
        <TouchableOpacity 
          style={styles.addButton} 
          onPress={() => setShowAddForm(true)}
        >
          <MaterialIcons name="add" size={18} color="white" />
          <Text style={styles.buttonText}>{t('churches.add')}</Text>
        </TouchableOpacity>
      )}

      {renderAddForm()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    marginTop: 2,
    textAlign: 'center',
    letterSpacing: 0.3,
    color: colors.accent,
  },
  subtitle: {
    fontSize: 11,
    textAlign: 'center',
    color: colors.textSecondary,
    marginTop: 1,
    marginBottom: 8,
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
    backgroundColor: 'rgba(16,46,80,0.7)',
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
    color: colors.textPrimary,
  },
  filterButton: {
    marginLeft: 8,
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: 'rgba(16,46,80,0.7)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filtersPanel: {
    backgroundColor: 'rgba(16,46,80,0.85)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: 16,
    marginBottom: 16,
  },
  filterTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  filterGroup: {
    marginBottom: 16,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  filterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  filterOption: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: 'rgba(13,35,64,0.7)',
  },
  filterOptionSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterOptionText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  filterOptionTextSelected: {
    color: '#0A1628',
    fontWeight: '700',
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
    backgroundColor: 'rgba(16,46,80,0.55)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: 12,
    marginBottom: 10,
    ...shadows.md,
  },
  churchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: 'rgba(244,162,97,0.35)',
  },
  username: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.textPrimary,
  },
  byline: {
    fontSize: 10.5,
    color: colors.textMuted,
    marginTop: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  churchName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  churchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  moreBtn: { padding: 2, alignItems: 'center', justifyContent: 'center' },
  churchImage: {
    width: '100%',
    height: 96,
    borderRadius: 10,
    marginBottom: 8,
  },
  churchImagePlaceholder: {
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  churchDetails: {
    gap: 3,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailText: {
    color: colors.textSecondary,
    marginLeft: 6,
    fontSize: 12.5,
    flex: 1,
  },
  metaContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  communityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    backgroundColor: '#F4A261',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  communityBtnText: { color: '#0A1628', fontWeight: '800', fontSize: 13 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(244,162,97,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,162,97,0.4)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.full,
  },
  chipText: {
    color: colors.accent,
    fontSize: 12.5,
    fontWeight: '600',
  },
  addButton: {
    backgroundColor: colors.accent,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: radius.full,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 6,
    ...shadows.sm,
  },
  buttonText: {
    color: '#0A1628',
    fontWeight: '800',
    fontSize: 13,
    marginLeft: 6,
  },
  // ── Luxury Add/Edit Church form (dark, over the rotating wallpaper) ─────────
  formRoot: { flex: 1, backgroundColor: '#0A1628' },
  formSafe: { flex: 1, backgroundColor: 'transparent' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  topIconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...typography.h3, color: colors.textPrimary },
  formContent: { padding: spacing.md },

  coverPicker: {
    height: 160, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: 'rgba(13,35,64,0.7)', borderWidth: 1, borderColor: 'rgba(244,162,97,0.4)',
    marginBottom: spacing.sm,
  },
  coverPreview: { width: '100%', height: '100%' },
  coverPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  coverHint: { ...typography.caption, color: colors.textSecondary },

  fieldLabel: { ...typography.label, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  fieldInput: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.textPrimary, backgroundColor: 'rgba(13,35,64,0.85)', fontSize: 15,
  },

  saveBar: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(16,46,80,0.92)',
  },
  saveBtn: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.md, alignItems: 'center' },
  cancelBtn: { backgroundColor: 'rgba(18,30,46,0.9)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  cancelText: { ...typography.button, color: colors.textSecondary },
  submitBtn: { backgroundColor: colors.accent, ...shadows.md },
  submitText: { ...typography.button, color: '#0A1628', fontWeight: '800' },
});

export default Churches;